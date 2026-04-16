const NodeMediaServer = require("./");
const path = require("path");
const fs = require("fs").promises;

const activeTranscoders = new Map();

const { createDatabaseConnection } = require("./db/connection");
const { spawn } = require("child_process");

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
    tasks: [{ app: "live", mp4: true, mp4Flags: "[movflags=faststart]" }],
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

  const hlsAbsolutePath = path.join(folderPath, "hls", "master.m3u8");
  const dashAbsolutePath = path.join(folderPath, "dash", "manifest.mpd");

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
 * Función para comprobar si hay manifiestos
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Funciones de arranque FFmpeg para HLS/DASH
 */
async function startHlsAbrTranscoding(appName, streamKey, folderPath) {
  const inputUrl = `rtmp://127.0.0.1/${appName}/${streamKey}`;
  const hlsRoot = path.join(folderPath, "hls");

  await fs.mkdir(hlsRoot, { recursive: true });

  const args = [
    "-y",
    "-i",
    inputUrl,

    "-filter_complex",
    "[0:v]split=3[v1][v2][v3];" +
      "[v1]scale=w=426:h=240:force_original_aspect_ratio=decrease:force_divisible_by=2[v240];" +
      "[v2]scale=w=854:h=480:force_original_aspect_ratio=decrease:force_divisible_by=2[v480];" +
      "[v3]scale=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2[v720]",

    "-map",
    "[v240]",
    "-map",
    "0:a?",
    "-map",
    "[v480]",
    "-map",
    "0:a?",
    "-map",
    "[v720]",
    "-map",
    "0:a?",

    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-profile:v",
    "main",
    "-g",
    "48",
    "-keyint_min",
    "48",
    "-sc_threshold",
    "0",

    "-c:a",
    "aac",
    "-ar",
    "48000",

    "-b:v:0",
    "400k",
    "-maxrate:v:0",
    "428k",
    "-bufsize:v:0",
    "600k",
    "-b:a:0",
    "64k",
    "-b:v:1",
    "1200k",
    "-maxrate:v:1",
    "1284k",
    "-bufsize:v:1",
    "1800k",
    "-b:a:1",
    "96k",
    "-b:v:2",
    "2800k",
    "-maxrate:v:2",
    "2996k",
    "-bufsize:v:2",
    "4200k",
    "-b:a:2",
    "128k",

    "-f",
    "hls",
    "-hls_time",
    "4",
    "-hls_playlist_type",
    "event",
    "-hls_flags",
    "independent_segments",
    "-master_pl_name",
    "master.m3u8",
    "-var_stream_map",
    "v:0,a:0,name:240p v:1,a:1,name:480p v:2,a:2,name:720p",
    "-hls_segment_filename",
    path.join(hlsRoot, "%v", "seg_%06d.ts"),
    path.join(hlsRoot, "%v", "index.m3u8"),
  ];

  const proc = spawn(config.trans.ffmpeg, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  proc.stdout.on("data", (data) => {
    console.log(`[FFMPEG-HLS-${streamKey}] ${data}`);
  });

  proc.stderr.on("data", (data) => {
    console.log(`[FFMPEG-HLS-${streamKey}] ${data}`);
  });

  proc.on("error", (error) => {
    console.error(`[FFMPEG-HLS-${streamKey}] Error al arrancar FFmpeg:`, error);
  });

  proc.on("close", (code) => {
    console.log(`[FFMPEG-HLS-${streamKey}] finalizado con código ${code}`);
  });

  return proc;
}

async function startDashAbrTranscoding(appName, streamKey, folderPath) {
  const inputUrl = `rtmp://127.0.0.1/${appName}/${streamKey}`;
  const dashRoot = path.join(folderPath, "dash");

  await fs.mkdir(dashRoot, { recursive: true });

  const args = [
    "-y",
    "-i",
    inputUrl,

    "-filter_complex",
    "[0:v]split=4[v1][v2][v3][v4];" +
      "[v1]scale=w=426:h=240:force_original_aspect_ratio=decrease:force_divisible_by=2[v240];" +
      "[v2]scale=w=854:h=480:force_original_aspect_ratio=decrease:force_divisible_by=2[v480];" +
      "[v3]scale=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2[v720];" +
      "[v4]scale=w=1920:h=1080:force_original_aspect_ratio=decrease:force_divisible_by=2[v1080]",

    "-map",
    "[v240]",
    "-map",
    "0:a?",
    "-map",
    "[v480]",
    "-map",
    "0:a?",
    "-map",
    "[v720]",
    "-map",
    "0:a?",
    "-map",
    "[v1080]",
    "-map",
    "0:a?",

    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-profile:v",
    "main",
    "-g",
    "48",
    "-keyint_min",
    "48",
    "-sc_threshold",
    "0",

    "-c:a",
    "aac",
    "-ar",
    "48000",

    "-b:v:0",
    "400k",
    "-maxrate:v:0",
    "428k",
    "-bufsize:v:0",
    "600k",
    "-b:a:0",
    "64k",
    "-b:v:1",
    "1200k",
    "-maxrate:v:1",
    "1284k",
    "-bufsize:v:1",
    "1800k",
    "-b:a:1",
    "96k",
    "-b:v:2",
    "2800k",
    "-maxrate:v:2",
    "2996k",
    "-bufsize:v:2",
    "4200k",
    "-b:a:2",
    "128k",
    "-b:v:3",
    "5000k",
    "-maxrate:v:3",
    "5350k",
    "-bufsize:v:3",
    "7500k",
    "-b:a:3",
    "128k",

    "-use_timeline",
    "1",
    "-use_template",
    "1",
    "-window_size",
    "10",
    "-extra_window_size",
    "10",
    "-seg_duration",
    "2",
    "-adaptation_sets",
    "id=0,streams=v id=1,streams=a",
    "-f",
    "dash",
    path.join(dashRoot, "manifest.mpd"),
  ];

  const proc = spawn(config.trans.ffmpeg, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  proc.stdout.on("data", (data) => {
    console.log(`[FFMPEG-DASH-${streamKey}] ${data}`);
  });

  proc.stderr.on("data", (data) => {
    console.log(`[FFMPEG-DASH-${streamKey}] ${data}`);
  });

  proc.on("error", (error) => {
    console.error(
      `[FFMPEG-DASH-${streamKey}] Error al arrancar FFmpeg:`,
      error,
    );
  });

  proc.on("close", (code) => {
    console.log(`[FFMPEG-DASH-${streamKey}] finalizado con código ${code}`);
  });

  return proc;
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
 * Marca la emisión como PROCESSING cuando el directo ha terminado
 * pero todavía se están cerrando/manipulando los ficheros.
 */
async function markVideoAsProcessing(streamKey) {
  await db.execute(
    `UPDATE videos
     SET status = 'PROCESSING',
         ended_at = NOW(),
         duration_seconds = TIMESTAMPDIFF(SECOND, created_at, NOW())
     WHERE stream_key = ?
     ORDER BY id DESC
     LIMIT 1`,
    [streamKey],
  );
}

/**
 * Actualiza el último registro de ese stream cuando termina
 */
/**
 * Marca la emisión como READY cuando todo ha terminado correctamente
 */
async function finalizeVideoRecord(streamKey, mp4Path) {
  await db.execute(
    `UPDATE videos
     SET status = 'READY',
         ended_at = NOW(),
         mp4_path = ?,
         duration_seconds = TIMESTAMPDIFF(SECOND, created_at, NOW())
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
         ended_at = NOW(),
         duration_seconds = TIMESTAMPDIFF(SECOND, created_at, NOW())
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

    const hlsProc = await startHlsAbrTranscoding(
      appName,
      streamKey,
      folderPath,
    );
    // const dashProc = await startDashAbrTranscoding(
    //   appName,
    //   streamKey,
    //   folderPath,
    // );

    // activeTranscoders.set(streamKey, { hlsProc, dashProc });
    activeTranscoders.set(streamKey, { hlsProc });

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

    await markVideoAsProcessing(streamKey);

    const folderPath = buildFolderPath(appName, streamKey);

    const transcoders = activeTranscoders.get(streamKey);

    if (transcoders) {
      if (transcoders.hlsProc && !transcoders.hlsProc.killed) {
        transcoders.hlsProc.kill("SIGINT");
      }

      // if (transcoders.dashProc && !transcoders.dashProc.killed) {
      //   transcoders.dashProc.kill("SIGINT");
      // }

      activeTranscoders.delete(streamKey);
    }

    // Espera breve para que ffmpeg termine de escribir el MP4
    await delay(1500);

    const hlsManifestPath = path.join(folderPath, "hls", "master.m3u8");
    //const dashManifestPath = path.join(folderPath, "dash", "manifest.mpd");

    const hlsExists = await fileExists(hlsManifestPath);
    //const dashExists = await fileExists(dashManifestPath);

    // if (!hlsExists || !dashExists) {
    //   console.error(
    //     `[STREAM] No se generaron correctamente los manifiestos ABR para ${streamKey}`,
    //   );
    //   await markVideoAsError(streamKey);
    //   return;
    // }

    if (!hlsExists) {
      console.error(
        `[STREAM] No se generaron correctamente los manifiestos ABR para ${streamKey}`,
      );
      await markVideoAsError(streamKey);
      return;
    }

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
