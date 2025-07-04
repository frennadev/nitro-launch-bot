import { bot } from ".";
import { CallBackQueries } from "./types";
import { escape } from "./utils";
import { getTokenInfo, calculateTokenHoldingsWorth } from "../backend/utils";
import { getAccurateSpendingStats } from "../backend/functions-main";

export const sendLaunchSuccessNotification = async (
  chatId: number,
  tokenAddress: string,
  tokenName: string,
  symbol: string
) => {
  // Get accurate financial statistics
  const financialStats = await getAccurateSpendingStats(tokenAddress);

  // Get enhanced token worth calculation from bonding curve
  const tokenWorth = await calculateTokenHoldingsWorth(tokenAddress, financialStats.totalTokens);

  // Calculate P&L using bonding curve pricing
  let profitLoss = 0;
  let profitLossPercentage = 0;
  
  if (tokenWorth.worthInUsd > 0 && financialStats.totalSpent > 0) {
    // Convert SOL spent to USD for comparison (using estimated SOL price from bonding curve calculation)
    const estimatedSolPrice = 240; // This should match the one in getPumpFunTokenInfo
    const totalSpentUsd = financialStats.totalSpent * estimatedSolPrice;
    
    profitLoss = tokenWorth.worthInUsd - totalSpentUsd;
    profitLossPercentage = (profitLoss / totalSpentUsd) * 100;
  }

  // Format numbers for display
  const formatUSD = (amount: number) => `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const formatSOL = (amount: number) => `${amount.toFixed(6)} SOL`;
  const formatPercentage = (percentage: number) => `${percentage.toFixed(1)}%`;

  const msg = [
    `🎉 *Token Launched Successfully\\!*`,
    `*Name:* ${escape(tokenName)}`,
    `*Symbol:* \`${escape(symbol)}\``,
    `*Address:* \`${tokenAddress}\``,
    ``,
    `💰 *Financial Overview:*`,
    `➡️ Total Spent: ${escape(formatSOL(financialStats.totalSpent))}`,
    `➡️ Dev Allocation: ${escape(formatSOL(financialStats.totalDevSpent))}`,
    `➡️ Snipe Buys: ${escape(formatSOL(financialStats.totalSnipeSpent))}`,
    `➡️ Unique Buy Wallets: ${financialStats.successfulBuyWallets}`,
    ``,
    `📊 *Current Market Data:*`,
    tokenWorth.marketCap > 0 ? `➡️ Market Cap: ${escape(formatUSD(tokenWorth.marketCap))}` : "",
    tokenWorth.pricePerToken > 0 ? `➡️ Price: ${escape(`$${tokenWorth.pricePerToken.toFixed(8)}`)}` : "",
    tokenWorth.bondingCurveProgress > 0 ? `➡️ Bonding Curve: ${escape(formatPercentage(tokenWorth.bondingCurveProgress))}` : "",
    ``,
    `💎 *Your Holdings:*`,
    tokenWorth.worthInUsd > 0 ? `➡️ Current Value: ${escape(formatUSD(tokenWorth.worthInUsd))}` : "",
    tokenWorth.worthInSol > 0 ? `➡️ Worth in SOL: ${escape(formatSOL(tokenWorth.worthInSol))}` : "",
    profitLoss !== 0
      ? `➡️ P/L: ${profitLoss >= 0 ? "🟢" : "🔴"} ${escape(formatUSD(profitLoss))} \\(${profitLossPercentage >= 0 ? "+" : ""}${escape(formatPercentage(profitLossPercentage))}\\)`
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
