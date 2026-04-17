const { createDatabaseConnection } = require("../../db/connection");

let db;

async function getDb() {
  if (!db) {
    db = await createDatabaseConnection();
    console.log("[API] Conexión a BD establecida");
  }
  return db;
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
  getVideos,
  getLiveVideos,
  getReadyVideos,
};
