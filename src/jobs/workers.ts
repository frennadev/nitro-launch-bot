import { Worker } from "bullmq";
import {
  tokenLaunchQueue,
  devSellQueue,
  walletSellQueue,
  prepareLaunchQueue,
  executeLaunchQueue,
  createTokenMetadataQueue,
  launchDappTokenQueue,
} from "./queues";
import type {
  LaunchTokenJob,
  PrepareTokenLaunchJob,
  ExecuteTokenLaunchJob,
  SellDevJob,
  SellWalletJob,
  CreateTokenMetadataJob,
  LaunchDappTokenJob,
} from "./types";
import { redisClient } from "./db";
import {
  releaseDevSellLock,
  releaseWalletSellLock,
  updateTokenState,
  handleTokenLaunchFailure,
  enqueueExecuteTokenLaunch,
  getTransactionStats,
  getAccurateSpendingStats,
  getWalletBalance,
} from "../backend/functions-main";
import { TokenState } from "../backend/types";
import {
  sendLaunchFailureNotification,
  sendLaunchSuccessNotification,
  sendNotification,
} from "../bot/message";
import bot from "../bot";
import {
  executeTokenLaunch,
  prepareTokenLaunch,
} from "../blockchain/pumpfun/launch";
// Sell functions available but not used in launchTokenFromDappWorker
// import { executeDevSell, executeWalletSell } from "../blockchain/pumpfun/sell";
import { logger } from "./logger";
import {
  updateLoadingState,
  completeLoadingState,
  failLoadingState,
  startMixerHeartbeat,
} from "../bot/loading";
import { Keypair } from "@solana/web3.js";
import { connection } from "../service/config";
import { createToken } from "../backend/functions";
import { createBonkToken } from "../blockchain/letsbonk/integrated-token-creator";
import axios from "axios";
import { UserModel, WalletModel } from "../backend/models";
import { safeObjectId } from "../backend/utils";
import { env } from "../config";
// import { LaunchDestination } from "../backend/types"; // Available but not used in current implementation

