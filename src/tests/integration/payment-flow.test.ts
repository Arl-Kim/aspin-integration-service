import { jest, describe, beforeEach, it, expect } from "@jest/globals";
import request from "supertest";
import app from "../../app.js";

// Define types for mocked responses
interface MockInitiatePaymentResult {
  transactionId: string;
  gatewayReference: string;
  status: string;
}

// Mock external services with proper typing
const mockPaymentGatewayService = {
  initiatePayment: jest.fn().mockImplementation(
    (): Promise<MockInitiatePaymentResult> =>
      Promise.resolve({
        transactionId: "MPESA_123456",
        gatewayReference: "WSR_123456",
        status: "pending",
      })
  ),
};

const mockAspinPaymentService = {
  notifyPaymentSuccess: jest
    .fn()
    .mockImplementation((): Promise<void> => Promise.resolve()),
  notifyPaymentFailure: jest
    .fn()
    .mockImplementation((): Promise<void> => Promise.resolve()),
};

const mockAspinAuthService = {
  getAccessToken: jest
    .fn()
    .mockImplementation((): Promise<string> => Promise.resolve("test-token")),
};

// Apply mocks
jest.mock("../../services/payment-gateway.service.js", () => ({
  paymentGatewayService: mockPaymentGatewayService,
}));

jest.mock("../../services/aspin-payment.service.js", () => ({
  aspinPaymentService: mockAspinPaymentService,
}));

jest.mock("../../services/aspin-auth.service.js", () => ({
  aspinAuthService: mockAspinAuthService,
}));

describe("Payment Flow Integration Tests", () => {
  const apiKey = "test_api_key_123";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /api/payments/initiate", () => {
    const validPayload = {
      policy_guid: "123e4567-e89b-12d3-a456-426614174000",
      amount: 5000,
      currency: "KES" as const,
      msisdn: "00254712345678",
    };

    it("should successfully initiate a payment", async () => {
      const response = await request(app)
        .post("/api/payments/initiate")
        .set("X-API-Key", apiKey)
        .send(validPayload)
        .expect(202);

      expect(response.body).toHaveProperty("transaction_id");
      expect(response.body.status).toBe("pending");
      expect(response.body.amount).toBe(5000);
      expect(response.body.currency).toBe("KES");
      expect(response.body._links.self).toMatch(/^\/api\/payments\/TXN_/);
    });

    it("should reject request with invalid amount", async () => {
      const response = await request(app)
        .post("/api/payments/initiate")
        .set("X-API-Key", apiKey)
        .send({
          ...validPayload,
          amount: 3000,
        })
        .expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("should reject request without API key", async () => {
      await request(app)
        .post("/api/payments/initiate")
        .send(validPayload)
        .expect(401);
    });

    it("should reject request with invalid MSISDN format", async () => {
      const response = await request(app)
        .post("/api/payments/initiate")
        .set("X-API-Key", apiKey)
        .send({
          ...validPayload,
          msisdn: "+254712345678", // Wrong format (should be 00...)
        })
        .expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("POST /api/payments/webhook", () => {
    const validWebhook = {
      transaction_id: "TXN_123456",
      status: "completed" as const,
      amount: 5000,
      currency: "KES" as const,
      timestamp: "2026-02-15T10:30:00Z",
    };

    beforeEach(async () => {
      // Create a transaction first
      await request(app)
        .post("/api/payments/initiate")
        .set("X-API-Key", apiKey)
        .send({
          policy_guid: "123e4567-e89b-12d3-a456-426614174000",
          amount: 5000,
          currency: "KES",
          msisdn: "00254712345678",
        });
    });

    it("should process completed payment webhook", async () => {
      const response = await request(app)
        .post("/api/payments/webhook")
        .set("X-Signature", "valid_signature")
        .set("X-Webhook-ID", "webhook-123")
        .send(validWebhook)
        .expect(202);

      expect(response.body.status).toBe("accepted");
      expect(response.body.transaction_id).toBe("TXN_123456");
    });

    it("should reject webhook without signature", async () => {
      await request(app)
        .post("/api/payments/webhook")
        .send(validWebhook)
        .expect(401);
    });

    it("should handle failed payment webhook", async () => {
      const failedWebhook = {
        ...validWebhook,
        status: "failed" as const,
      };

      await request(app)
        .post("/api/payments/webhook")
        .set("X-Signature", "valid_signature")
        .set("X-Webhook-ID", "webhook-125")
        .send(failedWebhook)
        .expect(202);
    });
  });

  describe("GET /api/payments/:transactionId", () => {
    it("should return transaction status", async () => {
      // First create a transaction
      const initiateResponse = await request(app)
        .post("/api/payments/initiate")
        .set("X-API-Key", apiKey)
        .send({
          policy_guid: "123e4567-e89b-12d3-a456-426614174000",
          amount: 5000,
          currency: "KES",
          msisdn: "00254712345678",
        });

      const transactionId = initiateResponse.body.transaction_id;

      // Then get its status
      const response = await request(app)
        .get(`/api/payments/${transactionId}`)
        .set("X-API-Key", apiKey)
        .expect(200);

      expect(response.body.transaction_id).toBe(transactionId);
      expect(response.body).toHaveProperty("status");
      expect(response.body).toHaveProperty("policy_guid");
    });

    it("should return 404 for non-existent transaction", async () => {
      await request(app)
        .get("/api/payments/non-existent")
        .set("X-API-Key", apiKey)
        .expect(404);
    });
  });
});
