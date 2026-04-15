const NodeMediaServer = require("./");

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
nms.run();

nms.on("preConnect", (id, args) => {
  console.log(
    "[NodeEvent on preConnect]",
    `id=${id} args=${JSON.stringify(args)}`,
  );
  // let session = nms.getSession(id);
  // session.reject();
});
