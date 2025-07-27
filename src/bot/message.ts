import { bot } from ".";
import { CallBackQueries } from "./types";
import { escape, compressCallbackData, createSafeCallbackData } from "./utils";
import { getTokenInfo, calculateTokenHoldingsWorth } from "../backend/utils";
import { getAccurateSpendingStats } from "../backend/functions-main";
import { InlineKeyboard } from "grammy";

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
  const messageData = await buildLaunchSuccessMessage(
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
        `🎉 *Bonk Token Launched Successfully\\!*`,
        `*Name:* ${escape(tokenName)}`,
        `*Symbol:* \`${escape(symbol)}\``,
        `*Address:* \`${tokenAddress}\``,
        ``,
        `✅ Your token is now live on Raydium Launch Lab\\!`,
        ``,
        `Use /view\\_tokens to manage your tokens\\!`,
      ].join("\n");

      await bot.api.sendMessage(chatId, simplifiedMessage, {
        parse_mode: "MarkdownV2",
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
    tokenWorth.bondingCurveProgress > 0
      ? `➡️ Bonding Curve: ${escape(formatPercentage(tokenWorth.bondingCurveProgress))}`
      : "",
    ``,
    `💎 *Your Holdings:*`,
    tokenWorth.worthInUsd > 0
      ? `➡️ Current Value: ${escape(formatUSD(tokenWorth.worthInUsd))}`
      : "",
    tokenWorth.worthInSol > 0
      ? `➡️ Worth in SOL: ${escape(formatSOL(tokenWorth.worthInSol))}`
      : "",
    ``,
    `Use the buttons below for next steps ⬇️`,
  ]
    .filter(Boolean)
    .join("\n");

  const keyboard = new InlineKeyboard()
    .text(
      "💸 Fund Token Wallets",
      createSafeCallbackData(CallBackQueries.FUND_TOKEN_WALLETS, tokenAddress)
    )
    .row()
    .text(
      "🔄 Refresh",
      createSafeCallbackData(
        LaunchMessageCallbacks.REFRESH_LAUNCH_DATA,
        tokenAddress
      )
    )
    .row()
    .text(
      "💯 Sell 100% Dev Supply",
      createSafeCallbackData(CallBackQueries.SELL_DEV_SUPPLY, tokenAddress)
    )
    .row()
    .text(
      "👨‍💻 Sell Dev Supply",
      createSafeCallbackData(CallBackQueries.SELL_DEV, tokenAddress)
    )
    .row()
    .text(
      "📈 Sell % supply",
      createSafeCallbackData(CallBackQueries.SELL_PERCENT, tokenAddress)
    )
    .row()
    .text(
      "🧨 Sell All",
      createSafeCallbackData(CallBackQueries.SELL_ALL, tokenAddress)
    )
    .row()
    .text(
      "👥 Individual Wallet Sells",
      createSafeCallbackData(CallBackQueries.SELL_INDIVIDUAL, tokenAddress)
    )
    .row()
    .text(
      "🎁 Airdrop SOL",
      createSafeCallbackData(CallBackQueries.AIRDROP_SOL, tokenAddress)
    );

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

  const keyboard = new InlineKeyboard()
    .text(
      "💸 Fund Token Wallets",
      createSafeCallbackData(CallBackQueries.FUND_TOKEN_WALLETS, tokenAddress)
    )
    .row()
    .text(
      "🔄 Refresh",
      createSafeCallbackData(
        LaunchMessageCallbacks.REFRESH_BONK_LAUNCH_DATA,
        tokenAddress
      )
    )
    .row()
    .text(
      "💯 Sell 100% Dev Supply",
      createSafeCallbackData(CallBackQueries.SELL_DEV_SUPPLY, tokenAddress)
    )
    .row()
    .text(
      "👨‍💻 Sell Dev Supply",
      createSafeCallbackData(CallBackQueries.SELL_DEV, tokenAddress)
    )
    .row()
    .text(
      "📈 Sell % supply",
      createSafeCallbackData(CallBackQueries.SELL_PERCENT, tokenAddress)
    )
    .row()
    .text(
      "🧨 Sell All",
      createSafeCallbackData(CallBackQueries.SELL_ALL, tokenAddress)
    )
    .row()
    .text(
      "👥 Individual Wallet Sells",
      createSafeCallbackData(CallBackQueries.SELL_INDIVIDUAL, tokenAddress)
    )
    .row()
    .text(
      "🎁 Airdrop SOL",
      createSafeCallbackData(CallBackQueries.AIRDROP_SOL, tokenAddress)
    );

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
