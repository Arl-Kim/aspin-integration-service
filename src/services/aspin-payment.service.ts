import axios, { AxiosInstance } from "axios";
import { config } from "../config/config";
import { logger } from "../utils/logger";
import { aspinAuthService } from "./aspin-auth.service";
import type { AspinPaymentUpdate } from "../types/payment.types";
import { AspinPaymentUpdateSchema } from "../types/payment.types";

export class AspinPaymentService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.aspin.apiUrl,
      timeout: 10000,
    });
  }

  /**
   * Notify ASPIn of successful payment
   */
  async notifyPaymentSuccess(
    policyGuid: string,
    amount: number,
    mnoReference: string,
    effectedAt: string
  ): Promise<void> {
    const payload: AspinPaymentUpdate = {
      policy_guid: policyGuid,
      amount_in_cents: amount * 100, // Convert to cents
      mno_reference: mnoReference,
      status: "Succeeded",
      channel: "ApiClient",
      effected_at: effectedAt,
    };

    // Validate payload
    AspinPaymentUpdateSchema.parse(payload);

    await this.sendPaymentUpdate(payload);
  }

  /**
   * Notify ASPIn of failed payment
   */
  async notifyPaymentFailure(
    policyGuid: string,
    amount: number,
    mnoReference: string,
    effectedAt: string
  ): Promise<void> {
    const payload: AspinPaymentUpdate = {
      policy_guid: policyGuid,
      amount_in_cents: amount * 100,
      mno_reference: mnoReference,
      status: "Failed",
      channel: "ApiClient",
      effected_at: effectedAt,
    };

    // Validate payload
    AspinPaymentUpdateSchema.parse(payload);

    await this.sendPaymentUpdate(payload);
  }

  /**
   * Send payment update to ASPIn
   */
  private async sendPaymentUpdate(payload: AspinPaymentUpdate): Promise<void> {
    try {
      // Get fresh access token
      const token = await aspinAuthService.getAccessToken();

      logger.info("Sending payment update to ASPIn", {
        policyGuid: payload.policy_guid,
        mnoReference: payload.mno_reference,
        status: payload.status,
      });

      const response = await this.client.post("/api/payments", payload, {
        params: {
          partner: config.aspin.partnerGuid,
        },
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      logger.info("ASPIn payment update successful", {
        status: response.status,
        policyGuid: payload.policy_guid,
      });
    } catch (error) {
      logger.error("ASPIn payment update failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        policyGuid: payload.policy_guid,
        mnoReference: payload.mno_reference,
      });

      throw new Error("Failed to notify ASPIn of payment status");
    }
  }
}

// Singleton instance
export const aspinPaymentService = new AspinPaymentService();
