/**
 * Meme Token Creation Conversation Handler
 *
 * Handles the complete flow from Twitter URL input to token launch
 * Integrates with AI analysis and existing token creation system
 */

import { type Conversation } from "@grammyjs/conversations";
import { type Context, InlineKeyboard } from "grammy";
import { getUser } from "../../backend/functions";
import { CallBackQueries } from "../types";
import { sendLoadingMessage } from "../loading";
import { sendMessage } from "../../backend/sender";
import { logger } from "../../blockchain/common/logger";
import {
  MemeTokenGeneratorService,
  MemeTokenGenerationResult,
  MarketingPlan,
} from "../../service/meme-token-generator";
import { TokenGenerationData } from "../../service/ai-memeable-analysis";

const cancelKeyboard = new InlineKeyboard().text(
  "❌ Cancel",
  CallBackQueries.BACK
);

// Helper function to validate Twitter URLs
function isValidTwitterUrl(url: string): boolean {
  const twitterUrlRegex =
    /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/;
  return twitterUrlRegex.test(url);
}

const memeTokenConversation = async (
  conversation: Conversation,
  ctx: Context
) => {
  // Only answer callback query if there is one
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery();
  }

  // Validate user
  const user = await getUser(ctx.chat!.id!.toString());
  if (!user) {
    await sendMessage(ctx, "Please try again ⚡", { parse_mode: "HTML" });
    await conversation.halt();
    return;
  }

  // Check if there's an initial Twitter URL from direct message
  const initialUrl = (ctx as any)?.session?.initialTwitterUrl;

  try {
    logger.info(`[Meme Token] Starting conversation for user: ${user.id}`);

    // Step 1: Introduction and URL request
    await sendMessage(
      ctx,
      "🤖 <b>AI-Powered Meme Token Creator</b>\n\n" +
        "🔥 <b>Turn viral content into tokens!</b>\n\n" +
        "📋 <b>How it works:</b>\n" +
        "1️⃣ You provide a Twitter/X post URL\n" +
        "2️⃣ AI analyzes the content for meme potential\n" +
        "3️⃣ AI generates token name, symbol, and narrative\n" +
        "4️⃣ You can customize and launch the token\n\n" +
        "🔗 <b>Please send a Twitter/X post URL:</b>\n" +
        "<i>Format: https://twitter.com/user/status/123... or https://x.com/user/status/123...</i>",
      {
        parse_mode: "HTML",
        reply_markup: cancelKeyboard,
      }
    );

    // Step 2: Collect Twitter URL (or use provided URL)
    let twitterUrl = "";

    if (initialUrl && isValidTwitterUrl(initialUrl)) {
      // Use the provided URL directly
      twitterUrl = initialUrl;

      // Clear the session URL after using it
      if ((ctx as any)?.session) {
        delete (ctx as any).session.initialTwitterUrl;
      }

      await sendMessage(
        ctx,
        `🔗 <b>Processing Twitter URL:</b>\n<code>${initialUrl}</code>\n\n` +
          "🤖 Starting AI analysis...",
        { parse_mode: "HTML" }
      );
    } else {
      // Ask user for URL
      while (true) {
        const urlUpdate = await conversation.wait();

        if (urlUpdate.callbackQuery?.data === CallBackQueries.BACK) {
          await urlUpdate.answerCallbackQuery();
          await sendMessage(ctx, "Meme token creation cancelled.");
          return conversation.halt();
        }

        if (urlUpdate.message?.text) {
          const url = urlUpdate.message.text.trim();

          // Validate URL format
          if (!isValidTwitterUrl(url)) {
            await sendMessage(
              ctx,
              "❌ <b>Invalid URL Format</b>\n\n" +
                "Please provide a valid Twitter/X post URL:\n" +
                "• <code>https://twitter.com/username/status/1234567890</code>\n" +
                "• <code>https://x.com/username/status/1234567890</code>",
              {
                parse_mode: "HTML",
                reply_markup: cancelKeyboard,
              }
            );
            continue;
          }

          twitterUrl = url;
          break;
        }

        await sendMessage(ctx, "Please send a valid Twitter/X URL or cancel.", {
          reply_markup: cancelKeyboard,
        });
      }
    }

    // Step 3: AI Analysis with loading
    const { update: updateAnalysis } = await sendLoadingMessage(
      ctx,
      "🤖 <b>AI Analysis in Progress...</b>\n\n" +
        "⏳ Fetching Twitter content...\n" +
        "🧠 Analyzing meme potential...\n" +
        "✨ Generating token concept..."
    );

    logger.info(`[Meme Token] Starting AI analysis for URL: ${twitterUrl}`);

    const generationResult: MemeTokenGenerationResult =
      await MemeTokenGeneratorService.generateTokenFromTwitterUrl(twitterUrl);

    if (!generationResult.success) {
      let errorMessage = "❌ <b>Analysis Failed</b>\n\n";

      if (
        generationResult.error?.includes("Payment required") ||
        generationResult.error?.includes("402")
      ) {
        errorMessage += "🔑 <b>Twitter API Configuration Issue</b>\n\n";
        errorMessage += "• The Twitter API key is not configured properly\n";
        errorMessage += "• The API key may be out of credits\n";
        errorMessage +=
          "• The API key may not have the required permissions\n\n";
        errorMessage +=
          "Please contact the bot administrator to resolve this issue.";
      } else if (
        generationResult.error?.includes("not found") ||
        generationResult.error?.includes("private")
      ) {
        errorMessage += "🔒 <b>Tweet Access Issue</b>\n\n";
        errorMessage += "• The tweet may be from a private account\n";
        errorMessage += "• The tweet may have been deleted\n";
        errorMessage += "• The URL may be incorrect\n\n";
        errorMessage += "Please try with a different public tweet.";
      } else {
        errorMessage += `<i>${generationResult.error}</i>\n\n`;
        errorMessage +=
          "Please try with a different Twitter post or contact support if this persists.";
      }

      await updateAnalysis(errorMessage);
      return conversation.halt();
    }

    const { analysis, tokenData, generatedImageUrl, marketingPlan, warnings } =
      generationResult;

    // Step 4: Show analysis results
    let analysisMessage = `🎯 <b>AI Analysis Complete!</b>\n\n`;

    analysisMessage += `📊 <b>Memeability Score:</b> ${analysis!.memeabilityScore}/100\n`;
    analysisMessage += `🎭 <b>Category:</b> ${analysis!.memeCategory}\n`;
    analysisMessage += `🚀 <b>Viral Potential:</b> ${analysis!.viralPotential.toUpperCase()}\n`;

    if (analysis!.isMemeable) {
      analysisMessage += `\n✅ <b>Verdict:</b> This content has meme potential!\n`;
    } else {
      analysisMessage += `\n⚠️ <b>Verdict:</b> Low meme potential detected\n`;
    }

    analysisMessage += `\n💭 <b>AI Reasoning:</b>\n<i>${analysis!.reasoning}</i>\n`;

    // Show generated token data
    analysisMessage += `\n🪙 <b>Generated Token Concept:</b>\n`;
    analysisMessage += `📛 <b>Name:</b> ${tokenData!.name}\n`;
    analysisMessage += `🏷️ <b>Symbol:</b> $${tokenData!.symbol}\n`;
    analysisMessage += `📝 <b>Description:</b> ${tokenData!.description}\n`;

    if (tokenData!.hashtags.length > 0) {
      analysisMessage += `\n🏷️ <b>Hashtags:</b> ${tokenData!.hashtags.join(" ")}\n`;
    }

    // Show warnings if any
    if (warnings && warnings.length > 0) {
      analysisMessage += `\n⚠️ <b>Warnings:</b>\n`;
      warnings.forEach((warning) => {
        analysisMessage += `• ${warning}\n`;
      });
    }

    const proceedKeyboard = new InlineKeyboard()
      .text("📱 Generate Preview", "generate_preview")
      .text("✏️ Customize", "customize_meme_token")
      .row()
      .text("🔄 Try Different URL", "retry_meme_url")
      .text("❌ Cancel", CallBackQueries.BACK);

    await updateAnalysis(analysisMessage);

    // Send new message with keyboard
    await sendMessage(ctx, "Choose your next action:", {
      reply_markup: proceedKeyboard,
    });

    // Step 5: Handle user choice
    const choiceUpdate = await conversation.wait();
    await choiceUpdate.answerCallbackQuery!();

    const choice = choiceUpdate.callbackQuery!.data;

    if (choice === CallBackQueries.BACK) {
      await sendMessage(ctx, "Meme token creation cancelled.");
      return conversation.halt();
    }

    if (choice === "retry_meme_url") {
      // Restart the conversation
      return await memeTokenConversation(conversation, ctx);
    }

    if (choice === "customize_meme_token") {
      // Allow user to modify the generated data
      const customizedData = await handleCustomization(
        conversation,
        ctx,
        tokenData!
      );
      if (!customizedData) {
        return conversation.halt();
      }
      Object.assign(tokenData!, customizedData);
    }

    if (choice === "generate_preview") {
      // Generate and show preview instead of creating token
      await generateTokenPreview(
        ctx,
        twitterUrl,
        tokenData!,
        marketingPlan!,
        generatedImageUrl
      );
      return conversation.halt();
    }

    conversation.halt();
  } catch (error) {
    logger.error("[Meme Token] Conversation error:", error);
    await sendMessage(
      ctx,
      "❌ An unexpected error occurred. Please try again later.",
      { parse_mode: "HTML" }
    );
    conversation.halt();
  }
};

