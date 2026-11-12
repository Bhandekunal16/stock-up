const {
  express,
  cluster,
  logByte,
  multer,
} = require("./provider/dependency.map");
const {
  clusterInterceptor,
  markClusterShuttingDown,
  replicate,
} = require("./provider/interceptor.map");
const {
  host,
  port,
  SHUTDOWN_TIMEOUT,
  REPLICA,
  clustering,
  replicas,
} = require("./provider/config.map");
const { middleware, errorMiddleware } = require("./middleware.loader");
const {
  gracefulShutdown,
  registerClusterPrimaryShutdown,
  registerWorkerShutdownMessage,
  triggerGracefulShutdown,
} = require("./layers/graceful.shutdown.layer");
const TesseractEngine = require("./lib/tesseract.lib");
const { PortfolioExtractionError } = require("./lib/portfolio-validation.lib");
const shares = require("./service/shares.service");
const portfolioService = new shares();

if (clustering && cluster.isPrimary) {
  clusterInterceptor();

  registerClusterPrimaryShutdown({
    shutdownTimeout: SHUTDOWN_TIMEOUT,
    markClusterShuttingDown,
  });
} else {
  const app = express();
  const activeRequests = new Set();

  const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 10 * 1024 * 1024, // 10 MB
    },
    fileFilter: (req, file, cb) => {
      if (!allowedImageTypes.has(file.mimetype)) {
        return cb(new Error("Only JPEG, PNG, and WebP images are allowed"));
      }

      cb(null, true);
    },
  });

  middleware(app);

  app.use((req, res, next) => {
    activeRequests.add(res);

    res.once("finish", () => {
      activeRequests.delete(res);
    });

    res.once("close", () => {
      activeRequests.delete(res);
    });

    next();
  });

  app.get("/", (_, res) => {
    res.json({ message: "hello world" });
  });

  async function getPortfolio(req, res) {
    try {
      const { date } = req.params;

      const data = await portfolioService.getStoreData(date);

      const found = data.length > 0;

      return res.status(found ? 200 : 404).json({
        success: found,
        count: data.length,
        data,
        message: found
          ? "Portfolio data retrieved successfully"
          : "No portfolio data found",
        statusCode: found ? 200 : 404,
      });
    } catch (error) {
      console.error("Portfolio retrieval error:", error);

      return res.status(500).json({
        success: false,
        data: [],
        message: error.message,
        statusCode: 500,
      });
    }
  }

  app.get("/api/portfolio", getPortfolio);
  app.get("/api/portfolio/:date", getPortfolio);

  app.post(
    "/api/portfolio/extract",
    upload.single("image"),
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({
            success: false,
            message: "Please upload an image",
          });
        }

        const engine = new TesseractEngine();

        const shares = await engine.runner(req.file.buffer);

        return res.status(200).json({
          success: true,
          count: shares.length,
          data: shares,
        });
      } catch (error) {
        console.error("Portfolio extraction error:", error);

        const statusCode =
          error instanceof PortfolioExtractionError
            ? error.statusCode
            : Number.isInteger(error.statusCode)
              ? error.statusCode
              : 500;
        const response = {
          success: false,
          message:
            error instanceof PortfolioExtractionError
              ? error.message
              : "Failed to extract portfolio data",
        };

        if (error.details) {
          response.details = error.details;
        } else if (statusCode === 500) {
          response.error = error.message;
        }

        return res.status(statusCode).json(response);
      }
    },
  );

  app.use((err, _, res, next) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    next();
  });

  app.use((_, res) => {
    res.status(404).json({
      status: false,
      statusCode: 404,
      message: "Not Found",
    });
  });

  errorMiddleware(app);

  const serverName = clustering ? "Express worker" : "Express";
  const servers = replicate(app, host, port, REPLICA, replicas);

  for (const server of servers) {
    gracefulShutdown({
      server,
      name: serverName,
      shutdownTimeout: SHUTDOWN_TIMEOUT,
      activeRequests,
      onShutdown: () => {
        logByte.warn(`${serverName}: shutdown started`);
      },
    });
  }

  if (clustering) {
    registerWorkerShutdownMessage(() => {
      triggerGracefulShutdown("shutdown");
    });
  }
}
