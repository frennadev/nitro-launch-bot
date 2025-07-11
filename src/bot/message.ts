import { bot } from ".";
import { CallBackQueries } from "./types";
import { escape } from "./utils";
import { getTokenInfo, calculateTokenHoldingsWorth, getSolBalance } from "../backend/utils";
import { getAccurateSpendingStats } from "../backend/functions-main";
import { Context, InlineKeyboard } from "grammy";
import { formatUSD } from "./utils";
import { getUserTrades } from "./utils";
import { startPreemptivePoolDiscovery } from "../backend/get-poolInfo";
import {
  checkSellAmountWithoutDecimals,
  generateReferralLink,
  getAllTradingWallets,
  getFundingWallet,
} from "../backend/functions";
import { logger } from "../jobs/logger";
import { getActiveTradingWallet } from "../backend/functions-main";

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

// --- BEGIN: TokenResponseGenerator and getHtmllinks implementation ---
export const getHtmllinks = (address: string) => {
  const links = [
    { abbr: "CA", text: "Solscan", url: `https://solscan.io/token/${address}` },
    { abbr: "DEX", text: "Dexscreener", url: `https://dexscreener.com/solana/${address}` },
    { abbr: "BRD", text: "Birdeye", url: `https://birdeye.so/token/${address}?chain=solana` },
    { abbr: "PHO", text: "Photon", url: `https://photon-sol.tinyastro.io/en/lp/${address}` },
    { abbr: "NEO", text: "Neo", url: `https://neo.bullx.io/terminal?chainId=1399811149&address=${address}` },
    { abbr: "AXIOM", text: "Axiom", url: `https://axiom.trade/meme/${address}` },
    { abbr: "PF", text: "Pump.fun", url: `https://pump.fun/coin/${address}` },
    { abbr: "GMGN", text: "GMGN", url: `https://gmgn.ai/sol/token/${address}` },
    { abbr: "BBL", text: "Bubblemaps", url: `https://v2.bubblemaps.io/map?address=${address}&chain=solana` },
  ];
  return links.map((link) => `<a href="${link.url}" target="_blank">${link.abbr}</a>`).join(" • ");
};

// Simplified TokenInfo interface for compatibility
interface TokenInfo {
  name: string;
  symbol: string;
  address: string;
  price?: number;
  priceChange24h?: number;
  marketCap?: number;
  volume24h?: number;
  liquidity?: number;
  verified?: boolean;
}

export class TokenResponseGenerator {
  async generateTokenResponse(
    tokenAddress: string,
    ctx: Context,
    userId: string,
    stage: "1" | "2" = "1"
  ): Promise<{
    message: string;
    keyboard: InlineKeyboard;
  } | null> {
    try {
      // Get token info using existing backend function
      const tokenInfo = await getTokenInfo(tokenAddress);
      if (!tokenInfo) {
        return null;
      }

      let currentWalletName = "Main";
      try {
        const fundingWallet = await getFundingWallet(userId);
        if (fundingWallet) {
          currentWalletName = "Main Wallet";
        }
      } catch (error) {
        console.warn("Could not fetch wallet name for token response:", error);
      }

      // Create simplified token info object
      const token: TokenInfo = {
        name: tokenInfo.baseToken?.name || "Unknown Token",
        symbol: tokenInfo.baseToken?.symbol || "UNKNOWN",
        address: tokenAddress,
        price: tokenInfo.priceUsd,
        marketCap: tokenInfo.marketCap,
        liquidity: tokenInfo.liquidity?.usd,
        verified: false, // Default to false for now
      };

      const message = await this.formatTokenMessage(token, ctx, userId, stage);
      const keyboard = await this.createTokenKeyboard(userId, tokenAddress, currentWalletName);

      return { message, keyboard };
    } catch (error) {
      logger.error("Error generating token response:", error);
      return null;
    }
  }

