import { Request, Response, NextFunction } from "express";
import { config } from "../config/config.ts";
import { logger } from "../utils/logger.ts";

/**
 * API Key authentication middleware
 */
export const authenticateApiKey = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const apiKey =
    req.headers["x-api-key"] || req.headers.authorization?.split(" ")[1];

  if (!apiKey) {
    logger.warn("API key missing", {
      path: req.path,
      method: req.method,
      ip: req.ip,
    });

    res.status(401).json({
      error: "UNAUTHORIZED",
      message: "API key is required",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (apiKey !== config.api.key) {
    logger.warn("Invalid API key", {
      path: req.path,
      method: req.method,
      ip: req.ip,
    });

    res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Invalid API key",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  next();
};

/**
 * Webhook signature validation middleware
 * Simulates HMAC-SHA256 verification
 */
export const validateWebhookSignature = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const signature = req.headers["x-signature"];
  const webhookId = req.headers["x-webhook-id"];

  if (!signature || !webhookId) {
    logger.warn("Webhook signature missing", {
      path: req.path,
      method: req.method,
    });

    res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Webhook signature is required",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Simulate signature validation
  // In production, verify HMAC-SHA256 with shared secret
  if (signature === "invalid_signature") {
    logger.warn("Invalid webhook signature", {
      webhookId,
      signature,
    });

    res.status(400).json({
      error: "INVALID_SIGNATURE",
      message: "Webhook signature validation failed",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Attach webhook context to request
  req.webhookContext = {
    id: webhookId as string,
    signature: signature as string,
    timestamp: req.headers["x-webhook-timestamp"] as string,
  };

  next();
};

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      webhookContext?: {
        id: string;
        signature: string;
        timestamp?: string;
      };
      correlationId?: string;
    }
  }
}
