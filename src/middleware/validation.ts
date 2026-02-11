import { Request, Response, NextFunction } from "express";
import { ZodObject, ZodError } from "zod";
import { logger } from "../utils/logger.ts";

/**
 * Request validation middleware using Zod
 */
export const validate = (schema: ZodObject) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        logger.warn("Request validation failed", {
          path: req.path,
          errors: error.issues,
        });

        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Request validation failed",
            details: error.issues.map((err) => ({
              field: err.path.join("."),
              issue: err.message,
            })),
          },
          status: 400,
          timestamp: new Date().toISOString(),
          path: req.path,
          trace_id: req.correlationId,
        });
        return;
      }

      next(error);
    }
  };
};
