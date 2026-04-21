const express = require("express");
const videosController = require("../controllers/videos");

module.exports = (context) => {
  let router = express.Router();

  router.get("/", videosController.getVideos);
  router.get("/live", videosController.getLiveVideos);
  router.get("/ready", videosController.getReadyVideos);
  router.post("/", videosController.createVideo);

  return router;
};
