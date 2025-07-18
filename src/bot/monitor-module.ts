import {
  generateReferralLink,
  getSpecificUserLimitOrders,
  getSpecificUserLimitSellOrders,
} from "../../backend/functions/functions";
import { ITrade, IWallet } from "../../backend/models";
import { logger } from "../../config/logger";
import { TokenInfoService } from "../../services/token/token-info-service";
import { MonitorData } from "../../utils/types";
import { formatUSD } from "../helpers";
import { getHtmllinks } from "../tokenResponse";
import {
  getTop10HoldersFormatted,
  getTop10TokenHolders,
} from "./jeets-detection-module";
import {
  calculateTokenWorth,
  findFirstIndexByToken,
  getUserTrades,
} from "./trades-module";
import { getUser, getUserById } from "./users-module";

export async function getTokenMonitorData(
  userId: string,
  tokenAddress: string,
  tradeIndex: number | undefined,
  trades: ITrade[]
): Promise<MonitorData | null> {
  try {
    // Early validation - no async needed
    if (trades.length === 0) {
      logger.warn(
        `No trades found for user ${userId} and token ${tokenAddress}`
      );

      throw new Error("No trades found for this user");
    }

    // Determine current trade without async calls
    let currentTrade: ITrade;
    if (tradeIndex !== undefined) {
      if (tradeIndex < 0 || tradeIndex >= trades.length) {
        logger.warn(
          `Trade index ${tradeIndex} out of range for user ${userId} and token ${tokenAddress}`
        );
        throw new Error("Trade index out of range");
      }
      currentTrade = trades[tradeIndex];
    } else {
      const index = trades.findIndex(
        (trade) => trade.tokenAddress === tokenAddress
      );
      if (index === -1) {
        logger.warn(
          `No trades found for user ${userId} and token ${tokenAddress}`
        );
        throw new Error("No trades found for this token");
      }
      currentTrade = trades[index];
    }

    // Pre-calculate time values
    const now = new Date();
    const tradeCreatedAt = new Date(currentTrade.createdAt);
    const diffMs = now.getTime() - tradeCreatedAt.getTime();
    const totalCountdownMs = 100 * 60 * 60 * 1000;
    const remainingMs = Math.max(0, totalCountdownMs - diffMs);
    const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
    const remainingMinutes = Math.floor(
      (remainingMs % (1000 * 60 * 60)) / (1000 * 60)
    );
    const age = `${remainingHours
      .toString()
      .padStart(2, "0")}:${remainingMinutes.toString().padStart(2, "0")}`;

    // Extract trade values
    const initial = currentTrade?.amountSol || 0;
    const payout = currentTrade?.amountPayedOut || 0;

    // Execute async operations in parallel
    const [user, tokenInfo, amountOut] = await Promise.all([
      getUser(userId),
      TokenInfoService.getInstance().getTokenInfo(tokenAddress),
      calculateTokenWorth(currentTrade, null), // Pass null first, will be resolved
    ]);

    if (!user) {
      logger.warn(`User not found for ID ${userId}`);
      throw new Error("User not found");
    }

    if (!tokenInfo) {
      logger.warn(`Token information not available for ${tokenAddress}`);
      throw new Error("Token information not available");
    }

    // Recalculate with actual tokenInfo if needed
    const actualAmountOut = await calculateTokenWorth(currentTrade, tokenInfo);

    // Calculate derived values
    const newPnl =
      initial > 0 ? ((actualAmountOut - initial) / initial) * 100 : 0;
    const pnl = `${newPnl.toFixed(2)} %`;
    const tokenSymbol = tokenInfo.symbol || "Unknown";
    const marketCap = formatUSD(tokenInfo.marketCap || 0);
    const price = +tokenInfo.price!.toFixed(2);
    const worth = (newPnl / 100) * initial + initial;

    // Calculate token percentage
    const tokenSupply = tokenInfo.supply;
    const amountTokens = Number(currentTrade.amountTokens);
    const tokenAmount =
      amountTokens % 1 === 0
        ? amountTokens / Math.pow(10, tokenInfo.decimals || 6)
        : amountTokens;
    const tokenPercentage = (tokenAmount / Number(tokenSupply)) * 100;

    logger.info(
      `Token supply for ${currentTrade.amountTokens} (${tokenAddress}): ${tokenSupply}`
    );

    return {
      age,
      initial: +initial.toFixed(3),
      payout: +payout.toFixed(3),
      pnl,
      pnlRaw: newPnl,
      tokenSymbol,
      marketCap,
      price,
      worth: +worth.toFixed(3),
      tokenPercentage: Number(tokenPercentage.toFixed(3)),
      currentTrade,
    };
  } catch (error) {
    logger.error(
      "Error getting monitor data:",
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

export async function generateMonitorMessage(
  data: MonitorData,
  botUsername: string,
  index: number
): Promise<string> {
  const refreshTime = new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  logger.info(
    `Generating monitor message for trade ${data.currentTrade.tokenAddress} at index ${index}`
  );

  // Get the user first, then get their trades
  const user = await getUserById(data.currentTrade.user.toString());
  if (!user) {
    throw new Error("User not found");
  }

  // Execute all async operations in parallel
  const [
    referralLinkResult,
    limitOrdersResult,
    activeTradesResult,
    linksHtmlResult,
  ] = await Promise.allSettled([
    generateReferralLink(user.id, botUsername),
    getSpecificUserLimitSellOrders(user.id, data.currentTrade.tokenAddress),
    getUserTrades(user.id),
    getHtmllinks(data.currentTrade.tokenAddress),
  ]);

  const orders =
    limitOrdersResult.status === "fulfilled" ? limitOrdersResult.value : [];
  const referralLink =
    referralLinkResult.status === "fulfilled" ? referralLinkResult.value : "";
  const activeTrades =
    activeTradesResult.status === "fulfilled" ? activeTradesResult.value : [];
  const linksHtml =
    linksHtmlResult.status === "fulfilled" ? linksHtmlResult.value : "";

  // Process limit orders
  let limitOrdersSection = "🧐 No active limit orders";
  try {
    if (orders.length > 0) {
      const orderLines = orders
        .map((order) => {
          const decimal = order.isMarketLimit ? 2 : 8;
          const isMarketLimit = order.isMarketLimit;
          const orderType = order.limitType === "buy" ? "🟢 Buy" : "🔴 Sell";
          const price = order.price
            ? `${
                isMarketLimit
                  ? `${Number(order.price.toFixed(decimal)).toLocaleString()}`
                  : `$${order.price.toFixed(decimal)}`
              } ${isMarketLimit ? "MC" : ""}`
            : "N/A";
          const amount = order.amount ? `${order.amount.toFixed(4)}` : "N/A";
          return `<b>${orderType} ${amount} ${
            order.limitType == "buy" ? "SOL" : "%"
          } at ${price}</b>`;
        })
        .join("\n");

      limitOrdersSection = `📋 <b>Active Limit Orders</b>\n${orderLines}`;
    }
  } catch (error) {
    console.warn("Could not fetch limit orders:", error);
  }

  // Process other trades in parallel
  let otherTradesSection = "";
  if (activeTrades.length > 0) {
    const tokenInfoService = TokenInfoService.getInstance();
    const now = new Date();
    const totalCountdownMs = 100 * 60 * 60 * 1000;

    // Filter and process trades in parallel
    const otherTradesPromises = activeTrades
      .filter((trade) => trade.tokenAddress !== data.currentTrade.tokenAddress)
      .map(async (trade, idx) => {
        try {
          const tokenInfo = await tokenInfoService.getTokenInfo(
            trade.tokenAddress
          );
          if (!tokenInfo) return null;

          const amountOut = await calculateTokenWorth(trade, tokenInfo);
          const initial = trade.amountSol || 0;
          const pnl = initial > 0 ? ((amountOut - initial) / initial) * 100 : 0;
          const tradeWallet = trade.wallet as any;
          const walletAbbr = tradeWallet?.publicKey.slice(0, 4);

          const tradeCreatedAt = new Date(trade.createdAt);
          const diffMs = now.getTime() - tradeCreatedAt.getTime();
          const remainingMs = Math.max(0, totalCountdownMs - diffMs);
          const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
          const remainingMinutes = Math.floor(
            (remainingMs % (1000 * 60 * 60)) / (1000 * 60)
          );
          const idx = activeTrades.indexOf(trade) + 1;
          const age = `${remainingHours
            .toString()
            .padStart(2, "0")}:${remainingMinutes.toString().padStart(2, "0")}`;

          return `<b>/T${idx} $${
            tokenInfo.symbol.toUpperCase() || "Unknown"
          } (${walletAbbr}) 🚀 ${pnl.toFixed(2)}%  🕛 ${age} </b>`;
        } catch (error) {
          logger.warn(
            `Error processing other trade ${trade.tokenAddress}:`,
            error
          );
          return null;
        }
      });

    const otherTradesResults = await Promise.allSettled(otherTradesPromises);
    const validTrades = otherTradesResults
      .filter(
        (result) => result.status === "fulfilled" && result.value !== null
      )
      .map((result) => (result as PromiseFulfilledResult<string>).value);

    if (validTrades.length > 0) {
      otherTradesSection = `📊 Other Active Trades:\n${validTrades.join(
        "\n"
      )}\n`;
    } else {
      otherTradesSection = "🧐 No other active trades\n";
    }
  }

  const topHoldersData = await getTop10HoldersFormatted(
    data.currentTrade.tokenAddress
  );
  let topHoldersSection = "";
  if (topHoldersData && topHoldersData.length > 0) {
    const formattedHolders = topHoldersData;
    topHoldersSection = `👥 Top Holders: - Tap to expand\n${formattedHolders}
  `;
  } else {
    topHoldersSection = "🧐 No holders found for this token\n";
  }
  return `
  🌟 <b>${data.tokenSymbol}</b> • ⏰ ${
    data.age
  } • 🎯 <a href="${referralLink}">Referral</a>
  
  💰 <b>Main Position</b> • 📈 <b>${data.pnl}</b>
  ┌─ Initial: <b>${data.initial.toFixed(3)} SOL</b>
  ├─ Payout: <b>${data.payout.toFixed(3)} SOL</b>
  ├─ Tokens: <b>${data.tokenPercentage.toFixed(3)}%</b>
  └─ Worth: <b>${data.worth.toFixed(3)} SOL</b>
  <blockquote expandable>🔍 <b>Jeet Detection Analysis</b>
  ${topHoldersSection}</blockquote>
  💎 <b>Market Data</b>
  ├─ Price: <b>$${data.price}</b>
  └─ Market Cap: <b>${data.marketCap}</b>
  
  ${otherTradesSection}
  ${limitOrdersSection}
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🔄 <i>Auto-updates active • Limit orders unaffected</i>
  🕒 <i>Last refresh: ${refreshTime}</i>
  ${linksHtml}`;
}

// return `
// 🌑 $${data.tokenSymbol} 🕛 ${data.age} 🌟<a href="${referralLink}">Referral</a>

// 💳 Main 🚀 ${data.pnl}
// Initial: ${data.initial.toFixed(3)} SOL | Payout: ${data.payout.toFixed(3)} SOL
// Tokens: ${data.tokenPercentage.toFixed(3)}% | Worth: ${data.worth.toFixed(
//   3
// )} SOL
// ${limitOrdersSection}

// <blockquote expandable>${topHoldersSection}</blockquote>
// 💸 Price: $${data.price} | Market Cap: ${data.marketCap}
// ${linksHtml}

// ${otherTradesSection}

// 🔄  Automatic updates are enabled. Limit orders are not impacted.
// 🕒 Last updated: ${refreshTime}`;
