import {
  jest,
  describe,
  beforeEach,
  it,
  expect,
  afterAll,
} from "@jest/globals";
import { aspinPaymentService } from "../../../services/aspin-payment.service.js";
import { aspinAuthService } from "../../../services/aspin-auth.service.js";
import axios from "axios";

// Mock dependencies
jest.mock("axios");
jest.mock("../../../services/aspin-auth.service.js", () => ({
  aspinAuthService: {
    getAccessToken: jest.fn(),
  },
}));

jest.mock("../../../utils/logger.js", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedAuthService = aspinAuthService as jest.Mocked<
  typeof aspinAuthService
>;

describe("AspinPaymentService", () => {
  const testData = {
    policyGuid: "123e4567-e89b-12d3-a456-426614174000",
    amount: 5000,
    mnoReference: "MNO_REF_123",
    effectedAt: "2026-02-15",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAuthService.getAccessToken.mockResolvedValue("test-access-token");
  });

  describe("notifyPaymentSuccess", () => {
    it("should send successful payment notification to ASPIn", async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: {} });

      await aspinPaymentService.notifyPaymentSuccess(
        testData.policyGuid,
        testData.amount,
        testData.mnoReference,
        testData.effectedAt
      );

      expect(mockedAuthService.getAccessToken).toHaveBeenCalled();
      expect(mockedAxios.post).toHaveBeenCalledWith(
        "/api/payments",
        {
          policy_guid: testData.policyGuid,
          amount_in_cents: 500000, // 5000 * 100
          mno_reference: testData.mnoReference,
          status: "Succeeded",
          channel: "ApiClient",
          effected_at: testData.effectedAt,
        },
        expect.objectContaining({
          params: { partner: expect.any(String) },
          headers: {
            Authorization: "Bearer test-access-token",
            "Content-Type": "application/json",
          },
        })
      );
    });

    it("should validate payload before sending", async () => {
      // Invalid data (missing required fields)
      const invalidData = {
        policyGuid: "invalid-guid", // Not UUID
        amount: -100, // Negative
        mnoReference: "",
        effectedAt: "invalid-date",
      };

      await expect(
        aspinPaymentService.notifyPaymentSuccess(
          invalidData.policyGuid,
          invalidData.amount,
          invalidData.mnoReference,
          invalidData.effectedAt
        )
      ).rejects.toThrow();

      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it("should throw error if ASPIn request fails", async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error("ASPIn API error"));

      await expect(
        aspinPaymentService.notifyPaymentSuccess(
          testData.policyGuid,
          testData.amount,
          testData.mnoReference,
          testData.effectedAt
        )
      ).rejects.toThrow("Failed to notify ASPIn of payment status");
    });

    it("should handle authentication failure", async () => {
      mockedAuthService.getAccessToken.mockRejectedValueOnce(
        new Error("Auth failed")
      );

      await expect(
        aspinPaymentService.notifyPaymentSuccess(
          testData.policyGuid,
          testData.amount,
          testData.mnoReference,
          testData.effectedAt
        )
      ).rejects.toThrow("Failed to notify ASPIn of payment status");
    });
  });

  describe("notifyPaymentFailure", () => {
    it("should send failed payment notification to ASPIn", async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: {} });

      await aspinPaymentService.notifyPaymentFailure(
        testData.policyGuid,
        testData.amount,
        testData.mnoReference,
        testData.effectedAt
      );

      expect(mockedAxios.post).toHaveBeenCalledWith(
        "/api/payments",
        expect.objectContaining({
          status: "Failed",
          amount_in_cents: 500000,
        }),
        expect.any(Object)
      );
    });
  });

  describe("sendPaymentUpdate (private)", () => {
    it("should log success on successful API call", async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: {} });

      // @ts-ignore - testing private method
      await aspinPaymentService["sendPaymentUpdate"]({
        policy_guid: testData.policyGuid,
        amount_in_cents: 500000,
        mno_reference: testData.mnoReference,
        status: "Succeeded",
        channel: "ApiClient",
        effected_at: testData.effectedAt,
      });

      // Should not throw
    });

    it("should include partner GUID in request params", async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: {} });

      // @ts-ignore - testing private method
      await aspinPaymentService["sendPaymentUpdate"]({
        policy_guid: testData.policyGuid,
        amount_in_cents: 500000,
        mno_reference: testData.mnoReference,
        status: "Succeeded",
        channel: "ApiClient",
        effected_at: testData.effectedAt,
      });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        "/api/payments",
        expect.any(Object),
        expect.objectContaining({
          params: {
            partner: expect.any(String),
          },
        })
      );
    });
  });
});
