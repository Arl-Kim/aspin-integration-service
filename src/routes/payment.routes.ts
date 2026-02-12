import { Router } from "express";
import { paymentController } from "../controllers/payment.controller.ts";
import {
  authenticateApiKey,
  validateWebhookSignature,
} from "../middleware/auth.ts";
import { validate } from "../middleware/validation.ts";
import { correlationMiddleware } from "../middleware/correlation.ts";
import {
  InitiatePaymentRequestSchema,
  PaymentHubWebhookSchema,
} from "../validators/payment.validator.ts";

const router = Router();

// Apply correlation middleware to all routes
router.use(correlationMiddleware);

/**
 * POST /api/payments/initiate
 * ASPIn → This Service
 * Requires API key authentication
 */
router.post(
  "/initiate",
  authenticateApiKey,
  validate(InitiatePaymentRequestSchema),
  paymentController.initiatePayment.bind(paymentController)
);

/**
 * POST /api/payments/webhook
 * PaymentHub → This Service
 * Requires webhook signature validation
 */
router.post(
  "/webhook",
  validateWebhookSignature,
  validate(PaymentHubWebhookSchema),
  paymentController.handleWebhook.bind(paymentController)
);

/**
 * GET /api/payments/:transactionId
 * Status endpoint
 */
router.get(
  "/:transactionId",
  authenticateApiKey,
  paymentController.getPaymentStatus.bind(paymentController)
);

export default router;
