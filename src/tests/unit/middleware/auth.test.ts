import { jest, describe, beforeEach, it, expect } from "@jest/globals";
import {
  authenticateApiKey,
  validateWebhookSignature,
} from "../../../middleware/auth.js";
import type { Request, Response } from "express";

// Mock config
jest.mock("../../../config/config.js", () => ({
  config: {
    api: {
      key: "test-api-key-123",
    },
  },
}));

jest.mock("../../../utils/logger.js", () => ({
  logger: {
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe("Auth Middleware", () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.Mock;
  let responseJson: jest.Mock;
  let responseStatus: jest.Mock;

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
      method: "POST",
      ip: "127.0.0.1",
      headers: {},
    };
  });

  describe("authenticateApiKey", () => {
    it("should call next() when valid API key in header", () => {
      mockRequest.headers = { "x-api-key": "test-api-key-123" };

      authenticateApiKey(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      expect(responseStatus).not.toHaveBeenCalled();
    });

    it("should accept API key from Authorization header", () => {
      mockRequest.headers = { authorization: "Bearer test-api-key-123" };

      authenticateApiKey(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
    });

    it("should return 401 when API key missing", () => {
      authenticateApiKey(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(responseStatus).toHaveBeenCalledWith(401);
      expect(responseJson).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "UNAUTHORIZED",
          message: "API key is required",
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("should return 401 when API key invalid", () => {
      mockRequest.headers = { "x-api-key": "wrong-key" };

      authenticateApiKey(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(responseStatus).toHaveBeenCalledWith(401);
      expect(responseJson).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "UNAUTHORIZED",
          message: "Invalid API key",
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe("validateWebhookSignature", () => {
    it("should call next() with valid signature", () => {
      mockRequest.headers = {
        "x-signature": "valid_signature",
        "x-webhook-id": "webhook-123",
        "x-webhook-timestamp": "2026-02-15T10:00:00Z",
      };

      validateWebhookSignature(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockRequest.webhookContext).toBeDefined();
      expect(mockRequest.webhookContext?.id).toBe("webhook-123");
      expect(mockRequest.webhookContext?.signature).toBe("valid_signature");
    });

    it("should return 401 when signature missing", () => {
      mockRequest.headers = { "x-webhook-id": "webhook-123" };

      validateWebhookSignature(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(responseStatus).toHaveBeenCalledWith(401);
      expect(responseJson).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "UNAUTHORIZED",
          message: "Webhook signature is required",
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("should return 401 when webhook ID missing", () => {
      mockRequest.headers = { "x-signature": "valid_signature" };

      validateWebhookSignature(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(responseStatus).toHaveBeenCalledWith(401);
    });

    it("should return 400 for invalid signature", () => {
      mockRequest.headers = {
        "x-signature": "invalid_signature",
        "x-webhook-id": "webhook-123",
      };

      validateWebhookSignature(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(responseStatus).toHaveBeenCalledWith(400);
      expect(responseJson).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "INVALID_SIGNATURE",
          message: "Webhook signature validation failed",
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});