// Helper function for customization
async function handleCustomization(
  conversation: Conversation,
  ctx: Context,
  originalData: TokenGenerationData
): Promise<TokenGenerationData | null> {
  await sendMessage(
    ctx,
    "✏️ <b>Customize Token Details</b>\n\n" +
      "Send your custom details in this format:\n" +
      "<code>Name, Symbol, Description</code>\n\n" +
      "<b>Current values:</b>\n" +
      `Name: ${originalData.name}\n` +
      `Symbol: ${originalData.symbol}\n` +
      `Description: ${originalData.description}\n\n` +
      "Or type 'skip' to use AI-generated values.",
    {
      parse_mode: "HTML",
      reply_markup: cancelKeyboard,
    }
  );

  const customUpdate = await conversation.wait();

  if (customUpdate.callbackQuery?.data === CallBackQueries.BACK) {
    await customUpdate.answerCallbackQuery();
    return null;
  }

  if (customUpdate.message?.text) {
    const text = customUpdate.message.text.trim().toLowerCase();

    if (text === "skip") {
      return originalData;
    }

    // Parse custom format: Name, Symbol, Description
    const parts = customUpdate.message.text.split(",").map((s) => s.trim());

    if (parts.length === 3) {
      const [name, symbol, description] = parts;

      // Validate
      if (name.length < 3 || name.length > 32) {
        await sendMessage(
          ctx,
          "❌ Name must be 3-32 characters. Using original values."
        );
        return originalData;
      }

      const cleanSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (cleanSymbol.length < 3 || cleanSymbol.length > 8) {
        await sendMessage(
          ctx,
          "❌ Symbol must be 3-8 alphanumeric characters. Using original values."
        );
        return originalData;
      }

      if (description.length < 10 || description.length > 250) {
        await sendMessage(
          ctx,
          "❌ Description must be 10-250 characters. Using original values."
        );
        return originalData;
      }

      return {
        ...originalData,
        name,
        symbol: cleanSymbol,
        description,
      };
    }

    await sendMessage(
      ctx,
      "❌ Invalid format. Using original AI-generated values."
    );
  }

  return originalData;
}

