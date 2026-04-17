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
    return buildPublicURLFromAbsoluteFilePath(
      mediaroot,
      httpPort,
      mp4AbsolutePath,
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
