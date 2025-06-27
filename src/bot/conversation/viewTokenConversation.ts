import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getUser, deleteToken } from "../../backend/functions";
import { TokenModel } from "../../backend/models";
import { CallBackQueries } from "../types";
import { sendMessage } from "../../backend/sender";
import { TokenState } from "../../backend/types";
import { getTokenInfo } from "../../backend/utils";
import { getTransactionFinancialStats } from "../../backend/functions-main";
// import {  } from "../utils";

const viewTokensConversation = async (
  conversation: Conversation<Context>,
  ctx: Context
) => {
  await ctx.answerCallbackQuery();
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    return conversation.halt();
  }

  // First, let's check if the user lookup is working correctly
  const userId = String(user._id);

  const tokens = await TokenModel.find({ user: user._id })
    .populate("launchData.devWallet")
    .populate("launchData.buyWallets")
    .sort({ createdAt: -1 })
    .exec();

  // If no tokens found, provide more helpful information
  if (tokens.length === 0) {
    await sendMessage(
      ctx,
      `No tokens found for user ${user.userName}.\n\nUser ID: \`${userId}\`\nTelegram ID: \`${user.telegramId}\``,
      {
        parse_mode: "Markdown",
      }
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
      financialStats = await getTransactionFinancialStats(tokenAddress);
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

    const lines = [
      `💊 **${name}**`,
      `🔑 Address: \`${tokenAddress}\``,
      `🏷️ Symbol: \`${symbol}\``,
      `📝 Description: ${description || "–"}`,
      "",
      `👨‍💻 Dev allocation: \`${devBuy || 0}\` SOL`,
      `🛒 Buyer allocation: \`${buyAmount || 0}\` SOL`,
      `👥 Worker wallets: \`${(buyWallets as any[])?.length || 0}\``,
      "",
      state === TokenState.LAUNCHED && tokenInfo
        ? `📊 Market Cap: ${`$${tokenInfo.marketCap.toLocaleString()}`} \n💸 Price: ${`$${tokenInfo.priceUsd}`} \n`
        : "",
      state === TokenState.LAUNCHED && financialStats
        ? `💰 **Financial Summary:**\n• Total Spent: ${financialStats.totalSpent.toString()} SOL\n• Successful Buys: ${financialStats.successfulBuys}\n${totalTokenValue > 0 ? `• Token Value: ${`$${totalTokenValue.toFixed(2)}`}\n` : ""}${profitLoss !== 0 ? `• P&L: ${profitLoss >= 0 ? "🟢" : "🔴"} ${`$${profitLoss.toFixed(2)}`} \\(${`${profitLossPercentage >= 0 ? "+" : ""}${profitLossPercentage.toFixed(1)}%`}\\)\n` : ""}`
        : "",
      `📊 Status: ${state === TokenState.LAUNCHED ? "✅ Launched" : "⌛ Pending"}`,
      "",
      `Showing ${index + 1} of ${tokens.length}`,
    ].join("\n");

    const keyboard = new InlineKeyboard();

    if (state === TokenState.LAUNCHED) {
      keyboard
        .text(
          "👨‍💻 Sell Dev Supply",
          `${CallBackQueries.SELL_DEV}_${tokenAddress}`
        )
        .text(
          "📈 Sell % Supply",
          `${CallBackQueries.SELL_PERCENT}_${tokenAddress}`
        )
        .row()
        .text("🧨 Sell All", `${CallBackQueries.SELL_ALL}_${tokenAddress}`)
        .text("📊 Sell Individual Wallet", `${CallBackQueries.SELL_INDIVIDUAL}_${tokenAddress}`)
        .row();
    } else {
      keyboard
        .text(
          "🚀 Launch Token",
          `${CallBackQueries.LAUNCH_TOKEN}_${tokenAddress}`
        )
        .row();
    }

    // Add delete button for all tokens
    keyboard
      .text(
        "🗑️ Delete Token",
        `${CallBackQueries.DELETE_TOKEN}_${tokenAddress}`
      )
      .row();

    // Navigation buttons
    if (tokens.length > 1) {
      if (index > 0) {
        keyboard.text("⬅️", "prev");
      }
      if (index < tokens.length - 1) {
        keyboard.text("➡️", "next");
      }
      keyboard.row();
    }

    keyboard.text("🔙 Back", CallBackQueries.BACK);

    sendMessage(ctx, lines, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  };

  const showDeleteConfirmation = async (
    tokenAddress: string,
    tokenName: string
  ) => {
    const message = `⚠️ **Delete Token Confirmation**

Are you sure you want to delete this token?

**Token:** ${tokenName}
**Address:** \`${tokenAddress}\`

⚠️ **Warning:** This action cannot be undone. The token will be permanently removed from your account.

Note: If this token was launched, it will continue to exist on the blockchain, but you will lose access to manage it through this bot.`;

    const keyboard = new InlineKeyboard()
      .text(
        "✅ Yes, Delete",
        `${CallBackQueries.CONFIRM_DELETE_TOKEN}_${tokenAddress}`
      )
      .text("❌ Cancel", "cancel_delete")
      .row();

    await ctx.reply(message, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  };

  await showToken(currentIndex);

  while (true) {
    const response = await conversation.waitFor("callback_query:data");

    const data = response.callbackQuery?.data;

    // Check if this is a sell/launch button that should be handled by global handlers
    const isSellButton = data?.startsWith(`${CallBackQueries.SELL_DEV}_`) ||
                        data?.startsWith(`${CallBackQueries.SELL_ALL}_`) ||
                        data?.startsWith(`${CallBackQueries.SELL_PERCENT}_`) ||
                        data?.startsWith(`${CallBackQueries.SELL_INDIVIDUAL}_`);
    
    const isLaunchButton = data?.startsWith(`${CallBackQueries.LAUNCH_TOKEN}_`);

    // For sell/launch buttons, DON'T answer callback query and halt to let global handlers take over
    if (isSellButton || isLaunchButton) {
      return conversation.halt();
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
      return conversation.halt();
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
          await ctx.reply(
            "✅ **Token deleted successfully!**\n\nThe token has been removed from your account.",
            {
              parse_mode: "Markdown",
            }
          );

          // Refresh the tokens list and return to main menu
          return conversation.halt();
        } else {
          await ctx.reply(
            `❌ **Failed to delete token**\n\n${result.message}`,
            {
              parse_mode: "Markdown",
            }
          );
        }
      } catch (error: any) {
        await ctx.reply(`❌ **Error deleting token**\n\n${error.message}`, {
          parse_mode: "Markdown",
        });
      }
    } else if (data === "cancel_delete") {
      await showToken(currentIndex);
    }
  }
};

export default viewTokensConversation;
