/**
 * Twitter Content Fetcher Service
 *
 * Fetches and extracts content from Twitter/X post URLs
 * Uses web scraping to get post text, media, and metadata
 */

import axios from "axios";
import { logger } from "../blockchain/common/logger";

export interface TwitterPostContent {
  text: string;
  author: string;
  timestamp?: string;
  media?: {
    type: "image" | "video";
    url: string;
  }[];
  engagement?: {
    likes?: number;
    retweets?: number;
    replies?: number;
  };
  url: string;
}

export interface TwitterFetchResult {
  success: boolean;
  content?: TwitterPostContent;
  error?: string;
}

export class TwitterContentFetcher {
  private static readonly USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  ];

  /**
   * Validates if URL is a valid Twitter/X post URL
   */
  static isValidTwitterUrl(url: string): boolean {
    const twitterUrlPattern =
      /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/\w+\/status\/\d+/i;
    return twitterUrlPattern.test(url);
  }

  /**
   * Normalizes Twitter URL to X.com format
   */
  static normalizeTwitterUrl(url: string): string {
    return url.replace(/twitter\.com/i, "x.com");
  }

  /**
   * Fetches Twitter post content from URL
   */
  static async fetchPostContent(url: string): Promise<TwitterFetchResult> {
    try {
      // Validate URL
      if (!this.isValidTwitterUrl(url)) {
        return {
          success: false,
          error: "Invalid Twitter/X URL format",
        };
      }

      // Normalize URL
      const normalizedUrl = this.normalizeTwitterUrl(url);
      logger.info(`[TwitterFetcher] Fetching content from: ${normalizedUrl}`);

      // Try multiple methods to fetch content
      const result = await this.tryMultipleFetchMethods(normalizedUrl);

      if (result.success && result.content) {
        logger.info(
          `[TwitterFetcher] Successfully fetched content: ${result.content.text.substring(0, 100)}...`
        );
        return result;
      }

      return {
        success: false,
        error: "Failed to fetch Twitter post content",
      };
    } catch (error) {
      logger.error(`[TwitterFetcher] Error fetching Twitter content:`, error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  /**
   * Try multiple methods to fetch content (fallback approach)
   */
  private static async tryMultipleFetchMethods(
    url: string
  ): Promise<TwitterFetchResult> {
    const methods = [
      () => this.fetchViaDirectScraping(url),
      () => this.fetchViaEmbedApi(url),
      () => this.fetchViaOpenGraph(url),
    ];

    for (const method of methods) {
      try {
        const result = await method();
        if (result.success) {
          return result;
        }
      } catch (error) {
        logger.warn(`[TwitterFetcher] Method failed, trying next:`, error);
      }
    }

    return {
      success: false,
      error: "All fetch methods failed",
    };
  }

  /**
   * Direct scraping method (primary)
   */
  private static async fetchViaDirectScraping(
    url: string
  ): Promise<TwitterFetchResult> {
    const userAgent =
      this.USER_AGENTS[Math.floor(Math.random() * this.USER_AGENTS.length)];

    const response = await axios.get(url, {
      headers: {
        "User-Agent": userAgent,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Cache-Control": "max-age=0",
      },
      timeout: 10000,
      maxRedirects: 5,
    });

    return this.parseHtmlContent(response.data, url);
  }

  /**
   * Twitter embed API method (fallback)
   */
  private static async fetchViaEmbedApi(
    url: string
  ): Promise<TwitterFetchResult> {
    // Extract tweet ID from URL
    const tweetIdMatch = url.match(/status\/(\d+)/);
    if (!tweetIdMatch) {
      throw new Error("Could not extract tweet ID");
    }

    const embedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}`;

    const response = await axios.get(embedUrl, {
      timeout: 5000,
    });

    if (response.data && response.data.html) {
      // Parse embed HTML to extract content
      return this.parseEmbedHtml(response.data.html, url);
    }

    throw new Error("No embed data available");
  }

  /**
   * Open Graph meta tags method (fallback)
   */
  private static async fetchViaOpenGraph(
    url: string
  ): Promise<TwitterFetchResult> {
    const userAgent = this.USER_AGENTS[0];

    const response = await axios.get(url, {
      headers: {
        "User-Agent": userAgent,
      },
      timeout: 5000,
    });

    return this.parseOpenGraph(response.data, url);
  }

  /**
   * Parse HTML content to extract post data
   */
  private static parseHtmlContent(
    html: string,
    url: string
  ): TwitterFetchResult {
    try {
      // Look for JSON-LD data (most reliable)
      const jsonLdMatch = html.match(
        /<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/s
      );
      if (jsonLdMatch) {
        try {
          const jsonData = JSON.parse(jsonLdMatch[1]);
          if (jsonData && jsonData.text) {
            return {
              success: true,
              content: {
                text: jsonData.text,
                author: jsonData.author?.name || "Unknown",
                url: url,
                timestamp: jsonData.datePublished,
              },
            };
          }
        } catch {
          // Continue to other methods
        }
      }

      // Look for meta tags
      const titleMatch = html.match(
        /<meta property="og:description" content="([^"]*)"[^>]*>/i
      );
      const authorMatch = html.match(
        /<meta name="twitter:title" content="([^"]*)"[^>]*>/i
      );

      if (titleMatch) {
        const text = this.decodeHtmlEntities(titleMatch[1]);
        const author = authorMatch
          ? this.decodeHtmlEntities(authorMatch[1])
          : "Unknown";

        // Clean up the text (remove Twitter-specific suffixes)
        const cleanText = text.replace(/\s*-\s*@\w+\s*$/, "").trim();

        if (cleanText && cleanText.length > 10) {
          return {
            success: true,
            content: {
              text: cleanText,
              author: author,
              url: url,
            },
          };
        }
      }

      // Try to extract from page title as fallback
      const pageTitleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
      if (pageTitleMatch) {
        const title = this.decodeHtmlEntities(pageTitleMatch[1]);
        // Twitter titles usually contain the tweet text
        const cleanTitle = title
          .replace(/\s*\/\s*X$/, "")
          .replace(/\s*\/\s*Twitter$/, "")
          .trim();

        if (cleanTitle && cleanTitle.length > 10) {
          return {
            success: true,
            content: {
              text: cleanTitle,
              author: "Unknown",
              url: url,
            },
          };
        }
      }

      throw new Error("Could not extract content from HTML");
    } catch (error) {
      logger.error("[TwitterFetcher] Error parsing HTML content:", error);
      return {
        success: false,
        error: "Failed to parse HTML content",
      };
    }
  }

  /**
   * Parse embed HTML content
   */
  private static parseEmbedHtml(
    embedHtml: string,
    url: string
  ): TwitterFetchResult {
    try {
      // Extract text from embed HTML
      const textMatch = embedHtml.match(/<p[^>]*>(.*?)<\/p>/s);
      if (textMatch) {
        const text = this.decodeHtmlEntities(
          textMatch[1].replace(/<[^>]*>/g, "")
        );

        // Extract author if available
        const authorMatch = embedHtml.match(/@(\w+)/);
        const author = authorMatch ? authorMatch[1] : "Unknown";

        return {
          success: true,
          content: {
            text: text.trim(),
            author: author,
            url: url,
          },
        };
      }

      throw new Error("Could not extract text from embed");
    } catch {
      return {
        success: false,
        error: "Failed to parse embed HTML",
      };
    }
  }

  /**
   * Parse Open Graph meta tags
   */
  private static parseOpenGraph(html: string, url: string): TwitterFetchResult {
    try {
      const descMatch = html.match(
        /<meta property="og:description" content="([^"]*)"[^>]*>/i
      );
      const titleMatch = html.match(
        /<meta property="og:title" content="([^"]*)"[^>]*>/i
      );

      if (descMatch || titleMatch) {
        const text = descMatch
          ? this.decodeHtmlEntities(descMatch[1])
          : this.decodeHtmlEntities(titleMatch![1]);

        return {
          success: true,
          content: {
            text: text.trim(),
            author: "Unknown",
            url: url,
          },
        };
      }

      throw new Error("No Open Graph data found");
    } catch {
      return {
        success: false,
        error: "Failed to parse Open Graph data",
      };
    }
  }

  /**
   * Decode HTML entities
   */
  private static decodeHtmlEntities(text: string): string {
    const entities: { [key: string]: string } = {
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": '"',
      "&#39;": "'",
      "&apos;": "'",
      "&#x27;": "'",
      "&#x2F;": "/",
      "&#x60;": "`",
      "&#x3D;": "=",
    };

    return text.replace(/&[^;]+;/g, (entity) => entities[entity] || entity);
  }

  /**
   * Extract tweet ID from URL
   */
  static extractTweetId(url: string): string | null {
    const match = url.match(/status\/(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * Get author handle from URL
   */
  static extractAuthorHandle(url: string): string | null {
    const match = url.match(/(?:twitter\.com|x\.com)\/(\w+)\/status/i);
    return match ? match[1] : null;
  }
}