export const launchTokenWorker = new Worker<LaunchTokenJob>(
  tokenLaunchQueue.name,
  async (job) => {
    const data = job.data;
    const loadingKey = `super-${data.userChatId}-token_launch-${data.tokenAddress}`;

    try {
      logger.info("[jobs]: Token Launch Job starting...");
      logger.info("[jobs-launch-token]: Job Data", data);

      // Update loading state - Phase 0: Validating parameters
      await updateLoadingState(loadingKey, 0);

      // Update loading state - Phase 1: Checking balances
      await updateLoadingState(loadingKey, 1);

      // Update loading state - Phase 2: Creating token
      await updateLoadingState(loadingKey, 2);

      await executeTokenLaunch(
        data.tokenPrivateKey,
        data.funderWallet,
        data.devWallet,
        data.buyerWallets,
        data.buyDistribution,
        data.tokenName,
        data.tokenSymbol,
        data.tokenMetadataUri,
        data.buyAmount,
        data.devBuy,
        data.launchStage,
        data.mode || "normal"
      );

      // Update loading state - Phase 5: Finalizing
      await updateLoadingState(loadingKey, 5);

      await updateTokenState(
        data.tokenAddress,
        TokenState.LAUNCHED,
        data.userId
      );

      // Pump addresses are never released - they remain permanently allocated to the user
      logger.info(
        `Pump address ${data.tokenAddress} remains permanently allocated to user ${data.userId}`
      );

      // Complete loading state
      await completeLoadingState(
        loadingKey,
        undefined,
        `<b>Token:</b> ${data.tokenName} ($${data.tokenSymbol})\n<b>Address:</b> <code>${data.tokenAddress}</code>`
      );

      console.log("[DEBUG] About to call sendLaunchSuccessNotification with:", {
        userChatId: data.userChatId,
        tokenAddress: data.tokenAddress,
        tokenName: data.tokenName,
        tokenSymbol: data.tokenSymbol,
        types: {
          userChatId: typeof data.userChatId,
          tokenAddress: typeof data.tokenAddress,
          tokenName: typeof data.tokenName,
          tokenSymbol: typeof data.tokenSymbol,
        },
      });

      await sendLaunchSuccessNotification(
        data.userChatId,
        data.tokenAddress,
        data.tokenName,
        data.tokenSymbol
      );

      // After Bonk dev buy/launch, wait 2 seconds before sniping (PumpFun-style best practice)
      const { TokenModel } = await import("../backend/models");
      const tokenRecord = await TokenModel.findOne({
        tokenAddress: data.tokenAddress,
      });
      if (tokenRecord?.launchData?.destination === "letsbonk") {
        logger.info(
          "[jobs]: Waiting 2 seconds after Bonk dev buy/launch before starting pool polling/snipes..."
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error: any) {
      logger.error(
        "[jobs-launch-token]: Error Occurred while launching token",
        error
      );

      // Fail loading state
      await failLoadingState(loadingKey, error.message);

      throw error;
    }
  },
  {
    connection: redisClient,
    concurrency: 10,
    removeOnFail: {
      count: 20,
    },
    removeOnComplete: {
      count: 10,
    },
    // Set lock duration to 5 minutes (300 seconds) for launch operations
    lockDuration: 5 * 60 * 1000, // 5 minutes in milliseconds
    lockRenewTime: 30 * 1000, // Renew lock every 30 seconds
  }
);

export const sellDevWorker = new Worker<SellDevJob>(
  devSellQueue.name,
  async (job) => {
    const data = job.data;
    const loadingKey = `super-${data.userChatId}-dev_sell-${data.tokenAddress}`;

    try {
      logger.info("[jobs]: Sell Dev Job starting...");
      logger.info("[jobs-sell-dev]: Job Data", data);

      // Update loading state - Phase 0: Validating parameters
      await updateLoadingState(loadingKey, 0);

      // Update loading state - Phase 1: Calculating amounts
      await updateLoadingState(loadingKey, 1);

      // Update loading state - Phase 2: Executing transaction
      await updateLoadingState(loadingKey, 2);

      // Check token type to determine which sell mechanism to use
      const { TokenModel } = await import("../backend/models");
      const token = await TokenModel.findOne({
        tokenAddress: data.tokenAddress,
      });

      let result;
      if (token?.launchData?.destination === "letsbonk") {
        // Bonk token - use Bonk sell mechanism
        logger.info(
          `[jobs-sell-dev]: Using Bonk sell mechanism for token ${data.tokenAddress}`
        );
        const { executeBonkSell } = await import(
          "../service/bonk-transaction-handler"
        );
        result = await executeBonkSell(
          data.sellPercent,
          data.devWallet,
          data.tokenAddress
        );
        // Record the transaction with actual SOL received
        const { recordTransactionWithActualAmounts } = await import(
          "../backend/utils"
        );
        const { Keypair } = await import("@solana/web3.js");
        const bs58 = await import("bs58");
        const devWalletPubkey = Keypair.fromSecretKey(
          bs58.default.decode(data.devWallet)
        ).publicKey.toBase58();
        // Type guard for Bonk sell result
        function isBonkSellResult(obj: any): obj is {
          success: boolean;
          signature: string;
          actualSolReceived: number;
        } {
          return (
            obj &&
            typeof obj.success === "boolean" &&
            typeof obj.signature === "string" &&
            "actualSolReceived" in obj
          );
        }

        if (isBonkSellResult(result) && result.success && result.signature) {
          await recordTransactionWithActualAmounts(
            data.tokenAddress,
            devWalletPubkey,
            "dev_sell",
            result.signature,
            true,
            0,
            {
              amountSol: result.actualSolReceived,
              amountTokens: undefined,
              sellPercent: data.sellPercent,
            },
            false // Don't parse again, already have actual amount
          );
        }
      } else {
        // PumpFun token - use PumpFun sell mechanism
        logger.info(
          `[jobs-sell-dev]: Using PumpFun sell mechanism for token ${data.tokenAddress}`
        );
        const { executeDevSell } = await import("../blockchain/pumpfun/sell");
        result = await executeDevSell(
          data.tokenAddress,
          data.devWallet,
          data.sellPercent
        );
      }

      // Update loading state - Phase 3: Confirming
      await updateLoadingState(loadingKey, 3);

      await releaseDevSellLock(data.tokenAddress);

      // Get transaction stats and financial data for detailed reporting
      const transactionStats = await getTransactionStats(data.tokenAddress);
      const financialStats = await getAccurateSpendingStats(data.tokenAddress);

      // Calculate sell-specific statistics
      const devSellTransactions = transactionStats.byType.dev_sell.filter(
        (t: any) => t.success
      );
      const latestDevSell = devSellTransactions[devSellTransactions.length - 1];

      const sellSummary = {
        solReceived: latestDevSell?.amountSol || 0,
        tokensSold: latestDevSell?.amountTokens || "0",
        sellPercent: data.sellPercent,
        signature: result.signature,
        totalDevEarned: financialStats.totalDevEarned,
        totalEarned: financialStats.totalEarned,
        netProfitLoss: financialStats.netProfitLoss,
        profitLossPercentage: financialStats.profitLossPercentage,
        isProfit: financialStats.isProfit,
      };

      // Format tokens sold for display (convert from raw to human readable)
      const tokensSoldFormatted = (
        Number(sellSummary.tokensSold) / 1e6
      ).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      });

      // Complete loading state with detailed information
      await completeLoadingState(
        loadingKey,
        undefined,
        `<b>💸 Dev Sell Complete</b>\n\n` +
          `🎯 <b>Sell Details:</b>\n` +
          `   • <b>Percentage:</b> ${data.sellPercent}%\n` +
          `   • <b>Tokens Sold:</b> ${tokensSoldFormatted} tokens\n` +
          `   • <b>SOL Received:</b> ${sellSummary.solReceived.toFixed(6)} SOL\n\n` +
          `📊 <b>Overall Performance:</b>\n` +
          `   • <b>Total P&L:</b> ${sellSummary.isProfit ? "🟢" : "🔴"} ${sellSummary.netProfitLoss >= 0 ? "+" : ""}${sellSummary.netProfitLoss.toFixed(6)} SOL\n` +
          `   • <b>Return:</b> ${sellSummary.profitLossPercentage >= 0 ? "📈" : "📉"} ${sellSummary.profitLossPercentage >= 0 ? "+" : ""}${sellSummary.profitLossPercentage.toFixed(1)}%\n\n` +
          `🔗 <b><a href="https://solscan.io/tx/${result.signature}">View Transaction</a></b>`
      );

      // Send detailed notification with enhanced formatting
      await sendNotification(
        bot,
        data.userChatId,
        `🎉 <b>Dev Sell Completed Successfully!</b>\n\n` +
          `🎯 <b>Sale Details:</b>\n` +
          `   • <b>Percentage:</b> ${data.sellPercent}%\n` +
          `   • <b>Tokens Sold:</b> ${tokensSoldFormatted} tokens\n` +
          `   • <b>SOL Received:</b> ${sellSummary.solReceived.toFixed(6)} SOL\n\n` +
          `📊 <b>Overall Performance:</b>\n` +
          `   • <b>Total P&L:</b> ${sellSummary.isProfit ? "🟢" : "🔴"} ${sellSummary.netProfitLoss >= 0 ? "+" : "-"}${Math.abs(sellSummary.netProfitLoss).toFixed(6)} SOL\n` +
          `   • <b>Return:</b> ${sellSummary.profitLossPercentage >= 0 ? "📈" : "📉"} ${sellSummary.profitLossPercentage >= 0 ? "+" : ""}${Math.abs(sellSummary.profitLossPercentage).toFixed(1)}%\n\n` +
          `🔗 <b><a href="https://solscan.io/tx/${result.signature}">View Transaction</a></b>`
      );
    } catch (error: any) {
      logger.error(
        "[jobs-sell-dev]: Error Occurred while selling dev supply",
        error
      );

      // Fail loading state
      await failLoadingState(loadingKey, error.message);

      throw error;
    }
  },
  {
    connection: redisClient,
    concurrency: 10,
    removeOnComplete: {
      count: 10,
    },
    removeOnFail: {
      count: 20,
    },
  }
);

