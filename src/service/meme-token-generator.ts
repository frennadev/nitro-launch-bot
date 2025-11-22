/**
 * Meme Token Generator Service
 *
 * Integrates Twitter content fetching, AI analysis, and token generation
 * into a complete pipeline for creating tokens from viral content
 */

import { logger } from "../blockchain/common/logger";
import { TwitterService } from "./twitter/TwitterService";
import {
  AIMemeableAnalysisService,
  MemeableAnalysis,
  TokenGenerationData,
} from "./ai-memeable-analysis";

// Interface to match TwitterPostContent structure from twitter-content-fetcher
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

// Interface for TwitterService response
interface TwitterApiResponse {
  data?: {
    text?: string;
    author?: {
      username?: string;
      name?: string;
    };
    created_at?: string;
    public_metrics?: {
      like_count?: number;
      retweet_count?: number;
      reply_count?: number;
    };
  };
  text?: string;
  author?: {
    username?: string;
    name?: string;
  };
  created_at?: string;
  public_metrics?: {
    like_count?: number;
    retweet_count?: number;
    reply_count?: number;
  };
}

export interface MemeTokenGenerationResult {
  success: boolean;
  twitterContent?: TwitterPostContent;
  analysis?: MemeableAnalysis;
  tokenData?: TokenGenerationData;
  generatedImageUrl?: string;
  recommendedImage?: string;
  marketingPlan?: MarketingPlan;
  error?: string;
  warnings?: string[];
}

export interface MarketingPlan {
  tweetTemplate: string;
  launchTiming: string;
  targetInfluencers: string[];
  contentStrategy: string[];
  communityEngagementTips: string[];
}

export class MemeTokenGeneratorService {
  // Helper function to validate Twitter URLs
  private static isValidTwitterUrl(url: string): boolean {
    const twitterUrlRegex =
      /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/;
    return twitterUrlRegex.test(url);
  }

  // Helper function to extract tweet ID from URL
  private static extractTweetId(url: string): string | null {
    const match = url.match(/\/status\/(\d+)/);
    return match ? match[1] : null;
  }

  // Helper function to convert TwitterService response to our format
  private static convertToTwitterContent(
    tweetData: TwitterApiResponse,
    url: string
  ): TwitterPostContent {
    return {
      text: tweetData?.data?.text || tweetData?.text || "",
      author:
        tweetData?.data?.author?.username ||
        tweetData?.author?.username ||
        "unknown",
      timestamp:
        tweetData?.data?.created_at ||
        tweetData?.created_at ||
        new Date().toISOString(),
      engagement: {
        likes: tweetData?.data?.public_metrics?.like_count || 0,
        retweets: tweetData?.data?.public_metrics?.retweet_count || 0,
        replies: tweetData?.data?.public_metrics?.reply_count || 0,
      },
      url: url,
    };
  }

