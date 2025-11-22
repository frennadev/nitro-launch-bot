import axios, { AxiosRequestConfig } from "axios";
import { logger } from "../../blockchain/common/logger";
import { env } from "../../config";
import { TweetsResponse } from "./interfaces";

export interface TwitterUser {
  id: string;
  username: string;
  name: string;
  description?: string;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
    listed_count: number;
  };
  profile_image_url?: string;
  verified?: boolean;
  created_at?: string;
}

export interface TwitterUserDetailed {
  status: string;
  msg: string;
  data: {
    id: string;
    name: string;
    userName: string;
    location: string;
    url: string;
    description: string;
    entities: {
      description: any[];
    };
    protected: boolean;
    isVerified: boolean;
    isBlueVerified: boolean;
    verifiedType: string | null;
    followers: number;
    following: number;
    favouritesCount: number;
    statusesCount: number;
    mediaCount: number;
    createdAt: string;
    coverPicture: string;
    profilePicture: string;
    canDm: boolean;
    affiliatesHighlightedLabel: Record<string, any>;
    isAutomated: boolean;
    automatedBy: string | null;
    pinnedTweetIds: string[];
  };
}

export interface GetUserTweetsOptions {
  userName: string;
}

export interface TwitterApiError {
  title: string;
  detail: string;
  type: string;
  status?: number;
}

export class TwitterService {
  private readonly apiKey: string;
  private readonly baseUrl = "https://api.twitterapi.io";

  constructor() {
    this.apiKey = env.TWITTER_API_KEY;

    if (!this.apiKey) {
      logger.error("[TwitterService] Twitter API key is not configured");
      throw new Error("Twitter API key is required");
    }
  }

