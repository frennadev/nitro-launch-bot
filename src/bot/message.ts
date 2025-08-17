import { bot } from ".";
import { CallBackQueries } from "./types";
import { escape, compressCallbackData, createSafeCallbackData } from "./utils";
import { getTokenInfo, calculateTokenHoldingsWorth } from "../backend/utils";
import { getAccurateSpendingStats } from "../backend/functions-main";
import { InlineKeyboard } from "grammy";
import { Api } from "grammy";

// Define BotInterface for type compatibility
interface BotInterface {
  api: Api;
}

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
  console.log("[DEBUG] sendLaunchSuccessNotification called with:", {
    chatId,
    tokenAddress,
    tokenName,
    symbol,
    types: {
      chatId: typeof chatId,
      tokenAddress: typeof tokenAddress,
      tokenName: typeof tokenName,
      symbol: typeof symbol,
    },
  });

  const messageData = await buildLaunchSuccessMessage(
    tokenAddress,
    tokenName,
    symbol
  );

  const message = await bot.api.sendMessage(chatId, messageData.text, {
    parse_mode: "HTML",
    reply_markup: messageData.keyboard,
  });

  // Pin the message
  try {
    await bot.api.pinChatMessage(chatId, message.message_id, {
      disable_notification: true, // Don't notify users about the pin
    });
  } catch (error) {
    console.warn(
      `[sendLaunchSuccessNotification] Could not pin message:`,
      error
    );
  }
};

// Bonk-specific success notification
export const sendBonkLaunchSuccessNotification = async (
  chatId: number,
  tokenAddress: string,
  tokenName: string,
  symbol: string
) => {
  try {
    const messageData = await buildBonkLaunchSuccessMessage(
      tokenAddress,
      tokenName,
      symbol
    );

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
      console.warn(
        `[sendBonkLaunchSuccessNotification] Could not pin message:`,
        error
      );
    }
  } catch (error: any) {
    console.error(
      `[sendBonkLaunchSuccessNotification] Error sending message:`,
      error
    );

    // If there's a button data error, send a simplified message without buttons
    if (
      error.description &&
      error.description.includes("BUTTON_DATA_INVALID")
    ) {
      console.warn(
        `[sendBonkLaunchSuccessNotification] Button data invalid, sending simplified message`
      );

      const simplifiedMessage = [
        `🎉 <b>Bonk Token Launched Successfully!</b>`,
        ``,
        `🪙 <b>${tokenName}</b> (${symbol})`,
        `📍 <code>${tokenAddress}</code>`,
        ``,
        `🚀 <b>Platform:</b> Raydium Launch Lab`,
        `✅ <b>Status:</b> <i>Live & Trading</i>`,
        ``,
        `💡 <i>Use the buttons below to manage your token</i>`,
      ]
        .filter(Boolean)
        .join("\n");

      const keyboard = new InlineKeyboard()
        .text("📊 View Tokens", "view_tokens")
        .row()
        .text(
          "🔄 Try Again",
          createSafeCallbackData(CallBackQueries.LAUNCH_TOKEN, tokenAddress)
        );

      await bot.api.sendMessage(chatId, simplifiedMessage, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
    } else {
      // For other errors, send a basic success message
      await bot.api.sendMessage(
        chatId,
        `🎉 Bonk token launched successfully! Token: ${tokenAddress}`,
        { parse_mode: "MarkdownV2" }
      );
    }
  }
};