export const sellWalletWorker = new Worker<SellWalletJob>(
  walletSellQueue.name,
  async (job) => {
    const data = job.data;
    const loadingKey = `super-${data.userChatId}-wallet_sell-${data.tokenAddress}`;
    const logIdentifier = `super-jobs-sell-wallet-${data.tokenAddress}`;

    try {
      logger.info("[jobs]: Wallet Sell Job starting...");
      logger.info("[jobs-sell-wallet]: Job Data", data);

      // Update loading state - Phase 0: Validating holdings
      await updateLoadingState(loadingKey, 0);

      // Update loading state - Phase 1: Calculating amounts
      await updateLoadingState(loadingKey, 1);

      // Update loading state - Phase 2: Executing transactions
      await updateLoadingState(loadingKey, 2);

      // Check token type to determine which sell mechanism to use
      const { TokenModel } = await import("../backend/models");
      const token = await TokenModel.findOne({
        tokenAddress: data.tokenAddress,
      });

      let results;
      if (token?.launchData?.destination === "letsbonk") {
        // Bonk token - use Bonk sell mechanism for each wallet
        logger.info(
          `[jobs-sell-wallet]: Using Bonk sell mechanism for token ${data.tokenAddress}`
        );
        const { executeBonkSell } = await import(
          "../service/bonk-transaction-handler"
        );
        const { recordTransactionWithActualAmounts } = await import(
          "../backend/utils"
        );
        const { Keypair } = await import("@solana/web3.js");
        const bs58 = await import("bs58");

        // Execute Bonk sells for each wallet
        const sellPromises = data.buyerWallets.map(
          async (walletPrivateKey: string) => {
            try {
              const result = await executeBonkSell(
                data.sellPercent,
                walletPrivateKey,
                data.tokenAddress
              );
              // Record the transaction with actual SOL received
              let walletPubkey = "unknown";
              try {
                walletPubkey = Keypair.fromSecretKey(
                  bs58.default.decode(walletPrivateKey)
                ).publicKey.toBase58();
              } catch {}
              if (result && result.success && result.signature) {
                await recordTransactionWithActualAmounts(
                  data.tokenAddress,
                  walletPubkey,
                  "wallet_sell",
                  result.signature,
                  true,
                  0,
                  {
                    amountSol: result.actualSolReceived,
                    amountTokens: undefined,
                    sellPercent: data.sellPercent,
                  },
                  false // Don't parse again, already have actual amount
                );
              }
              return {
                success: result.success,
                signature: result.signature,
                error: result.error,
                expectedSolOut: result.actualSolReceived || 0,
              };
            } catch (error: any) {
              return {
                success: false,
                error: error.message,
                expectedSolOut: 0,
              };
            }
          }
        );

        results = await Promise.all(sellPromises);
      } else {
        // PumpFun token - use PumpFun sell mechanism
        logger.info(
          `[jobs-sell-wallet]: Using PumpFun sell mechanism for token ${data.tokenAddress}`
        );
        const { executeWalletSell } = await import(
          "../blockchain/pumpfun/sell"
        );
        results = await executeWalletSell(
          data.tokenAddress,
          data.buyerWallets,
          data.devWallet,
          data.sellPercent
        );
      }

      // Update loading state - Phase 3: Confirming
      await updateLoadingState(loadingKey, 3);

      await releaseWalletSellLock(data.tokenAddress);

      // Calculate immediate sell statistics
      const successfulSells = results.filter((r) => r.success);
      const failedSells = results.filter((r) => !r.success);
      const immediateSuccessRate = Math.round(
        (successfulSells.length / results.length) * 100
      );

      // Send immediate success notification with basic info
      const initialMessage =
        `🎉 <b>Wallet Sells Completed Successfully!</b>\n\n` +
        `✅ <b>Success Rate:</b> ${successfulSells.length}/${results.length} wallets (${immediateSuccessRate}%)\n` +
        `💰 <b>Total Received:</b> Calculating...\n` +
        `🪙 <b>Tokens Sold:</b> Calculating...\n` +
        `📊 <b>Overall P&L:</b> Calculating...\n\n` +
        `${failedSells.length > 0 ? `⚠️ ${failedSells.length} wallet(s) failed to sell\n\n` : ""}` +
        `⏳ <b>Fetching detailed transaction data...</b>`;

      const initialNotification = await bot.api.sendMessage(
        data.userChatId,
        initialMessage,
        {
          parse_mode: "HTML",
        }
      );

      // Wait for transaction confirmation and parsing (3-5 seconds)
      logger.info(
        `[${logIdentifier}] Waiting 4 seconds for transaction parsing to complete...`
      );
      await new Promise((resolve) => setTimeout(resolve, 4000));

      // Now get accurate transaction stats and financial data
      const transactionStats = await getTransactionStats(data.tokenAddress);
      const financialStats = await getAccurateSpendingStats(data.tokenAddress);

      // Calculate wallet sell-specific statistics
      const walletSellTransactions = transactionStats.byType.wallet_sell.filter(
        (t: any) => t.success
      );

      // Calculate totals from this sell batch
      const totalSolReceived = successfulSells.reduce(
        (sum, r) => sum + (r.expectedSolOut || 0),
        0
      );
      const totalTokensSold = walletSellTransactions
        .slice(-successfulSells.length) // Get the most recent transactions
        .reduce((sum, t) => sum + BigInt(t.amountTokens || "0"), BigInt(0));

      const sellSummary = {
        successfulWallets: successfulSells.length,
        failedWallets: failedSells.length,
        totalWallets: results.length,
        solReceived: totalSolReceived,
        tokensSold: totalTokensSold.toString(),
        sellPercent: data.sellPercent,
        totalWalletEarned: financialStats.totalWalletEarned,
        totalEarned: financialStats.totalEarned,
        netProfitLoss: financialStats.netProfitLoss,
        profitLossPercentage: financialStats.profitLossPercentage,
        isProfit: financialStats.isProfit,
        successRate: Math.round(
          (successfulSells.length / results.length) * 100
        ),
      };

      // Format tokens sold for display
      const tokensSoldFormatted = (
        Number(sellSummary.tokensSold) / 1e6
      ).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      });

      // Update the initial notification with accurate data
      const finalMessage =
        `🎉 <b>Wallet Sells Completed Successfully!</b>\n\n` +
        `✅ <b>Success Rate:</b> ${sellSummary.successfulWallets}/${sellSummary.totalWallets} wallets (${sellSummary.successRate}%)\n` +
        `💰 <b>Total Received:</b> ${sellSummary.solReceived.toFixed(6)} SOL\n` +
        `🪙 <b>Tokens Sold:</b> ${tokensSoldFormatted} tokens (${data.sellPercent}%)\n\n` +
        `📊 <b>Overall Performance:</b>\n` +
        `   • <b>Total P&L:</b> ${sellSummary.isProfit ? "🟢" : "🔴"} ${sellSummary.netProfitLoss >= 0 ? "+" : ""}${sellSummary.netProfitLoss.toFixed(6)} SOL\n` +
        `   • <b>Return:</b> ${sellSummary.profitLossPercentage >= 0 ? "📈" : "📉"} ${sellSummary.profitLossPercentage >= 0 ? "+" : ""}${sellSummary.profitLossPercentage.toFixed(1)}%\n\n` +
        `${sellSummary.failedWallets > 0 ? `⚠️ <i>${sellSummary.failedWallets} wallet(s) failed to sell</i>\n\n` : ""}` +
        `💡 <i>View individual transactions in your token list for more details.</i>`;

      try {
        await bot.api.editMessageText(
          data.userChatId,
          initialNotification.message_id,
          finalMessage,
          {
            parse_mode: "HTML",
          }
        );
        logger.info(
          `[${logIdentifier}] Updated notification with accurate transaction data`
        );
      } catch (error) {
        logger.warn(
          `[${logIdentifier}] Failed to edit notification, sending new message:`,
          error
        );
        // Fallback: send new message if editing fails
        await sendNotification(bot, data.userChatId, finalMessage);
      }

      // Complete the loading state without additional message
      await completeLoadingState(loadingKey, undefined, "");
    } catch (error: any) {
      logger.error(
        "[jobs-sell-wallet]: Error Occurred while selling wallet supply",
        error
      );

      // Fail loading state
      await failLoadingState(loadingKey, error.message);

      throw error;
    }
  },
  {
    connection: redisClient,
    concurrency: 10,
    removeOnComplete: {
      count: 10,
    },
    removeOnFail: {
      count: 20,
    },
  }
);

