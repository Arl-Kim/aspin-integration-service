import { logger } from "../utils/logger.ts";
import { config } from "../config/config.ts";
import type { IdempotencyRecord } from "../types/payment.types.ts";

/**
 * In-memory idempotency store with TTL
 * In production, allow replacing with Redis or DynamoDB
 */
class IdempotencyService {
  private store: Map<string, IdempotencyRecord> = new Map();
  private ttl: number;

  constructor() {
    this.ttl = config.idempotency.ttl;

    // Clean up expired records every hour
    setInterval(() => this.cleanup(), 60 * 60 * 1000);
  }

  /**
   * Check if a key has been processed before
   * Returns cached response if exists and not expired
   */
  async get(key: string): Promise<unknown | null> {
    const record = this.store.get(key);

    if (!record) {
      return null;
    }

    if (record.expiresAt < new Date()) {
      this.store.delete(key);
      return null;
    }

    logger.debug("Idempotency cache hit", { key });
    return record.response;
  }

  /**
   * Store the response for a key with TTL
   */
  async set(key: string, response: unknown): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + this.ttl);

    this.store.set(key, {
      key,
      response,
      expiresAt,
    });

    logger.debug("Idempotency cache set", { key, expiresAt });
  }

  /**
   * Check if a key exists without returning the value
   */
  async exists(key: string): Promise<boolean> {
    const record = this.store.get(key);

    if (!record) {
      return false;
    }

    if (record.expiresAt < new Date()) {
      this.store.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Remove expired records
   */
  private cleanup(): void {
    const now = new Date();
    let expiredCount = 0;

    for (const [key, record] of this.store.entries()) {
      if (record.expiresAt < now) {
        this.store.delete(key);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      logger.debug("Idempotency store cleanup", { expiredCount });
    }
  }

  /**
   * Get store size (for monitoring)
   */
  size(): number {
    return this.store.size;
  }
}

// Singleton instance
export const idempotencyService = new IdempotencyService();
