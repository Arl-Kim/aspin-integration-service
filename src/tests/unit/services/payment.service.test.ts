import {
  jest,
  describe,
  beforeEach,
  it,
  expect,
} from "@jest/globals";
import { paymentService } from "../../../services/payment.service.js";
import { idempotencyService } from "../../../services/idempotency.service.js";
import { paymentGatewayService } from "../../../services/payment-gateway.service.js";
import { aspinPaymentService } from "../../../services/aspin-payment.service.js";
import { PaymentGateway } from "../../../types/payment.types.js";

// Mock dependencies
jest.mock("../../../services/idempotency.service.js", () => ({
  idempotencyService: {
    get: jest.fn(),
    set: jest.fn(),
    exists: jest.fn(),
    size: jest.fn(),
  },
}));

jest.mock("../../../services/payment-gateway.service.js", () => ({
  paymentGatewayService: {
    initiatePayment: jest.fn(),
  },
}));

jest.mock("../../../services/aspin-payment.service.js", () => ({
  aspinPaymentService: {
    notifyPaymentSuccess: jest.fn(),
    notifyPaymentFailure: jest.fn(),
  },
}));

jest.mock("../../../utils/logger.js", () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

// Get typed mocks
const mockedIdempotencyService = idempotencyService as jest.Mocked<
  typeof idempotencyService
>;
const mockedPaymentGatewayService = paymentGatewayService as jest.Mocked<
  typeof paymentGatewayService
>;
const mockedAspinPaymentService = aspinPaymentService as jest.Mocked<
  typeof aspinPaymentService
>;

describe("PaymentService", () => {
  const correlationId = "test-correlation-id";

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear transactions store
    // @ts-ignore - accessing private property
    paymentService.transactions.clear();
  });

  describe("initiatePayment", () => {
    const validRequest = {
      policy_guid: "123e4567-e89b-12d3-a456-426614174000",
      amount: 5000,
      currency: "KES" as const,
      msisdn: "00254712345678",
      description: "Test payment",
    };

    it("should successfully initiate M-Pesa payment", async () => {
      // Mock gateway response
      mockedPaymentGatewayService.initiatePayment.mockResolvedValue({
        transactionId: "MPESA_123456",
        gatewayReference: "WSR_123456",
        status: "pending",
      });

      const result = await paymentService.initiatePayment(
        validRequest,
        correlationId
      );

      expect(result).toHaveProperty("transactionId");
      expect(result.transactionId).toMatch(/^TXN_/);
      expect(result.status).toBe("pending");

      // Verify gateway was called with correct params
      expect(mockedPaymentGatewayService.initiatePayment).toHaveBeenCalledWith(
        PaymentGateway.MPESA,
        expect.objectContaining({
          amount: 5000,
          currency: "KES",
          msisdn: "00254712345678",
          reference: result.transactionId,
          description: "Test payment",
        })
      );

      // Verify transaction was stored
      // @ts-ignore - accessing private property
      const storedTransaction = paymentService.transactions.get(
        result.transactionId
      );
      expect(storedTransaction).toBeDefined();
      expect(storedTransaction?.policyGuid).toBe(validRequest.policy_guid);
    });

    it("should successfully initiate Airtel payment for Airtel MSISDN", async () => {
      const airtelRequest = {
        ...validRequest,
        msisdn: "00254731234567", // Airtel prefix
      };

      mockedPaymentGatewayService.initiatePayment.mockResolvedValue({
        transactionId: "AIRTEL_123456",
        gatewayReference: "AIR_123456",
        status: "pending",
      });

      const result = await paymentService.initiatePayment(
        airtelRequest,
        correlationId
      );

      expect(mockedPaymentGatewayService.initiatePayment).toHaveBeenCalledWith(
        PaymentGateway.AIRTEL,
        expect.any(Object)
      );
    });

    it("should throw error for invalid amount (KES 5000 required)", async () => {
      const invalidRequest = {
        ...validRequest,
        amount: 3000,
      };

      await expect(
        paymentService.initiatePayment(invalidRequest, correlationId)
      ).rejects.toThrow(
        "Invalid payment amount. KES 5,000 required for this policy"
      );

      expect(
        mockedPaymentGatewayService.initiatePayment
      ).not.toHaveBeenCalled();
    });

    it("should handle gateway errors gracefully", async () => {
      mockedPaymentGatewayService.initiatePayment.mockRejectedValue(
        new Error("PaymentHub timeout")
      );

      await expect(
        paymentService.initiatePayment(validRequest, correlationId)
      ).rejects.toThrow("PaymentHub timeout");
    });

    it("should determine correct gateway based on MSISDN", () => {
      // Test M-Pesa prefixes
      expect(
        // @ts-ignore - testing private method
        paymentService.determineGateway("00254701234567")
      ).toBe(PaymentGateway.MPESA); // 70
      expect(
        // @ts-ignore - testing private method
        paymentService.determineGateway("00254711234567")
      ).toBe(PaymentGateway.MPESA); // 71
      expect(
        // @ts-ignore - testing private method
        paymentService.determineGateway("00254791234567")
      ).toBe(PaymentGateway.MPESA); // 79

      // Test Airtel prefixes
      expect(
        // @ts-ignore - testing private method
        paymentService.determineGateway("00254731234567")
      ).toBe(PaymentGateway.AIRTEL); // 73
      expect(
        // @ts-ignore - testing private method
        paymentService.determineGateway("00254741234567")
      ).toBe(PaymentGateway.AIRTEL); // 74
    });
  });

  describe("handleWebhook", () => {
    const transactionId = "TXN_123456";
    const completedWebhook = {
      transaction_id: transactionId,
      status: "completed" as const,
      amount: 5000,
      currency: "KES" as const,
      timestamp: "2026-02-11T10:35:00Z",
      mno_reference: "MNO_REF_123",
    };

    const failedWebhook = {
      ...completedWebhook,
      status: "failed" as const,
    };

    beforeEach(() => {
      // Seed a transaction
      // @ts-ignore - accessing private method
      paymentService.transactions.set(transactionId, {
        transactionId,
        policyGuid: "123e4567-e89b-12d3-a456-426614174000",
        amount: 5000,
        currency: "KES",
        msisdn: "00254712345678",
        status: "pending",
        gateway: PaymentGateway.MPESA,
        gatewayReference: "WSR_123456",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it("should process completed payment webhook", async () => {
      mockedIdempotencyService.get.mockResolvedValue(null);
      mockedAspinPaymentService.notifyPaymentSuccess.mockResolvedValue();

      await paymentService.handleWebhook(completedWebhook, correlationId);

      expect(mockedIdempotencyService.get).toHaveBeenCalledWith(transactionId);
      expect(
        mockedAspinPaymentService.notifyPaymentSuccess
      ).toHaveBeenCalledWith(
        "123e4567-e89b-12d3-a456-426614174000",
        5000,
        "MNO_REF_123",
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) // YYYY-MM-DD
      );
      expect(mockedIdempotencyService.set).toHaveBeenCalledWith(
        transactionId,
        expect.objectContaining({
          processed: true,
          status: "completed",
        })
      );
    });

    it("should process failed payment webhook", async () => {
      mockedIdempotencyService.get.mockResolvedValue(null);
      mockedAspinPaymentService.notifyPaymentFailure.mockResolvedValue();

      await paymentService.handleWebhook(failedWebhook, correlationId);

      expect(mockedAspinPaymentService.notifyPaymentFailure).toHaveBeenCalled();
      expect(
        mockedAspinPaymentService.notifyPaymentSuccess
      ).not.toHaveBeenCalled();
    });

    it("should skip duplicate webhook", async () => {
      mockedIdempotencyService.get.mockResolvedValue({ processed: true });

      await paymentService.handleWebhook(completedWebhook, correlationId);

      expect(
        mockedAspinPaymentService.notifyPaymentSuccess
      ).not.toHaveBeenCalled();
      expect(
        mockedAspinPaymentService.notifyPaymentFailure
      ).not.toHaveBeenCalled();
    });

    it("should throw error for non-existent transaction", async () => {
      mockedIdempotencyService.get.mockResolvedValue(null);
      const unknownWebhook = {
        ...completedWebhook,
        transaction_id: "TXN_UNKNOWN",
      };

      await expect(
        paymentService.handleWebhook(unknownWebhook, correlationId)
      ).rejects.toThrow("Transaction not found: TXN_UNKNOWN");
    });

    it("should use transaction_id as mno_reference if not provided", async () => {
      const webhookWithoutMnoRef = {
        ...completedWebhook,
        mno_reference: undefined,
      };

      mockedIdempotencyService.get.mockResolvedValue(null);
      mockedAspinPaymentService.notifyPaymentSuccess.mockResolvedValue();

      await paymentService.handleWebhook(webhookWithoutMnoRef, correlationId);

      expect(
        mockedAspinPaymentService.notifyPaymentSuccess
      ).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        transactionId, // Should use transaction_id as fallback
        expect.any(String)
      );
    });
  });

  describe("getTransaction", () => {
    it("should return transaction if exists", () => {
      const transactionId = "TXN_123456";
      // @ts-ignore - accessing private method
      paymentService.transactions.set(transactionId, {
        transactionId,
        policyGuid: "test",
        amount: 5000,
        currency: "KES",
        msisdn: "00254712345678",
        status: "pending",
        gateway: PaymentGateway.MPESA,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = paymentService.getTransaction(transactionId);
      expect(result).toBeDefined();
      expect(result?.transactionId).toBe(transactionId);
    });

    it("should return undefined for non-existent transaction", () => {
      const result = paymentService.getTransaction("non-existent");
      expect(result).toBeUndefined();
    });
  });
});