// Helper function to generate and send token preview
async function generateTokenPreview(
  ctx: Context,
  twitterUrl: string,
  tokenData: TokenGenerationData,
  marketingPlan: MarketingPlan,
  generatedImageUrl?: string
): Promise<void> {
  try {
    logger.info(
      `[Meme Token Preview] Generating preview for ${tokenData.name}`
    );

    // Create comprehensive preview message
    let previewMessage = `🎉 <b>AI-Generated Meme Token Preview</b>\n\n`;

    previewMessage += `🪙 <b>Token Details:</b>\n`;
    previewMessage += `📛 <b>Name:</b> ${tokenData.name}\n`;
    previewMessage += `🏷️ <b>Symbol:</b> $${tokenData.symbol}\n`;
    previewMessage += `📝 <b>Description:</b> ${tokenData.description}\n\n`;

    previewMessage += `📖 <b>AI-Generated Narrative:</b>\n`;
    previewMessage += `<i>${tokenData.narrative}</i>\n\n`;

    if (tokenData.hashtags.length > 0) {
      previewMessage += `🏷️ <b>Hashtags:</b> ${tokenData.hashtags.join(" ")}\n\n`;
    }

    previewMessage += `🎯 <b>Marketing Strategy:</b>\n`;
    previewMessage += `👥 <b>Target Audience:</b> ${tokenData.targetAudience}\n`;
    previewMessage += `📈 <b>Marketing Angle:</b> ${tokenData.marketingAngle}\n`;
    previewMessage += `⏰ <b>Launch Timing:</b> ${marketingPlan.launchTiming}\n\n`;

    previewMessage += `📝 <b>Suggested Launch Tweet:</b>\n`;
    previewMessage += `<code>${marketingPlan.tweetTemplate}</code>\n\n`;

    previewMessage += `💡 <b>Launch Strategy:</b>\n`;
    tokenData.launchStrategy.forEach((strategy, index) => {
      previewMessage += `${index + 1}️⃣ ${strategy}\n`;
    });

    previewMessage += `\n🎭 <b>Inspired by:</b> <a href="${twitterUrl}">Original Tweet</a>\n\n`;

    previewMessage += `\n📊 <b>Content Strategy:</b>\n`;
    marketingPlan.contentStrategy.forEach((strategy) => {
      previewMessage += `• ${strategy}\n`;
    });

    previewMessage += `\n🤝 <b>Community Engagement:</b>\n`;
    marketingPlan.communityEngagementTips.forEach((tip) => {
      previewMessage += `• ${tip}\n`;
    });

    previewMessage += `\n🎯 <b>Target Influencers:</b>\n`;
    marketingPlan.targetInfluencers.forEach((influencer) => {
      previewMessage += `• ${influencer}\n`;
    });

    // Send image if generated, otherwise send text preview
    if (generatedImageUrl) {
      try {
        // Send image with caption
        await ctx.replyWithPhoto(generatedImageUrl, {
          caption: previewMessage,
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text("🚀 Create This Token", "create_from_preview")
            .text("🔄 Try Another Tweet", "try_another")
            .row()
            .text("📱 Share Preview", "share_preview")
            .text("❌ Done", "done_preview"),
        });

        logger.info(
          `[Meme Token Preview] Sent preview with AI-generated image`
        );
      } catch (imageError) {
        logger.warn(
          `[Meme Token Preview] Failed to send image, sending text only:`,
          imageError
        );
        // Fallback to text-only preview
        await sendTextPreview(ctx, previewMessage);
      }
    } else {
      // Send text-only preview
      await sendTextPreview(ctx, previewMessage);
    }
  } catch (error) {
    logger.error("[Meme Token Preview] Error generating preview:", error);
    await sendMessage(
      ctx,
      "❌ <b>Preview Generation Failed</b>\n\n" +
        "Unable to generate token preview. Please try again or contact support.",
      { parse_mode: "HTML" }
    );
  }
}

// Helper to send text-only preview
async function sendTextPreview(
  ctx: Context,
  previewMessage: string
): Promise<void> {
  await sendMessage(ctx, previewMessage, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard()
      .text("🚀 Create This Token", "create_from_preview")
      .text("🔄 Try Another Tweet", "try_another")
      .row()
      .text("📱 Share Preview", "share_preview")
      .text("❌ Done", "done_preview"),
  });

  logger.info(`[Meme Token Preview] Sent text-only preview`);
}

export default memeTokenConversation;
