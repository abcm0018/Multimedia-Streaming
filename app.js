const NodeMediaServer = require("./");
const path = require("path");
const fs = require("fs").promises;

const { createDatabaseConnection } = require("./db/connection");
const {
  insertVideoRecord,
  markVideoAsProcessing,
  finalizeVideoRecord,
  markVideoAsError,
} = require("./services/videoService");
const {
  buildPublicURLFromAbsoluteFilePath,
  delay,
  fileExists,
  findMp4PublicUrl,
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
    mediaroot:
      "C:/Users/anabe/Desktop/Master/Segundo Cuatrimestre/Advanced Multimedia Services/Practica 2/node-media-server/media",
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
    ffmpeg: "C:/ffmpeg/ffmpeg.exe",
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

    await insertVideoRecord(db, streamKey, folderPath, hlsPath, dashPath);

    console.log(`[DB] Emisión ${streamKey} insertada correctamente`);
  } catch (error) {
    console.error("[DB] Error al insertar la emisión:", error);
  }
});

nms.on("donePublish", async (id, streamPath, args) => {
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

    await markVideoAsProcessing(db, streamKey);

    const folderPath = path.join(config.http.mediaroot, appName, streamKey);

    await delay(1500);

    const hlsManifestPath = path.join(folderPath, "hls", "master.m3u8");
    const hlsExists = await fileExists(hlsManifestPath);

    if (!hlsExists) {
      console.error(
        `[STREAM] No se generaron correctamente los manifiestos ABR para ${streamKey}`,
      );
      await markVideoAsError(db, streamKey);
      return;
    }

    const mp4Path = await findMp4PublicUrl(
      folderPath,
      config.http.mediaroot,
      config.http.port,
    );

    await finalizeVideoRecord(db, streamKey, mp4Path);

    console.log(`[DB] Emisión ${streamKey} actualizada a READY`);
    console.log(`[DB] MP4 detectado: ${mp4Path || "No encontrado"}`);
  } catch (error) {
    console.error("[DB] Error al finalizar la emisión:", error);

    try {
      const streamKey = getStreamKey(streamPath);
      if (streamKey) {
        await markVideoAsError(db, streamKey);
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
    await initializeDatabase();
    nms.run();
    console.log("[SERVER] Node Media Server iniciado correctamente");
  } catch (error) {
    console.error("[SERVER] Error al iniciar la aplicación:", error);
  }
}

startServer();
