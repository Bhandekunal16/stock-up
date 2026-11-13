const environment = {
  config: require("../json/config.json"),
  app: require("../json/app.json"),
  rateLimiting: require("../json/rate-limiting.config.json"),
  helmet: require("../json/helmet.config.json"),
  logger: require("../json/logger.config.json"),
  mongo: require("../json/mongodb.config.json"),
  image_lab: require("../json/image.lib.config.json"),
};

module.exports = {
  ...environment.config,
  ...environment.app,
  ...environment.rateLimiting,
  helmet: environment.helmet,
  ...environment.logger,
  ...environment.mongo,
  ...environment.image_lab,
};
