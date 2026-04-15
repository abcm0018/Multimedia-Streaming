const NodeMediaServer = require("./");
const path = require("path");
const { createDatabaseConnection } = require("./db/connection");
const fs = require("fs").promises;

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
        hls: true,
        hlsFlags: "[hls_time=2:hls_list_size=0]",
        dash: true,
        dashFlags: "[f=dash:window_size=6:extra_window_size=6]",
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
 * Contruye la ruta de la carpeta donde NMS guarda los archivos
 */
function buildFolderPath(appName, streamKey) {
  return path.join(config.http.mediaroot, appName, streamKey);
}

/**
 * Convierte una ruta absoluta dentro del mediaroot a una URL pública HTTP
 */
function buildPublicURLFromAbsoluteFilePath(absPath) {
  const normalizedMediaRoot = path.resolve(config.http.mediaroot);
  const normalizedAbsPath = path.resolve(absPath);

  if (!normalizedAbsPath.startsWith(normalizedMediaRoot)) {
    throw new Error("El archivo no está dentro del mediaroot configurado");
  }

  const relativePath = path.relative(normalizedMediaRoot, normalizedAbsPath);
  const publicPath = relativePath.split(path.sep).join("/"); // Asegura que use "/" como separador
  return `http://localhost:${config.http.port}/${publicPath}`;
}

/**
 * Devuelve las rutas principales esperadas para HLS/DASH
 */
function buildStreamingPaths(appName, streamKey) {
  const folderPath = buildFolderPath(appName, streamKey);

  const hlsAbsolutePath = path.join(folderPath, "index.m3u8");
  const dashAbsolutePath = path.join(folderPath, "index.mpd");

  return {
    folderPath,
    hlsPath: buildPublicURLFromAbsoluteFilePath(hlsAbsolutePath),
    dashPath: buildPublicURLFromAbsoluteFilePath(dashAbsolutePath),
  };
}

/**
 * Funcion que da tiempo a ffmpeg a terminar de cerrar archivos
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Busca el primer MP4 dentro de la capeta del stream y devuelve su URL pública
 */
async function findMp4PublicUrl(folderPath) {
  try {
    const files = await fs.readdir(folderPath);

    const mp4File = files.find(
      (file) => path.extname(file).toLowerCase() === ".mp4",
    );
    if (!mp4File) {
      console.warn(
        "No se encontró ningún archivo MP4 en la carpeta del stream",
      );
      return null;
    }
    const mp4AbsolutePath = path.join(folderPath, mp4File);
    return buildPublicURLFromAbsoluteFilePath(mp4AbsolutePath);
  } catch (error) {
    console.error("Error al buscar el archivo MP4:", error);
    return null;
  }
}

/**
 * Inserta una nueva emisión en la BD al empezar el stream.
 */
async function insertVideoRecord(streamKey, folderPath, hlsPath, dashPath) {
  const title = `Emisión ${streamKey}`;

  await db.execute(
    `INSERT INTO videos (
      title,
      stream_key,
      folder_path,
      hls_path,
      dash_path,
      mp4_path,
      status,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'LIVE', NOW())`,
    [title, streamKey, folderPath, hlsPath, dashPath, null],
  );
}

/**
 * Actualiza el último registro de ese stream cuando termina
 */
async function finalizeVideoRecord(streamKey, mp4Path) {
  await db.execute(
    `UPDATE videos
     SET status = 'READY',
         ended_at = NOW(),
         mp4_path = ?
     WHERE stream_key = ?
     ORDER BY id DESC
     LIMIT 1`,
    [mp4Path, streamKey],
  );
}

/**
 * Si hay error al publicar, opcionalmente marca el stream como ERROR.
 */
async function markVideoAsError(streamKey) {
  await db.execute(
    `UPDATE videos
     SET status = 'ERROR',
         ended_at = NOW()
     WHERE stream_key = ?
     ORDER BY id DESC
     LIMIT 1`,
    [streamKey],
  );
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

    const { folderPath, hlsPath, dashPath } = buildStreamingPaths(
      appName,
      streamKey,
    );

    await insertVideoRecord(streamKey, folderPath, hlsPath, dashPath);

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

    const folderPath = buildFolderPath(appName, streamKey);

    // Espera breve para que ffmpeg termine de escribir el MP4
    await delay(3000);

    const mp4Path = await findMp4PublicUrl(folderPath);

    await finalizeVideoRecord(streamKey, mp4Path);

    console.log(`[DB] Emisión ${streamKey} actualizada a READY`);
    console.log(`[DB] MP4 detectado: ${mp4Path || "No encontrado"}`);
  } catch (error) {
    console.error("[DB] Error al finalizar la emisión:", error);

    try {
      const streamKey = getStreamKey(streamPath);
      if (streamKey) {
        await markVideoAsError(streamKey);
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

/**
 * Arranque principal
 */
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
