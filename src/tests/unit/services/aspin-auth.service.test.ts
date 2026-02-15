import {
  jest,
  describe,
  beforeEach,
  it,
  expect,
} from "@jest/globals";
import axios from "axios";
import { aspinAuthService } from "../../../services/aspin-auth.service.js";

// Mock axios
jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock logger
jest.mock("../../../utils/logger.js", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

describe("AspinAuthService", () => {
  const mockTokenResponse = {
    data: {
      access_token: "test-access-token-123",
      token_type: "bearer",
      refresh_token: "test-refresh-token-456",
      expires_in: 1517, // ~25 minutes
      scope: "all",
      user_client_name: "TestClient",
      user_guid: "test-user-guid",
      user_fullname: "Test User",
      user_partners: [{ guid: "demo", name: "Demo Partner" }],
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    aspinAuthService.clearToken();
  });

  describe("getAccessToken", () => {
    it("should return cached token if valid", async () => {
      // First call to get token
      mockedAxios.post.mockResolvedValueOnce(mockTokenResponse);

      const firstToken = await aspinAuthService.getAccessToken();

      // Second call should use cache
      const secondToken = await aspinAuthService.getAccessToken();

      expect(firstToken).toBe("test-access-token-123");
      expect(secondToken).toBe("test-access-token-123");
      expect(mockedAxios.post).toHaveBeenCalledTimes(1); // Only one actual API call
    });

    it("should fetch new token if cache expired", async () => {
      // Mock first successful response
      mockedAxios.post.mockResolvedValueOnce(mockTokenResponse);

      const firstToken = await aspinAuthService.getAccessToken();
      expect(firstToken).toBe("test-access-token-123");

      // Manually expire the token
      // @ts-ignore - accessing private property
      aspinAuthService.tokenExpiry = new Date(Date.now() - 1000);

      // Mock second response
      mockedAxios.post.mockResolvedValueOnce({
        ...mockTokenResponse,
        data: { ...mockTokenResponse.data, access_token: "new-token-789" },
      });

      const secondToken = await aspinAuthService.getAccessToken();
      expect(secondToken).toBe("new-token-789");
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });

    it("should throw error on authentication failure", async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error("Network error"));

      await expect(aspinAuthService.getAccessToken()).rejects.toThrow(
        "Failed to authenticate with ASPIn"
      );
    });

    it("should throw error on invalid response schema", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          // Missing required fields
          access_token: "test-token",
        },
      });

      await expect(aspinAuthService.getAccessToken()).rejects.toThrow();
    });
  });

  describe("authenticate", () => {
    it("should make correct API call to ASPIn", async () => {
      mockedAxios.post.mockResolvedValueOnce(mockTokenResponse);

      // @ts-ignore - calling private method
      await aspinAuthService["authenticate"]();

      expect(mockedAxios.post).toHaveBeenCalledWith(
        "/oauth/token",
        null,
        expect.objectContaining({
          params: {
            grant_type: "password",
            scope: "all",
            username: expect.any(String),
            password: expect.any(String),
          },
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^Basic /),
            "Content-Type": "application/x-www-form-urlencoded",
          }),
        })
      );
    });

    it("should set token expiry with buffer", async () => {
      const expiresIn = 1517; // 25 minutes 17 seconds
      mockedAxios.post.mockResolvedValueOnce(mockTokenResponse);

      // @ts-ignore - calling private method
      await aspinAuthService["authenticate"]();

      // @ts-ignore - accessing private property
      const expiry = aspinAuthService.tokenExpiry;
      expect(expiry).toBeInstanceOf(Date);

      // Should be expires_in - 60 seconds from now
      const expectedExpiry = new Date();
      expectedExpiry.setSeconds(expectedExpiry.getSeconds() + expiresIn - 60);

      // Allow 1 second difference due to test execution time
      expect(expiry?.getTime()).toBeCloseTo(expectedExpiry.getTime(), -2);
    });
  });

  describe("clearToken", () => {
    it("should clear cached token and expiry", async () => {
      // First get token
      mockedAxios.post.mockResolvedValueOnce(mockTokenResponse);
      await aspinAuthService.getAccessToken();

      // Verify token is cached
      // @ts-ignore
      expect(aspinAuthService.accessToken).toBe("test-access-token-123");
      // @ts-ignore
      expect(aspinAuthService.tokenExpiry).toBeInstanceOf(Date);

      // Clear token
      aspinAuthService.clearToken();

      // @ts-ignore
      expect(aspinAuthService.accessToken).toBeNull();
      // @ts-ignore
      expect(aspinAuthService.tokenExpiry).toBeNull();
    });
  });
});
