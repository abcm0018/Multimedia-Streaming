const NodeMediaServer = require("./");
const path = require("path");
const fs = require("fs").promises;

const { createDatabaseConnection } = require("./db/connection");
const {
  insertVideoRecord,
  markVideoAsProcessing,
  finalizeVideoRecord,
  markVideoAsError,
  findPendingVideoByStreamKey,
  activatePendingVideo,
  findLatestVideoByStreamKey,
  markVideoAsProcessingById,
  finalizeVideoRecordById,
  markVideoAsErrorById,
} = require("./services/videoService");
const {
  buildPublicURLFromAbsoluteFilePath,
  delay,
  fileExists,
  findMp4PublicUrl,
  copyDirectory,
} = require("./services/mediaUtils");

const config = {
  rtmp: {
    port: 1935,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60,
  },
  http: {
    port: 8000,
    mediaroot: "C:/Users/Ana Belen/OneDrive/Escritorio/Multimedia-Streaming/media",
    webroot: "./www",
    allow_origin: "*",
    api: true,
  },
  https: {
    port: 8443,
    key: "./privatekey.pem",
    cert: "./certificate.pem",
  },
  auth: {
    api: true,
    api_user: "admin",
    api_pass: "admin",
    play: false,
    publish: false,
    secret: "nodemedia2017privatekey",
  },
  trans: {
    ffmpeg: "C:/ffmpeg/bin/ffmpeg.exe",
    tasks: [
      {
        app: "live",
        hlsAbr: true,
        keepSegments: true,
        mp4: true,
        mp4Flags: "[movflags=faststart]",
      },
    ],
  },
};

let nms = new NodeMediaServer(config);
let db;

/**
 * Inicializa la conexión a la base de datos
 */
async function initializeDatabase() {
  db = await createDatabaseConnection();
  console.log("Database connection established");
}

/**
 * Extrae el nombre de la app desde el streamPath
 * @param {string} streamPath - El path del stream (e.g., "/live/stream")
 * @returns {string} - El nombre de la app (e.g., "live")
 */
function getAppName(streamPath) {
  const parts = streamPath.split("/").filter(Boolean);
  return parts.length >= 1 ? parts[0] : null;
}

function getStreamKey(streamPath) {
  const parts = streamPath.split("/").filter(Boolean);
  return parts.length >= 2 ? parts[1] : null;
}

/**
 * Eventos de Node Media Server
 */
nms.on("preConnect", (id, args) => {
  console.log(
    "[NodeEvent on preConnect]",
    `id=${id} args=${JSON.stringify(args)}`,
  );
});

nms.on("postPublish", async (id, streamPath, args) => {
  try {
    console.log(
      "[NodeEvent on postPublish]",
      `id=${id} streamPath=${streamPath} args=${JSON.stringify(args)}`,
    );

    const appName = getAppName(streamPath);
    const streamKey = getStreamKey(streamPath);

    if (!appName || !streamKey) {
      console.error("[STREAM] No se pudo extraer appName o streamKey");
      return;
    }

    const folderPath = path.join(config.http.mediaroot, appName, streamKey);
    const hlsAbsolutePath = path.join(folderPath, "hls", "master.m3u8");
    const dashAbsolutePath = path.join(folderPath, "manifest.mpd");

    const hlsPath = buildPublicURLFromAbsoluteFilePath(
      config.http.mediaroot,
      config.http.port,
      hlsAbsolutePath,
    );

    const dashPath = buildPublicURLFromAbsoluteFilePath(
      config.http.mediaroot,
      config.http.port,
      dashAbsolutePath,
    );

    const pendingVideo = await findPendingVideoByStreamKey(db, streamKey);

    if (pendingVideo) {
      await activatePendingVideo(
        db,
        pendingVideo.id,
        folderPath,
        hlsPath,
        dashPath,
      );
      console.log(`[DB] Emisión pendiente ${streamKey} activada correctamente`);
    } else {
      await insertVideoRecord(db, streamKey, folderPath, hlsPath, dashPath);
      console.log(
        `[DB] No había pendiente. Emisión ${streamKey} insertada automáticamente`,
      );
    }
  } catch (error) {
    console.error("[DB] Error al insertar/activar la emisión:", error);
  }
});

nms.on("donePublish", async (id, streamPath, args) => {
  let video = null;
  try {
    console.log(
      "[NodeEvent on donePublish]",
      `id=${id} streamPath=${streamPath}`,
    );

    const appName = getAppName(streamPath);
    const streamKey = getStreamKey(streamPath);

    if (!appName || !streamKey) {
      console.error("[STREAM] No se pudo extraer appName o streamKey");
      return;
    }

    video = await findLatestVideoByStreamKey(db, streamKey);

    if (!video) {
      console.error(`[DB] No se encontró vídeo para streamKey=${streamKey}`);
      return;
    }

    await markVideoAsProcessingById(db, video.id);

    const folderPath = path.join(config.http.mediaroot, appName, streamKey);

    await delay(2000);

    const hlsSourceFolder = path.join(folderPath, "hls");
    const hlsManifestPath = path.join(hlsSourceFolder, "master.m3u8");
    const hlsExists = await fileExists(hlsManifestPath);

    if (!hlsExists) {
      console.error(
        `[STREAM] No se generaron correctamente los manifiestos ABR para ${streamKey}`,
      );
      await markVideoAsErrorById(db, video.id);
      return;
    }

    const vodHlsFolder = path.join(folderPath, "vod", String(video.id), "hls");

    await copyDirectory(hlsSourceFolder, vodHlsFolder);

    const vodHlsManifestPath = path.join(vodHlsFolder, "master.m3u8");

    const vodHlsPath = buildPublicURLFromAbsoluteFilePath(
      config.http.mediaroot,
      config.http.port,
      vodHlsManifestPath,
    );

    const mp4Path = await findMp4PublicUrl(
      folderPath,
      config.http.mediaroot,
      config.http.port,
    );

    await finalizeVideoRecordById(db, video.id, mp4Path, vodHlsPath);

    console.log(`[DB] Emisión ${streamKey} actualizada a READY`);
    console.log(`[DB] ID vídeo: ${video.id}`);
    console.log(`[DB] HLS histórico: ${vodHlsPath}`);
    console.log(`[DB] MP4 detectado: ${mp4Path || "No encontrado"}`);
  } catch (error) {
    console.error("[DB] Error al finalizar la emisión:", error);

    try {
      if (video && video.id) {
        await markVideoAsErrorById(db, video.id);
      } else {
        const streamKey = getStreamKey(streamPath);

        if (streamKey) {
          await markVideoAsError(db, streamKey);
        }
      }
    } catch (innerError) {
      console.error("[DB] Error al marcar la emisión como ERROR:", innerError);
    }
  }
});


nms.on("doneConnect", (id, args) => {
  console.log(
    "[NodeEvent on doneConnect]",
    `id=${id} args=${JSON.stringify(args)}`,
  );
});

async function startServer() {
  try {
    await fs.mkdir(config.http.mediaroot, { recursive: true });
    await initializeDatabase();
    nms.run();
    console.log("[SERVER] Node Media Server iniciado correctamente");
  } catch (error) {
    console.error("[SERVER] Error al iniciar la aplicación:", error);
  }
}

startServer();
