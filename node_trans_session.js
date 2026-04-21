//
//  Created by Mingliang Chen on 18/3/9.
//  illuspas[a]gmail.com
//  Copyright (c) 2018 Nodemedia. All rights reserved.
//

const Logger = require("./node_core_logger");

const EventEmitter = require("events");
const { spawn } = require("child_process");
const dateFormat = require("dateformat");
const mkdirp = require("mkdirp");
const fs = require("fs");

class NodeTransSession extends EventEmitter {
  constructor(conf) {
    super();
    this.conf = conf;
    this.mp4_exec = null;
  }

  /**
   * Contruye la ruta de la carpeta donde NMS guarda los archivos
   */
  buildFolderPath() {
    return `${this.conf.mediaroot}/${this.conf.streamApp}/${this.conf.streamName}`;
  }

  /**
   * Devuelve la ruta raíz física de HLS
   */
  buildHlsRootPath() {
    return `${this.buildFolderPath()}/hls`;
  }

  /**
   * Devuelve la ruta principal esperada para HLS/DASH
   */
  buildHlsMasterPath() {
    return `${this.buildHlsRootPath()}/master.m3u8`;
  }

  buildDashManifestPath() {
    return `${this.buildFolderPath()}/manifest.mpd`;
  }

  /**
   * Devuelve las rutas principales esperadas para HLS/DASH
   */
  buildStreamingPaths() {
    return {
      folderPath: this.buildFolderPath(),
      hlsRootPath: this.buildHlsRootPath(),
      hlsMasterPath: this.buildHlsMasterPath(),
      dashManifestPath: this.buildDashManifestPath(),
    };
  }

  /**
   * Busca el primer MP4 dentro de la capeta del stream y devuelve su URL pública
   */
  findMp4FilePath() {
    const folderPath = this.buildFolderPath();

    if (!fs.existsSync(folderPath)) {
      return null;
    }

    const files = fs.readdirSync(folderPath);
    const mp4File = files.find((file) => file.toLowerCase().endsWith(".mp4"));

    if (!mp4File) {
      return null;
    }

    return `${folderPath}/${mp4File}`;
  }

  run() {
    // Si viene activado HLS ABR, usamos el nuevo modo ABR
    if (this.conf.hlsAbr) {
      return this.runHlsAbr();
    }

    let vc = this.conf.vc || "copy";
    let ac = this.conf.ac || "copy";
    let inPath =
      "rtmp://127.0.0.1:" + this.conf.rtmpPort + this.conf.streamPath;
    let ouPath = this.buildFolderPath();
    let mapStr = "";

    if (this.conf.rtmp && this.conf.rtmpApp) {
      if (this.conf.rtmpApp === this.conf.streamApp) {
        Logger.error("[Transmuxing RTMP] Cannot output to the same app.");
      } else {
        let rtmpOutput = `rtmp://127.0.0.1:${this.conf.rtmpPort}/${this.conf.rtmpApp}/${this.conf.streamName}`;
        mapStr += `[f=flv]${rtmpOutput}|`;
        Logger.log(
          "[Transmuxing RTMP] " + this.conf.streamPath + " to " + rtmpOutput,
        );
      }
    }

    if (this.conf.mp4) {
      this.conf.mp4Flags = this.conf.mp4Flags ? this.conf.mp4Flags : "";
      let mp4FileName = dateFormat("yyyy-mm-dd-HH-MM") + ".mp4";
      let mapMp4 = `${this.conf.mp4Flags}${ouPath}/${mp4FileName}|`;
      mapStr += mapMp4;
      Logger.log(
        "[Transmuxing MP4] " +
          this.conf.streamPath +
          " to " +
          ouPath +
          "/" +
          mp4FileName,
      );
    }

    if (this.conf.hls) {
      this.conf.hlsFlags = this.conf.hlsFlags ? this.conf.hlsFlags : "";
      let hlsFileName = "index.m3u8";
      let mapHls = `${this.conf.hlsFlags}${ouPath}/${hlsFileName}|`;
      mapStr += mapHls;
      Logger.log(
        "[Transmuxing HLS] " +
          this.conf.streamPath +
          " to " +
          ouPath +
          "/" +
          hlsFileName,
      );
    }

    if (this.conf.dash) {
      this.conf.dashFlags = this.conf.dashFlags ? this.conf.dashFlags : "";
      let dashFileName = "manifest.mpd";
      let mapDash = `${this.conf.dashFlags}${ouPath}/${dashFileName}`;
      mapStr += mapDash;
      Logger.log(
        "[Transmuxing DASH] " +
          this.conf.streamPath +
          " to " +
          ouPath +
          "/" +
          dashFileName,
      );
    }

    mkdirp.sync(ouPath);

    let argv = ["-y", "-fflags", "nobuffer", "-i", inPath];
    Array.prototype.push.apply(argv, ["-c:v", vc]);
    Array.prototype.push.apply(argv, this.conf.vcParam);
    Array.prototype.push.apply(argv, ["-c:a", ac]);
    Array.prototype.push.apply(argv, this.conf.acParam);
    Array.prototype.push.apply(argv, [
      "-f",
      "tee",
      "-map",
      "0:a?",
      "-map",
      "0:v?",
      mapStr,
    ]);
    argv = argv.filter((n) => {
      return n;
    }); // quitar vacíos

    this.ffmpeg_exec = spawn(this.conf.ffmpeg, argv);

    this.ffmpeg_exec.on("error", (e) => {
      Logger.ffdebug(e);
    });

    this.ffmpeg_exec.stdout.on("data", (data) => {
      Logger.ffdebug(`FF输出：${data}`);
    });

    this.ffmpeg_exec.stderr.on("data", (data) => {
      Logger.ffdebug(`FF输出：${data}`);
    });

    this.ffmpeg_exec.on("close", (code) => {
      Logger.log("[Transmuxing end] " + this.conf.streamPath);
      this.emit("end");

      // Solo borramos segmentos/manifiestos si NO queremos conservarlos
      if (!this.conf.keepSegments) {
        fs.readdir(ouPath, function (err, files) {
          if (!err) {
            files.forEach((filename) => {
              if (
                filename.endsWith(".ts") ||
                filename.endsWith(".m3u8") ||
                filename.endsWith(".mpd") ||
                filename.endsWith(".m4s") ||
                filename.endsWith(".tmp")
              ) {
                fs.unlinkSync(ouPath + "/" + filename);
              }
            });
          }
        });
      }
    });
  }