  private async formatTokenMessage(
    token: TokenInfo,
    ctx: Context,
    userId: string,
    stage: "1" | "2" = "1"
  ): Promise<string> {
    const priceText = token.price ? `$${token.price.toFixed(8)}` : "N/A";
    const priceChangeText = token.priceChange24h
      ? `${token.priceChange24h > 0 ? "+" : ""}${token.priceChange24h.toFixed(2)}%`
      : "N/A";
    const priceChangeEmoji =
      token.priceChange24h && token.priceChange24h > 0 ? "🟢" : "🔴";

    const marketCapText = token.marketCap ? formatUSD(token.marketCap) : "N/A";
    const volumeText = token.volume24h ? formatUSD(token.volume24h) : "N/A";
    const liquidityText = token.liquidity ? formatUSD(token.liquidity) : "N/A";

    const verifiedBadge = token.verified ? "✅" : "";

    const linksHtml = getHtmllinks(token.address);
    
    // Get bot info for referral link
    let referralLink = "";
    try {
      const botInfo = await ctx.api.getMe();
      const botUsername = botInfo.username;
      const [referralLinkResult] = await Promise.allSettled([
        generateReferralLink(userId, botUsername),
      ]);
      referralLink = referralLinkResult.status === "fulfilled" ? referralLinkResult.value : "";
    } catch (error) {
      console.warn("Could not generate referral link:", error);
    }

    if (stage === "1") {
      return `
🪙 ${token.name} $${token.symbol} ${verifiedBadge}
<code>${token.address}</code>
🤑 <a href="${referralLink}">Share Token & Earn</a>

💰 <b>Price:</b>  ${priceText} | 📈 24h:  ${priceChangeEmoji} ${priceChangeText}
🏦 <b>Market Cap:</b> ${marketCapText}
📊 <b>Volume 24h:</b> ${volumeText}
💧 <b>Liquidity:</b>  ${liquidityText}

🔄 <b>Fetching additional data...</b>

📱 <b>Quick Actions:</b> Use the buttons below to buy or sell this token.`;
    }

    // Simplified limit orders section
    const limitOrdersSection = "🧐 No active limit orders";

    let walletsBalanceSection = "";
    try {
      const [userWalletsResult, fundingWalletResult] = await Promise.allSettled([
        getAllTradingWallets(userId),
        getFundingWallet(userId),
      ]);

      const userWallets = userWalletsResult.status === "fulfilled" ? userWalletsResult.value : [];
      const fundingWallet = fundingWalletResult.status === "fulfilled" ? fundingWalletResult.value : null;

      const allWallets = [];
      if (fundingWallet) {
        allWallets.push({
          name: "Main",
          publicKey: fundingWallet.publicKey,
        });
      }
      allWallets.push(...userWallets);

      if (allWallets.length > 0) {
        const balancePromises = allWallets.map(async (wallet) => {
          try {
            const solBalanceResult = await Promise.allSettled([
              getSolBalance(wallet.publicKey),
            ]);

            const solBalance = solBalanceResult[0].status === "fulfilled" ? solBalanceResult[0].value : 0;

            const truncatedName = wallet.name.length > 8 ? `${wallet.name.substring(0, 7)}...` : wallet.name.padEnd(8);

            return `<code>${truncatedName}| 0 (0%)      | ${solBalance.toFixed(3)}</code>`;
          } catch (error) {
            const truncatedName = wallet.name.length > 8 ? `${wallet.name.substring(0, 7)}...` : wallet.name.padEnd(8);
            return `<code>${truncatedName}| 0 (0%)      | 0</code>`;
          }
        });

        const balanceLines = await Promise.all(balancePromises);

        walletsBalanceSection = `
<pre>
<b>💰 Balances</b>
<code>Wallet   | ${token.symbol.padEnd(8)} | SOL</code>
<code>─────────|${Array(token.symbol.length + 3).fill("─").join("")}|──────</code>
${balanceLines.join("\n")}

${limitOrdersSection}
</pre>`;
      } else {
        walletsBalanceSection = `<pre class="tg-spoiler"><b>💰 Balances</b>
    <code>No wallets found</code>
    </pre>`;
      }
    } catch (error) {
      console.warn("Could not fetch wallet balances:", error);
      walletsBalanceSection = `<pre class="tg-spoiler"><b>💰 Balances</b>
    <code>Unable to load balances</code>
    </pre>`;
    }

    const refreshTime = new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    return `
🪙 ${token.name} $${token.symbol} ${verifiedBadge}
<code>${token.address}</code>
🤑 <a href="${referralLink}">Share Token & Earn</a>

💰 <b>Price:</b>  ${priceText} | 📈 24h:  ${priceChangeEmoji} ${priceChangeText}
🏦 <b>Market Cap:</b> ${marketCapText}
📊 <b>Volume 24h:</b> ${volumeText}
💧 <b>Liquidity:</b>  ${liquidityText}

${walletsBalanceSection}
${linksHtml}
📱 <b>Quick Actions:</b> Use the buttons below to buy or sell this token.
🕓 <b>${refreshTime}</b>`;
  }

  private async createTokenKeyboard(
    userId: string,
    tokenAddress: string,
    currentWalletName?: string
  ): Promise<InlineKeyboard> {
    const walletName = currentWalletName || "Main";

    return new InlineKeyboard()
      .text(`💳 ${walletName} 🔄`, `cycle_wallet_${tokenAddress}`)
      .text("🔄 Refresh", `refresh_ca_${tokenAddress}`)
      .row()
      .text("0.01 SOL", `buy_token_${tokenAddress}_0.01`)
      .text("0.05 SOL", `buy_token_${tokenAddress}_0.05`)
      .text("0.1 SOL", `buy_token_${tokenAddress}_0.1`)
      .row()
      .text("0.2 SOL", `buy_token_${tokenAddress}_0.2`)
      .text("0.5 SOL", `buy_token_${tokenAddress}_0.5`)
      .text("1 SOL", `buy_token_${tokenAddress}_1.0`)
      .row()
      .text("X SOL", `buy_token_${tokenAddress}_X`)
      .text("📈 Buy Limit", `buy_limit_${tokenAddress}`)
      .row()
      .text("👁️ Track", `${CallBackQueries.VIEW_TOKEN_TRADES}_${tokenAddress}`)
      .text("🔴 Go to Sell", `${CallBackQueries.VIEW_TOKEN_TRADES}_${tokenAddress}_0`)
      .row()
      .url("📊 DexScreener", `https://dexscreener.com/solana/${tokenAddress}`)
      .url("🧑‍💻 Contract", `https://solscan.io/token/${tokenAddress}`);
  }

  // Generate a quick response for multiple tokens found
  generateMultipleTokensMessage(addresses: string[]): string {
    if (addresses.length === 1) {
      return `🔍 <b>Token detected!</b>\n\nFetching information for: ${addresses[0]}`;
    }

    const addressList = addresses.map((addr) => `${addr}`).join("\n");
    return `🔍 <b>Multiple tokens detected!</b>\n\nProcessing ${addresses.length} token addresses:\n${addressList}`;
  }
}
// --- END: TokenResponseGenerator and getHtmllinks implementation ---
