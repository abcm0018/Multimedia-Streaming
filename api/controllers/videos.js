const { createDatabaseConnection } = require("../../db/connection");

let db;

async function getDb() {
  if (!db) {
    db = await createDatabaseConnection();
    console.log("[API] Conexión a BD establecida");
  }
  return db;
}

async function createVideo(req, res, next) {
  try {
    const db = await getDb();
    const { title, stream_key } = req.body;

    if (!title || !stream_key) {
      return res.status(400).json({
        error: "title y stream_key son obligatorios",
      });
    }

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
      ) VALUES (?, ?, NULL, NULL, NULL, NULL, 'PENDING', NOW())`,
      [title, stream_key],
    );

    res.status(201).json({ message: "Emisión preparada correctamente" });
  } catch (error) {
    console.error("[API] Error al crear emisión pendiente:", error);
    res.status(500).json({ error: "Error al crear emisión pendiente" });
  }
}

async function getVideos(req, res, next) {
  try {
    const db = await getDb();

    const [rows] = await db.execute(`
      SELECT 
        id,
        title,
        stream_key,
        folder_path,
        hls_path,
        dash_path,
        mp4_path,
        status,
        created_at,
        ended_at
      FROM videos
      ORDER BY created_at DESC
    `);

    res.json(rows);
  } catch (error) {
    console.error("[API] Error al obtener vídeos:", error);
    res.status(500).json({ error: "Error al obtener vídeos" });
  }
}

async function getLiveVideos(req, res, next) {
  try {
    const db = await getDb();

    const [rows] = await db.execute(`
      SELECT 
        id,
        title,
        stream_key,
        folder_path,
        hls_path,
        dash_path,
        mp4_path,
        status,
        created_at,
        ended_at
      FROM videos
      WHERE status = 'LIVE'
      ORDER BY created_at DESC
    `);

    res.json(rows);
  } catch (error) {
    console.error("[API] Error al obtener directos:", error);
    res.status(500).json({ error: "Error al obtener directos" });
  }
}

async function getReadyVideos(req, res, next) {
  try {
    const db = await getDb();

    const [rows] = await db.execute(`
      SELECT 
        id,
        title,
        stream_key,
        folder_path,
        hls_path,
        dash_path,
        mp4_path,
        status,
        created_at,
        ended_at
      FROM videos
      WHERE status = 'READY'
      ORDER BY created_at DESC
    `);

    res.json(rows);
  } catch (error) {
    console.error("[API] Error al obtener grabados:", error);
    res.status(500).json({ error: "Error al obtener grabados" });
  }
}

module.exports = {
  createVideo,
  getVideos,
  getLiveVideos,
  getReadyVideos,
};
