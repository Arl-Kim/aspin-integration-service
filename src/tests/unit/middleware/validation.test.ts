import { jest, describe, beforeEach, it, expect } from "@jest/globals";
import { validate } from "../../../middleware/validation.js";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";

// Mock logger
jest.mock("../../../utils/logger.js", () => ({
  logger: {
    warn: jest.fn(),
  },
}));

describe("Validation Middleware", () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.Mock;
  let responseJson: jest.Mock;
  let responseStatus: jest.Mock;

  const testSchema = z.object({
    body: z.object({
      name: z.string().min(3),
      age: z.number().min(18),
    }),
  });

  beforeEach(() => {
    jest.clearAllMocks();

    responseJson = jest.fn().mockReturnThis();
    responseStatus = jest.fn().mockReturnValue({ json: responseJson });

    mockResponse = {
      status: responseStatus as any,
      json: responseJson as any,
    };

    mockNext = jest.fn();
    mockRequest = {
      path: "/test",
      correlationId: "test-correlation-id",
      body: {},
    };
  });

  it("should call next() when validation passes", async () => {
    mockRequest.body = {
      name: "John Doe",
      age: 25,
    };

    const middleware = validate(testSchema);
    await middleware(
      mockRequest as Request,
      mockResponse as Response,
      mockNext
    );

    expect(mockNext).toHaveBeenCalled();
    expect(responseStatus).not.toHaveBeenCalled();
  });

  it("should return 400 when validation fails", async () => {
    mockRequest.body = {
      name: "Jo", // Too short
      age: 15, // Too young
    };

    const middleware = validate(testSchema);
    await middleware(
      mockRequest as Request,
      mockResponse as Response,
      mockNext
    );

    expect(responseStatus).toHaveBeenCalledWith(400);
    expect(responseJson).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
        }),
        status: 400,
        trace_id: "test-correlation-id",
      })
    );
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("should validate multiple parts of request", async () => {
    const multiPartSchema = z.object({
      body: z.object({}),
      query: z.object({
        page: z.string().regex(/^\d+$/),
      }),
      params: z.object({
        id: z.string().uuid(),
      }),
    });

    mockRequest.query = { page: "abc" }; // Not a number
    mockRequest.params = { id: "not-a-uuid" };

    const middleware = validate(multiPartSchema);
    await middleware(
      mockRequest as Request,
      mockResponse as Response,
      mockNext
    );

    expect(responseStatus).toHaveBeenCalledWith(400);
    const errorCall = (responseJson.mock.calls[0] as any)[0];
    expect(errorCall.error.details).toHaveLength(2); // Two validation errors
  });

  it("should pass non-Zod errors to next()", async () => {
    const schemaThatThrows = z.object({
      body: z.object({}).superRefine(() => {
        throw new Error("Unexpected error");
      }),
    });

    mockRequest.body = {};

    const middleware = validate(schemaThatThrows);
    await middleware(
      mockRequest as Request,
      mockResponse as Response,
      mockNext
    );

    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    expect(responseStatus).not.toHaveBeenCalled();
  });
});
