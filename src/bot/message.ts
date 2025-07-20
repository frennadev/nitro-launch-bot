import { bot } from ".";
import { CallBackQueries } from "./types";
import { escape } from "./utils";
import { getTokenInfo, calculateTokenHoldingsWorth } from "../backend/utils";
import { getAccurateSpendingStats } from "../backend/functions-main";

// Add a new callback for refresh functionality
export enum LaunchMessageCallbacks {
  REFRESH_LAUNCH_DATA = "refresh_launch_data",
  REFRESH_BONK_LAUNCH_DATA = "refresh_bonk_launch_data",
}

export const sendLaunchSuccessNotification = async (
  chatId: number,
  tokenAddress: string,
  tokenName: string,
  symbol: string
) => {
  const messageData = await buildLaunchSuccessMessage(tokenAddress, tokenName, symbol);
  
  const message = await bot.api.sendMessage(chatId, messageData.text, {
    parse_mode: "MarkdownV2",
    reply_markup: messageData.keyboard,
  });

  // Pin the message
  try {
    await bot.api.pinChatMessage(chatId, message.message_id, {
      disable_notification: true, // Don't notify users about the pin
    });
  } catch (error) {
    console.warn(`[sendLaunchSuccessNotification] Could not pin message:`, error);
  }
};

// Bonk-specific success notification
export const sendBonkLaunchSuccessNotification = async (
  chatId: number,
  tokenAddress: string,
  tokenName: string,
  symbol: string
) => {
  const messageData = await buildBonkLaunchSuccessMessage(tokenAddress, tokenName, symbol);
  
  const message = await bot.api.sendMessage(chatId, messageData.text, {
    parse_mode: "MarkdownV2",
    reply_markup: messageData.keyboard,
  });

  // Pin the message
  try {
    await bot.api.pinChatMessage(chatId, message.message_id, {
      disable_notification: true, // Don't notify users about the pin
    });
  } catch (error) {
    console.warn(`[sendBonkLaunchSuccessNotification] Could not pin message:`, error);
  }
};

const buildLaunchSuccessMessage = async (tokenAddress: string, tokenName: string, symbol: string) => {
  // Get accurate financial statistics
  const financialStats = await getAccurateSpendingStats(tokenAddress);

  // Get enhanced token worth calculation from bonding curve
  const tokenWorth = await calculateTokenHoldingsWorth(tokenAddress, financialStats.totalTokens);

  // Fix market cap calculation - PumpFun minimum is ~$4000
  const correctedMarketCap = Math.max(tokenWorth.marketCap, 4000);

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
    `➡️ Market Cap: ${escape(formatUSD(correctedMarketCap))}`,
    tokenWorth.bondingCurveProgress > 0 ? `➡️ Bonding Curve: ${escape(formatPercentage(tokenWorth.bondingCurveProgress))}` : "",
    ``,
    `💎 *Your Holdings:*`,
    tokenWorth.worthInUsd > 0 ? `➡️ Current Value: ${escape(formatUSD(tokenWorth.worthInUsd))}` : "",
    tokenWorth.worthInSol > 0 ? `➡️ Worth in SOL: ${escape(formatSOL(tokenWorth.worthInSol))}` : "",
    ``,
    `Use the buttons below for next steps ⬇️`,
  ]
    .filter(Boolean)
    .join("\n");

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "🔄 Refresh",
          callback_data: `${LaunchMessageCallbacks.REFRESH_LAUNCH_DATA}_${tokenAddress}`,
        },
      ],
      [
        {
          text: "💯 Sell 100% Dev Supply",
          callback_data: `${CallBackQueries.SELL_DEV_SUPPLY}_${tokenAddress}`,
        },
      ],
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
      [
        {
          text: "🎁 Airdrop SOL",
          callback_data: `${CallBackQueries.AIRDROP_SOL}_${tokenAddress}`,
        },
      ],
    ],
  };

  return { text: msg, keyboard };
};

