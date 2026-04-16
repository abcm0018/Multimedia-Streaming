const express = require("express");
const cors = require("cors");
const { createDatabaseConnection } = require("./db/connection");

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

let db;

async function initializeDatabase() {
  db = await createDatabaseConnection();
  console.log("[API] Conexión a BD establecida");
}

app.get("/api/videos", async (req, res) => {
  try {
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
});

app.get("/api/videos/live", async (req, res) => {
  try {
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
});

app.get("/api/videos/ready", async (req, res) => {
  try {
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
});

async function startServer() {
  try {
    await initializeDatabase();

    app.listen(PORT, () => {
      console.log(`[API] Servidor corriendo en http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("[API] Error al iniciar:", error);
  }
}

startServer();
