const path = require("path");
const fs = require("fs").promises;

function buildPublicURLFromAbsoluteFilePath(mediaroot, httpPort, absPath) {
  const normalizedMediaRoot = path.resolve(mediaroot);
  const normalizedAbsPath = path.resolve(absPath);

  if (!normalizedAbsPath.startsWith(normalizedMediaRoot)) {
    throw new Error("El archivo no está dentro del mediaroot configurado");
  }

  const relativePath = path.relative(normalizedMediaRoot, normalizedAbsPath);
  const publicPath = relativePath.split(path.sep).join("/");

  return `http://localhost:${httpPort}/${publicPath}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findMp4PublicUrl(folderPath, mediaroot, httpPort) {
  try {
    const files = await fs.readdir(folderPath);

    const mp4Files = files.filter(
      (file) => path.extname(file).toLowerCase() === ".mp4",
    );

    if (!mp4Files.length) {
      console.warn(
        "No se encontró ningún archivo MP4 en la carpeta del stream",
      );
      return null;
    }

    const mp4FilesWithStats = await Promise.all(
      mp4Files.map(async (file) => {
        const fullPath = path.join(folderPath, file);
        const stats = await fs.stat(fullPath);

        return {
          file,
          fullPath,
          mtimeMs: stats.mtimeMs,
        };
      }),
    );

    mp4FilesWithStats.sort((a, b) => b.mtimeMs - a.mtimeMs);

    const newestMp4Path = mp4FilesWithStats[0].fullPath;

    return buildPublicURLFromAbsoluteFilePath(
      mediaroot,
      httpPort,
      newestMp4Path,
    );
  } catch (error) {
    console.error("Error al buscar el archivo MP4:", error);
    return null;
  }
}

module.exports = {
  buildPublicURLFromAbsoluteFilePath,
  delay,
  fileExists,
  findMp4PublicUrl,
};