export const prepareLaunchWorker = new Worker<PrepareTokenLaunchJob>(
  prepareLaunchQueue.name,
  async (job) => {
    const data = job.data;
    const loadingKey = `super-${data.userChatId}-prepare_launch-${data.tokenAddress}`;

    try {
      logger.info("[jobs]: Prepare Launch Job starting...");
      logger.info("[jobs-prepare-launch]: Job Data", data);

      // Update loading state - Phase 0: Validating parameters
      await updateLoadingState(loadingKey, 0);

      // Update loading state - Phase 1: Collecting platform fee
      await updateLoadingState(loadingKey, 1);
      let heartbeatInterval: NodeJS.Timeout | null = null;

      if (data.mode === "normal") {
        // Update loading state - Phase 2: Initializing mixer
        await updateLoadingState(loadingKey, 2);

        // Start heartbeat for long mixing operations (with safety wrapper)

        try {
          heartbeatInterval = startMixerHeartbeat(loadingKey, 15);
        } catch (heartbeatError) {
          // If heartbeat fails to start, log but continue with operation
          logger.warn(
            "Failed to start mixer heartbeat, continuing without it:",
            heartbeatError
          );
        }
      }

      try {
        await prepareTokenLaunch(
          data.tokenPrivateKey,
          data.funderWallet,
          data.devWallet,
          data.buyerWallets,
          data.tokenName,
          data.tokenSymbol,
          data.buyAmount,
          data.devBuy,
          loadingKey, // Pass loading key for progress tracking
          data.mode
        );
      } finally {
        // Safely clear heartbeat interval
        if (heartbeatInterval) {
          try {
            clearInterval(heartbeatInterval);
          } catch (clearError) {
            logger.warn("Failed to clear heartbeat interval:", clearError);
          }
        }
      }

      // Complete preparation loading state
      await completeLoadingState(
        loadingKey,
        undefined,
        `🎉 <b>Preparation Complete!</b>\n\n` +
          `🪙 <b>Token:</b> ${data.tokenName} ($${data.tokenSymbol})\n` +
          `✅ <b>Status:</b> Ready for launch\n` +
          `🚀 <b>Next:</b> Execution phase starting...`
      );

      // Automatically enqueue the execution phase
      const executeResult = await enqueueExecuteTokenLaunch(
        data.userId,
        data.userChatId,
        data.tokenAddress,
        data.mode
      );

      if (!executeResult.success) {
        throw new Error(
          `Failed to enqueue execution phase: ${executeResult.message}`
        );
      }

      await sendNotification(
        bot,
        data.userChatId,
        `🎉 <b>Preparation Phase Complete!</b> 🎉\n\n` +
          `✨ <b>What's Been Done:</b>\n` +
          `• 🔄 Wallets funded via mixer\n` +
          `• ⚡ All systems ready\n\n` +
          `🚀 <b>Next Phase:</b> Token Launch Execution\n` +
          `⏳ <b>Status:</b> Starting launch sequence...\n\n` +
          `🎯 <b>Your token is about to go live!</b>`
      );
    } catch (error: any) {
      logger.error(
        "[jobs-prepare-launch]: Error Occurred while preparing token launch",
        error
      );

      // Fail loading state
      await failLoadingState(loadingKey, error.message);

      throw error;
    }
  },
  {
    connection: redisClient,
    concurrency: 5,
    removeOnFail: {
      count: 20,
    },
    removeOnComplete: {
      count: 10,
    },
    lockDuration: 3 * 60 * 1000, // 3 minutes for preparation
    lockRenewTime: 30 * 1000,
  }
);

