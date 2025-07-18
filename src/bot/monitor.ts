import { ConversationFlavor } from "@grammyjs/conversations";

import { Context } from "grammy";
import { logger } from "../utils/logger";
import { getUser } from "../backend/functions";
import bot from ".";

export const handleViewTokenTrades = async (
  ctx: ConversationFlavor<Context>,
  userId: string,
  tokenAddress: string,
  variant: "buy" | "scan" = "scan",
  index?: number
) => {
  logger.info(index);
  try {
    const user = await getUser(userId);
    if (!user || user === null) {
      logger.info(
        `[handleViewTokenTrades] User ${userId} requested trades for token ${tokenAddress} with variant ${variant}`,
        user,
        userId
      );
      return await ctx.reply("❌ User not found. Please try again later.");
    }

 

    try {
  
    // 🔥 PERFORMANCE OPTIMIZATION: Parallel bot info and monitor data
    logger.info(
      `[handleViewTokenTrades] Fetching bot info and monitor data for token ${tokenAddress} at index ${newIndex}`
    );
    const [botInfo, monitorData] = await Promise.all([
      bot.api.getMe(),
      getTokenMonitorData(userId, tokenAddress, newIndex, trades),
    ]);

    if (variant == "scan") {
      if (!monitorData) {
        await logger.error("❌ Unable to fetch monitor data.");
        return;
      }

      const currentIndex =
        newIndex !== undefined
          ? newIndex
          : await findFirstIndexByToken(trades, tokenAddress);

      // 🔥 PERFORMANCE OPTIMIZATION: Send message first, then setup interval
      const message = await sendMessage(
        ctx,
        await generateMonitorMessage(
          monitorData,
          botInfo.username,
          currentIndex || 0
        ),
        {
          parse_mode: "HTML",
          reply_markup: await getTradeKeyboard(
            currentIndex,
            trades.length,
            user.id,
            tokenAddress,
            monitorData.currentTrade.id
          ),
        }
      );

      // Run non-critical operations in background
      setImmediate(async () => {
        try {
          await bot.api.pinChatMessage(userId, message.message_id);
          setupMonitorInterval(
            userId,
            user.id,
            tokenAddress,
            message,
            trades,
            index
          );
        } catch (error) {
          logger.warn("Non-critical operations failed:", error);
        }
      });
    } else {
      logger.info(
        `[handleViewTokenTrades] Viewing trades for token ${tokenAddress} at index ${
          index ? index : "latest"
        }`
      );
      const monitorData = await getTokenMonitorData(
        userId,
        tokenAddress,
        index,
        trades
      );
      logger.info(
        `[handleViewTokenTrades] Monitor data for token ${tokenAddress}:`,
        monitorData
      );

      if (!monitorData) {
        await sendMessage(ctx, "❌ Unable to fetch monitor data.");
        return;
      }

      logger.info(
        `[handleViewTokenTrades] Total trades found for user ${userId}: ${trades.length}`
      );

      const currentIndex =
        index !== undefined
          ? index
          : await findFirstIndexByToken(trades, tokenAddress);
      logger.info(
        `[handleViewTokenTrades] Current index for token ${tokenAddress}: ${currentIndex}`
      );

      const generated = {
        message: await generateMonitorMessage(
          monitorData,
          botInfo.username,
          currentIndex
        ),
        keyboard: await getTradeKeyboard(
          currentIndex,
          trades.length,
          user.id,
          tokenAddress,
          monitorData.currentTrade.id
        ),
      };

      const message = await bot.api.sendMessage(userId, generated!.message!, {
        parse_mode: "HTML",
        reply_markup: generated?.keyboard,
      });

      lastMessageMap.set(String(userId), {
        chatId: userId,
        messageId: message.message_id,
        timestamp: Date.now(),
      });

      await bot.api.pinChatMessage(userId, message.message_id);

      const existingMonitor = activeMonitorIntervals.get(`${userId}`);
      if (existingMonitor) {
        clearInterval(existingMonitor.interval);
      }

      setImmediate(async () => {
        try {
          await bot.api.pinChatMessage(userId, message.message_id);
          setupMonitorInterval(
            userId,
            user.id,
            tokenAddress,
            message,
            trades,
            index
          );
        } catch (error) {
          logger.warn("Non-critical operations failed:", error);
        }
      });
    }
  } catch (error) {
    logger.error("Error in VIEW_TOKEN_TRADES callback:", error);
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
    await handleViewTokenTrades(ctx, userId, tokenAddress, "scan", [], index);
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
