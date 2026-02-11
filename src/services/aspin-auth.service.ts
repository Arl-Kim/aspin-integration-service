import axios, { AxiosInstance } from "axios";
import { config } from "../config/config.ts";
import { logger } from "../utils/logger.ts";
import { AspinTokenResponseSchema } from "../types/payment.types.ts";

export class AspinAuthService {
  private client: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: config.aspin.apiUrl,
      timeout: 10000,
    });
  }

  /**
   * Get valid access token (auto-refreshes if expired)
   */
  async getAccessToken(): Promise<string> {
    // Check if we have a valid token
    if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date()) {
      logger.debug("Using cached ASPIn access token");
      return this.accessToken;
    }

    // Token expired or doesn't exist, get new one
    return this.authenticate();
  }

  /**
   * Authenticate with ASPIn using OAuth2 password grant
   */
  private async authenticate(): Promise<string> {
    try {
      logger.info("Authenticating with ASPIn API");

      // Generate Basic Auth token: base64(client_id:client_secret)
      const basicToken = Buffer.from(
        `${config.aspin.clientId}:${config.aspin.clientSecret}`
      ).toString("base64");

      const response = await this.client.post("/oauth/token", null, {
        params: {
          grant_type: "password",
          scope: "all",
          username: config.aspin.username,
          password: config.aspin.password,
        },
        headers: {
          Authorization: `Basic ${basicToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      // Validate response
      const tokenData = AspinTokenResponseSchema.parse(response.data);

      this.accessToken = tokenData.access_token;

      // Set expiry (subtract 60 seconds buffer)
      this.tokenExpiry = new Date();
      this.tokenExpiry.setSeconds(
        this.tokenExpiry.getSeconds() + tokenData.expires_in - 60
      );

      logger.info("ASPIn authentication successful", {
        expiresIn: tokenData.expires_in,
        user: tokenData.user_fullname,
      });

      return this.accessToken;
    } catch (error) {
      logger.error("ASPIn authentication failed", { error });
      throw new Error("Failed to authenticate with ASPIn");
    }
  }

  /**
   * Clear cached token (force re-authentication)
   */
  clearToken(): void {
    this.accessToken = null;
    this.tokenExpiry = null;
    logger.debug("ASPIn token cache cleared");
  }
}

// Singleton instance
export const aspinAuthService = new AspinAuthService();