export const createTokenMetadataWorker = new Worker<CreateTokenMetadataJob>(
  createTokenMetadataQueue.name,
  async (job) => {
    const data = job.data;
    // const loadingKey = `super-${data.userWalletAddress}-execute_launch-${data.userId}`;
    const {
      name,
      symbol,
      description,
      imageUrl,
      socials: { website, telegram, twitter } = {},
      userId,
      userWalletAddress,
      platform,
    } = job.data;

    let token;
    try {
      logger.info("[jobs]: create Job starting...");
      logger.info("[jobs-create]: Job Data", data);

      // Build query conditions - only include fundingWallet if userWalletAddress is not empty
      const queryConditions: Array<
        { _id?: string } | { fundingWallet?: import("mongoose").Types.ObjectId }
      > = [{ _id: userId }];

      // Only add fundingWallet condition if userWalletAddress is provided and not empty
      const safeWalletId = safeObjectId(userWalletAddress);
      if (safeWalletId) {
        queryConditions.push({ fundingWallet: safeWalletId });
      }

      const user = await UserModel.findOne({
        $or: queryConditions,
      }).populate("fundingWallet");
      if (!user) {
        throw new Error("User not found");
      }

      const { data: fileData } = await axios.get<ArrayBuffer>(imageUrl, {
        responseType: "arraybuffer",
      });
      if (platform === "pump") {
        token = await createToken(
          user.id,
          name,
          symbol,
          description,
          fileData,
          {
            website: website || "",
            telegram: telegram || "",
            twitter: twitter || "",
          }
        );
      } else {
        token = await createBonkToken(name, symbol, imageUrl, true, user.id, {
          website,
          telegram,
          twitter,
        });
      }

      console.log("Created token metadata:", token);
    } catch (error: any) {
      logger.error(
        "[jobs-create]: Error Occurred while creating token metadata",
        error
      );
      throw error;
    }
  },
  {
    connection: redisClient,
    concurrency: 10,
    removeOnFail: {
      count: 20,
    },
    removeOnComplete: {
      count: 10,
    },
    lockDuration: 3 * 60 * 1000, // 3 minutes for execution
    lockRenewTime: 30 * 1000,
  }
);

