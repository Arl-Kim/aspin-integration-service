import { z } from "zod";
import {
  InitiatePaymentRequestSchema,
  PaymentHubWebhookSchema,
} from "../types/payment.types.ts";

// Re-export schemas
export { InitiatePaymentRequestSchema, PaymentHubWebhookSchema };

// Webhook signature validation schema
export const WebhookHeadersSchema = z.object({
  "x-signature": z.string().optional(),
  "x-webhook-id": z.string().uuid(),
  "x-webhook-timestamp": z.string().datetime().optional(),
});

export type WebhookHeaders = z.infer<typeof WebhookHeadersSchema>;
