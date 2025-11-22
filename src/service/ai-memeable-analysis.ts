/**
 * AI Memeable Analysis Service
 *
 * Uses OpenAI GPT-4 to analyze Twitter content for memeable potential
 * and generate token narratives, names, symbols, and descriptions
 */

import OpenAI from "openai";
import { env } from "../config";
import { logger } from "../blockchain/common/logger";
import { TwitterPostContent } from "./twitter-content-fetcher";

export interface MemeableAnalysis {
  isMemeable: boolean;
  memeabilityScore: number; // 0-100
  reasoning: string;
  memeCategory: string; // e.g., "animal", "pop culture", "crypto meme", "viral moment"
  viralPotential: "low" | "medium" | "high";
  risks: string[];
  recommendations: string[];
}

export interface TokenGenerationData {
  name: string;
  symbol: string;
  description: string;
  narrative: string;
  hashtags: string[];
  marketingAngle: string;
  targetAudience: string;
  launchStrategy: string[];
}

export interface MemeAnalysisResult {
  success: boolean;
  analysis?: MemeableAnalysis;
  tokenData?: TokenGenerationData;
  generatedImageUrl?: string;
  error?: string;
}

export class AIMemeableAnalysisService {
  private static openai: OpenAI | null = null;

  /**
   * Initialize OpenAI client
   */
  private static getOpenAIClient(): OpenAI {
    if (!this.openai) {
      if (!env.OPENAI_API_KEY) {
        throw new Error("OpenAI API key not configured");
      }
      this.openai = new OpenAI({
        apiKey: env.OPENAI_API_KEY,
      });
    }
    return this.openai;
  }

  /**
   * Analyze Twitter content for memeable potential and generate token data
   */
  static async analyzeMemeableContent(
    twitterContent: TwitterPostContent
  ): Promise<MemeAnalysisResult> {
    try {
      logger.info(
        `[AI Meme Analysis] Analyzing content: ${twitterContent.text.substring(0, 100)}...`
      );

      const openai = this.getOpenAIClient();

      const systemPrompt = this.buildSystemPrompt();
      const userPrompt = this.buildUserPrompt(twitterContent);

      const response = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 2000,
        response_format: { type: "json_object" },
      });

      const responseContent = response.choices[0]?.message?.content;
      if (!responseContent) {
        throw new Error("Empty response from OpenAI");
      }

      const result = JSON.parse(responseContent);

      // Validate and structure the response
      const analysisResult = this.structureAnalysisResult(result);

      // Generate image if analysis was successful and memeable
      if (
        analysisResult.success &&
        analysisResult.analysis?.isMemeable &&
        analysisResult.tokenData
      ) {
        try {
          const imageUrl = await this.generateTokenImage(
            analysisResult.tokenData,
            twitterContent
          );
          analysisResult.generatedImageUrl = imageUrl;
        } catch (imageError) {
          logger.warn(
            "[AI Meme Analysis] Image generation failed:",
            imageError
          );
          // Continue without image - not critical
        }
      }

