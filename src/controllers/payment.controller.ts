import type { Request, Response } from "express";
import { paymentService } from "../services/payment.service.ts";
import {
  InitiatePaymentRequestSchema,
  PaymentHubWebhookSchema,
} from "../validators/payment.validator.ts";

export class PaymentController {
  /**
   * POST /api/payments/initiate
   * Receives payment request from ASPIn
   */
  async initiatePayment(req: Request, res: Response): Promise<void> {
    const correlationId = req.correlationId || "unknown";

    try {
      // Validate request body
      const validatedData = InitiatePaymentRequestSchema.parse(req.body);

      // Process payment initiation
      const result = await paymentService.initiatePayment(
        validatedData,
        correlationId
      );

      // Return success response
      res.status(202).json({
        transaction_id: result.transactionId,
        status: result.status,
        amount: validatedData.amount,
        currency: validatedData.currency,
        timestamp: new Date().toISOString(),
        _links: {
          self: `/api/payments/${result.transactionId}`,
        },
      });
    } catch (error) {
      // Pass to error handler middleware
      throw error;
    }
  }

  /**
   * POST /api/payments/webhook
   * Receives payment status updates from PaymentHub
   */
  async handleWebhook(req: Request, res: Response): Promise<void> {
    const correlationId = req.correlationId || "unknown";

    try {
      // Validate webhook payload
      const validatedWebhook = PaymentHubWebhookSchema.parse(req.body);

      // Process webhook
      await paymentService.handleWebhook(validatedWebhook, correlationId);

      // Return acknowledgment
      res.status(202).json({
        status: "accepted",
        transaction_id: validatedWebhook.transaction_id,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * GET /api/payments/:transactionId
   * Get payment status (optional, good for debugging)
   */
  async getPaymentStatus(req: Request, res: Response): Promise<void> {
    const { transactionId } = req.params;

    // Ensure transactionId is a string
    if (!transactionId || Array.isArray(transactionId)) {
      res.status(400).json({
        error: {
          code: "INVALID_PARAMETER",
          message: "transactionId must be a single string",
        },
        status: 400,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const transaction = paymentService.getTransaction(transactionId);

    if (!transaction) {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: `Transaction ${transactionId} not found`,
        },
        status: 404,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    res.status(200).json({
      transaction_id: transaction.transactionId,
      policy_guid: transaction.policyGuid,
      status: transaction.status,
      amount: transaction.amount,
      currency: transaction.currency,
      gateway: transaction.gateway,
      gateway_reference: transaction.gatewayReference,
      created_at: transaction.createdAt,
      updated_at: transaction.updatedAt,
    });
  }
}

// Singleton instance
export const paymentController = new PaymentController();
