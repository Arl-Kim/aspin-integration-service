import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger.ts";
import { config } from "../config/config.ts";

/**
 * Global error handler middleware
 */
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void => {
  const correlationId = req.correlationId || "unknown";

  logger.error("Unhandled error", {
    correlationId,
    error: err.message,
    stack: config.env === "development" ? err.stack : undefined,
    path: req.path,
    method: req.method,
  });

  // Determine if this is a known operational error
  const isOperational =
    err.message.includes("Invalid") ||
    err.message.includes("required") ||
    err.message.includes("not found");

  const status = isOperational ? 400 : 500;
  const code = isOperational ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR";
  const message = isOperational ? err.message : "An unexpected error occurred";

  res.status(status).json({
    error: {
      code,
      message,
    },
    status,
    timestamp: new Date().toISOString(),
    path: req.path,
    trace_id: correlationId,
  });
};
