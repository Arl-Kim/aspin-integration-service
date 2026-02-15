import {
  jest,
  describe,
  beforeEach,
  it,
  expect,
} from "@jest/globals";
import { idempotencyService } from "../../../services/idempotency.service.js";

// Mock logger to avoid console output during tests
jest.mock("../../../utils/logger.js", () => ({
  logger: {
    debug: jest.fn(),
  },
}));

describe("IdempotencyService", () => {
  beforeEach(() => {
    // Clear the store before each test
    // @ts-ignore - accessing private store for testing
    idempotencyService.store.clear();
    jest.clearAllMocks();
  });

  describe("get", () => {
    it("should return null for non-existent key", async () => {
      const result = await idempotencyService.get("non-existent");
      expect(result).toBeNull();
    });

    it("should return cached response for existing key", async () => {
      const key = "test-key";
      const response = { data: "test" };

      await idempotencyService.set(key, response);
      const result = await idempotencyService.get(key);

      expect(result).toEqual(response);
    });

    it("should return null for expired key", async () => {
      const key = "expired-key";
      const response = { data: "test" };

      // Set with short TTL
      // @ts-ignore - accessing private property
      idempotencyService.ttl = -1; // Force immediate expiry
      await idempotencyService.set(key, response);

      const result = await idempotencyService.get(key);
      expect(result).toBeNull();
    });
  });

  describe("set", () => {
    it("should store response with expiry", async () => {
      const key = "test-key";
      const response = { data: "test" };

      await idempotencyService.set(key, response);

      // @ts-ignore - accessing private store for testing
      const record = idempotencyService.store.get(key);
      expect(record).toBeDefined();
      expect(record?.key).toBe(key);
      expect(record?.response).toEqual(response);
      expect(record?.expiresAt).toBeInstanceOf(Date);
      expect(record?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("exists", () => {
    it("should return true for existing key", async () => {
      const key = "test-key";
      await idempotencyService.set(key, { data: "test" });

      const result = await idempotencyService.exists(key);
      expect(result).toBe(true);
    });

    it("should return false for non-existent key", async () => {
      const result = await idempotencyService.exists("non-existent");
      expect(result).toBe(false);
    });

    it("should return false for expired key", async () => {
      const key = "expired-key";
      await idempotencyService.set(key, { data: "test" });

      // Manually expire the record
      // @ts-ignore - accessing private store
      const record = idempotencyService.store.get(key);
      if (record) {
        record.expiresAt = new Date(Date.now() - 1000);
      }

      const result = await idempotencyService.exists(key);
      expect(result).toBe(false);
    });
  });

  describe("size", () => {
    it("should return correct store size", async () => {
      expect(idempotencyService.size()).toBe(0);

      await idempotencyService.set("key1", { data: 1 });
      await idempotencyService.set("key2", { data: 2 });

      expect(idempotencyService.size()).toBe(2);
    });
  });

  describe("cleanup", () => {
    it("should remove expired records", async () => {
      // Set two keys
      await idempotencyService.set("key1", { data: 1 });
      await idempotencyService.set("key2", { data: 2 });

      // Manually expire key1
      // @ts-ignore - accessing private store
      const record1 = idempotencyService.store.get("key1");
      if (record1) {
        record1.expiresAt = new Date(Date.now() - 1000);
      }

      // @ts-ignore - calling private method
      idempotencyService.cleanup();

      expect(idempotencyService.size()).toBe(1);
      expect(await idempotencyService.get("key1")).toBeNull();
      expect(await idempotencyService.get("key2")).toBeDefined();
    });
  });
});