  /**
   * Complete pipeline: URL -> Content -> Analysis -> Token Data
   */
  static async generateTokenFromTwitterUrl(
    url: string
  ): Promise<MemeTokenGenerationResult> {
    const warnings: string[] = [];

    try {
      logger.info(
        `[Meme Token Generator] Starting generation pipeline for URL: ${url}`
      );

      // Step 1: Validate and fetch Twitter content
      if (!this.isValidTwitterUrl(url)) {
        return {
          success: false,
          error:
            "Invalid Twitter/X URL format. Please provide a valid tweet URL.",
        };
      }

      const tweetId = this.extractTweetId(url);
      if (!tweetId) {
        return {
          success: false,
          error: "Could not extract tweet ID from URL.",
        };
      }

      logger.info("[Meme Token Generator] Step 1: Fetching Twitter content...");

      const twitterService = new TwitterService();
      const tweetData = await twitterService.getTweetById(tweetId);

      if (!tweetData) {
        return {
          success: false,
          error:
            "Tweet not found or private. Please make sure the tweet exists and is publicly accessible.",
        };
      }

      const twitterContent = this.convertToTwitterContent(tweetData, url);
      logger.info(
        `[Meme Token Generator] Content fetched: "${twitterContent.text.substring(0, 100)}..."`
      );

      // Step 2: AI analysis for memeability
      logger.info(
        "[Meme Token Generator] Step 2: Analyzing memeability with AI..."
      );

      if (!AIMemeableAnalysisService.isConfigured()) {
        return {
          success: false,
          error:
            "OpenAI API key not configured. Please set OPENAI_API_KEY environment variable.",
        };
      }

      const analysisResult =
        await AIMemeableAnalysisService.analyzeMemeableContent(twitterContent);

      if (
        !analysisResult.success ||
        !analysisResult.analysis ||
        !analysisResult.tokenData
      ) {
        return {
          success: false,
          error: analysisResult.error || "AI analysis failed",
        };
      }

      const { analysis, tokenData, generatedImageUrl } = analysisResult;
      logger.info(
        `[Meme Token Generator] Analysis complete - Memeable: ${analysis.isMemeable}, Score: ${analysis.memeabilityScore}`
      );

      if (generatedImageUrl) {
        logger.info(
          `[Meme Token Generator] AI-generated image available: ${generatedImageUrl.substring(0, 50)}...`
        );
      }

      // Step 3: Additional validation and warnings
      if (!analysis.isMemeable) {
        warnings.push(
          "AI analysis suggests this content has low meme potential"
        );
      }

      if (analysis.memeabilityScore < 50) {
        warnings.push(
          `Low memeability score (${analysis.memeabilityScore}/100) - consider reviewing the content`
        );
      }

      if (analysis.risks.length > 0) {
        warnings.push(
          `Potential risks identified: ${analysis.risks.join(", ")}`
        );
      }

      // Step 4: Generate marketing plan
      logger.info(
        "[Meme Token Generator] Step 3: Generating marketing plan..."
      );
      const marketingPlan = this.generateMarketingPlan(
        twitterContent,
        analysis,
        tokenData
      );

      // Step 5: Recommend image strategy
      const recommendedImage = this.recommendImageStrategy(
        twitterContent,
        analysis
      );

      const result: MemeTokenGenerationResult = {
        success: true,
        twitterContent,
        analysis,
        tokenData,
        generatedImageUrl,
        recommendedImage,
        marketingPlan,
        warnings: warnings.length > 0 ? warnings : undefined,
      };

      logger.info(
        `[Meme Token Generator] Pipeline complete - Token: ${tokenData.name} (${tokenData.symbol})`
      );
      return result;
    } catch (error) {
      logger.error("[Meme Token Generator] Pipeline error:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown error in token generation pipeline",
      };
    }
  }