      return analysisResult;
    } catch (error) {
      logger.error("[AI Meme Analysis] Error analyzing content:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  /**
   * Build system prompt for AI analysis
   */
  private static buildSystemPrompt(): string {
    return `You are an expert crypto meme analyst and token creator with deep knowledge of:
- Viral internet culture and meme trends
- Crypto community preferences and what makes tokens succeed
- Social media psychology and engagement patterns
- Token naming conventions and branding best practices

Your job is to analyze Twitter/X posts to determine their memeable potential and generate comprehensive token creation data.

ANALYSIS CRITERIA:
- Memeability: Does the content have viral potential? Is it funny, relatable, or culturally relevant?
- Crypto Context: How well would this translate to a crypto token/meme coin?
- Community Appeal: Would crypto Twitter find this engaging?
- Timing: Is the content timely or evergreen?
- Risks: Any potential issues (offensive content, copyright, etc.)

RESPONSE FORMAT:
You must respond with a valid JSON object containing these exact fields:

{
  "analysis": {
    "isMemeable": boolean,
    "memeabilityScore": number (0-100),
    "reasoning": "detailed explanation of analysis",
    "memeCategory": "category like 'animal', 'pop culture', 'crypto meme', etc.",
    "viralPotential": "low" | "medium" | "high",
    "risks": ["array of potential risks"],
    "recommendations": ["array of recommendations"]
  },
  "tokenData": {
    "name": "creative token name based on the meme",
    "symbol": "3-6 character symbol",
    "description": "engaging description for the token",
    "narrative": "compelling story/narrative for marketing",
    "hashtags": ["array of relevant hashtags"],
    "marketingAngle": "key marketing angle/hook",
    "targetAudience": "description of target audience",
    "launchStrategy": ["array of launch strategy points"]
  }
}

GUIDELINES:
- Be creative but appropriate
- Consider crypto community culture
- Ensure names/symbols aren't offensive
- Make descriptions engaging and meme-worthy
- Include practical marketing advice
- Consider viral potential and timing`;
  }

  /**
   * Build user prompt with Twitter content
   */
  private static buildUserPrompt(content: TwitterPostContent): string {
    let prompt = `Analyze this Twitter/X post for memeable potential and generate token creation data:

POST CONTENT:
"${content.text}"

AUTHOR: @${content.author}
URL: ${content.url}`;

    if (content.timestamp) {
      prompt += `\nTIMESTAMP: ${content.timestamp}`;
    }

    if (content.engagement) {
      prompt += `\nENGAGEMENT: ${content.engagement.likes} likes, ${content.engagement.retweets} retweets, ${content.engagement.replies} replies`;
    }

    if (content.media && content.media.length > 0) {
      prompt += `\nMEDIA: ${content.media.length} media item(s) - ${content.media.map((m) => m.type).join(", ")}`;
    }

    prompt += `

Please provide a comprehensive analysis following the JSON format specified in the system prompt.

Consider:
1. Is this content genuinely funny, interesting, or viral-worthy?
2. Would the crypto community relate to or find this appealing?
3. Can this be turned into a successful meme token concept?
4. What are the risks and opportunities?
5. What would be the best token name, symbol, and marketing approach?`;

    return prompt;
  }

  /**
   * Structure and validate the analysis result
   */
  private static structureAnalysisResult(
    result: Record<string, unknown>
  ): MemeAnalysisResult {
    try {
      // Validate required fields
      if (!result.analysis || !result.tokenData) {
        throw new Error("Missing required analysis or tokenData fields");
      }

      const resultAnalysis = result.analysis as Record<string, unknown>;
      const resultTokenData = result.tokenData as Record<string, unknown>;

      const analysis: MemeableAnalysis = {
        isMemeable: Boolean(resultAnalysis.isMemeable),
        memeabilityScore: Math.max(
          0,
          Math.min(100, Number(resultAnalysis.memeabilityScore) || 0)
        ),
        reasoning: String(resultAnalysis.reasoning || "No reasoning provided"),
        memeCategory: String(resultAnalysis.memeCategory || "general"),
        viralPotential: ["low", "medium", "high"].includes(
          resultAnalysis.viralPotential as string
        )
          ? (resultAnalysis.viralPotential as "low" | "medium" | "high")
          : "medium",
        risks: Array.isArray(resultAnalysis.risks)
          ? (resultAnalysis.risks as string[])
          : [],
        recommendations: Array.isArray(resultAnalysis.recommendations)
          ? (resultAnalysis.recommendations as string[])
          : [],
      };

      const tokenData: TokenGenerationData = {
        name: String(resultTokenData.name || "Meme Token").substring(0, 32),
        symbol: String(resultTokenData.symbol || "MEME")
          .toUpperCase()
          .substring(0, 8)
          .replace(/[^A-Z0-9]/g, ""),
        description: String(
          resultTokenData.description || "A memeable token"
        ).substring(0, 250),
        narrative: String(resultTokenData.narrative || ""),
        hashtags: Array.isArray(resultTokenData.hashtags)
          ? (resultTokenData.hashtags as string[]).slice(0, 10)
          : [],
        marketingAngle: String(resultTokenData.marketingAngle || ""),
        targetAudience: String(
          resultTokenData.targetAudience || "Crypto community"
        ),
        launchStrategy: Array.isArray(resultTokenData.launchStrategy)
          ? (resultTokenData.launchStrategy as string[]).slice(0, 8)
          : [],
      };

      // Ensure symbol is valid (3-8 characters, alphanumeric)
      if (tokenData.symbol.length < 3) {
        tokenData.symbol = (tokenData.symbol + "TOKEN").substring(0, 8);
      }

      logger.info(
        `[AI Meme Analysis] Analysis complete - Memeable: ${analysis.isMemeable}, Score: ${analysis.memeabilityScore}, Token: ${tokenData.name} (${tokenData.symbol})`
      );

      return {
        success: true,
        analysis,
        tokenData,
      };
    } catch (error) {
      logger.error("[AI Meme Analysis] Error structuring result:", error);
      return {
        success: false,
        error: "Failed to structure analysis result",
      };
    }
  }

  /**
   * Quick memeability check (lighter version)
   */
  static async quickMemeabilityCheck(
    text: string
  ): Promise<{ isMemeable: boolean; score: number; reason: string }> {
    try {
      const openai = this.getOpenAIClient();

      const response = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [
          {
            role: "system",
            content:
              'You are a crypto meme expert. Analyze text for memeable potential. Respond with JSON: {"isMemeable": boolean, "score": number(0-100), "reason": "brief explanation"}',
          },
          {
            role: "user",
            content: `Rate this content's meme potential: "${text}"`,
          },
        ],
        temperature: 0.3,
        max_tokens: 200,
        response_format: { type: "json_object" },
      });

      const result = JSON.parse(response.choices[0]?.message?.content || "{}");

      return {
        isMemeable: Boolean(result.isMemeable),
        score: Math.max(0, Math.min(100, Number(result.score) || 0)),
        reason: String(result.reason || "No analysis available"),
      };
    } catch (error) {
      logger.error("[AI Meme Analysis] Error in quick check:", error);
      return {
        isMemeable: false,
        score: 0,
        reason: "Analysis failed",
      };
    }
  }

  /**
   * Generate alternative token names based on analysis
   */
  static async generateAlternativeNames(
    analysis: MemeableAnalysis,
    originalText: string
  ): Promise<string[]> {
    try {
      const openai = this.getOpenAIClient();

      const response = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [
          {
            role: "system",
            content:
              'Generate 5 creative, appropriate crypto token names based on meme content. Respond with JSON: {"names": ["name1", "name2", ...]}',
          },
          {
            role: "user",
            content: `Generate alternative token names for this meme: "${originalText}"\nCategory: ${analysis.memeCategory}`,
          },
        ],
        temperature: 0.8,
        max_tokens: 300,
        response_format: { type: "json_object" },
      });

      const result = JSON.parse(response.choices[0]?.message?.content || "{}");
      return Array.isArray(result.names) ? result.names.slice(0, 5) : [];
    } catch (error) {
      logger.error(
        "[AI Meme Analysis] Error generating alternative names:",
        error
      );
      return [];
    }
  }

  /**
   * Generate token image using DALL-E
   */
  static async generateTokenImage(
    tokenData: TokenGenerationData,
    twitterContent: TwitterPostContent
  ): Promise<string> {
    try {
      logger.info(
        `[AI Image Generation] Generating image for token: ${tokenData.name}`
      );

      const openai = this.getOpenAIClient();

      // Create image prompt based on token data and meme category
      const imagePrompt = this.buildImagePrompt(tokenData, twitterContent);

      const response = await openai.images.generate({
        model: "dall-e-3",
        prompt: imagePrompt,
        size: "1024x1024",
        quality: "standard",
        n: 1,
      });

      const imageUrl = response.data?.[0]?.url;
      if (!imageUrl) {
        throw new Error("No image URL returned from DALL-E");
      }

      logger.info(
        `[AI Image Generation] Successfully generated image: ${imageUrl.substring(0, 50)}...`
      );
      return imageUrl;
    } catch (error) {
      logger.error("[AI Image Generation] Error generating image:", error);
      throw new Error(
        `Image generation failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Build DALL-E prompt for token image
   */
  private static buildImagePrompt(
    tokenData: TokenGenerationData,
    twitterContent: TwitterPostContent
  ): string {
    // Base style for crypto tokens
    let prompt =
      "Create a professional cryptocurrency token logo with clean, modern design. ";

    // Add specific elements based on token name and category
    if (
      tokenData.name.toLowerCase().includes("dog") ||
      tokenData.name.toLowerCase().includes("doge")
    ) {
      prompt +=
        "Feature a stylized cartoon dog character, similar to Shiba Inu style, ";
    } else if (tokenData.name.toLowerCase().includes("cat")) {
      prompt += "Feature a stylized cartoon cat character, ";
    } else if (tokenData.name.toLowerCase().includes("moon")) {
      prompt += "Feature a crescent moon or space theme, ";
    } else if (
      tokenData.name.toLowerCase().includes("rocket") ||
      tokenData.name.toLowerCase().includes("launch")
    ) {
      prompt += "Feature a rocket ship or launch theme, ";
    } else {
      // Generic based on the content
      prompt += `Feature elements related to "${tokenData.name}" theme, `;
    }

    // Add style requirements
    prompt += "with vibrant colors, circular design perfect for a token logo, ";
    prompt += "professional crypto aesthetic, no text or words, ";
    prompt += "clean background, high contrast, ";
    prompt += "suitable for cryptocurrency branding, ";
    prompt += "memeable and fun but professional quality, ";
    prompt += "1024x1024 square format optimized for social media";

    // Add context from original tweet if relevant
    if (twitterContent.text.length > 0) {
      const relevantWords = twitterContent.text
        .split(" ")
        .filter(
          (word) =>
            word.length > 3 && !word.startsWith("@") && !word.startsWith("#")
        )
        .slice(0, 3);

      if (relevantWords.length > 0) {
        prompt += `. Incorporate subtle visual elements inspired by: ${relevantWords.join(", ")}`;
      }
    }

    logger.info(
      `[AI Image Generation] Using prompt: ${prompt.substring(0, 100)}...`
    );
    return prompt;
  }

  /**
   * Validate OpenAI API key configuration
   */
  static isConfigured(): boolean {
    return Boolean(env.OPENAI_API_KEY);
  }
}
