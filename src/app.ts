import express from "express";
import type { Application, Request, Response, NextFunction } from "express";
import { config } from "dotenv";
import routes from "./routes/index.ts";
import { correlationMiddleware } from "./middleware/correlation.ts";
import { errorHandler } from "./middleware/error.ts";
import { logger } from "./utils/logger.ts";

// Load environment variables
config();

// Initialize express application instance
const app: Application = express();

// Global Middleware

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Correlation ID for distributed tracing (MUST come before route handlers)
app.use(correlationMiddleware);

// Request logging middleware (available in development)
if (process.env.NODE_ENV === "development") {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    // Log after response is sent
    res.on("finish", () => {
      const duration = Date.now() - startTime;
      logger.info(`${req.method} ${req.path} - ${res.statusCode}`, {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        correlationId: req.correlationId,
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });
    });

    next();
  });
}

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "aspin-integration-service",
    environment: process.env.NODE_ENV || "development",
    version: "1.0.0",
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

// Root endpoint
app.get("/", (req: Request, res: Response) => {
  res.status(200).json({
    name: "Aspin Integration Service",
    version: "1.0.0",
    description: "Payment collection integration service for ASPIn",
    environment: process.env.NODE_ENV || "development",
    endpoints: {
      health: "GET /health",
      initiatePayment: "POST /api/payments/initiate",
      webhook: "POST /api/payments/webhook",
      paymentStatus: "GET /api/payments/:transactionId",
    },
    documentation: "See /docs/ directory for OpenAPI specification",
    timestamp: new Date().toISOString(),
  });
});

// Mount all API routes under /api
app.use("/api", routes);

// 404 handler
app.use((req: Request, res: Response) => {
  logger.warn("Route not found", {
    method: req.method,
    path: req.path,
    correlationId: req.correlationId,
  });

  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: `Cannot ${req.method} ${req.path}`,
    },
    status: 404,
    timestamp: new Date().toISOString(),
    path: req.path,
    trace_id: req.correlationId,
  });
});

// Global error handler
app.use(errorHandler);

export default app;