export const launchTokenFromDappWorker = new Worker<LaunchDappTokenJob>(
  launchDappTokenQueue.name,
  async (job) => {
    const data = job.data;
    const {
      buyAmount,
      devBuy,
      tokenName,
      launchMode,
      platform,
      tokenId,
      tokenSymbol,
      userId,
    } = job.data;

    let actualTokenAddress: string | undefined;

    try {
      logger.info("[launchDappToken]: Job starting...", data);

      // --------- VALIDATE USER ---------
      const user = await UserModel.findById(safeObjectId(String(userId)));

      if (!user) {
        throw new Error("User not found");
      }
      const userChatId = user?.telegramId;
      console.log(
        "[launchDappToken]: Found user",
        JSON.stringify(user, null, 2)
      );

      // --------- GET TOKEN FROM DATABASE ---------
      const { TokenModel } = await import("../backend/models");
      const tokenDoc = await TokenModel.findById(
        safeObjectId(String(tokenId))
      ).lean();
      if (!tokenDoc) {
        throw new Error(`Token not found with ID: ${tokenId}`);
      }

      console.log("[launchDappToken]: Found token document", tokenDoc);

      // Use the actual token address from the database
      actualTokenAddress = tokenDoc.tokenAddress;
      if (!actualTokenAddress) {
        throw new Error(`Token ${tokenId} does not have a valid token address`);
      }

      logger.info("[launchDappToken]: Found token", {
        tokenId,
        tokenAddress: actualTokenAddress,
        tokenName: tokenDoc.name,
        tokenSymbol: tokenDoc.symbol,
      });

      // -------- GET WALLETS FROM DATABASE BASED ON USERID --------
      // Get funding wallet
      const fundingWalletDoc = await WalletModel.findOne({
        user: user.id,
        isFunding: true,
      }).lean();

      if (!fundingWalletDoc) {
        throw new Error(
          "No funding wallet found. Please configure funding wallet first."
        );
      }

      // Get buyer wallets
      const buyerWalletDocs = await WalletModel.find({
        user: user.id,
        isBuyer: true,
      }).lean();

      if (buyerWalletDocs.length === 0) {
        throw new Error(
          "No buyer wallets found. Please add buyer wallets first."
        );
      }

      // Get dev wallet
      const devWalletDoc = await WalletModel.findOne({
        user: user.id,
        isDev: true,
      }).lean();

      if (!devWalletDoc) {
        throw new Error(
          "No dev wallet found. Please configure dev wallet first."
        );
      }

      // -------- DECRYPT WALLET PRIVATE KEYS --------
      const { safeDecryptPrivateKey } = await import(
        "../backend/wallet-decryption"
      );

      // Decrypt funding wallet
      const fundingDecryptResult = await safeDecryptPrivateKey(
        fundingWalletDoc.privateKey,
        fundingWalletDoc._id.toString()
      );

      if (!fundingDecryptResult.success) {
        throw new Error(
          `Invalid funding wallet data: ${fundingDecryptResult.error}`
        );
      }

      const fundingWallet = {
        publicKey: fundingWalletDoc.publicKey,
        privateKey: fundingDecryptResult.privateKey!,
      };

      // Decrypt dev wallet
      const devDecryptResult = await safeDecryptPrivateKey(
        devWalletDoc.privateKey,
        devWalletDoc._id.toString()
      );

      if (!devDecryptResult.success) {
        throw new Error(`Invalid dev wallet data: ${devDecryptResult.error}`);
      }

      const devWallet = {
        publicKey: devWalletDoc.publicKey,
        privateKey: devDecryptResult.privateKey!,
      }; // -------- VALIDATE LAUNCH PARAMETERS --------
      if (!buyAmount || buyAmount <= 0) {
        throw new Error("Buy amount must be greater than 0");
      }

      if (devBuy < 0) {
        throw new Error("Dev buy amount cannot be negative");
      }

      if (devBuy > buyAmount) {
        throw new Error("Dev buy amount cannot exceed total buy amount");
      }

      // -------- BALANCE CHECKS --------
      const checkBalance = async (publicKey: string): Promise<number> => {
        try {
          return await getWalletBalance(publicKey);
        } catch (error) {
          logger.warn(`Could not get balance for ${publicKey}:`, error);
          return 0;
        }
      };

      const devBalance = await checkBalance(devWallet.publicKey);
      const minDevBalance = (env.LAUNCH_FEE_SOL || 0.01) + 0.1;

      if (devBalance < minDevBalance) {
        throw new Error(
          `Insufficient dev wallet balance. Required: ${minDevBalance.toFixed(4)} SOL, Current: ${devBalance.toFixed(4)} SOL`
        );
      }

      // Check funding wallet balance for normal mode
      if (launchMode === "normal") {
        const fundingBalance = await checkBalance(fundingWallet.publicKey);
        const walletFees = buyerWalletDocs.length * 0.005;
        const requiredFundingAmount = buyAmount + devBuy + walletFees + 0.1;

        if (fundingBalance < requiredFundingAmount) {
          throw new Error(
            `Insufficient funding wallet balance. Required: ${requiredFundingAmount.toFixed(4)} SOL, Available: ${fundingBalance.toFixed(4)} SOL`
          );
        }
      }

      // -------- DETERMINE PLATFORM --------
      const isBonkToken = platform === "bonk";

      logger.info("[launchDappToken]: Starting launch process", {
        tokenAddress: actualTokenAddress,
        platform: platform || "pump",
        launchMode,
        buyAmount,
        devBuy,
        walletCount: buyerWalletDocs.length,
      });

      let result: { success: boolean; error?: string; [key: string]: unknown };

      if (isBonkToken) {
        // -------- BONK TOKEN LAUNCH --------
        logger.info("[launchDappToken]: Executing Bonk token launch");

        try {
          // Import Bonk launch function
          const { launchBonkToken } = await import("../backend/functions");

          // Execute Bonk token launch with mixing and on-chain creation
          const bonkResult = await launchBonkToken(
            user.id,
            actualTokenAddress,
            buyAmount,
            devBuy,
            launchMode
          );

          if (bonkResult.success) {
            result = {
              success: true,
              tokenAddress: actualTokenAddress,
              platform: "bonk",
              signature: bonkResult.signature,
              tokenName: bonkResult.tokenName,
              tokenSymbol: bonkResult.tokenSymbol,
              message: "Bonk token launched successfully on Raydium Launch Lab",
            };

            logger.info(
              "[launchDappToken]: Bonk token launch completed successfully",
              result
            );
          } else {
            result = {
              success: false,
              error: bonkResult.error || "Bonk token launch failed",
            };

            logger.error(
              "[launchDappToken]: Bonk token launch failed",
              bonkResult.error
            );
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error
              ? error.message
              : "Unknown error during Bonk launch";
          result = {
            success: false,
            error: errorMessage,
          };

          logger.error("[launchDappToken]: Bonk token launch error", error);
        }
      } else {
        // -------- PUMPFUN TOKEN LAUNCH (DEFAULT) --------
        logger.info("[launchDappToken]: Executing PumpFun token launch");

        try {
          // Import PumpFun launch preparation function
          const { enqueuePrepareTokenLaunch } = await import(
            "../backend/functions-main"
          );

          // Prepare buyer keys for launch with resilient decryption
          const { safeDecryptWalletBatch } = await import(
            "../backend/wallet-decryption"
          );
          const buyerDecryptResult = await safeDecryptWalletBatch(
            buyerWalletDocs.map((w) => ({
              _id: w._id.toString(),
              privateKey: w.privateKey,
            })),
            "buyer wallet"
          );

          if (!buyerDecryptResult.success) {
            const errorDetails = buyerDecryptResult.errors
              .map((e) => `${e.walletId}: ${e.error}`)
              .join(", ");
            throw new Error(`Failed to decrypt buyer wallets: ${errorDetails}`);
          }

          const buyerKeys = buyerDecryptResult.privateKeys;

          // Execute PumpFun token launch through staging system
          const pumpResult = await enqueuePrepareTokenLaunch(
            user.id,
            userChatId, // Telegram chat ID for notifications
            actualTokenAddress,
            fundingWallet.privateKey,
            devWallet.privateKey,
            buyerKeys,
            devBuy,
            buyAmount,
            launchMode
          );

          if (pumpResult.success) {
            result = {
              success: true,
              tokenAddress: actualTokenAddress,
              platform: "pump",
              walletsUsed: buyerWalletDocs.length,
              message:
                pumpResult.message ||
                "PumpFun token launch submitted to queue successfully",
            };

            logger.info(
              "[launchDappToken]: PumpFun token launch queued successfully",
              result
            );
          } else {
            result = {
              success: false,
              error: "Failed to submit PumpFun token launch",
            };

            logger.error(
              "[launchDappToken]: PumpFun token launch submission failed"
            );
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error
              ? error.message
              : "Unknown error during PumpFun launch";
          result = {
            success: false,
            error: errorMessage,
          };

          logger.error("[launchDappToken]: PumpFun token launch error", error);
        }
      }

      // -------- NOTIFICATIONS --------
      if (userChatId && result.success) {
        try {
          await sendLaunchSuccessNotification(
            userChatId,
            actualTokenAddress,
            tokenName,
            tokenSymbol
          );
        } catch (error) {
          logger.warn(
            "[launchDappToken]: Could not send success notification:",
            error
          );
        }
      }

      logger.info("[launchDappToken]: Job completed successfully", {
        tokenAddress: actualTokenAddress,
        platform: platform || "pump",
        success: result.success,
      });

      return {
        success: true,
        tokenAddress: actualTokenAddress,
        platform: platform || "pump",
        launchMode,
        buyAmount,
        devBuy,
        walletsUsed: buyerWalletDocs.length,
        result,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error("[launchDappToken]: Error occurred during launch", error);

      // Send failure notification if userChatId is available
      if (data.userChatId) {
        try {
          await sendLaunchFailureNotification(
            data.userChatId,
            actualTokenAddress || data.tokenId,
            data.tokenName || "Unknown Token",
            errorMessage
          );
        } catch (notifError) {
          logger.warn(
            "[launchDappToken]: Could not send failure notification:",
            notifError
          );
        }
      }

      throw error;
    }
  },
  {
    connection: redisClient,
    concurrency: 10,
    removeOnFail: {
      count: 20,
    },
    removeOnComplete: {
      count: 10,
    },
    lockDuration: 3 * 60 * 1000, // 3 minutes for execution
    lockRenewTime: 30 * 1000,
  }
);

export const executeLaunchWorker = new Worker<ExecuteTokenLaunchJob>(
  executeLaunchQueue.name,
  async (job) => {
    const data = job.data;
    const loadingKey = `super-${data.userChatId}-execute_launch-${data.tokenAddress}`;

    try {
      logger.info("[jobs]: Execute Launch Job starting...");
      logger.info("[jobs-execute-launch]: Job Data", data);

      // Update loading state - Phase 0: Starting execution
      await updateLoadingState(loadingKey, 0);

      // Update loading state - Phase 1: Creating token
      await updateLoadingState(loadingKey, 1);

      // Update loading state - Phase 2: Executing buys
      await updateLoadingState(loadingKey, 2);

      // Generate buy distribution for sequential buying
      const { generateBuyDistribution } = await import("../backend/functions");
      // Get SOL balance of each buyer wallet
      const bs58 = await import("bs58");

      const buyDistribution =
        data.mode === "normal"
          ? generateBuyDistribution(data.buyAmount, data.buyerWallets.length)
          : await Promise.all(
              data.buyerWallets.map(async (walletPrivateKey: string) => {
                try {
                  const wallet = Keypair.fromSecretKey(
                    bs58.default.decode(walletPrivateKey)
                  );
                  const balance = await connection.getBalance(wallet.publicKey);
                  const balanceInSol = balance / 1e9; // Convert lamports to SOL
                  return Math.max(0, balanceInSol - 0.05); // Leave 0.05 SOL room for fees
                } catch (error) {
                  logger.warn(`Failed to get balance for wallet: ${error}`);
                  return 0.05; // Fallback to minimum amount
                }
              })
            );

      await executeTokenLaunch(
        data.tokenPrivateKey,
        "", // funderWallet not needed for execution phase
        data.devWallet,
        data.buyerWallets,
        buyDistribution,
        data.tokenName,
        data.tokenSymbol,
        data.tokenMetadataUri,
        data.buyAmount,
        data.devBuy,
        data.launchStage,
        data.mode
      );

      // Update loading state - Phase 3: Finalizing
      await updateLoadingState(loadingKey, 3);

      await updateTokenState(
        data.tokenAddress,
        TokenState.LAUNCHED,
        data.userId
      );

      // Pump addresses are never released - they remain permanently allocated to the user
      logger.info(
        `Pump address ${data.tokenAddress} remains permanently allocated to user ${data.userId}`
      );

      // Complete loading state
      await completeLoadingState(
        loadingKey,
        undefined,
        `🎉 <b>Launch Complete!</b>\n\n` +
          `🪙 <b>Token:</b> ${data.tokenName} ($${data.tokenSymbol})\n` +
          `📍 <b>Address:</b> <code>${data.tokenAddress}</code>\n` +
          `✅ <b>Status:</b> Successfully launched\n\n` +
          `🚀 <b>Your token is now live and ready for trading!</b>`
      );

      console.log("[DEBUG] About to call sendLaunchSuccessNotification with:", {
        userChatId: data.userChatId,
        tokenAddress: data.tokenAddress,
        tokenName: data.tokenName,
        tokenSymbol: data.tokenSymbol,
        types: {
          userChatId: typeof data.userChatId,
          tokenAddress: typeof data.tokenAddress,
          tokenName: typeof data.tokenName,
          tokenSymbol: typeof data.tokenSymbol,
        },
      });

      await sendLaunchSuccessNotification(
        data.userChatId,
        data.tokenAddress,
        data.tokenName,
        data.tokenSymbol
      );
    } catch (error: unknown) {
      logger.error(
        "[jobs-execute-launch]: Error Occurred while executing token launch",
        error
      );

      // Fail loading state
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await failLoadingState(loadingKey, errorMessage);

      throw error;
    }
  },
  {
    connection: redisClient,
    concurrency: 10,
    removeOnFail: {
      count: 20,
    },
    removeOnComplete: {
      count: 10,
    },
    lockDuration: 3 * 60 * 1000, // 3 minutes for execution
    lockRenewTime: 30 * 1000,
  }
);

launchTokenWorker.on("ready", () => {
  logger.info("Token launch worker ready");
});
launchTokenWorker.on("active", async () => {
  logger.info("Token launch worker active");
});
launchTokenWorker.on("error", async (error) => {
  logger.error("Token Launch Worker Error", error);
});
launchTokenWorker.on("failed", async (job) => {
  await updateTokenState(
    job!.data.tokenAddress,
    TokenState.LISTED,
    job!.data.userId
  );

  // Handle pump address release on launch failure with error context
  await handleTokenLaunchFailure(job!.data.tokenAddress, job?.failedReason);

  const token = job!.data;
  await sendLaunchFailureNotification(
    job!.data.userChatId,
    token.tokenAddress,
    token.tokenName,
    token.tokenSymbol
  );
});
launchTokenWorker.on("closed", () => {
  logger.info("Launch Token worker closed successfully");
});

sellDevWorker.on("ready", () => {
  logger.info("Dev Sell worker ready");
});
sellDevWorker.on("active", async () => {
  logger.info("Dev Sell worker active");
});
sellDevWorker.on("error", async (error) => {
  logger.error("Dev Sell Worker Error", error);
});
sellDevWorker.on("failed", async (job) => {
  await releaseDevSellLock(job!.data.tokenAddress);
  await sendNotification(
    bot,
    job!.data.userChatId,
    "❌ <b>Dev Wallet Sell Failed</b>\n\n🔄 <i>Please try again from your tokens list.</i>"
  );
});
sellDevWorker.on("closed", () => {
  logger.info("Dev Sell Worker closed successfully");
});

sellWalletWorker.on("ready", () => {
  logger.info("Wallet Sell worker ready");
});
sellWalletWorker.on("active", async () => {
  logger.info("Wallet Sell worker active");
});
sellWalletWorker.on("error", async (error) => {
  logger.error("Wallet Sell Worker Error", error);
});
sellWalletWorker.on("failed", async (job) => {
  await releaseWalletSellLock(job!.data.tokenAddress);
  await sendNotification(
    bot,
    job!.data.userChatId,
    "❌ <b>Wallet Sells Failed</b>\n\n🔄 <i>Please try again from your tokens list.</i>"
  );
});
sellWalletWorker.on("closed", async () => {
  logger.info("Wallet Sell worker closed successfully");
});

prepareLaunchWorker.on("ready", () => {
  logger.info("Prepare Launch worker ready");
});
prepareLaunchWorker.on("active", async () => {
  logger.info("Prepare Launch worker active");
});
prepareLaunchWorker.on("error", async (error) => {
  logger.error("Prepare Launch Worker Error", error);
});
prepareLaunchWorker.on("failed", async (job) => {
  await updateTokenState(
    job!.data.tokenAddress,
    TokenState.LISTED,
    job!.data.userId
  );

  const token = job!.data;
  await sendNotification(
    bot,
    job!.data.userChatId,
    `❌ <b>Token preparation failed</b>\n\nToken: ${token.tokenName} ($${token.tokenSymbol})\n\n🔄 You can try again from your tokens list.`
  );
});
prepareLaunchWorker.on("closed", () => {
  logger.info("Prepare Launch worker closed successfully");
});

launchTokenFromDappWorker.on("ready", () => {
  logger.info("Launch Token From Dapp worker ready");
});
launchTokenFromDappWorker.on("active", async () => {
  logger.info("Launch Token From Dapp worker active");
});
launchTokenFromDappWorker.on("error", async (error) => {
  logger.error("Launch Token From Dapp Worker Error", error);
});
launchTokenFromDappWorker.on("failed", async (job) => {
  const token = job!.data;
  await sendLaunchFailureNotification(
    job!.data.userChatId,
    token.tokenId,
    token.tokenName,
    job?.failedReason || "Launch failed"
  );
});
launchTokenFromDappWorker.on("closed", () => {
  logger.info("Launch Token From Dapp worker closed successfully");
});

executeLaunchWorker.on("ready", () => {
  logger.info("Execute launch worker ready");
});
executeLaunchWorker.on("active", async () => {
  logger.info("Execute launch worker active");
});
executeLaunchWorker.on("error", async (error) => {
  logger.error("Execute Launch Worker Error", error);
});
executeLaunchWorker.on("failed", async (job) => {
  await updateTokenState(
    job!.data.tokenAddress,
    TokenState.LISTED,
    job!.data.userId
  );

  // Handle pump address release on execution failure with error context
  await handleTokenLaunchFailure(job!.data.tokenAddress, job?.failedReason);

  const token = job!.data;
  await sendLaunchFailureNotification(
    job!.data.userChatId,
    token.tokenAddress,
    token.tokenName,
    token.tokenSymbol
  );
});
executeLaunchWorker.on("closed", () => {
  logger.info("Execute launch worker closed successfully");
});
