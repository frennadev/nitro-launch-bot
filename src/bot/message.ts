import bot from ".";
import { CallBackQueries } from "./types";
import { escape } from "./utils";
import { getTokenInfo } from "../backend/utils";
import { getAccurateSpendingStats } from "../backend/functions-main";

export const sendLaunchSuccessNotification = async (
  chatId: number,
  tokenAddress: string,
  tokenName: string,
  symbol: string
) => {
  // Get token info for market cap and price
  const tokenInfo = await getTokenInfo(tokenAddress);

  // Get accurate financial statistics
  const financialStats = await getAccurateSpendingStats(tokenAddress);

  // Calculate token value if we have price and token amounts
  let totalTokenValue = 0;
  let profitLoss = 0;
  let profitLossPercentage = 0;

  if (tokenInfo && tokenInfo.price && financialStats.totalTokens !== "0") {
    const totalTokensNumber = Number(financialStats.totalTokens) / 1e6; // Convert from raw token amount to human readable
    totalTokenValue = totalTokensNumber * tokenInfo.price;
    profitLoss = totalTokenValue - financialStats.totalSpent;
    profitLossPercentage = financialStats.totalSpent > 0 ? (profitLoss / financialStats.totalSpent) * 100 : 0;
  }

  const msg = [
    `🎉 *Token Launched Successfully\\!*`,
    `*Name:* ${escape(tokenName)}`,
    `*Symbol:* \`${escape(symbol)}\``,
    `*Address:* \`${tokenAddress}\``,
    ``,
    `💰 *Financial Overview:*`,
    `➡️ Total Spent: ${escape(financialStats.totalSpent.toString())} SOL`,
    `➡️ Dev Allocation: ${escape(financialStats.totalDevSpent.toString())} SOL`,
    `➡️ Snipe Buys: ${escape(financialStats.totalSnipeSpent.toString())} SOL`,
    `➡️ Unique Buy Wallets: ${escape(financialStats.successfulBuyWallets.toString())}`,
    tokenInfo ? `➡️ Market Cap: ${escape(`$${tokenInfo.marketCap.toLocaleString()}`)}` : "",
    tokenInfo && tokenInfo.price !== undefined ? `➡️ Price: ${escape(`$${tokenInfo.price}`)}` : "",
    totalTokenValue > 0 ? `➡️ Current Value: ${escape(`$${totalTokenValue.toFixed(2)}`)}` : "",
    profitLoss !== 0
      ? `➡️ P/L: ${profitLoss >= 0 ? "🟢" : "🔴"} ${escape(`$${profitLoss.toFixed(2)}`)} (${profitLossPercentage >= 0 ? "+" : ""}${profitLossPercentage.toFixed(1)}%)`
      : "",
    ``,
    `Use the buttons below for next steps ⬇️`,
  ]
    .filter(Boolean)
    .join("\n");

  await bot.api.sendMessage(chatId, msg, {
    parse_mode: "MarkdownV2",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "👨‍💻 Sell Dev Supply",
            callback_data: `${CallBackQueries.SELL_DEV}_${tokenAddress}`,
          },
          {
            text: "📈 Sell % supply",
            callback_data: `${CallBackQueries.SELL_PERCENT}_${tokenAddress}`,
          },
        ],
        [
          {
            text: "🧨 Sell All",
            callback_data: `${CallBackQueries.SELL_ALL}_${tokenAddress}`,
          },
          {
            text: "👥 Individual Wallet Sells",
            callback_data: `${CallBackQueries.SELL_INDIVIDUAL}_${tokenAddress}`,
          },
        ],
      ],
    },
  });
};

export const sendLaunchFailureNotification = async (
  chatId: number,
  tokenAddress: string,
  tokenName: string,
  symbol: string
) => {
  const msg = [
    `❌ *Token launch Failed* \n`,
    `*Name*: ${escape(tokenName)}`,
    `*Symbol:* $\`${escape(symbol)}\``,
    `*Token Address*: \`${tokenAddress}\``,
    `\nClick the buttons below to retry the launch ⬇️`,
  ].join("\n");
  await bot.api.sendMessage(chatId, msg, {
    parse_mode: "MarkdownV2",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🚀 Launch Token",
            callback_data: `${CallBackQueries.LAUNCH_TOKEN}_${tokenAddress}`,
          },
        ],
      ],
    },
  });
};

export const sendNotification = async (chatId: number, message: string) => {
  await bot.api.sendMessage(chatId, message, { parse_mode: "MarkdownV2" });
};