  /**
   * Quick meme check without full token generation
   */
  static async quickMemeCheck(url: string): Promise<{
    success: boolean;
    isMemeable: boolean;
    score: number;
    reason: string;
    error?: string;
  }> {
    try {
      // Validate and fetch content
      if (!this.isValidTwitterUrl(url)) {
        return {
          success: false,
          isMemeable: false,
          score: 0,
          reason: "Invalid Twitter URL",
          error: "Invalid Twitter/X URL format",
        };
      }

      const tweetId = this.extractTweetId(url);
      if (!tweetId) {
        return {
          success: false,
          isMemeable: false,
          score: 0,
          reason: "Could not extract tweet ID",
          error: "Could not extract tweet ID from URL",
        };
      }

      const twitterService = new TwitterService();
      const tweetData = await twitterService.getTweetById(tweetId);

      if (!tweetData) {
        return {
          success: false,
          isMemeable: false,
          score: 0,
          reason: "Could not fetch content",
          error: "Tweet not found or private",
        };
      }

      const twitterContent = this.convertToTwitterContent(tweetData, url);

      // Quick analysis
      const quickCheck = await AIMemeableAnalysisService.quickMemeabilityCheck(
        twitterContent.text
      );

      return {
        success: true,
        isMemeable: quickCheck.isMemeable,
        score: quickCheck.score,
        reason: quickCheck.reason,
      };
    } catch (error) {
      return {
        success: false,
        isMemeable: false,
        score: 0,
        reason: "Analysis failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Generate comprehensive marketing plan
   */
  private static generateMarketingPlan(
    twitterContent: TwitterPostContent,
    analysis: MemeableAnalysis,
    tokenData: TokenGenerationData
  ): MarketingPlan {
    // Generate tweet template
    const hashtags =
      tokenData.hashtags.length > 0
        ? tokenData.hashtags
            .map((h) => (h.startsWith("#") ? h : `#${h}`))
            .join(" ")
        : "#memecoin #crypto #solana";

    const tweetTemplate = `🚀 Introducing $${tokenData.symbol} - ${tokenData.name}!

${tokenData.narrative}

Inspired by: ${twitterContent.url}

${hashtags}

#PumpFun #MemeCoin #ToTheMoon`;

    // Launch timing based on viral potential
    const launchTiming =
      analysis.viralPotential === "high"
        ? "Launch immediately while trend is hot"
        : analysis.viralPotential === "medium"
          ? "Launch within 24-48 hours"
          : "Consider waiting for better timing or content";

    // Target influencers based on category
    const influencerMap: { [key: string]: string[] } = {
      animal: ["@dogecoin", "@ShibaInuCoin", "@pepe"],
      "pop culture": ["@elonmusk", "@boredapeyc", "@cryptopunks"],
      "crypto meme": ["@cz_binance", "@VitalikButerin", "@crypto_god"],
      "viral moment": ["@9gag", "@memesofficial", "@dank_memes"],
      general: ["@memecoin_hub", "@crypto_memes", "@degenerate"],
    };

    const targetInfluencers =
      influencerMap[analysis.memeCategory.toLowerCase()] ||
      influencerMap["general"];

    // Content strategy
    const contentStrategy = [
      "Create meme variations of the original content",
      "Share behind-the-scenes token creation story",
      "Engage with the original tweet author",
      "Post regular updates with token metrics",
      "Create community challenges and contests",
    ];

    // Community engagement tips
    const communityEngagementTips = [
      "Respond to every comment in the first hour",
      "Share the original tweet that inspired the token",
      "Create polls asking community for feedback",
      "Partner with meme accounts for cross-promotion",
      "Host Twitter Spaces to discuss the token",
    ];

    return {
      tweetTemplate,
      launchTiming,
      targetInfluencers,
      contentStrategy,
      communityEngagementTips,
    };
  }

  /**
   * Recommend image strategy based on content
   */
  private static recommendImageStrategy(
    twitterContent: TwitterPostContent,
    analysis: MemeableAnalysis
  ): string {
    if (twitterContent.media && twitterContent.media.length > 0) {
      return `Use or remix existing media from the tweet: ${twitterContent.media.map((m) => m.url).join(", ")}`;
    }

    const imageRecommendations: { [key: string]: string } = {
      animal:
        "Create a cartoon version of the animal mentioned, possibly wearing crypto-themed accessories",
      "pop culture":
        "Design a minimalist icon representing the pop culture reference with crypto elements",
      "crypto meme":
        "Use existing crypto meme templates but customize with your token theme",
      "viral moment":
        "Create a simple, recognizable logo that captures the essence of the viral moment",
      general:
        "Design a clean, professional logo that represents the token name and concept",
    };

    return (
      imageRecommendations[analysis.memeCategory.toLowerCase()] ||
      imageRecommendations["general"]
    );
  }

  /**
   * Validate token data before creation
   */
  static validateTokenData(tokenData: TokenGenerationData): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Name validation
    if (!tokenData.name || tokenData.name.length < 3) {
      errors.push("Token name must be at least 3 characters");
    }
    if (tokenData.name.length > 32) {
      errors.push("Token name cannot exceed 32 characters");
    }

    // Symbol validation
    if (!tokenData.symbol || tokenData.symbol.length < 3) {
      errors.push("Token symbol must be at least 3 characters");
    }
    if (tokenData.symbol.length > 8) {
      errors.push("Token symbol cannot exceed 8 characters");
    }
    if (!/^[A-Z0-9]+$/.test(tokenData.symbol)) {
      errors.push(
        "Token symbol must contain only uppercase letters and numbers"
      );
    }

    // Description validation
    if (!tokenData.description || tokenData.description.length < 10) {
      errors.push("Token description must be at least 10 characters");
    }
    if (tokenData.description.length > 250) {
      errors.push("Token description cannot exceed 250 characters");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Generate fallback token data if AI analysis fails
   */
  static generateFallbackTokenData(
    twitterContent: TwitterPostContent
  ): TokenGenerationData {
    const words = twitterContent.text
      .split(" ")
      .filter((word) => word.length > 2);
    const firstWord = words[0] || "Meme";

    return {
      name: `${firstWord} Token`.substring(0, 32),
      symbol:
        firstWord
          .substring(0, 8)
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "") || "MEME",
      description: `A meme token inspired by viral content from @${twitterContent.author}`,
      narrative: `This token was inspired by a viral post that caught the attention of the crypto community.`,
      hashtags: ["#memecoin", "#viral", "#crypto"],
      marketingAngle: "Community-driven meme token",
      targetAudience: "Crypto enthusiasts and meme lovers",
      launchStrategy: [
        "Build community engagement",
        "Leverage original viral content",
        "Focus on fun and community",
      ],
    };
  }
}
