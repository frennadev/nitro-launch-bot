import { type Conversation } from "@grammyjs/conversations";
import { type Context } from "grammy";
import { InlineKeyboard } from "grammy";
import {
  getUser,
  getDefaultDevWallet,
  generateReferralLink,
  getAllTradingWallets,
} from "../../backend/functions";
import {
  getTokenBalance,
  getTokenInfo,
  getCurrentSolPrice,
} from "../../backend/utils";
import { sendMessage } from "../../backend/sender";
import { logger } from "../../blockchain/common/logger";
import { CallBackQueries } from "../types";
import {
  decompressCallbackData,
  formatUSD,
  safeAnswerCallbackQuery,
  isCompressedCallbackData,
} from "../utils";

export const ctoMonitorConversation = async (
  conversation: Conversation<Context>,
  ctx: Context,
  tokenAddress?: string
): Promise<void> => {
  // Get user ID from context
  const userId = ctx?.chat!.id.toString();
  const user = await getUser(userId);
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    return conversation.halt();
  }

  await safeAnswerCallbackQuery(ctx, "💰 Loading");

  let finalTokenAddress: string;

  if (tokenAddress) {
    finalTokenAddress = tokenAddress;
  } else {
    const data = ctx.callbackQuery?.data;

    if (!data) {
      await sendMessage(ctx, "❌ Invalid callback data.");
      return conversation.halt();
    }

    if (isCompressedCallbackData(data)) {
      const decompressed = decompressCallbackData(data);
      if (!decompressed) {
        await sendMessage(ctx, "❌ Invalid callback data.");
        return conversation.halt();
      }
      finalTokenAddress = decompressed.tokenAddress;
    } else {
      // Handle legacy uncompressed format
      finalTokenAddress = data.split("_").pop() || "";
    }
  }

  if (!finalTokenAddress) {
    await sendMessage(ctx, "❌ Invalid token address.");
    return conversation.halt();
  }

  try {
    const buyerWallets = await getAllTradingWallets(user.id);
    const devWallet = await getDefaultDevWallet(String(user.id));
    const devWalletAddress = devWallet;

    // Get dev wallet token balance for this token
    let devWalletTokenBalance = 0;
    try {
      devWalletTokenBalance = await getTokenBalance(
        finalTokenAddress,
        devWalletAddress
      );
    } catch (error) {
      logger.warn(`Failed to get dev wallet token balance: ${error}`);
    }

    // Add dev wallet to buyer wallets if it has tokens
    if (devWalletTokenBalance > 0) {
      buyerWallets.push({
        id: `dev-${user.id}`,
        publicKey: devWalletAddress,
        privateKey: "",
        createdAt: new Date(),
      });
    }

    logger.info(
      `Buyer wallets: ${JSON.stringify(buyerWallets, null, 2)}, for user ${user.id}`
    );

    const tokenInfo = await getTokenInfo(finalTokenAddress);
    if (!tokenInfo) {
      await sendMessage(ctx, "❌ Token not found.");
      return conversation.halt();
    }

    if (buyerWallets.length === 0) {
      await sendMessage(
        ctx,
        "❌ No buyer wallets found. Please add a buyer wallet first."
      );
      return conversation.halt();
    }

    // Calculate total snipes (buys) made by user's buyer wallets for this token
    const { TransactionRecordModel } = await import("../../backend/models");

    const walletDetails = await Promise.all(
      buyerWallets.map(async (wallet) => {
        const transactions = await TransactionRecordModel.find({
          tokenAddress: finalTokenAddress,
          walletPublicKey: wallet.publicKey,
        });

        // Get current token balance for this wallet
        let currentTokenBalance = 0;
        try {
          currentTokenBalance = await getTokenBalance(
            finalTokenAddress,
            wallet.publicKey
          );
        } catch (error) {
          logger.warn(
            `Failed to get token balance for wallet ${wallet.publicKey}:`,
            error
          );
        }

        // Group transactions by type
        const groupedTransactions = {
          externalBuys: transactions.filter(
            (tx) => tx.transactionType === "external_buy"
          ),
          externalSells: transactions.filter(
            (tx) => tx.transactionType === "external_sell"
          ),
        };

        // Calculate totals for each category
        const summary = {
          externalBuys: {
            count: groupedTransactions.externalBuys.length,
            totalAmount: groupedTransactions.externalBuys.reduce(
              (sum, tx) => sum + (tx.amountSol || 0),
              0
            ),
            totalValue: groupedTransactions.externalBuys.reduce(
              (sum, tx) => sum + (tx.amountSol || 0),
              0
            ),
          },
          externalSells: {
            count: groupedTransactions.externalSells.length,
            totalAmount: groupedTransactions.externalSells.reduce(
              (sum, tx) => sum + (tx.amountSol || 0),
              0
            ),
            totalValue: groupedTransactions.externalSells.reduce(
              (sum, tx) => sum + (tx.amountSol || 0),
              0
            ),
          },
        };

        return {
          address: wallet.publicKey,
          currentTokenBalance,
          transactions: groupedTransactions,
          summary,
          totalTransactions: transactions.length,
        };
      })
    );

    // Calculate total initial (all buy transactions) and payout (all sell transactions)
    const initial = walletDetails.reduce((total, wallet) => {
      return total + wallet.summary.externalBuys.totalAmount;
    }, 0);

    const payout = walletDetails.reduce((total, wallet) => {
      return total + wallet.summary.externalSells.totalAmount;
    }, 0);

    // Calculate total supply (sum of all current token balances across wallets)
    const totalSupply =
      walletDetails.reduce((total, wallet) => {
        return total + wallet.currentTokenBalance;
      }, 0) / Math.pow(10, tokenInfo.baseToken.decimals);

    // Calculate percentage of total token supply held
    let supplyPercentage = 0;
    let supplyPercentageText = "0.0000%";

    if (tokenInfo.birdeye?.totalSupply && totalSupply > 0) {
      // Convert supply to number (it might be a string)
      const totalTokenSupply =
        typeof tokenInfo.birdeye.totalSupply === "string"
          ? parseFloat(tokenInfo.birdeye.totalSupply)
          : tokenInfo.birdeye.totalSupply;

      // Calculate percentage held
      console.log(
        `Total supply: ${totalSupply}, Total token supply: ${totalTokenSupply}`
      );
      supplyPercentage = (totalSupply / totalTokenSupply) * 100;
      supplyPercentageText = `${supplyPercentage.toFixed(4)}%`;

      logger.info(
        `[TokenTrades] Supply calculation: ${totalSupply} / ${totalTokenSupply} = ${supplyPercentageText}`
      );
    }

    // Calculate current worth of all tokens in SOL
    const solPrice = await getCurrentSolPrice();
    const currentPrice = tokenInfo.priceUsd || 0;
    let totalCurrentWorthSol = 0;

    if (currentPrice && solPrice) {
      const priceInSol = currentPrice / solPrice;
      totalCurrentWorthSol = totalSupply * priceInSol;

      logger.info(
        `[TokenTrades] Total tokens: ${totalSupply}, Price in SOL: ${priceInSol}, Worth: ${totalCurrentWorthSol} SOL`
      );
    } else {
      logger.warn(
        `[TokenTrades] Unable to calculate worth - currentPrice: ${currentPrice}, solPrice: ${solPrice}`
      );
    }

    // Calculate PnL based on initial investment and current worth
    const totalPnL = totalCurrentWorthSol + payout - initial;
    const pnLPercentage =
      initial > 0 ? ((totalPnL / initial) * 100).toFixed(2) : "0.00";
    const pnLFormatted = `${totalPnL >= 0 ? "+" : ""}${totalPnL.toFixed(3)} SOL (${pnLPercentage}%)`;

    const marketCap = formatUSD(tokenInfo.marketCap);
    const price = tokenInfo.priceUsd;
    const botUsername = (ctx.me as any)?.username || "unknown";
    const referralLink = await generateReferralLink(user.id, botUsername);

    // Calculate token age
    let tokenAge = "Unknown";
    try {
      const { TransactionRecordModel } = await import("../../backend/models");
      const creationTransaction = await TransactionRecordModel.findOne({
        tokenAddress: finalTokenAddress,
        transactionType: "token_creation",
      });
      console.log(`Creation transaction: ${creationTransaction}`);

      if (creationTransaction) {
        const createdAt = creationTransaction.createdAt;
        const now = new Date();
        const diffMs = now.getTime() - createdAt.getTime();

        // Convert to human readable format
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor(
          (diffMs % (1000 * 60 * 60)) / (1000 * 60)
        );

        if (diffHours > 0) {
          tokenAge = `${diffHours}h ${diffMinutes}m`;
        } else {
          tokenAge = `${diffMinutes}m`;
        }

        logger.info(
          `[TokenAge] Token ${finalTokenAddress} age calculated: ${tokenAge}`
        );
      } else {
        // Fallback: check token's blockchain creation time if available
        if (tokenInfo.createdAt) {
          const createdAt = new Date(tokenInfo.createdAt);
          const now = new Date();
          const diffMs = now.getTime() - createdAt.getTime();

          const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
          const diffMinutes = Math.floor(
            (diffMs % (1000 * 60 * 60)) / (1000 * 60)
          );

          if (diffHours > 0) {
            tokenAge = `${diffHours}h ${diffMinutes}m`;
          } else {
            tokenAge = `${diffMinutes}m`;
          }
        }
      }
    } catch (error) {
      logger.warn(
        `Error calculating token age for ${finalTokenAddress}:`,
        error
      );
      tokenAge = "Unknown";
    }

    const message = await sendMessage(
      ctx,
      `
🎯 <b>${tokenInfo.baseToken.symbol}</b> 🔗 <a href="${referralLink}">📢 Share & Earn</a> • ⏰ <code>${tokenAge}</code>

📊 <b>Position Overview</b>
┌─ 💰 Initial Investment: <code>${initial.toFixed(3)} SOL</code>
├─ 💸 Total Sold: <code>${payout.toFixed(3)} SOL</code>
├─ 🪙 Token Holdings: <code>${supplyPercentageText}</code>
├─ 💎 Current Worth: <code>${totalCurrentWorthSol.toFixed(3)} SOL</code>
└─ 📈 Total P&L: <b>${pnLFormatted}</b>

💹 <b>Market Information</b>
├─ 💵 Current Price: <code>$${Number(price).toFixed(5)}</code>
└─ 🏦 Market Cap: <code>${marketCap}</code>

🕐 Last Update: <code>${new Date().toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })}</code>
💡 <i>Click refresh to resume live monitoring</i>
      `,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("🔄 Refresh", `remonitor_data_${finalTokenAddress}`)
          .url(
            "📊 Chart",
            `https://dexscreener.com/solana/${finalTokenAddress}`
          )
          .row()
          .text("💸 25%", `sell_ca_25_${finalTokenAddress}`)
          .text("💸 50%", `sell_ca_50_${finalTokenAddress}`)
          .text("💸 75%", `sell_ca_75_${finalTokenAddress}`)
          .text("💸 100%", `sell_ca_100_${finalTokenAddress}`)
          .row()
          .url("🔗 Contract", `https://solscan.io/token/${finalTokenAddress}`)
          .text("🏠 Menu", CallBackQueries.BACK),
      }
    );

    await ctx.api.pinChatMessage(userId, message.message_id);

    // Wait for user interactions
    while (true) {
      const response = await conversation.waitFor("callback_query:data");
      const data = response.callbackQuery?.data;

      // Handle refresh
      if (data === `remonitor_data_${finalTokenAddress}`) {
        await response.answerCallbackQuery("🔄 Refreshing...");
        // Restart the monitor conversation to refresh data
        return await ctoMonitorConversation(
          conversation,
          response,
          finalTokenAddress
        );
      }

      // Handle sell buttons - let global handlers take over
      if (data?.startsWith("sell_ca_")) {
        return conversation.halt();
      }

      // Handle CTO
      if (data === `${CallBackQueries.CTO}_${finalTokenAddress}`) {
        return conversation.halt();
      }

      // Handle back/menu
      if (data === CallBackQueries.BACK) {
        await response.answerCallbackQuery();
        return conversation.halt();
      }

      // Unknown callback
      await response.answerCallbackQuery();
    }
  } catch (error) {
    logger.error("Error fetching trade history:", error);
    await sendMessage(
      ctx,
      "❌ Error fetching trade history. Please try again later."
    );
    return conversation.halt();
  }
};
