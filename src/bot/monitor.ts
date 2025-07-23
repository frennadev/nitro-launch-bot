import { ConversationFlavor } from "@grammyjs/conversations";
import { Context } from "grammy";
import { logger } from "../utils/logger";
import { getUser } from "../backend/functions";
import { sendMessage } from "../backend/sender";
import { getTokenInfo } from "../backend/utils";
import { InlineKeyboard } from "grammy";
import { CallBackQueries } from "./types";
import { compressCallbackData } from "./utils";

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

    // Get token info
    const tokenInfo = await getTokenInfo(tokenAddress);
    if (!tokenInfo) {
      await sendMessage(
        ctx,
        `❌ **Token not found**\n\nCould not fetch information for token: \`${tokenAddress}\``,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Generate monitor message with current data
    const refreshTime = new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const monitorMessage = [
      `📊 **Token Monitor**`,
      ``,
      `**Token:** ${tokenInfo.name} (${tokenInfo.symbol})`,
      `**Address:** \`${tokenAddress}\``,
      `**Status:** Monitoring active`,
      `**Mode:** ${variant}`,
      `**Last Updated:** ${refreshTime}`,
      ``,
      `**Market Data:**`,
      `• Price: $${tokenInfo.priceUsd || "N/A"}`,
      `• Market Cap: $${tokenInfo.marketCap ? tokenInfo.marketCap.toLocaleString() : "N/A"}`,
      `• Volume (24h): $${tokenInfo.volume24h ? tokenInfo.volume24h.toLocaleString() : "N/A"}`,
      `• Liquidity: $${tokenInfo.liquidity ? tokenInfo.liquidity.toLocaleString() : "N/A"}`,
      ``,
      `💡 **Tip:** Use /menu or /start to return to the main menu.`,
    ].join("\n");

    // Create keyboard with refresh and other options
    const keyboard = new InlineKeyboard()
      .text("🔄 Refresh", `remonitor_data_${tokenAddress}`)
      .row()
      .text("💸 Fund Token Wallets", compressCallbackData(CallBackQueries.FUND_TOKEN_WALLETS, tokenAddress))
      .row()
      .text("🔙 Back to Tokens", CallBackQueries.VIEW_TOKENS);

    await sendMessage(ctx, monitorMessage, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });

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
