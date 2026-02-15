import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger.ts";
import { idempotencyService } from "./idempotency.service.ts";
import { paymentGatewayService } from "./payment-gateway.service.ts";
import { aspinPaymentService } from "./aspin-payment.service.ts";
import type {
  InitiatePaymentRequest,
  PaymentTransaction,
  PaymentHubWebhook,
} from "../types/payment.types.ts";
import { PaymentGateway } from "../types/payment.types.ts";

export class PaymentService {
  private transactions: Map<string, PaymentTransaction> = new Map();

  /**
   * Initiate a new payment
   */
  async initiatePayment(
    request: InitiatePaymentRequest,
    correlationId: string
  ): Promise<{ transactionId: string; status: string }> {
    const log = logger.child({
      correlationId,
      policyGuid: request.policy_guid,
    });

    try {
      // Validate amount (KES 5,000)
      if (request.currency === "KES" && request.amount !== 5000) {
        throw new Error(
          "Invalid payment amount. KES 5,000 required for this policy"
        );
      }

      // Generate unique transaction ID
      const transactionId = `TXN_${uuidv4().replace(/-/g, "").substring(0, 12)}`;

      // Determine gateway based on MSISDN
      const gateway = this.determineGateway(request.msisdn);

      // Store transaction record
      const transaction: PaymentTransaction = {
        transactionId,
        policyGuid: request.policy_guid,
        amount: request.amount,
        currency: request.currency,
        msisdn: request.msisdn,
        status: "pending",
        gateway,
        createdAt: new Date(),
        updatedAt: new Date(),
        // Only include metadata if it exists
        ...(request.metadata !== undefined && { metadata: request.metadata }),
      };

      this.transactions.set(transactionId, transaction);

      // Initiate payment with gateway
      const gatewayResult = await paymentGatewayService.initiatePayment(
        gateway,
        {
          amount: request.amount,
          currency: request.currency,
          msisdn: request.msisdn,
          reference: transactionId,
          description:
            request.description || `Policy payment: ${request.policy_guid}`,
        }
      );

      // Update transaction with gateway reference
      transaction.gatewayReference = gatewayResult.gatewayReference;
      transaction.status = gatewayResult.status;
      transaction.updatedAt = new Date();

      log.info("Payment initiated successfully", {
        transactionId,
        gateway,
        gatewayReference: gatewayResult.gatewayReference,
      });

      return {
        transactionId,
        status: gatewayResult.status,
      };
    } catch (error) {
      log.error("Payment initiation failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }

  /**
   * Handle webhook from PaymentHub
   */
  async handleWebhook(
    webhook: PaymentHubWebhook,
    correlationId: string
  ): Promise<void> {
    const log = logger.child({
      correlationId,
      transactionId: webhook.transaction_id,
    });

    try {
      // Check idempotency using transaction_id as key
      const existing = await idempotencyService.get(webhook.transaction_id);
      if (existing) {
        log.warn("Duplicate webhook received, skipping...", {
          transactionId: webhook.transaction_id,
        });
        return;
      }

      // Get transaction from store
      const transaction = this.transactions.get(webhook.transaction_id);
      if (!transaction) {
        throw new Error(`Transaction not found: ${webhook.transaction_id}`);
      }

      // Update transaction status
      transaction.status = webhook.status;
      transaction.updatedAt = new Date();

      // Generate MNO reference (unique for idempotency)
      const mnoReference = webhook.mno_reference || webhook.transaction_id;

      // Notify ASPIn based on payment status
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const effectedAt = `${year}-${month}-${day}`;

      if (webhook.status === "completed") {
        await aspinPaymentService.notifyPaymentSuccess(
          transaction.policyGuid,
          transaction.amount,
          mnoReference,
          effectedAt
        );
      } else if (webhook.status === "failed") {
        await aspinPaymentService.notifyPaymentFailure(
          transaction.policyGuid,
          transaction.amount,
          mnoReference,
          effectedAt
        );
      }

      // Store idempotency record
      await idempotencyService.set(webhook.transaction_id, {
        processed: true,
        timestamp: new Date().toISOString(),
        status: webhook.status,
      });

      log.info("Webhook processed successfully", {
        transactionId: webhook.transaction_id,
        status: webhook.status,
        mnoReference,
      });
    } catch (error) {
      log.error("Webhook processing failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }

  /**
   * Determine payment gateway based on MSISDN
   * I have used just simplified logic for assessment
   */
  private determineGateway(msisdn: string): PaymentGateway {
    // Safaricom (M-Pesa) prefixes: 25470, 25471, 25472, 25479
    // Airtel prefixes: 25473, 25474, 25475, 25477
    if (msisdn.match(/^00254(7[0-2]|79)/)) {
      return PaymentGateway.MPESA;
    }
    if (msisdn.match(/^00254(7[3-5]|77)/)) {
      return PaymentGateway.AIRTEL;
    }

    // Default to M-Pesa for Kenya, Airtel for others
    return msisdn.startsWith("00254")
      ? PaymentGateway.MPESA
      : PaymentGateway.AIRTEL;
  }

  /**
   * Get transaction by ID
   */
  getTransaction(transactionId: string): PaymentTransaction | undefined {
    return this.transactions.get(transactionId);
  }
}

// Singleton instance
export const paymentService = new PaymentService();