  // Método para HLS adaptativo (ABR)
  runHlsAbr() {
    let inPath =
      "rtmp://127.0.0.1:" + this.conf.rtmpPort + this.conf.streamPath;
    let ouPath = this.buildFolderPath();
    let hlsRoot = this.buildHlsRootPath();

    mkdirp.sync(ouPath);
    mkdirp.sync(hlsRoot);

    // Carpetas por calidad
    mkdirp.sync(`${hlsRoot}/240p`);
    mkdirp.sync(`${hlsRoot}/480p`);
    mkdirp.sync(`${hlsRoot}/720p`);

    Logger.log(
      "[Transmuxing ABR HLS] " +
        this.conf.streamPath +
        " to " +
        hlsRoot +
        "/master.m3u8",
    );

    let argv = [
      "-y",
      "-fflags",
      "nobuffer",
      "-i",
      inPath,

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
      `${hlsRoot}/%v/seg_%06d.ts`,
      `${hlsRoot}/%v/index.m3u8`,
    ];

    argv = argv.filter((n) => n);

    this.ffmpeg_exec = spawn(this.conf.ffmpeg, argv);

    this.ffmpeg_exec.on("error", (e) => {
      Logger.ffdebug(e);
    });

    this.ffmpeg_exec.stdout.on("data", (data) => {
      Logger.ffdebug(`FF输出：${data}`);
    });

    this.ffmpeg_exec.stderr.on("data", (data) => {
      Logger.ffdebug(`FF输出：${data}`);
    });

    //Volvemos a generar MP4 también en el flujo ABR
    if (this.conf.mp4) {
      this.conf.mp4Flags = this.conf.mp4Flags ? this.conf.mp4Flags : "";
      let mp4FileName = dateFormat("yyyy-mm-dd-HH-MM") + ".mp4";
      let mp4OutputPath = `${ouPath}/${mp4FileName}`;

      Logger.log(
        "[Transmuxing MP4] " + this.conf.streamPath + " to " + mp4OutputPath,
      );

      let mp4Argv = [
        "-y",
        "-fflags",
        "nobuffer",
        "-i",
        inPath,
        "-c:v",
        this.conf.vc || "copy",
        "-c:a",
        this.conf.ac || "copy",
      ];

      Array.prototype.push.apply(mp4Argv, this.conf.vcParam || []);
      Array.prototype.push.apply(mp4Argv, this.conf.acParam || []);

      // CAMBIO: mp4Flags en ffmpeg deben ir separados, no como output tee
      if (this.conf.mp4Flags && this.conf.mp4Flags.includes("movflags")) {
        mp4Argv.push("-movflags", "faststart");
      }

      Array.prototype.push.apply(mp4Argv, [
        "-map",
        "0:a?",
        "-map",
        "0:v?",
        mp4OutputPath,
      ]);

      mp4Argv = mp4Argv.filter((n) => n);

      this.mp4_exec = spawn(this.conf.ffmpeg, mp4Argv);

      this.mp4_exec.on("error", (e) => {
        Logger.ffdebug(e);
      });

      this.mp4_exec.stdout.on("data", (data) => {
        Logger.ffdebug(`FF输出：${data}`);
      });

      this.mp4_exec.stderr.on("data", (data) => {
        Logger.ffdebug(`FF输出：${data}`);
      });

      this.mp4_exec.on("close", () => {
        Logger.log("[Transmuxing MP4 end] " + this.conf.streamPath);
      });
    }

    this.ffmpeg_exec.on("close", () => {
      Logger.log("[Transmuxing ABR HLS end] " + this.conf.streamPath);
      this.emit("end");

      if (!this.conf.keepSegments) {
        this.deleteHlsArtifacts(hlsRoot);
      }
    });
  }

  // Método para borrado recursivo de artefactos HLS dentro de /hls
  deleteHlsArtifacts(basePath) {
    if (!fs.existsSync(basePath)) {
      return;
    }

    const walk = (currentPath) => {
      const files = fs.readdirSync(currentPath, { withFileTypes: true });

      files.forEach((file) => {
        const fullPath = `${currentPath}/${file.name}`;

        if (file.isDirectory()) {
          walk(fullPath);
          return;
        }

        if (
          file.name.endsWith(".ts") ||
          file.name.endsWith(".m3u8") ||
          file.name.endsWith(".mpd") ||
          file.name.endsWith(".m4s") ||
          file.name.endsWith(".tmp")
        ) {
          fs.unlinkSync(fullPath);
        }
      });
    };

    walk(basePath);
  }

  end() {
    // Cerramos ambos procesos
    if (this.ffmpeg_exec) {
      this.ffmpeg_exec.kill("SIGTERM");
    }
  }
}

module.exports = NodeTransSession;
