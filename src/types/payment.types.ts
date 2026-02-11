import { z } from "zod";

// Zod Validation Schemas

// ASPIn → This Service: Payment Initiation Request
export const InitiatePaymentRequestSchema = z.object({
  policy_guid: z.string().uuid(),
  amount: z.number().positive().int(),
  currency: z.enum(["KES", "UGX", "RWF", "ZMW", "ZAR"]),
  msisdn: z
    .string()
    .regex(/^00[1-9]\d{6,14}$/, "Must be E.164 with leading 00"),
  customer_id: z.string().optional(),
  external_reference: z.string().optional(),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type InitiatePaymentRequest = z.infer<
  typeof InitiatePaymentRequestSchema
>;

// This Service → ASPIn: Payment Notification
export const AspinPaymentUpdateSchema = z.object({
  policy_guid: z.string().uuid(),
  amount_in_cents: z.number().positive().int(),
  mno_reference: z.string(),
  status: z.enum(["Succeeded", "Failed"]),
  channel: z.literal("ApiClient"),
  effected_at: z.string().date(),
});

export type AspinPaymentUpdate = z.infer<typeof AspinPaymentUpdateSchema>;

// PaymentHub → This Service: Webhook Payload
export const PaymentHubWebhookSchema = z.object({
  transaction_id: z.string(),
  status: z.enum(["completed", "failed", "pending"]),
  amount: z.number().positive().int(),
  currency: z.enum(["KES", "UGX", "RWF", "ZMW", "ZAR"]),
  timestamp: z.string().datetime(),
  signature: z.string().optional(),
  policy_guid: z.string().uuid().optional(), // Added for context
  mno_reference: z.string().optional(), // Added for idempotency
});

export type PaymentHubWebhook = z.infer<typeof PaymentHubWebhookSchema>;

// This Service → ASPIn: OAuth2 Token Response
export const AspinTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal("bearer"),
  refresh_token: z.string(),
  expires_in: z.number(),
  scope: z.string(),
  user_client_name: z.string(),
  user_guid: z.string(),
  user_fullname: z.string(),
  user_partners: z.array(z.any()),
});

export type AspinTokenResponse = z.infer<typeof AspinTokenResponseSchema>;

// Internal Types

export interface PaymentTransaction {
  transactionId: string;
  policyGuid: string;
  amount: number;
  currency: string;
  msisdn: string;
  status: "pending" | "processing" | "completed" | "failed";
  gateway: "mpesa" | "airtel";
  gatewayReference?: string;
  mnoReference?: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface IdempotencyRecord {
  key: string;
  response: unknown;
  expiresAt: Date;
}

export enum PaymentGateway {
  MPESA = "mpesa",
  AIRTEL = "airtel",
}

export interface GatewayConfig {
  name: PaymentGateway;
  initiateEndpoint: string;
  webhookEndpoint: string;
  apiKey?: string;
  apiSecret?: string;
  timeout: number;
}
