import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export const config = {
  env: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "3000", 10),

  api: {
    key: process.env.API_KEY || "test_api_key_123",
    webhookSecret: process.env.WEBHOOK_SECRET || "test_webhook_secret_456",
  },

  paymentHub: {
    url: process.env.PAYMENT_HUB_API_URL || "http://localhost:3001",
    timeout: parseInt(process.env.PAYMENT_HUB_TIMEOUT || "5000", 10),
  },

  aspin: {
    apiUrl:
      process.env.ASPIN_API_URL ||
      "https://engine.staging.aspin-inclusivity.com",
    clientId: process.env.ASPIN_CLIENT_ID || "5BNGscbCVZ",
    clientSecret:
      process.env.ASPIN_CLIENT_SECRET || "XK0inXBj1KZ8Eo98ugnTmuZUfDOenIeV",
    username: process.env.ASPIN_USERNAME || "test_admin",
    password: process.env.ASPIN_PASSWORD || "Qwertyui1!",
    partnerGuid: process.env.ASPIN_PARTNER_GUID || "demo",
    tokenUrl:
      process.env.ASPIN_TOKEN_URL || `${process.env.ASPIN_API_URL}/oauth/token`,
    paymentUrl:
      process.env.ASPIN_PAYMENT_URL ||
      `${process.env.ASPIN_API_URL}/api/payments`,
  },

  idempotency: {
    ttl: parseInt(process.env.IDEMPOTENCY_TTL || "86400", 10),
  },

  logging: {
    level: process.env.LOG_LEVEL || "debug",
  },
} as const;

export type Config = typeof config;
