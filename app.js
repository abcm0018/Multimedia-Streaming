const NodeMediaServer = require("./");
const path = require("path");
const { createDatabaseConnection } = require("./db/connection");

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
        hlsFlags: "[hls_time=2:hls_list_size=0]", // list_size=0 guarda TODOS los segmentos → clave para VOD
        dash: true,
        dashFlags: "[f=dash:window_size=6:extra_window_size=6]",
        // mp4 eliminado
      },
    ],
  },
};

let nms = new NodeMediaServer(config);
let db;

async function initializeDatabase() {
  db = await createDatabaseConnection();
  console.log("Database connection established");
}

function getAppName(streamPath) {
  const parts = streamPath.split("/").filter(Boolean);
  return parts.length >= 1 ? parts[0] : null;
}

function getStreamKey(streamPath) {
  const parts = streamPath.split("/").filter(Boolean);
  return parts.length >= 2 ? parts[1] : null;
}

function buildFolderPath(appName, streamKey) {
  return path.join(config.http.mediaroot, appName, streamKey);
}

function buildPublicURLFromAbsoluteFilePath(absPath) {
  const normalizedMediaRoot = path.resolve(config.http.mediaroot);
  const normalizedAbsPath = path.resolve(absPath);

  if (!normalizedAbsPath.startsWith(normalizedMediaRoot)) {
    throw new Error("El archivo no está dentro del mediaroot configurado");
  }

  const relativePath = path.relative(normalizedMediaRoot, normalizedAbsPath);
  const publicPath = relativePath.split(path.sep).join("/");
  return `http://localhost:${config.http.port}/${publicPath}`;
}

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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function insertVideoRecord(streamKey, folderPath, hlsPath, dashPath) {
  const title = `Emisión ${streamKey}`;
  await db.execute(
    `INSERT INTO videos (
      title, stream_key, folder_path, hls_path, dash_path, status, created_at
    ) VALUES (?, ?, ?, ?, ?, 'LIVE', NOW())`,
    [title, streamKey, folderPath, hlsPath, dashPath],
  );
}

async function finalizeVideoRecord(streamKey) {
  await db.execute(
    `UPDATE videos
     SET status = 'READY', ended_at = NOW()
     WHERE stream_key = ?
     ORDER BY id DESC
     LIMIT 1`,
    [streamKey],
  );
}

async function markVideoAsError(streamKey) {
  await db.execute(
    `UPDATE videos
     SET status = 'ERROR', ended_at = NOW()
     WHERE stream_key = ?
     ORDER BY id DESC
     LIMIT 1`,
    [streamKey],
  );
}

nms.on("preConnect", (id, args) => {
  console.log("[NodeEvent on preConnect]", `id=${id} args=${JSON.stringify(args)}`);
});

nms.on("postPublish", async (id, streamPath, args) => {
  try {
    console.log("[NodeEvent on postPublish]", `id=${id} streamPath=${streamPath}`);
    const appName = getAppName(streamPath);
    const streamKey = getStreamKey(streamPath);

    if (!appName || !streamKey) {
      console.error("[STREAM] No se pudo extraer appName o streamKey");
      return;
    }

    const { folderPath, hlsPath, dashPath } = buildStreamingPaths(appName, streamKey);
    await insertVideoRecord(streamKey, folderPath, hlsPath, dashPath);
    console.log(`[DB] Emisión ${streamKey} insertada correctamente`);
  } catch (error) {
    console.error("[DB] Error al insertar la emisión:", error);
  }
});

nms.on("donePublish", async (id, streamPath, args) => {
  try {
    console.log("[NodeEvent on donePublish]", `id=${id} streamPath=${streamPath}`);
    const appName = getAppName(streamPath);
    const streamKey = getStreamKey(streamPath);

    if (!appName || !streamKey) {
      console.error("[STREAM] No se pudo extraer appName o streamKey");
      return;
    }

    // Pequeña espera para que ffmpeg cierre el .m3u8 correctamente
    await delay(2000);

    await finalizeVideoRecord(streamKey);
    console.log(`[DB] Emisión ${streamKey} actualizada a READY (VOD vía HLS)`);
  } catch (error) {
    console.error("[DB] Error al finalizar la emisión:", error);
    try {
      const streamKey = getStreamKey(streamPath);
      if (streamKey) await markVideoAsError(streamKey);
    } catch (innerError) {
      console.error("[DB] Error al marcar la emisión como ERROR:", innerError);
    }
  }
});

nms.on("doneConnect", (id, args) => {
  console.log("[NodeEvent on doneConnect]", `id=${id} args=${JSON.stringify(args)}`);
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
const express = require('express');
const cors = require('cors');
const { createDatabaseConnection } = require('./db/connection');

const app = express();
app.use(cors());

app.get('/api/videos', async (req, res) => {
  try {
    const db = await createDatabaseConnection();
    const [rows] = await db.execute(
      `SELECT id, title, stream_key, hls_path, dash_path, status, created_at, ended_at
       FROM videos
       WHERE status = 'READY'
       ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3001, () => console.log('[API] Escuchando en puerto 3001'));
startServer();
