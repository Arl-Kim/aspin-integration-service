import { jest, describe, beforeEach, it, expect } from "@jest/globals";
import { paymentController } from "../../../controllers/payment.controller.js";
import { paymentService } from "../../../services/payment.service.js";
import type { Request, Response } from "express";
import type { PaymentTransaction } from "../../../types/payment.types.js";

// Mock payment service
jest.mock("../../../services/payment.service.js", () => ({
  paymentService: {
    initiatePayment: jest.fn(),
    handleWebhook: jest.fn(),
    getTransaction: jest.fn(),
  },
}));

jest.mock("../../../utils/logger.js", () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    }),
  },
}));

const mockedPaymentService = paymentService as jest.Mocked<
  typeof paymentService
>;

describe("PaymentController", () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
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

    mockRequest = {
      correlationId: "test-correlation-id",
    };
  });

  describe("initiatePayment", () => {
    const validRequestBody = {
      policy_guid: "123e4567-e89b-12d3-a456-426614174000",
      amount: 5000,
      currency: "KES" as const,
      msisdn: "00254712345678",
    };

    it("should successfully initiate payment and return 202", async () => {
      mockRequest.body = validRequestBody;
      mockedPaymentService.initiatePayment.mockResolvedValue({
        transactionId: "TXN_123456",
        status: "pending",
      });

      await paymentController.initiatePayment(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockedPaymentService.initiatePayment).toHaveBeenCalledWith(
        validRequestBody,
        "test-correlation-id"
      );
      expect(responseStatus).toHaveBeenCalledWith(202);
      expect(responseJson).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction_id: "TXN_123456",
          status: "pending",
          amount: 5000,
          currency: "KES",
          _links: expect.objectContaining({
            self: "/api/payments/TXN_123456",
          }),
        })
      );
    });

    it("should throw validation error for invalid request", async () => {
      mockRequest.body = {
        ...validRequestBody,
        amount: "invalid", // Should be number
      };

      await expect(
        paymentController.initiatePayment(
          mockRequest as Request,
          mockResponse as Response
        )
      ).rejects.toThrow();

      expect(mockedPaymentService.initiatePayment).not.toHaveBeenCalled();
    });

    it("should propagate service errors", async () => {
      mockRequest.body = validRequestBody;
      mockedPaymentService.initiatePayment.mockRejectedValue(
        new Error("Service error")
      );

      await expect(
        paymentController.initiatePayment(
          mockRequest as Request,
          mockResponse as Response
        )
      ).rejects.toThrow("Service error");
    });
  });

  describe("handleWebhook", () => {
    const validWebhookBody = {
      transaction_id: "TXN_123456",
      status: "completed" as const,
      amount: 5000,
      currency: "KES" as const,
      timestamp: "2026-02-11T10:35:00Z",
    };

    it("should successfully process webhook and return 202", async () => {
      mockRequest.body = validWebhookBody;
      mockedPaymentService.handleWebhook.mockResolvedValue();

      await paymentController.handleWebhook(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockedPaymentService.handleWebhook).toHaveBeenCalledWith(
        validWebhookBody,
        "test-correlation-id"
      );
      expect(responseStatus).toHaveBeenCalledWith(202);
      expect(responseJson).toHaveBeenCalledWith({
        status: "accepted",
        transaction_id: "TXN_123456",
        timestamp: expect.any(String),
      });
    });

    it("should throw validation error for invalid webhook", async () => {
      mockRequest.body = {
        ...validWebhookBody,
        status: "invalid_status",
      };

      await expect(
        paymentController.handleWebhook(
          mockRequest as Request,
          mockResponse as Response
        )
      ).rejects.toThrow();
    });
  });

  describe("getPaymentStatus", () => {
    it("should return transaction when found", async () => {
      mockRequest.params = { transactionId: "TXN_123456" };
      const mockTransaction: PaymentTransaction = {
        transactionId: "TXN_123456",
        policyGuid: "123e4567-e89b-12d3-a456-426614174000",
        amount: 5000,
        currency: "KES",
        status: "completed",
        gateway: "mpesa",
        gatewayReference: "WSR_123456",
        createdAt: new Date(),
        updatedAt: new Date(),
        msisdn: "00254712345678",
      };

      mockedPaymentService.getTransaction.mockReturnValue(mockTransaction);

      await paymentController.getPaymentStatus(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(200);
      expect(responseJson).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction_id: "TXN_123456",
          status: "completed",
        })
      );
    });

    it("should return 404 when transaction not found", async () => {
      mockRequest.params = { transactionId: "TXN_123456" };
      mockedPaymentService.getTransaction.mockReturnValue(undefined);

      await paymentController.getPaymentStatus(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(404);
      expect(responseJson).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: "NOT_FOUND",
          }),
        })
      );
    });

    it("should return 400 for invalid transactionId parameter", async () => {
      mockRequest.params = { transactionId: ["invalid", "array"] as any };

      await paymentController.getPaymentStatus(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(400);
      expect(responseJson).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: "INVALID_PARAMETER",
          }),
        })
      );
    });
  });
});
