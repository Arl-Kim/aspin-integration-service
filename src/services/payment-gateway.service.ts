import axios, { type AxiosInstance } from "axios";
import { config } from "../config/config.ts";
import { logger } from "../utils/logger.ts";
import { v4 as uuidv4 } from "uuid";
import type { PaymentGateway } from "../types/payment.types.ts";

interface InitiatePaymentParams {
  amount: number;
  currency: string;
  msisdn: string;
  reference: string;
  description?: string;
}

interface InitiatePaymentResult {
  transactionId: string;
  gatewayReference: string;
  status: "pending" | "processing" | "completed" | "failed";
}

/**
 * Mock PaymentHub implementation for assessment
 * Simulates both M-Pesa and Airtel Money APIs
 */
export class PaymentGatewayService {
  private mpesaClient: AxiosInstance;
  private airtelClient: AxiosInstance;

  constructor() {
    // Mock clients - in production, these would be real SDKs
    this.mpesaClient = axios.create({
      baseURL: "https://sandbox.safaricom.co.ke/mpesa",
      timeout: config.paymentHub.timeout,
    });

    this.airtelClient = axios.create({
      baseURL: "https://openapi.airtel.africa",
      timeout: config.paymentHub.timeout,
    });
  }

  /**
   * Initiate payment with selected gateway
   */
  async initiatePayment(
    gateway: PaymentGateway,
    params: InitiatePaymentParams
  ): Promise<InitiatePaymentResult> {
    logger.info(`Initiating ${gateway} payment`, {
      amount: params.amount,
      currency: params.currency,
      msisdn: params.msisdn,
    });

    // Simulate gateway selection
    switch (gateway) {
      case "mpesa":
        return this.initiateMpesaPayment(params);
      case "airtel":
        return this.initiateAirtelPayment(params);
      default:
        throw new Error(`Unsupported gateway: ${gateway}`);
    }
  }

  /**
   * Mock M-Pesa STK Push
   */
  private async initiateMpesaPayment(
    params: InitiatePaymentParams
  ): Promise<InitiatePaymentResult> {
    // Simulate network delay or timeout
    await this.simulateNetworkConditions();

    // Mock response
    const transactionId = `MPESA_${uuidv4().replace(/-/g, "").substring(0, 12)}`;
    const gatewayReference = `WSR_${Date.now()}`;

    logger.debug("M-Pesa payment initiated", {
      transactionId,
      gatewayReference,
    });

    return {
      transactionId,
      gatewayReference,
      status: "pending",
    };
  }

  /**
   * Mock Airtel Money API
   */
  private async initiateAirtelPayment(
    params: InitiatePaymentParams
  ): Promise<InitiatePaymentResult> {
    // Simulate network delay or timeout
    await this.simulateNetworkConditions();

    // Mock response
    const transactionId = `AIRTEL_${uuidv4().replace(/-/g, "").substring(0, 12)}`;
    const gatewayReference = `AIR_${Date.now()}`;

    logger.debug("Airtel Money payment initiated", {
      transactionId,
      gatewayReference,
    });

    return {
      transactionId,
      gatewayReference,
      status: "pending",
    };
  }

  /**
   * Simulate network conditions for testing
   * - 5% chance of timeout
   * - 10% chance of slow response (>3s)
   */
  private async simulateNetworkConditions(): Promise<void> {
    const rand = Math.random();

    // Simulate timeout (5% chance)
    if (rand < 0.05) {
      logger.warn("Simulating PaymentHub timeout");
      await new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error("PaymentHub timeout"));
        }, config.paymentHub.timeout + 1000);
      });
    }

    // Simulate slow response (10% chance)
    if (rand < 0.15) {
      logger.debug("Simulating slow PaymentHub response");
      await new Promise((resolve) => setTimeout(resolve, 3500));
    }

    // Normal response (immediate)
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

// Singleton instance
export const paymentGatewayService = new PaymentGatewayService();