// Bonk-specific success message builder
const buildBonkLaunchSuccessMessage = async (tokenAddress: string, tokenName: string, symbol: string) => {
  // Get accurate financial statistics for Bonk tokens
  const financialStats = await getAccurateSpendingStats(tokenAddress);

  // Format numbers for display
  const formatUSD = (amount: number) => `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const formatSOL = (amount: number) => `${amount.toFixed(6)} SOL`;
  const formatPercentage = (percentage: number) => `${percentage.toFixed(1)}%`;

  // Calculate estimated market cap for Bonk tokens (similar to PumpFun but adapted)
  const estimatedMarketCap = Math.max(4000, financialStats.totalSpent * 2500); // Rough estimate

  // Calculate estimated holdings worth (simplified for Bonk)
  const estimatedHoldingsWorth = financialStats.totalSpent * 1.2; // 20% estimated gain
  const estimatedHoldingsSOL = estimatedHoldingsWorth;

  const msg = [
    `🎉 *Bonk Token Launched Successfully\\!*`,
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
    `➡️ Market Cap: ${escape(formatUSD(estimatedMarketCap))}`,
    `➡️ Platform: Raydium Launch Lab`,
    ``,
    `💎 *Your Holdings:*`,
    `➡️ Worth in SOL: ${escape(formatSOL(estimatedHoldingsSOL))}`,
    ``,
    `Use the buttons below for next steps ⬇️`,
  ]
    .filter(Boolean)
    .join("\n");

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "🔄 Refresh",
          callback_data: `${LaunchMessageCallbacks.REFRESH_BONK_LAUNCH_DATA}_${tokenAddress.substring(0, 8)}`,
        },
      ],
      [
        {
          text: "💯 Sell 100% Dev Supply",
          callback_data: `${CallBackQueries.SELL_DEV_SUPPLY}_${tokenAddress.substring(0, 8)}`,
        },
      ],
      [
        {
          text: "👨‍💻 Sell Dev Supply",
          callback_data: `${CallBackQueries.SELL_DEV}_${tokenAddress.substring(0, 8)}`,
        },
        {
          text: "📈 Sell % supply",
          callback_data: `${CallBackQueries.SELL_PERCENT}_${tokenAddress.substring(0, 8)}`,
        },
      ],
      [
        {
          text: "🧨 Sell All",
          callback_data: `${CallBackQueries.SELL_ALL}_${tokenAddress.substring(0, 8)}`,
        },
        {
          text: "👥 Individual Wallet Sells",
          callback_data: `${CallBackQueries.SELL_INDIVIDUAL}_${tokenAddress.substring(0, 8)}`,
        },
      ],
      [
        {
          text: "🎁 Airdrop SOL",
          callback_data: `${CallBackQueries.AIRDROP_SOL}_${tokenAddress.substring(0, 8)}`,
        },
      ],
    ],
  };

  return { text: msg, keyboard };
};

// Function to handle refresh callback
export const handleLaunchDataRefresh = async (
  chatId: number,
  messageId: number,
  tokenAddress: string,
  tokenName: string,
  symbol: string
) => {
  try {
    const messageData = await buildLaunchSuccessMessage(tokenAddress, tokenName, symbol);
    
    await bot.api.editMessageText(chatId, messageId, messageData.text, {
      parse_mode: "MarkdownV2",
      reply_markup: messageData.keyboard,
    });
  } catch (error) {
    console.error(`[handleLaunchDataRefresh] Error refreshing launch data:`, error);
    // If edit fails, try to send a new message
    try {
      await bot.api.sendMessage(chatId, "🔄 *Refreshing data\\.\\.\\.*", {
        parse_mode: "MarkdownV2",
      });
    } catch (fallbackError) {
      console.error(`[handleLaunchDataRefresh] Fallback message also failed:`, fallbackError);
    }
  }
};

// Function to handle Bonk refresh callback
export const handleBonkLaunchDataRefresh = async (
  chatId: number,
  messageId: number,
  tokenAddress: string,
  tokenName: string,
  symbol: string
) => {
  try {
    const messageData = await buildBonkLaunchSuccessMessage(tokenAddress, tokenName, symbol);
    
    await bot.api.editMessageText(chatId, messageId, messageData.text, {
      parse_mode: "MarkdownV2",
      reply_markup: messageData.keyboard,
    });
  } catch (error) {
    console.error(`[handleBonkLaunchDataRefresh] Error refreshing launch data:`, error);
    // If edit fails, try to send a new message
    try {
      await bot.api.sendMessage(chatId, "🔄 *Refreshing data\\.\\.\\.*", {
        parse_mode: "MarkdownV2",
      });
    } catch (fallbackError) {
      console.error(`[handleBonkLaunchDataRefresh] Fallback message also failed:`, fallbackError);
    }
  }
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