const buildLaunchSuccessMessage = async (
  tokenAddress: string,
  tokenName: string,
  symbol: string
) => {
  console.log("[DEBUG] buildLaunchSuccessMessage called with:", {
    tokenAddress,
    tokenName,
    symbol,
    types: {
      tokenAddress: typeof tokenAddress,
      tokenName: typeof tokenName,
      symbol: typeof symbol,
    },
  });

  // Get accurate financial statistics
  const financialStats = await getAccurateSpendingStats(tokenAddress);

  // Get enhanced token worth calculation from bonding curve
  const tokenWorth = await calculateTokenHoldingsWorth(
    tokenAddress,
    financialStats.totalTokens
  );

  // Fix market cap calculation - PumpFun minimum is ~$4000
  const correctedMarketCap = Math.max(tokenWorth.marketCap, 4000);

  // Format numbers for display
  const formatUSD = (amount: number) =>
    `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const formatSOL = (amount: number) => `${amount.toFixed(6)} SOL`;
  const formatPercentage = (percentage: number) => `${percentage.toFixed(1)}%`;

  const msg = [
    `🎉 <b>Token Launch Complete!</b>`,
    ``,
    `🪙 <b>${tokenName}</b> (${symbol})`,
    `📍 <code>${tokenAddress}</code>`,
    ``,
    `💰 <b>Financial Summary</b>`,
    `💸 Total Spent: ${formatSOL(financialStats.totalSpent)}`,
    `👨‍💻 Dev Allocation: ${formatSOL(financialStats.totalDevSpent)}`,
    `⚡ Snipe Buys: ${formatSOL(financialStats.totalSnipeSpent)}`,
    `👥 Unique Buyers: ${financialStats.successfulBuyWallets}`,
    ``,
    `📊 <b>Market Data</b>`,
    `💎 Market Cap: ${formatUSD(correctedMarketCap)}`,
    tokenWorth.bondingCurveProgress > 0
      ? `📈 Bonding Progress: ${formatPercentage(tokenWorth.bondingCurveProgress)}`
      : "",
    `✅ Status: <i>Live & Trading</i>`,
    ``,
    tokenWorth.worthInUsd > 0 || tokenWorth.worthInSol > 0
      ? `🎯 <b>Your Holdings</b>`
      : "",
    tokenWorth.worthInUsd > 0
      ? `💵 USD Value: ${formatUSD(tokenWorth.worthInUsd)}`
      : "",
    tokenWorth.worthInSol > 0
      ? `◎ SOL Value: ${formatSOL(tokenWorth.worthInSol)}`
      : "",
    tokenWorth.worthInUsd > 0 || tokenWorth.worthInSol > 0 ? `` : "",
    `🎛️ <b>Choose an action below:</b>`,
  ]
    .filter(Boolean)
    .join("\n");

  const keyboard = new InlineKeyboard()
    .text(
      "💸 Fund Wallets",
      createSafeCallbackData(CallBackQueries.FUND_TOKEN_WALLETS, tokenAddress)
    )
    .text(
      "🔄 Refresh",
      createSafeCallbackData(
        LaunchMessageCallbacks.REFRESH_LAUNCH_DATA,
        tokenAddress
      )
    )
    .row()
    .text(
      "💯 Sell 100% Dev",
      createSafeCallbackData(CallBackQueries.SELL_DEV_SUPPLY, tokenAddress)
    )
    .text(
      "👨‍💻 Sell Dev Supply",
      createSafeCallbackData(CallBackQueries.SELL_DEV, tokenAddress)
    )
    .row()
    .text(
      "📈 Sell % Supply",
      createSafeCallbackData(CallBackQueries.SELL_PERCENT, tokenAddress)
    )
    .text(
      "🧨 Sell All",
      createSafeCallbackData(CallBackQueries.SELL_ALL, tokenAddress)
    )
    .row()
    .text(
      "👥 Individual Sells",
      createSafeCallbackData(CallBackQueries.SELL_INDIVIDUAL, tokenAddress)
    )
    .text(
      "🎁 Airdrop SOL",
      createSafeCallbackData(CallBackQueries.AIRDROP_SOL, tokenAddress)
    )
    .row()
    .text("📊 Monitor", `${CallBackQueries.VIEW_TOKEN_TRADES}_${tokenAddress}`)
    .row()
    .url("📊 DexScreener", `https://dexscreener.com/solana/${tokenAddress}`)
    .url("🔍 Solscan", `https://solscan.io/token/${tokenAddress}`);

  return { text: msg, keyboard };
};

