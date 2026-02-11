import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";

/**
 * Correlation ID middleware for distributed tracing
 */
export const correlationMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Use existing correlation ID or generate new one
  const correlationId =
    (req.headers["x-correlation-id"] as string) ||
    (req.headers["x-request-id"] as string) ||
    uuidv4();

  req.correlationId = correlationId;

  // Set response header
  res.setHeader("X-Correlation-ID", correlationId);

  next();
};
