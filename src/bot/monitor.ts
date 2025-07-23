import { ConversationFlavor } from "@grammyjs/conversations";
import { Context } from "grammy";
import { logger } from "../utils/logger";
import { getUser } from "../backend/functions";
import { sendMessage } from "../backend/sender";

export const handleViewTokenTrades = async (
  ctx: ConversationFlavor<Context>,
  userId: string,
  tokenAddress: string,
  variant: "buy" | "scan" = "scan",
  index?: number
) => {
  try {
    const user = await getUser(userId);
    if (!user) {
      return await ctx.reply("❌ User not found. Please try again later.");
    }

    // Simple placeholder implementation
    await sendMessage(
      ctx,
      `📊 **Token Monitor**\n\n` +
        `**Token:** \`${tokenAddress}\`\n` +
        `**Status:** Monitoring active\n` +
        `**Mode:** ${variant}\n\n` +
        `💡 Monitor functionality is being updated.`,
      { parse_mode: "Markdown" }
    );

  } catch (error) {
    logger.error("Error in handleViewTokenTrades:", error);
    await sendMessage(
      ctx,
      "❌ Error fetching trade data. Please try again later."
    );
  }
};

export const handleViewMonitorPage = async (
  ctx: ConversationFlavor<Context>
) => {
  const userId = ctx.chat?.id.toString();
  if (!userId) {
    await ctx.reply("❌ User ID not found.");
    return;
  }

  try {
    await ctx.answerCallbackQuery();
  } catch (error) {
    logger.warn(
      `[VIEW_TOKEN_TRADES] Failed to answer callback query: ${error}`
    );
  }

  const [, , , tokenAddress, indexRaw] =
    ctx.callbackQuery?.data?.split("_") ?? [];
  const index = indexRaw ? parseInt(indexRaw) : undefined;

  if (!tokenAddress) {
    await ctx.reply("❌ Invalid token address.");
    return;
  }

  try {
    await handleViewTokenTrades(ctx, userId, tokenAddress, "scan", index);
  } catch (error) {
    logger.error("Error in VIEW_TOKEN_TRADES callback:", error);
    if (
      (error as Error).message &&
      (error as Error).message.includes(
        "Cannot begin another operation after the replay has completed"
      )
    ) {
      logger.warn("[VIEW_TOKEN_TRADES] Callback query expired, ignoring");
      return; // Silently ignore expired callbacks
    }

    await ctx.reply("❌ Error fetching trade data. Please try again later.");
  }
};
