async function getVideoCreatedAt(db, streamKey) {
  const [rows] = await db.execute(
    `SELECT id, created_at
     FROM videos
     WHERE stream_key = ?
     ORDER BY id DESC
     LIMIT 1`,
    [streamKey],
  );

  if (!rows.length) {
    return null;
  }

  return rows[0].created_at;
}

function calculateDurationSeconds(createdAt) {
  if (!createdAt) return 0;

  const createdAtDate = new Date(createdAt);
  const now = new Date();

  return Math.max(0, Math.floor((now - createdAtDate) / 1000));
}

async function insertVideoRecord(db, streamKey, folderPath, hlsPath, dashPath) {
  const title = `Emisión ${streamKey} - ${new Date().toLocaleString("es-ES")}`;

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

async function markVideoAsProcessing(db, streamKey) {
  const createdAt = await getVideoCreatedAt(db, streamKey);
  const durationSeconds = calculateDurationSeconds(createdAt);

  await db.execute(
    `UPDATE videos
     SET status = 'PROCESSING',
         ended_at = NOW(),
         duration_seconds = ?
     WHERE stream_key = ?
     ORDER BY id DESC
     LIMIT 1`,
    [durationSeconds, streamKey],
  );
}

async function finalizeVideoRecord(db, streamKey, mp4Path) {
  const createdAt = await getVideoCreatedAt(db, streamKey);
  const durationSeconds = calculateDurationSeconds(createdAt);

  await db.execute(
    `UPDATE videos
     SET status = 'READY',
         ended_at = NOW(),
         mp4_path = ?,
         duration_seconds = ?
     WHERE stream_key = ?
     ORDER BY id DESC
     LIMIT 1`,
    [mp4Path, durationSeconds, streamKey],
  );
}

async function markVideoAsError(db, streamKey) {
  const createdAt = await getVideoCreatedAt(db, streamKey);
  const durationSeconds = calculateDurationSeconds(createdAt);

  await db.execute(
    `UPDATE videos
     SET status = 'ERROR',
         ended_at = NOW(),
         duration_seconds = ?
     WHERE stream_key = ?
     ORDER BY id DESC
     LIMIT 1`,
    [durationSeconds, streamKey],
  );
}

async function createPendingVideo(db, title, streamKey) {
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
    [title, streamKey],
  );
}

async function findPendingVideoByStreamKey(db, streamKey) {
  const [rows] = await db.execute(
    `SELECT id, title, stream_key
     FROM videos
     WHERE stream_key = ? AND status = 'PENDING'
     ORDER BY created_at DESC
     LIMIT 1`,
    [streamKey],
  );

  return rows.length ? rows[0] : null;
}

async function activatePendingVideo(db, id, folderPath, hlsPath, dashPath) {
  await db.execute(
    `UPDATE videos
     SET status = 'LIVE',
         folder_path = ?,
         hls_path = ?,
         dash_path = ?
     WHERE id = ?`,
    [folderPath, hlsPath, dashPath, id],
  );
}

module.exports = {
  insertVideoRecord,
  markVideoAsProcessing,
  finalizeVideoRecord,
  markVideoAsError,
  createPendingVideo,
  findPendingVideoByStreamKey,
  activatePendingVideo,
};
