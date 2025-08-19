import { ConversationFlavor } from "@grammyjs/conversations";
import { Context } from "grammy";
import { logger } from "../utils/logger";
import {
  getUser,
  getAllBuyerWallets,
  getDevWallet,
  getFundingWallet,
  getWalletBalance,
  abbreviateNumber,
} from "../backend/functions";
import { sendMessage } from "../backend/sender";
import { getTokenInfo, getTokenBalance } from "../backend/utils";
import { InlineKeyboard } from "grammy";
import { CallBackQueries } from "./types";
import { compressCallbackData } from "./utils";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export const handleViewTokenTrades = async (
  ctx: ConversationFlavor<Context>,
  userId: string,
  tokenAddress: string,
  variant: "buy" | "scan" = "scan",
  index?: number
) => {
  try {
    const user = await getUser(userId);
    if (!user) {
      return await sendMessage(
        ctx,
        "❌ User not found. Please try again later."
      );
    }

    // Get token info
    const tokenInfo = await getTokenInfo(tokenAddress);
    if (!tokenInfo) {
      await sendMessage(
        ctx,
        `❌ **Token not found**\n\nCould not fetch information for token: \`${tokenAddress}\``,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Generate monitor message with current data
    const refreshTime = new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    // Extract token name and symbol from the correct structure
    const tokenName =
      tokenInfo.baseToken?.name || tokenInfo.name || "Unknown Token";
    const tokenSymbol =
      tokenInfo.baseToken?.symbol || tokenInfo.symbol || "Unknown";

    const monitorMessage = [
      `📊 **Token Monitor**`,
      ``,
      `**Token:** ${tokenName} (${tokenSymbol})`,
      `**Address:** \`${tokenAddress}\``,
      `**Status:** Monitoring active`,
      `**Mode:** ${variant}`,
      `**Last Updated:** ${refreshTime}`,
      ``,
      `**Market Data:**`,
      `• Price: $${tokenInfo.priceUsd || "N/A"}`,
      `• Market Cap: $${tokenInfo.marketCap ? tokenInfo.marketCap.toLocaleString() : "N/A"}`,
      `• Volume (24h): $${tokenInfo.volume24h ? tokenInfo.volume24h.toLocaleString() : "N/A"}`,
      `• Liquidity: $${tokenInfo.liquidity ? (typeof tokenInfo.liquidity === "object" ? tokenInfo.liquidity.usd?.toLocaleString() : tokenInfo.liquidity.toLocaleString()) : "N/A"}`,
      ``,
      `💡 **Tip:** Use /menu or /start to return to the main menu.`,
    ].join("\n");

    // Create keyboard with refresh and other options
    const keyboard = new InlineKeyboard()
      .text("🔄 Refresh", `remonitor_data_${tokenAddress}`)
      .row()
      .text(
        "� View Wallets",
        compressCallbackData(CallBackQueries.VIEW_TOKEN_WALLETS, tokenAddress)
      )
      .row()
      .text(
        "�💸 Fund Token Wallets",
        compressCallbackData(CallBackQueries.FUND_TOKEN_WALLETS, tokenAddress)
      )
      .row()
      .text("🔙 Back to Tokens", CallBackQueries.VIEW_TOKENS);

    await sendMessage(ctx, monitorMessage, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  } catch (error) {
    logger.error("Error in handleViewTokenTrades:", error);
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
    await sendMessage(ctx, "❌ User ID not found.");
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
    await sendMessage(ctx, "❌ Invalid token address.");
    return;
  }

  try {
    await handleViewTokenTrades(ctx, userId, tokenAddress, "scan", index);
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

    await sendMessage(
      ctx,
      "❌ Error fetching trade data. Please try again later."
    );
  }
};

type WalletHolder = {
  pubkey: string;
  balance: number; // token amount
  tokenPrice: number; // USD value of that wallet's tokens
  solBalance: number; // SOL balance for gas fees
  shortAddress: string;
  type: "buyer" | "dev" | "funding";
};

export const handleViewTokenWallets = async (
  ctx: ConversationFlavor<Context>,
  userId: string,
  tokenAddress: string,
  page: number = 0
) => {
  try {
    const user = await getUser(userId);
    if (!user) {
      return await sendMessage(
        ctx,
        "❌ User not found. Please try again later."
      );
    }

    // Use the MongoDB user ID (ObjectId) for wallet operations
    const userObjectId = user._id.toString();

    // Get token info for price calculation
    const tokenInfo = await getTokenInfo(tokenAddress);
    if (!tokenInfo) {
      await sendMessage(
        ctx,
        `❌ **Token not found**\n\nCould not fetch information for token: \`${tokenAddress}\``,
        { parse_mode: "Markdown" }
      );
      return;
    }

    const tokenPrice = parseFloat(tokenInfo.priceUsd || "0");
    const tokenName =
      tokenInfo.baseToken?.name || tokenInfo.name || "Unknown Token";
    const tokenSymbol =
      tokenInfo.baseToken?.symbol || tokenInfo.symbol || "Unknown";

    const walletHolders: WalletHolder[] = [];

    // Get all wallet types
    const buyerWallets = await getAllBuyerWallets(userObjectId);
    const devWalletData = await getDevWallet(userObjectId);
    const fundingWalletData = await getFundingWallet(userObjectId);

    // Check buyer wallets
    for (const wallet of buyerWallets) {
      try {
        const tokenBalance = await getTokenBalance(
          tokenAddress,
          wallet.publicKey
        );
        if (tokenBalance > 0) {
          const solBalance = await getWalletBalance(wallet.publicKey);
          const tokenValueUsd = (tokenBalance / 1e6) * tokenPrice;
          walletHolders.push({
            pubkey: wallet.publicKey,
            balance: tokenBalance,
            tokenPrice: tokenValueUsd,
            solBalance: solBalance,
            shortAddress:
              wallet.publicKey.slice(0, 6) + "…" + wallet.publicKey.slice(-4),
            type: "buyer",
          });
        }
      } catch (error) {
        logger.error(`Error checking buyer wallet ${wallet.publicKey}:`, error);
      }
    }

    // Check dev wallet
    if (devWalletData?.wallet) {
      try {
        // Derive public key from private key
        const devKeypair = Keypair.fromSecretKey(
          bs58.decode(devWalletData.wallet)
        );
        const devPublicKey = devKeypair.publicKey.toString();

        const tokenBalance = await getTokenBalance(tokenAddress, devPublicKey);
        if (tokenBalance > 0) {
          const solBalance = await getWalletBalance(devPublicKey);
          const tokenValueUsd = (tokenBalance / 1e6) * tokenPrice;
          walletHolders.push({
            pubkey: devPublicKey,
            balance: tokenBalance,
            tokenPrice: tokenValueUsd,
            solBalance: solBalance,
            shortAddress:
              devPublicKey.slice(0, 6) + "…" + devPublicKey.slice(-4),
            type: "dev",
          });
        }
      } catch (error) {
        logger.error(`Error checking dev wallet:`, error);
      }
    }

    // Check funding wallet
    if (fundingWalletData?.publicKey) {
      try {
        const tokenBalance = await getTokenBalance(
          tokenAddress,
          fundingWalletData.publicKey
        );
        if (tokenBalance > 0) {
          const solBalance = await getWalletBalance(
            fundingWalletData.publicKey
          );
          const tokenValueUsd = (tokenBalance / 1e6) * tokenPrice;
          walletHolders.push({
            pubkey: fundingWalletData.publicKey,
            balance: tokenBalance,
            tokenPrice: tokenValueUsd,
            solBalance: solBalance,
            shortAddress:
              fundingWalletData.publicKey.slice(0, 6) +
              "…" +
              fundingWalletData.publicKey.slice(-4),
            type: "funding",
          });
        }
      } catch (error) {
        logger.error(
          `Error checking funding wallet ${fundingWalletData.publicKey}:`,
          error
        );
      }
    }

    if (walletHolders.length === 0) {
      await sendMessage(
        ctx,
        `🔴 **No wallets hold this token**\n\n**Token:** ${tokenName} (${tokenSymbol})\n**Address:** \`${tokenAddress}\``,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Sort wallets by token balance (highest first)
    walletHolders.sort((a, b) => b.balance - a.balance);

    // Calculate totals
    const totalTokens = walletHolders.reduce((sum, w) => sum + w.balance, 0);
    const totalValueUsd = walletHolders.reduce(
      (sum, w) => sum + w.tokenPrice,
      0
    );

    // Pagination settings
    const WALLETS_PER_PAGE = 5;
    const totalPages = Math.ceil(walletHolders.length / WALLETS_PER_PAGE);
    const startIndex = page * WALLETS_PER_PAGE;
    const endIndex = Math.min(
      startIndex + WALLETS_PER_PAGE,
      walletHolders.length
    );
    const currentPageWallets = walletHolders.slice(startIndex, endIndex);

    // Format total tokens
    const totalTokensFormatted = (totalTokens / 1e6).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });

    // Create message header
    const message = [
      `💰 **Token Wallet Holdings**`,
      ``,
      `**Token:** ${tokenName} (${tokenSymbol})`,
      `**Address:** \`${tokenAddress}\``,
      ``,
      `📊 **Summary:**`,
      `• ${walletHolders.length} wallets holding tokens`,
      `• ${totalTokensFormatted} total tokens`,
      `• $${abbreviateNumber(totalValueUsd)} total value`,
      ``,
    ];

    if (totalPages > 1) {
      message.push(`📄 **Page ${page + 1} of ${totalPages}**`);
      message.push(``);
    }

    // Add wallet details
    currentPageWallets.forEach((wallet, index) => {
      const walletNumber = startIndex + index + 1;
      const typeEmoji =
        wallet.type === "buyer" ? "👝" : wallet.type === "dev" ? "👨‍💻" : "💰";
      const typeLabel =
        wallet.type === "buyer"
          ? "Buyer"
          : wallet.type === "dev"
            ? "Dev"
            : "Funding";
      const tokenAmount = (wallet.balance / 1e6).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      });

      message.push(`${typeEmoji} **${typeLabel} Wallet #${walletNumber}**`);
      message.push(`**Address:** \`${wallet.shortAddress}\``);
      message.push(`**Tokens:** ${tokenAmount}`);
      message.push(`**Value:** $${wallet.tokenPrice.toFixed(4)}`);
      message.push(`**SOL:** ${wallet.solBalance.toFixed(4)}`);
      message.push(``);
    });

    // Create keyboard
    const keyboard = new InlineKeyboard();

    // Add individual sell buttons for current page wallets
    currentPageWallets.forEach((wallet, index) => {
      const walletNumber = startIndex + index + 1;
      const typeEmoji =
        wallet.type === "buyer" ? "👝" : wallet.type === "dev" ? "👨‍💻" : "💰";
      keyboard
        .text(
          `🔴 Sell ${typeEmoji} #${walletNumber}`,
          compressCallbackData(
            CallBackQueries.SELL_WALLET_TOKEN,
            `${tokenAddress}_${wallet.pubkey}_${wallet.type}`
          )
        )
        .row();
    });

    // Add pagination buttons if needed
    if (totalPages > 1) {
      if (page > 0) {
        keyboard.text(
          "⬅️ Previous",
          compressCallbackData(
            CallBackQueries.VIEW_TOKEN_WALLETS,
            `${tokenAddress}_${page - 1}`
          )
        );
      }
      if (page < totalPages - 1) {
        keyboard.text(
          "➡️ Next",
          compressCallbackData(
            CallBackQueries.VIEW_TOKEN_WALLETS,
            `${tokenAddress}_${page + 1}`
          )
        );
      }
      keyboard.row();
    }

    // Add back button
    keyboard.text("🔙 Back to Monitor", `remonitor_data_${tokenAddress}`);

    await sendMessage(ctx, message.join("\n"), {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  } catch (error) {
    logger.error("Error in handleViewTokenWallets:", error);
    await sendMessage(
      ctx,
      "❌ Error fetching wallet data. Please try again later."
    );
  }
};
