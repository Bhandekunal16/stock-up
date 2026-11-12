
const path = require("node:path");

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

const {
  PortfolioExtractionError,
} = require("./lib/portfolio-validation.lib");

const shares = require("./service/shares.service");

const portfolioService = new shares();

// ---------------------------------------------------------
// Cluster primary process
// ---------------------------------------------------------

if (clustering && cluster.isPrimary) {
  clusterInterceptor();

  registerClusterPrimaryShutdown({
    shutdownTimeout: SHUTDOWN_TIMEOUT,
    markClusterShuttingDown,
  });

} else {

  // -------------------------------------------------------
  // Express application
  // -------------------------------------------------------

  const app = express();

  const activeRequests = new Set();

  // -------------------------------------------------------
  // Middleware
  // -------------------------------------------------------

  app.use(express.json());

  app.use(express.urlencoded({
    extended: true,
  }));

  // -------------------------------------------------------
  // Image upload configuration
  // -------------------------------------------------------

  const allowedImageTypes = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);

  const upload = multer({
    storage: multer.memoryStorage(),

    limits: {
      fileSize: 10 * 1024 * 1024,
    },

    fileFilter: (req, file, cb) => {
      if (!allowedImageTypes.has(file.mimetype)) {
        return cb(
          new Error("Only JPEG, PNG, and WebP images are allowed")
        );
      }

      cb(null, true);
    },
  });

  // -------------------------------------------------------
  // Existing application middleware
  // -------------------------------------------------------

  middleware(app);

  // -------------------------------------------------------
  // Active request tracking
  // -------------------------------------------------------

  app.use((req, res, next) => {
    activeRequests.add(res);

    const cleanup = () => {
      activeRequests.delete(res);
    };

    res.once("finish", cleanup);
    res.once("close", cleanup);

    next();
  });

  // -------------------------------------------------------
  // Portfolio retrieval handler
  // -------------------------------------------------------

  async function getPortfolio(req, res) {
    try {
      const { date } = req.params;

      const data = await portfolioService.getStoreData(date);

      const found = Array.isArray(data) && data.length > 0;

      return res.status(found ? 200 : 404).json({
        success: found,
        count: found ? data.length : 0,
        data: found ? data : [],

        message: found
          ? "Portfolio data retrieved successfully"
          : "No portfolio data found",

        statusCode: found ? 200 : 404,
      });

    } catch (error) {
      logByte.error(`Portfolio retrieval error: ${error.message}`);

      return res.status(500).json({
        success: false,
        count: 0,
        data: [],
        message: "Failed to retrieve portfolio data",
        statusCode: 500,
      });
    }
  }

  // -------------------------------------------------------
  // Portfolio extraction handler
  // -------------------------------------------------------

  async function extractPortfolio(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Please upload an image",
        });
      }

      const engine = new TesseractEngine();

      const extractedShares = await engine.runner(req.file.buffer);

      return res.status(200).json({
        success: true,
        count: extractedShares.length,
        data: extractedShares,
      });

    } catch (error) {
      logByte.error(`Portfolio extraction error: ${error.message}`);

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
  }

  // -------------------------------------------------------
  // API routes
  // Register APIs BEFORE React static hosting
  // -------------------------------------------------------

  app.get("/api/portfolio", getPortfolio);

  app.get("/api/portfolio/:date", getPortfolio);

  app.post(
    "/api/portfolio/extract",
    upload.single("image"),
    extractPortfolio
  );

  // -------------------------------------------------------
  // React production build
  // -------------------------------------------------------

  const distPath = path.resolve(__dirname, "dist");

  const indexPath = path.join(distPath, "index.html");

  // Serve React static assets
  app.use(express.static(distPath, {
    index: false,
    fallthrough: true,
  }));

  // -------------------------------------------------------
  // React SPA fallback
  // Supports:
  // /
  // /dashboard
  // /settings
  // /holdings
  // /analytics
  // -------------------------------------------------------

  app.get("/{*splat}", (req, res, next) => {
    if (req.accepts("html")) {
      return res.sendFile(indexPath, (error) => {
        if (error) {
          next(error);
        }
      });
    }

    next();
  });

  // -------------------------------------------------------
  // Multer and application error handler
  // -------------------------------------------------------

  app.use((err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }

    const statusCode =
      err instanceof multer.MulterError
        ? 400
        : 500;

    logByte.error(`Application error: ${err.message}`);

    return res.status(statusCode).json({
      success: false,
      statusCode,
      message: err.message || "Internal server error",
    });
  });

  // -------------------------------------------------------
  // Not found handler
  // -------------------------------------------------------

  app.use((req, res) => {
    return res.status(404).json({
      success: false,
      statusCode: 404,
      message: "Not Found",
      path: req.originalUrl,
    });
  });

  // Existing error middleware
  errorMiddleware(app);

  // -------------------------------------------------------
  // Start Express replicas
  // -------------------------------------------------------

  const serverName = clustering
    ? "Express worker"
    : "Express";

  const servers = replicate(
    app,
    host,
    port,
    REPLICA,
    replicas
  );

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

  // -------------------------------------------------------
  // Cluster worker shutdown handling
  // -------------------------------------------------------

  if (clustering) {
    registerWorkerShutdownMessage(() => {
      triggerGracefulShutdown("shutdown");
    });
  }
}
