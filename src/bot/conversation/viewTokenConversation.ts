import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getUser, deleteToken } from "../../backend/functions";
import { TokenModel } from "../../backend/models";
import { CallBackQueries } from "../types";
import { sendMessage } from "../../backend/sender";
import { TokenState } from "../../backend/types";
import { getTokenInfo } from "../../backend/utils";
import { getAccurateSpendingStats } from "../../backend/functions-main";
import { sendErrorWithAutoDelete, compressCallbackData } from "../utils";
// import {  } from "../utils";

const viewTokensConversation = async (
  conversation: Conversation<Context>,
  ctx: Context
) => {
  await ctx.answerCallbackQuery();
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(
      ctx,
      "❌ <b>Access Denied</b>\n\n<i>User not recognized</i>",
      {
        parse_mode: "HTML",
      }
    );
    return conversation.halt();
  }

  // First, let's check if the user lookup is working correctly

  const tokens = await TokenModel.find({ user: user._id })
    .populate("launchData.devWallet")
    .populate("launchData.buyWallets")
    .sort({ createdAt: -1 })
    .exec();

  // If no tokens found, provide more helpful information
  if (tokens.length === 0) {
    await sendMessage(
      ctx,
      `🚀 <b>No Tokens Found</b>\n\n` +
        `💡 <i>Ready to launch your first token?</i>\n\n` +
        `🎯 Use the menu below to get started!\n\n` +
        `👤 <b>User:</b> ${user.userName}`,
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  let currentIndex = 0;

  const showToken = async (index: number) => {
    const token = tokens[index];
    const { name, symbol, description, tokenAddress, state, launchData } =
      token;
    const { buyWallets, buyAmount, devBuy } = launchData!;

    let tokenInfo;
    let financialStats;
    if (state === TokenState.LAUNCHED) {
      tokenInfo = await getTokenInfo(tokenAddress);
      financialStats = await getAccurateSpendingStats(tokenAddress);
    }

    // Calculate token value and P&L if we have the data
    let totalTokenValue = 0;
    let profitLoss = 0;
    let profitLossPercentage = 0;

    if (
      tokenInfo &&
      tokenInfo.price &&
      financialStats &&
      financialStats.totalTokens !== "0"
    ) {
      const totalTokensNumber = Number(financialStats.totalTokens) / 1e6; // Convert from raw token amount to human readable
      totalTokenValue = totalTokensNumber * tokenInfo.price;
      profitLoss = totalTokenValue - financialStats.totalSpent;
      profitLossPercentage =
        financialStats.totalSpent > 0
          ? (profitLoss / financialStats.totalSpent) * 100
          : 0;
    }

    const formatCurrency = (value: number, currency: string = "$") =>
      `${currency}${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const formatSOL = (value: number) =>
      `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SOL`;

    const formatPercentage = (value: number) =>
      `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;

    const lines = [
      `🚀 <b>${name}</b> • <code>${symbol}</code>`,
      `📋 <code>${tokenAddress}</code>`,
      ...(description ? [`💬 ${description}`] : []),
      ``,
      `💰 <b>Investment</b>`,
      `├ Dev Buy: <b>${formatSOL(devBuy || 0)}</b>`,
      `├ Total Buy: <b>${formatSOL(buyAmount || 0)}</b>`,
      `└ Wallets: <b>${(buyWallets as unknown[])?.length || 0}</b>`,
      ``,
      ...(state === TokenState.LAUNCHED && tokenInfo
        ? [
            `📊 <b>Market Data</b>`,
            `├ Market Cap: <b>${formatCurrency(tokenInfo.marketCap)}</b>`,
            `└ Price: <b>${formatCurrency(parseFloat(tokenInfo.priceUsd))}</b>`,
            ``,
          ]
        : []),
      ...(state === TokenState.LAUNCHED && financialStats
        ? [
            `📈 <b>Performance</b>`,
            `├ Total Spent: <b>${formatSOL(financialStats.totalSpent)}</b>`,
            `├ Successful Buys: <b>${financialStats.successfulBuyWallets}</b>`,
            ...(totalTokenValue > 0
              ? [`├ Current Value: <b>${formatCurrency(totalTokenValue)}</b>`]
              : []),
            ...(profitLoss !== 0
              ? [
                  `└ ${profitLoss >= 0 ? "🟢" : "🔴"} P&L: <b>${formatCurrency(profitLoss)}</b> (${formatPercentage(profitLossPercentage)})`,
                ]
              : []),
            ``,
          ]
        : []),
      `🎯 <b>Status:</b> ${state === TokenState.LAUNCHED ? "🟢 <b>Live</b>" : "🟡 <b>Pending Launch</b>"}`,
      ``,
      `<i>Token ${index + 1} of ${tokens.length}</i>`,
    ]
      .filter((line) => line.trim() !== "")
      .join("\n");

    const keyboard = new InlineKeyboard();

    if (state === TokenState.LAUNCHED) {
      keyboard
        .text(
          "💰 Sell Dev",
          compressCallbackData(CallBackQueries.SELL_DEV, tokenAddress)
        )
        .text(
          "📊 Sell %",
          compressCallbackData(CallBackQueries.SELL_PERCENT, tokenAddress)
        )
        .row()
        .text(
          "💥 Sell All",
          compressCallbackData(CallBackQueries.SELL_ALL, tokenAddress)
        )
        .text(
          "🎯 Individual",
          compressCallbackData(CallBackQueries.SELL_INDIVIDUAL, tokenAddress)
        )
        .row()
        .text(
          "📊 Monitor",
          compressCallbackData(CallBackQueries.VIEW_TOKEN_TRADES, tokenAddress)
        )
        .text(
          "🎁 Airdrop",
          compressCallbackData(CallBackQueries.AIRDROP_SOL, tokenAddress)
        )
        .row()
        .text("👑 CTO", compressCallbackData(CallBackQueries.CTO, tokenAddress))
        .text(
          "💸 Fund Wallets",
          compressCallbackData(CallBackQueries.FUND_TOKEN_WALLETS, tokenAddress)
        );

      // Debug: Log the callback data being generated
      console.log(
        "Generated sell individual callback data:",
        `${CallBackQueries.SELL_INDIVIDUAL}_${tokenAddress}`
      );
      console.log(
        "Generated fund token wallets callback data:",
        compressCallbackData(CallBackQueries.FUND_TOKEN_WALLETS, tokenAddress)
      );
    } else {
      keyboard.text(
        "🚀 Launch",
        compressCallbackData(CallBackQueries.LAUNCH_TOKEN, tokenAddress)
      );
    }

    // Management buttons
    keyboard
      .row()
      .text(
        "🗑️ Delete",
        compressCallbackData(CallBackQueries.DELETE_TOKEN, tokenAddress)
      );

    // Navigation
    if (tokens.length > 1) {
      keyboard.row();
      if (index > 0) keyboard.text("⬅️ Previous", "prev");
      if (index < tokens.length - 1) keyboard.text("➡️ Next", "next");
    }

    keyboard.row().text("🔙 Back", CallBackQueries.BACK);

    sendMessage(ctx, lines, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  };

  const showDeleteConfirmation = async (
    tokenAddress: string,
    tokenName: string
  ) => {
    const message = [
      `⚠️ <b>Delete Token?</b>`,
      ``,
      `🚀 <b>${tokenName}</b>`,
      `📋 <code>${tokenAddress}</code>`,
      ``,
      `<i>This action cannot be undone.</i>`,
      ``,
      `💡 <b>Note:</b> Token will remain on blockchain but you'll lose bot access.`,
    ].join("\n");

    const keyboard = new InlineKeyboard()
      .text(
        "✅ Confirm",
        compressCallbackData(CallBackQueries.CONFIRM_DELETE_TOKEN, tokenAddress)
      )
      .text("❌ Cancel", "cancel_delete");

    await sendMessage(ctx, message, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  };

  await showToken(currentIndex);

  while (true) {
    const response = await conversation.waitFor("callback_query:data");

    const data = response.callbackQuery?.data;

    // Check if this is a sell/launch button that should be handled by global handlers
    const isSellButton =
      data?.startsWith(`${CallBackQueries.SELL_DEV}_`) ||
      data?.startsWith(`${CallBackQueries.SELL_ALL}_`) ||
      data?.startsWith(`${CallBackQueries.SELL_PERCENT}_`) ||
      data?.startsWith(`${CallBackQueries.SELL_INDIVIDUAL}_`);

    const isLaunchButton = data?.startsWith(`${CallBackQueries.LAUNCH_TOKEN}_`);

    // For sell/launch buttons, DON'T answer callback query and halt to let global handlers take over
    if (isSellButton || isLaunchButton) {
      await conversation.halt();
    }

    // For all other buttons, answer the callback query as normal
    await response.answerCallbackQuery();

    if (data === "prev" && currentIndex > 0) {
      currentIndex--;
      await showToken(currentIndex);
    } else if (data === "next" && currentIndex < tokens.length - 1) {
      currentIndex++;
      await showToken(currentIndex);
    } else if (data === CallBackQueries.BACK) {
      // Import and start main menu conversation
      const mainMenuConversation = await import("./mainMenu");
      return await mainMenuConversation.default(conversation, response);
    } else if (data?.startsWith(`${CallBackQueries.DELETE_TOKEN}_`)) {
      const tokenAddress = data.substring(
        `${CallBackQueries.DELETE_TOKEN}_`.length
      );
      const token = tokens.find((t) => t.tokenAddress === tokenAddress);
      if (token) {
        await showDeleteConfirmation(tokenAddress, token.name);
      }
    } else if (data?.startsWith(`${CallBackQueries.CONFIRM_DELETE_TOKEN}_`)) {
      const tokenAddress = data.substring(
        `${CallBackQueries.CONFIRM_DELETE_TOKEN}_`.length
      );

      try {
        const result = await deleteToken(String(user._id), tokenAddress);

        if (result.success) {
          await sendMessage(
            ctx,
            `✅ <b>Token Deleted</b>\n\n<i>Successfully removed from your account.</i>`,
            { parse_mode: "HTML" }
          );
          return conversation.halt();
        } else {
          await sendMessage(
            ctx,
            `❌ <b>Delete Failed</b>\n\n<i>${result.message}</i>`,
            { parse_mode: "HTML" }
          );
        }
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        await sendErrorWithAutoDelete(
          ctx,
          `❌ <b>Error</b>\n\n<i>${errorMessage}</i>`
        );
      }
    } else if (data === "cancel_delete") {
      await showToken(currentIndex);
    }
  }
};

export default viewTokensConversation;