// Bonk-specific success message builder
const buildBonkLaunchSuccessMessage = async (
  tokenAddress: string,
  tokenName: string,
  symbol: string
) => {
  // Get accurate financial statistics for Bonk tokens
  const financialStats = await getAccurateSpendingStats(tokenAddress);

  // Format numbers for display
  const formatUSD = (amount: number) =>
    `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const formatSOL = (amount: number) => `${amount.toFixed(6)} SOL`;
  const formatPercentage = (percentage: number) => `${percentage.toFixed(1)}%`;

  // Calculate estimated market cap for Bonk tokens (similar to PumpFun but adapted)
  const estimatedMarketCap = Math.max(4000, financialStats.totalSpent * 2500); // Rough estimate

  // Calculate estimated holdings worth (simplified for Bonk)
  const estimatedHoldingsWorth = financialStats.totalSpent * 1.2; // 20% estimated gain
  const estimatedHoldingsSOL = estimatedHoldingsWorth;

  const msg = [
    `🎉 <b>Bonk Token Launched Successfully!</b>`,
    ``,
    `🪙 <b>${tokenName}</b> (${symbol})`,
    `📍 <code>${tokenAddress}</code>`,
    ``,
    `💰 <b>Financial Summary</b>`,
    `💸 Total Spent: ${formatSOL(financialStats.totalSpent)}`,
    `👨‍💻 Dev Allocation: ${formatSOL(financialStats.totalDevSpent)}`,
    `⚡ Snipe Buys: ${formatSOL(financialStats.totalSnipeSpent)}`,
    `👥 Unique Buyers: ${financialStats.successfulBuyWallets}`,
    ``,
    `📊 <b>Market Data</b>`,
    `💎 Market Cap: ${formatUSD(estimatedMarketCap)}`,
    `🚀 Platform: Raydium Launch Lab`,
    `✅ Status: <i>Live & Trading</i>`,
    ``,
    `🎯 <b>Your Holdings</b>`,
    `◎ SOL Value: ${formatSOL(estimatedHoldingsSOL)}`,
    ``,
    `🎛️ <b>Choose an action below:</b>`,
  ]
    .filter(Boolean)
    .join("\n");

  const keyboard = new InlineKeyboard()
    .text(
      "💸 Fund Wallets",
      createSafeCallbackData(CallBackQueries.FUND_TOKEN_WALLETS, tokenAddress)
    )
    .text(
      "🔄 Refresh",
      createSafeCallbackData(
        LaunchMessageCallbacks.REFRESH_BONK_LAUNCH_DATA,
        tokenAddress
      )
    )
    .row()
    .text(
      "💯 Sell 100% Dev",
      createSafeCallbackData(CallBackQueries.SELL_DEV_SUPPLY, tokenAddress)
    )
    .text(
      "👨‍💻 Sell Dev Supply",
      createSafeCallbackData(CallBackQueries.SELL_DEV, tokenAddress)
    )
    .row()
    .text(
      "📈 Sell % Supply",
      createSafeCallbackData(CallBackQueries.SELL_PERCENT, tokenAddress)
    )
    .text(
      "🧨 Sell All",
      createSafeCallbackData(CallBackQueries.SELL_ALL, tokenAddress)
    )
    .row()
    .text(
      "👥 Individual Sells",
      createSafeCallbackData(CallBackQueries.SELL_INDIVIDUAL, tokenAddress)
    )
    .text(
      "🎁 Airdrop SOL",
      createSafeCallbackData(CallBackQueries.AIRDROP_SOL, tokenAddress)
    )
    .row()
    .text("📊 Monitor", `${CallBackQueries.VIEW_TOKEN_TRADES}_${tokenAddress}`)
    .row()
    .url("📊 DexScreener", `https://dexscreener.com/solana/${tokenAddress}`)
    .url("🔍 Solscan", `https://solscan.io/token/${tokenAddress}`);

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
    const messageData = await buildLaunchSuccessMessage(
      tokenAddress,
      tokenName,
      symbol
    );

    // Send a new message instead of editing the original success message
    // This way users can always go back to the original success page
    await bot.api.sendMessage(chatId, messageData.text, {
      parse_mode: "MarkdownV2",
      reply_markup: messageData.keyboard,
    });
  } catch (error) {
    console.error(
      `[handleLaunchDataRefresh] Error refreshing launch data:`,
      error
    );
    // If sending fails, try to send a simple error message
    try {
      await bot.api.sendMessage(
        chatId,
        "❌ *Error refreshing data\\. Please try again\\.*",
        {
          parse_mode: "MarkdownV2",
        }
      );
    } catch (fallbackError) {
      console.error(
        `[handleLaunchDataRefresh] Fallback message also failed:`,
        fallbackError
      );
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
    const messageData = await buildBonkLaunchSuccessMessage(
      tokenAddress,
      tokenName,
      symbol
    );

    // Send a new message instead of editing the original success message
    // This way users can always go back to the original success page
    await bot.api.sendMessage(chatId, messageData.text, {
      parse_mode: "MarkdownV2",
      reply_markup: messageData.keyboard,
    });
  } catch (error) {
    console.error(
      `[handleBonkLaunchDataRefresh] Error refreshing launch data:`,
      error
    );
    // If sending fails, try to send a simple error message
    try {
      await bot.api.sendMessage(
        chatId,
        "❌ *Error refreshing data\\. Please try again\\.*",
        {
          parse_mode: "MarkdownV2",
        }
      );
    } catch (fallbackError) {
      console.error(
        `[handleBonkLaunchDataRefresh] Fallback message also failed:`,
        fallbackError
      );
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
    `❌ <b>Token Launch Failed</b>`,
    ``,
    `🪙 <b>${tokenName}</b> (${symbol})`,
    `📍 <code>${tokenAddress}</code>`,
    ``,
    `💡 <i>Something went wrong during the launch process.</i>`,
    `🔄 <i>You can retry using the buttons below:</i>`,
  ]
    .filter(Boolean)
    .join("\n");

  const keyboard = new InlineKeyboard()
    .text(
      "🚀 Retry Launch",
      createSafeCallbackData(CallBackQueries.LAUNCH_TOKEN, tokenAddress)
    )
    .row()
    .text("📊 View Tokens", "view_tokens")
    .text("🏠 Main Menu", "main_menu");

  await bot.api.sendMessage(chatId, msg, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
};

export const sendNotification = async (
  bot: BotInterface,
  chatId: number,
  message: string
) => {
  await bot.api.sendMessage(chatId, message, { parse_mode: "HTML" });
};