  async getUserTweets(options: GetUserTweetsOptions): Promise<TweetsResponse> {
    try {
      const { userName } = options;

      let url = `${
        this.baseUrl
      }/twitter/user/last_tweets?userName=${encodeURIComponent(userName)}`;

      const config: AxiosRequestConfig = {
        method: "GET",
        url,
        headers: {
          "X-API-Key": this.apiKey,
          "Content-Type": "application/json",
        },
      };

      logger.info(`[TwitterService] Fetching tweets for user: ${userName}`);

      const response = await axios(config);
      const data = response.data as TweetsResponse;

      const tweetCount = data.data?.tweets.length || 0;
      logger.info(
        `[TwitterService] Successfully fetched ${tweetCount} tweets for user: ${userName}`
      );

      return data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error(
          `[TwitterService] API request failed with status ${error.response?.status}: ${error.response?.data}`
        );
        throw new Error(
          `Twitter API request failed: ${error.response?.status} - ${error.response?.data}`
        );
      }
      logger.error(`[TwitterService] Error fetching user tweets:`, error);
      throw error;
    }
  }

  async getUserByUsername(
    userName: string
  ): Promise<TwitterUserDetailed | null> {
    try {
      const url = `${
        this.baseUrl
      }/twitter/user/info?userName=${encodeURIComponent(userName)}`;

      const config: AxiosRequestConfig = {
        method: "GET",
        url,
        headers: {
          "X-API-Key": this.apiKey,
        },
        timeout: 15000, // 15 second timeout
      };

      logger.info(`[TwitterService] Fetching user info for: ${userName}`);

      // Add timeout wrapper for extra safety
      const response = (await Promise.race([
        axios(config),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Request timeout after 15 seconds")),
            15000
          )
        ),
      ])) as any;

      // Log raw response for debugging
      logger.debug(`[TwitterService] Raw response status: ${response.status}`);
      logger.debug(`[TwitterService] Raw response headers:`, response.headers);
      logger.debug(`[TwitterService] Raw response data:`, response.data);

      if (!response.data) {
        logger.error(`[TwitterService] Empty response data for ${userName}`);
        return null;
      }

      const data = response.data as TwitterUserDetailed;

      // Check if the response has the expected structure
      if (typeof data !== "object") {
        logger.error(
          `[TwitterService] Invalid response format for ${userName}:`,
          typeof data
        );
        return null;
      }

      logger.debug(`[TwitterService] Parsed API response for ${userName}:`, {
        status: data.status,
        msg: data.msg,
        hasData: !!data.data,
        dataKeys: data.data ? Object.keys(data.data) : [],
      });

      if (data.status !== "success") {
        logger.error(
          `[TwitterService] API returned error status: ${data.status}, message: ${data.msg}`
        );
        return null;
      }

      if (!data.data) {
        logger.error(
          `[TwitterService] No user data in response for ${userName}`
        );
        return null;
      }

      logger.info(
        `[TwitterService] Successfully fetched user info for: ${userName}`
      );
      return data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          logger.warn(`[TwitterService] User not found: ${userName}`);
          return null;
        }

        const status = error.response?.status || "unknown";
        const statusText = error.response?.statusText || "unknown";
        const responseData = error.response?.data
          ? JSON.stringify(error.response.data)
          : "no data";

        logger.error(
          `[TwitterService] API request failed with status ${status} (${statusText}): ${responseData}`
        );

        throw new Error(
          `Twitter API request failed: ${status} - ${statusText}`
        );
      }

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logger.error(
        `[TwitterService] Error fetching user info for ${userName}:`,
        errorMessage
      );
      throw new Error(`Twitter API request failed: ${errorMessage}`);
    }
  }

  async validateUsername(userName: string): Promise<boolean> {
    try {
      const user = await this.getUserByUsername(userName);
      return user !== null;
    } catch (error) {
      logger.error(
        `[TwitterService] Error validating username ${userName}:`,
        error
      );
      return false;
    }
  }

  async getTweetById(tweetId: string): Promise<any> {
    try {
      const url = `${
        this.baseUrl
      }/twitter/tweets?tweet_ids=${encodeURIComponent(tweetId)}`;

      const config: AxiosRequestConfig = {
        method: "GET",
        url,
        headers: {
          "X-API-Key": this.apiKey,
        },
      };

      logger.info(`[TwitterService] Fetching tweet by ID: ${tweetId}`);

      const response = await axios(config);
      const data = response.data;

      logger.info(`[TwitterService] Successfully fetched tweet: ${tweetId}`);
      return data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          logger.warn(`[TwitterService] Tweet not found: ${tweetId}`);
          return null;
        }
        if (error.response?.status === 402) {
          logger.error(
            `[TwitterService] Payment required - Twitter API key may be invalid or out of credits`
          );
          throw new Error(
            `Twitter API payment required. Please check your TWITTER_API_KEY configuration and API credits.`
          );
        }
        logger.error(
          `[TwitterService] API request failed with status ${error.response?.status}: ${JSON.stringify(error.response?.data)}`
        );
        throw new Error(
          `Twitter API request failed: ${error.response?.status} - ${JSON.stringify(error.response?.data)}`
        );
      }
      logger.error(`[TwitterService] Error fetching tweet:`, error);
      throw error;
    }
  }

  async getUserMentions(userName: string): Promise<any> {
    try {
      const url = `${
        this.baseUrl
      }/twitter/user/mentions?userName=${encodeURIComponent(userName)}`;

      const config: AxiosRequestConfig = {
        method: "GET",
        url,
        headers: {
          "X-API-Key": this.apiKey,
          "Content-Type": "application/json",
        },
      };

      logger.info(`[TwitterService] Fetching mentions for user: ${userName}`);

      const response = await axios(config);
      const data = response.data;

      logger.info(
        `[TwitterService] Successfully fetched mentions for user: ${userName}`
      );
      return data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error(
          `[TwitterService] API request failed with status ${error.response?.status}: ${error.response?.data}`
        );
        throw new Error(
          `Twitter API request failed: ${error.response?.status} - ${error.response?.data}`
        );
      }
      logger.error(`[TwitterService] Error fetching user mentions:`, error);
      throw error;
    }
  }
}
