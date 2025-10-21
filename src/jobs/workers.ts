import { Worker } from "bullmq";
import type { Context } from "grammy";
import {
  tokenLaunchQueue,
  devSellQueue,
  walletSellQueue,
  prepareLaunchQueue,
  executeLaunchQueue,
  createTokenMetadataQueue,
  launchDappTokenQueue,
  ctoQueue,
  externalBuyQueue,
  premixFundsQueue,
  walletWarmingQueue,
} from "./queues";
import type {
  LaunchTokenJob,
  PrepareTokenLaunchJob,
  ExecuteTokenLaunchJob,
  SellDevJob,
  SellWalletJob,
  CreateTokenMetadataJob,
  LaunchDappTokenJob,
  CTOJob,
  ExternalBuyJob,
  PremixFundsJob,
  WalletWarmingJob,
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
  createBackgroundLoadingState,
  hasLoadingState,
} from "../bot/loading";
import { Keypair } from "@solana/web3.js";
import { connection } from "../service/config";
import { createToken } from "../backend/functions";
import { createBonkToken } from "../blockchain/letsbonk/integrated-token-creator";
import axios from "axios";
import { UserModel, WalletModel } from "../backend/models";
import { safeObjectId } from "../backend/utils";
import { env } from "../config";
import { emitWorkerProgress } from "./progress-service";
import {
  emitCTOProgress,
  recordCTOResult,
  emitExternalBuyProgress,
  recordExternalBuyResult,
} from "./cto-progress-tracker";

// import { LaunchDestination } from "../backend/types"; // Available but not used in current implementation

/**
 * Universal CTO operation execution for non-PumpFun platforms
 * Uses the mixer to distribute funds and executeExternalBuyNoConfirmation for platform-agnostic buying
 */
async function executeUniversalCTOOperation(
  tokenAddress: string,
  userId: string,
  buyAmount: number,
  platform: string,
  jobId: string
): Promise<{
  success: boolean;
  error?: string;
  successfulBuys: number;
  failedBuys: number;
  totalSpent?: number;
}> {
  const { logger } = await import("../blockchain/common/logger");

  try {
    logger.info(
      `[Universal-CTO] Starting universal CTO operation for ${platform} platform: ${tokenAddress}, amount: ${buyAmount} SOL`
    );

    // Get funding and buyer wallets
    const { getUser, getFundingWallet, getAllBuyerWallets } = await import(
      "../backend/functions"
    );

    const user = await getUser(userId);
    if (!user) {
      return {
        success: false,
        error: "User not found",
        successfulBuys: 0,
        failedBuys: 0,
      };
    }

    const fundingWallet = await getFundingWallet(user.id);
    if (!fundingWallet) {
      return {
        success: false,
        error: "No funding wallet found",
        successfulBuys: 0,
        failedBuys: 0,
      };
    }

    const buyerWallets = await getAllBuyerWallets(user.id);
    if (!buyerWallets || buyerWallets.length === 0) {
      return {
        success: false,
        error: "No buyer wallets found",
        successfulBuys: 0,
        failedBuys: 0,
      };
    }

    logger.info(
      `[Universal-CTO] Using ${buyerWallets.length} buyer wallets for ${platform} platform execution`
    );

    // For now, use a simplified approach similar to the standard CTO operation
    // This will use the existing mixer-based approach with platform-agnostic execution

    logger.info(
      `[Universal-CTO] Delegating to standard CTO operation with platform: ${platform}`
    );

    // Use the existing CTO operation but ensure platform detection is passed through
    const { executeCTOOperation } = await import(
      "../blockchain/pumpfun/ctoOperation"
    );

    // The existing CTO operation will handle fund distribution and execution
    // We pass the detected platform so it can use the right buy logic
    return await executeCTOOperation(tokenAddress, userId, buyAmount, platform);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      `[Universal-CTO] Error executing ${platform} CTO operation:`,
      errorMessage
    );

    return {
      success: false,
      error: `Universal CTO operation failed: ${errorMessage}`,
      successfulBuys: 0,
      failedBuys: 0,
    };
  }
}

export const launchTokenWorker = new Worker<LaunchTokenJob>(
  tokenLaunchQueue.name,
  async (job) => {
    const data = job.data;
    const loadingKey = `${data.userChatId}-token_launch-${data.tokenAddress}`;
    const jobId = job.id?.toString() || "unknown";

    try {
      logger.info("[jobs]: Token Launch Job starting...");
      logger.info("[jobs-launch-token]: Job Data", data);

      // Emit job started
      emitWorkerProgress(
        jobId,
        "launch_token",
        data.tokenAddress,
        data.userId,
        data.userChatId,
        0,
        6,
        "Job Started",
        "Token launch job has been initiated",
        0,
        "started",
        {
          tokenName: data.tokenName,
          tokenSymbol: data.tokenSymbol,
          buyAmount: data.buyAmount,
          devBuy: data.devBuy,
        }
      );

      // Phase 1: Validating parameters
      emitWorkerProgress(
        jobId,
        "launch_token",
        data.tokenAddress,
        data.userId,
        data.userChatId,
        1,
        6,
        "Validating Parameters",
        "Checking token parameters and validating launch data",
        15,
        "in_progress"
      );
      await updateLoadingState(loadingKey, 0);

      // Phase 2: Checking balances
      emitWorkerProgress(
        jobId,
        "launch_token",
        data.tokenAddress,
        data.userId,
        data.userChatId,
        2,
        6,
        "Checking Balances",
        "Verifying wallet balances and fund availability",
        30,
        "in_progress"
      );
      await updateLoadingState(loadingKey, 1);

      // Phase 3: Creating token
      emitWorkerProgress(
        jobId,
        "launch_token",
        data.tokenAddress,
        data.userId,
        data.userChatId,
        3,
        6,
        "Creating Token",
        "Deploying token contract and setting up initial configuration",
        45,
        "in_progress"
      );
      await updateLoadingState(loadingKey, 2);

      // Phase 4: Executing launch
      emitWorkerProgress(
        jobId,
        "launch_token",
        data.tokenAddress,
        data.userId,
        data.userChatId,
        4,
        6,
        "Executing Launch",
        "Running token launch sequence with dev buy and buyer wallet transactions",
        60,
        "in_progress"
      );

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

      // Phase 5: Finalizing
      emitWorkerProgress(
        jobId,
        "launch_token",
        data.tokenAddress,
        data.userId,
        data.userChatId,
        5,
        6,
        "Finalizing Launch",
        "Updating token state and completing launch process",
        85,
        "in_progress"
      );
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

      // Phase 6: Completed
      emitWorkerProgress(
        jobId,
        "launch_token",
        data.tokenAddress,
        data.userId,
        data.userChatId,
        6,
        6,
        "Launch Completed",
        "Token launch has been completed successfully",
        100,
        "completed",
        {
          tokenName: data.tokenName,
          tokenSymbol: data.tokenSymbol,
          tokenAddress: data.tokenAddress,
        }
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
      const { safeTokenOperation } = await import("./safe-db-operations");

      const tokenRecord = await safeTokenOperation(() =>
        TokenModel.findOne({
          tokenAddress: data.tokenAddress,
        })
      );
      if (tokenRecord?.launchData?.destination === "letsbonk") {
        logger.info(
          "[jobs]: Waiting 2 seconds after Bonk dev buy/launch before starting pool polling/snipes..."
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(
        "[jobs-launch-token]: Error Occurred while launching token",
        error
      );

      // Emit error progress
      emitWorkerProgress(
        jobId,
        "launch_token",
        data.tokenAddress,
        data.userId,
        data.userChatId,
        0,
        6,
        "Launch Failed",
        "Token launch encountered an error",
        0,
        "failed",
        {
          error: errorMessage,
          tokenName: data.tokenName,
          tokenSymbol: data.tokenSymbol,
        }
      );

      // Fail loading state
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
    // Set lock duration to 5 minutes (300 seconds) for launch operations
    lockDuration: 5 * 60 * 1000, // 5 minutes in milliseconds
    lockRenewTime: 30 * 1000, // Renew lock every 30 seconds
  }
);

export const sellDevWorker = new Worker<SellDevJob>(
  devSellQueue.name,
  async (job) => {
    const data = job.data;
    const loadingKey = `${data.userChatId}-dev_sell-${data.tokenAddress}`;
    const jobId = job.id?.toString() || "unknown";

    try {
      logger.info("[jobs]: Sell Dev Job starting...");
      logger.info("[jobs-sell-dev]: Job Data", data);

      // Phase 1: Job Started
      emitWorkerProgress(
        jobId,
        "dev_sell",
        data.tokenAddress,
        data.userId,
        data.userChatId,
        1,
        5,
        "Dev Sell Started",
        "Initiating developer token sell process",
        10,
        "started",
        {
          sellPercent: data.sellPercent,
        }
      );

      // Phase 2: Validating parameters
      emitWorkerProgress(
        jobId,
        "dev_sell",
        data.tokenAddress,
        data.userId,
        data.userChatId,
        2,
        5,
        "Validating Parameters",
        "Checking sell parameters and token holdings",
        25,
        "in_progress"
      );
      await updateLoadingState(loadingKey, 0);

      // Phase 3: Calculating amounts
      emitWorkerProgress(
        jobId,
        "dev_sell",
        data.tokenAddress,
        data.userId,
        data.userChatId,
        3,
        5,
        "Calculating Amounts",
        "Computing sell amounts and transaction parameters",
        45,
        "in_progress"
      );
      await updateLoadingState(loadingKey, 1);

      // Phase 4: Executing transaction
      emitWorkerProgress(
        jobId,
        "dev_sell",
        data.tokenAddress,
        data.userId,
        data.userChatId,
        4,
        5,
        "Executing Transaction",
        "Broadcasting sell transaction to blockchain",
        70,
        "in_progress"
      );
      await updateLoadingState(loadingKey, 2);

      // Check token type to determine which sell mechanism to use
      const { TokenModel } = await import("../backend/models");
      const { safeTokenOperation } = await import("./safe-db-operations");

      const token = await safeTokenOperation(() =>
        TokenModel.findOne({
          tokenAddress: data.tokenAddress,
        })
      );

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

      // Phase 5: Dev Sell Completed
      emitWorkerProgress(
        jobId,
        "dev_sell",
        data.tokenAddress,
        data.userId,
        data.userChatId,
        5,
        5,
        "Dev Sell Completed",
        "Developer token sell has been completed successfully",
        100,
        "completed",
        {
          sellPercent: data.sellPercent,
          solReceived: sellSummary.solReceived,
          tokensSold: tokensSoldFormatted,
          profitLoss: sellSummary.netProfitLoss,
          signature: result.signature,
        }
      );

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
    const loadingKey = `${data.userChatId}-wallet_sell-${data.tokenAddress}`;
    const logIdentifier = `super-jobs-sell-wallet-${data.tokenAddress}`;
    const jobId = job.id?.toString() || "unknown";

    try {
      logger.info("[jobs]: Wallet Sell Job starting...");
      logger.info("[jobs-sell-wallet]: Job Data", data);

      // Phase 1: Job Started
      emitWorkerProgress(
        jobId,
        "wallet_sell",
        data.tokenAddress,
        data.userId,
        data.userChatId,
        1,
        5,
        "Wallet Sell Started",
        "Initiating wallet token sell process",
        5,
        "started",
        {
          sellPercent: data.sellPercent,
          walletsCount: data.buyerWallets?.length || 0,
        }
      );

      // Phase 2: Validating holdings
      emitWorkerProgress(
        jobId,
        "wallet_sell",
        data.tokenAddress,
        data.userId,
        data.userChatId,
        2,
        5,
        "Validating Holdings",
        "Checking wallet token holdings and balances",
        20,
        "in_progress"
      );
      await updateLoadingState(loadingKey, 0);

      // Phase 3: Calculating amounts
      emitWorkerProgress(
        jobId,
        "wallet_sell",
        data.tokenAddress,
        data.userId,
        data.userChatId,
        3,
        5,
        "Calculating Amounts",
        "Computing sell amounts for all wallets",
        40,
        "in_progress"
      );
      await updateLoadingState(loadingKey, 1);

      // Phase 4: Executing transactions
      emitWorkerProgress(
        jobId,
        "wallet_sell",
        data.tokenAddress,
        data.userId,
        data.userChatId,
        4,
        5,
        "Executing Transactions",
        "Broadcasting sell transactions for all wallets",
        65,
        "in_progress"
      );
      await updateLoadingState(loadingKey, 2);

      // Check token type to determine which sell mechanism to use
      const { TokenModel } = await import("../backend/models");
      const { safeTokenOperation } = await import("./safe-db-operations");

      const token = await safeTokenOperation(() =>
        TokenModel.findOne({
          tokenAddress: data.tokenAddress,
        })
      );

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

      // Phase 5: Wallet Sell Completed
      emitWorkerProgress(
        jobId,
        "wallet_sell",
        data.tokenAddress,
        data.userId,
        data.userChatId,
        5,
        5,
        "Wallet Sell Completed",
        "All wallet token sells have been completed successfully",
        100,
        "completed",
        {
          walletsCount: data.buyerWallets?.length || 0,
          sellPercent: data.sellPercent,
        }
      );

      // Complete the loading state without additional message
      await completeLoadingState(loadingKey, undefined, "");
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(
        "[jobs-sell-wallet]: Error Occurred while selling wallet supply",
        error
      );

      // Emit error progress
      emitWorkerProgress(
        jobId,
        "wallet_sell",
        data.tokenAddress,
        data.userId,
        data.userChatId,
        0,
        5,
        "Wallet Sell Failed",
        "Wallet token sell encountered an error",
        0,
        "failed",
        {
          error: errorMessage,
          sellPercent: data.sellPercent,
          walletsCount: data.buyerWallets?.length || 0,
        }
      );

      // Fail loading state
      await failLoadingState(loadingKey, errorMessage);

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
    const loadingKey = `${data.userChatId}-prepare_launch-${data.tokenAddress}`;
    const jobId = job.id?.toString() || "unknown";

    try {
      logger.info("[jobs]: Prepare Launch Job starting...");
      logger.info("[jobs-prepare-launch]: Job Data", data);

      // Create loading state if it doesn't exist (for background jobs)
      if (!hasLoadingState(loadingKey)) {
        await createBackgroundLoadingState(
          data.userChatId,
          "prepare_launch",
          data.tokenAddress
        );
      }

      // Phase 1: Job Started
      emitWorkerProgress(
        jobId,
        "prepare_launch",
        data.tokenAddress,
        data.userId,
        data.userChatId,
        1,
        7,
        "Preparation Started",
        "Token launch preparation has been initiated",
        5,
        "started",
        {
          buyAmount: data.buyAmount,
          devBuy: data.devBuy,
          mode: data.mode,
        }
      );

      // Phase 2: Validating parameters
      emitWorkerProgress(
        jobId,
        "prepare_launch",
        data.tokenAddress,
        data.userId,
        data.userChatId,
        2,
        7,
        "Validating Parameters",
        "Checking launch parameters and wallet configurations",
        15,
        "in_progress"
      );
      await updateLoadingState(loadingKey, 0);

      // Phase 3: Collecting platform fee
      emitWorkerProgress(
        jobId,
        "prepare_launch",
        data.tokenAddress,
        data.userId,
        data.userChatId,
        3,
        7,
        "Collecting Platform Fee",
        "Processing platform fees and preparing funding",
        25,
        "in_progress"
      );
      await updateLoadingState(loadingKey, 1);
      let heartbeatInterval: NodeJS.Timeout | null = null;

      if (data.mode === "normal") {
        // Phase 4: Initializing mixer
        emitWorkerProgress(
          jobId,
          "prepare_launch",
          data.tokenAddress,
          data.userId,
          data.userChatId,
          4,
          7,
          "Initializing Mixer",
          "Setting up privacy mixer for fund distribution",
          40,
          "in_progress"
        );
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
    const jobId = job.id?.toString() || "unknown";
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

      // Phase 1: Token Creation Started
      emitWorkerProgress(
        jobId,
        "create_token_metadata",
        "pending", // No token address yet
        userId,
        0, // No userChatId available
        1,
        4,
        "Token Creation Started",
        "Initiating token metadata creation process",
        10,
        "started",
        {
          tokenName: name,
          tokenSymbol: symbol,
          platform: platform,
        }
      );

      // Build query conditions - only include fundingWallet if userWalletAddress is not empty
      const queryConditions: Array<
        { _id?: string } | { fundingWallet?: import("mongoose").Types.ObjectId }
      > = [{ _id: userId }];

      // Only add fundingWallet condition if userWalletAddress is provided and not empty
      const safeWalletId = safeObjectId(userWalletAddress);
      if (safeWalletId) {
        queryConditions.push({ fundingWallet: safeWalletId });
      }

      const { safeUserOperation } = await import("./safe-db-operations");

      const user = await safeUserOperation(() =>
        UserModel.findOne({
          $or: queryConditions,
        }).populate("fundingWallet")
      );
      if (!user) {
        throw new Error("User not found");
      }

      // Phase 2: Downloading Image
      emitWorkerProgress(
        jobId,
        "create_token_metadata",
        "pending",
        userId,
        0,
        2,
        4,
        "Downloading Image",
        "Fetching and processing token image",
        30,
        "in_progress"
      );

      const { data: fileData } = await axios.get<ArrayBuffer>(imageUrl, {
        responseType: "arraybuffer",
      });

      // Phase 3: Creating Token
      emitWorkerProgress(
        jobId,
        "create_token_metadata",
        "pending",
        userId,
        0,
        3,
        4,
        "Creating Token",
        `Creating token on ${platform} platform`,
        60,
        "in_progress"
      );

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

      // Phase 4: Token Creation Completed
      emitWorkerProgress(
        jobId,
        "create_token_metadata",
        token?.tokenAddress || "unknown",
        userId,
        0,
        4,
        4,
        "Token Creation Completed",
        "Token metadata has been created successfully",
        100,
        "completed",
        {
          tokenName: name,
          tokenSymbol: symbol,
          tokenAddress: token?.tokenAddress,
          platform: platform,
        }
      );

      console.log("Created token metadata:", token);
    } catch (error: unknown) {
      logger.error(
        "[jobs-create]: Error Occurred while creating token metadata",
        error
      );

      // Emit error progress
      if (job.data.socketUserId) {
        emitWorkerProgress(
          jobId,
          "create_token_metadata",
          "unknown", // tokenAddress not available yet
          userId,
          0, // userChatId not available in this job
          0, // phase
          4, // totalPhases
          "Error",
          `Token creation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          0, // progress
          "failed",
          { error: error instanceof Error ? error.message : "Unknown error" }
        );
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

export const launchTokenFromDappWorker = new Worker<LaunchDappTokenJob>(
  launchDappTokenQueue.name,
  async (job) => {
    const data = job.data;
    const jobId = job.id?.toString() || "unknown";
    const {
      buyAmount,
      devBuy,
      tokenName,
      launchMode,
      platform,
      tokenId,
      tokenSymbol,
      userId,
      userChatId: userChatIdFromJob,
    } = job.data;

    let actualTokenAddress: string | undefined;
    let userChatId = userChatIdFromJob;

    try {
      logger.info("[launchDappToken]: Job starting...", data);

      // Phase 1: Validating User (10%)
      emitWorkerProgress(
        jobId,
        "launch_token_from_dapp",
        tokenId,
        userId,
        userChatId,
        1,
        6,
        "Validating User",
        "Verifying user credentials and permissions",
        10,
        "in_progress"
      );

      // --------- VALIDATE USER ---------
      const user = await UserModel.findById(safeObjectId(String(userId)));

      if (!user) {
        throw new Error("User not found");
      }
      userChatId = Number(user?.telegramId) || userChatId;
      console.log(
        "[launchDappToken]: Found user",
        JSON.stringify(user, null, 2)
      );

      // Phase 2: Fetching Token Data (25%)
      emitWorkerProgress(
        jobId,
        "launch_token_from_dapp",
        tokenId,
        userId,
        userChatId,
        2,
        6,
        "Fetching Token Data",
        "Retrieving token information from database",
        25,
        "in_progress"
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

      // Phase 3: Preparing Wallets (40%)
      emitWorkerProgress(
        jobId,
        "launch_token_from_dapp",
        actualTokenAddress,
        userId,
        userChatId,
        3,
        6,
        "Preparing Wallets",
        "Setting up funding and buyer wallets",
        40,
        "in_progress"
      );

      // -------- GET WALLETS FROM DATABASE BASED ON USERID --------
      // Get funding wallet
      const { safeWalletOperation } = await import("./safe-db-operations");

      const fundingWalletDoc = await safeWalletOperation(() =>
        WalletModel.findOne({
          user: user.id,
          isFunding: true,
        }).lean()
      );

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
      const devWalletDoc = await safeWalletOperation(() =>
        WalletModel.findOne({
          user: user.id,
          isDev: true,
        }).lean()
      );

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

      // Phase 4: Executing Launch (60%)
      emitWorkerProgress(
        jobId,
        "launch_token_from_dapp",
        actualTokenAddress,
        userId,
        userChatId,
        4,
        6,
        "Executing Launch",
        `Launching token on ${platform || "pump"} platform`,
        60,
        "in_progress"
      );

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
            +userChatId, // Telegram chat ID for notifications
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

      // Phase 5: Sending Notifications (80%)
      emitWorkerProgress(
        jobId,
        "launch_token_from_dapp",
        actualTokenAddress || tokenId,
        userId,
        userChatId,
        5,
        6,
        "Sending Notifications",
        "Notifying user of launch results",
        80,
        "in_progress"
      );

      // -------- NOTIFICATIONS --------
      if (userChatId && result.success) {
        try {
          await sendLaunchSuccessNotification(
            +userChatId,
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

      // Phase 6: Launch Complete (100%)
      emitWorkerProgress(
        jobId,
        "launch_token_from_dapp",
        actualTokenAddress || tokenId,
        userId,
        userChatId,
        6,
        6,
        "Launch Complete",
        result.success
          ? "Token launch completed successfully"
          : "Token launch completed with issues",
        100,
        result.success ? "completed" : "failed"
      );

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

      // Emit error progress
      emitWorkerProgress(
        jobId,
        "launch_token_from_dapp",
        actualTokenAddress || tokenId,
        userId,
        userChatId,
        0,
        6,
        "Error",
        `Launch failed: ${errorMessage}`,
        0,
        "failed",
        { error: errorMessage }
      );

      // Send failure notification if userChatId is available
      if (userChatId) {
        try {
          await sendLaunchFailureNotification(
            +userChatId,
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
    const jobId = job.id?.toString() || "unknown";
    const loadingKey = `${data.userChatId}-execute_launch-${data.tokenAddress}`;

    try {
      logger.info("[jobs]: Execute Launch Job starting...");
      logger.info("[jobs-execute-launch]: Job Data", data);

      // Phase 1: Initializing Launch (15%)
      emitWorkerProgress(
        jobId,
        "execute_launch",
        data.tokenAddress,
        data.userId || "unknown",
        data.userChatId,
        1,
        5,
        "Initializing Launch",
        "Setting up execution environment",
        15,
        "in_progress"
      );

      // Create loading state if it doesn't exist (for background jobs)
      if (!hasLoadingState(loadingKey)) {
        await createBackgroundLoadingState(
          data.userChatId,
          "execute_launch",
          data.tokenAddress
        );
      }

      // Update loading state - Phase 0: Starting execution
      await updateLoadingState(loadingKey, 0);

      // Phase 2: Creating Token on Chain (35%)
      emitWorkerProgress(
        jobId,
        "execute_launch",
        data.tokenAddress,
        data.userId || "unknown",
        data.userChatId,
        2,
        5,
        "Creating Token",
        "Deploying token to blockchain",
        35,
        "in_progress"
      );

      // Update loading state - Phase 1: Creating token
      await updateLoadingState(loadingKey, 1);

      // Phase 3: Executing Buys (60%)
      emitWorkerProgress(
        jobId,
        "execute_launch",
        data.tokenAddress,
        data.userId || "unknown",
        data.userChatId,
        3,
        5,
        "Executing Buys",
        "Processing token purchases",
        60,
        "in_progress"
      );

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

      // Phase 4: Finalizing Launch (85%)
      emitWorkerProgress(
        jobId,
        "execute_launch",
        data.tokenAddress,
        data.userId || "unknown",
        data.userChatId,
        4,
        5,
        "Finalizing Launch",
        "Updating token state and completing setup",
        85,
        "in_progress"
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

      // Phase 5: Execution Complete (100%)
      emitWorkerProgress(
        jobId,
        "execute_launch",
        data.tokenAddress,
        data.userId || "unknown",
        data.userChatId,
        5,
        5,
        "Execution Complete",
        "Token launch completed successfully",
        100,
        "completed"
      );
    } catch (error: unknown) {
      logger.error(
        "[jobs-execute-launch]: Error Occurred while executing token launch",
        error
      );

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Emit error progress
      emitWorkerProgress(
        jobId,
        "execute_launch",
        data.tokenAddress,
        data.userId || "unknown",
        data.userChatId,
        0,
        5,
        "Error",
        `Launch execution failed: ${errorMessage}`,
        0,
        "failed",
        { error: errorMessage }
      );

      // Fail loading state
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

// CTO Worker
export const ctoWorker = new Worker<CTOJob>(
  ctoQueue.name,
  async (job) => {
    const data = job.data;
    const jobId = job.id?.toString() || "unknown";

    const startTime = Date.now();

    try {
      logger.info("[jobs]: CTO Job starting...");
      logger.info("[jobs-cto]: Job Data", data);

      // Phase 1: Job Started - Use enhanced CTO progress tracking
      emitCTOProgress(
        jobId,
        data.tokenAddress,
        data.userId,
        data.userChatId,
        1,
        5,
        "CTO Operation Started",
        `Initiating ${data.mode} CTO operation`,
        10,
        "started",
        data.mode,
        data.platform,
        data.buyAmount,
        data.socketUserId,
        {
          currentOperation: "Initializing operation",
          estimatedTimeRemaining: data.mode === "prefunded" ? 30000 : 60000, // 30s or 60s
        }
      );

      // Phase 2: Validating parameters
      emitCTOProgress(
        jobId,
        data.tokenAddress,
        data.userId,
        data.userChatId,
        2,
        5,
        "Validating Parameters",
        "Checking wallet balances and operation parameters",
        25,
        "in_progress",
        data.mode,
        data.platform,
        data.buyAmount,
        data.socketUserId,
        {
          currentOperation: "Validating user and wallet setup",
          estimatedTimeRemaining: data.mode === "prefunded" ? 25000 : 50000,
        }
      );

      // Validate user and wallets
      const { getUser, getFundingWallet, getAllBuyerWallets } = await import(
        "../backend/functions"
      );

      const user = await getUser(data.userChatId.toString());
      if (!user) {
        throw new Error("User not found");
      }

      if (data.mode === "prefunded") {
        const buyerWallets = await getAllBuyerWallets(user.id);
        if (buyerWallets.length === 0) {
          throw new Error("No buyer wallets found for prefunded mode");
        }
      } else {
        const fundingWallet = await getFundingWallet(user.id);
        if (!fundingWallet) {
          throw new Error("No funding wallet found for standard mode");
        }
      }

      // Phase 3: Platform Detection & Preparation
      emitCTOProgress(
        jobId,
        data.tokenAddress,
        data.userId,
        data.userChatId,
        3,
        5,
        "Platform Detection",
        "Analyzing token platform for optimal execution strategy",
        45,
        "in_progress",
        data.mode,
        data.platform,
        data.buyAmount,
        data.socketUserId,
        {
          currentOperation: "Detecting platform and optimizing strategy",
          estimatedTimeRemaining: data.mode === "prefunded" ? 20000 : 40000,
        }
      );

      // Perform platform detection if not provided or unknown
      let detectedPlatform = data.platform;
      if (!data.platform || data.platform === "unknown") {
        try {
          const { detectTokenPlatformWithCache } = await import(
            "../service/token-detection-service"
          );
          detectedPlatform = await detectTokenPlatformWithCache(
            data.tokenAddress
          );

          logger.info(
            `[jobs-cto]: Platform detection completed for token ${data.tokenAddress}: ${detectedPlatform}`
          );

          // Update progress with detected platform
          emitCTOProgress(
            jobId,
            data.tokenAddress,
            data.userId,
            data.userChatId,
            3,
            5,
            "Platform Detection Complete",
            `Detected ${detectedPlatform} platform - optimizing execution strategy`,
            50,
            "in_progress",
            data.mode,
            detectedPlatform,
            data.buyAmount,
            data.socketUserId,
            {
              currentOperation: `Preparing ${detectedPlatform} platform execution`,
              estimatedTimeRemaining: data.mode === "prefunded" ? 18000 : 35000,
            }
          );
        } catch (platformError: any) {
          logger.warn(
            `[jobs-cto]: Platform detection failed for token ${data.tokenAddress}: ${platformError.message}, using fallback`
          );
          detectedPlatform = "unknown"; // Use fallback multi-platform approach
        }
      } else {
        logger.info(
          `[jobs-cto]: Using provided platform for token ${data.tokenAddress}: ${detectedPlatform}`
        );
      }

      // Phase 4: Executing CTO Operation
      emitCTOProgress(
        jobId,
        data.tokenAddress,
        data.userId,
        data.userChatId,
        4,
        5,
        "Executing Operation",
        data.mode === "prefunded"
          ? "Executing prefunded CTO using available buyer wallet balances"
          : `Executing ${data.mode} CTO with ${data.buyAmount.toFixed(6)} SOL`,
        70,
        "in_progress",
        data.mode,
        data.platform,
        data.buyAmount,
        data.socketUserId,
        {
          currentOperation:
            data.mode === "prefunded"
              ? "Direct wallet execution using available balances"
              : "Mixer distribution and buys",
          estimatedTimeRemaining: data.mode === "prefunded" ? 15000 : 30000,
        }
      );

      let result;
      if (data.mode === "prefunded") {
        // Use prefunded execution that bypasses mixer
        // For prefunded mode, ignore buyAmount and use available buyer wallet balances
        const { executePrefundedCTOOperation } = await import(
          "../bot/conversation/ctoConversation"
        );
        result = await executePrefundedCTOOperation(
          data.tokenAddress,
          data.userId,
          0, // Ignore buyAmount for prefunded mode - use available balances
          detectedPlatform // Use detected platform
        );
      } else {
        // Use standard execution with mixer - platform-agnostic approach
        if (detectedPlatform === "pumpfun" || detectedPlatform === "unknown") {
          // Use original PumpFun CTO operation for PumpFun tokens or unknown fallback
          const { executeCTOOperation } = await import(
            "../blockchain/pumpfun/ctoOperation"
          );
          result = await executeCTOOperation(
            data.tokenAddress,
            data.userId,
            data.buyAmount,
            detectedPlatform
          );
        } else {
          // For all other platforms (bonk, cpmm, pumpswap, meteora, heaven),
          // use a universal mixer-based CTO approach
          result = await executeUniversalCTOOperation(
            data.tokenAddress,
            data.userId,
            data.buyAmount,
            detectedPlatform,
            jobId
          );
        }
      }

      // Phase 5: Operation Completed
      if (result.success) {
        emitCTOProgress(
          jobId,
          data.tokenAddress,
          data.userId,
          data.userChatId,
          5,
          5,
          "CTO Operation Completed",
          `Successfully executed ${result.successfulBuys || 0} buy transactions on ${detectedPlatform}`,
          100,
          "completed",
          data.mode,
          detectedPlatform,
          data.buyAmount,
          data.socketUserId,
          {
            successfulBuys: result.successfulBuys || 0,
            failedBuys: result.failedBuys || 0,
            totalSpent:
              data.mode === "prefunded"
                ? (result as unknown as { totalSpent?: number }).totalSpent || 0
                : data.buyAmount,
            currentOperation: `Operation completed successfully on ${detectedPlatform}`,
            estimatedTimeRemaining: 0,
          }
        );

        // Record final result with actual spent amount
        recordCTOResult(
          jobId,
          true,
          result.successfulBuys || 0,
          result.failedBuys || 0,
          data.mode === "prefunded"
            ? (result as unknown as { totalSpent?: number }).totalSpent || 0
            : data.buyAmount, // Use actual spent amount for prefunded mode
          [], // Transaction signatures would come from result if available
          undefined,
          startTime
        );

        logger.info(
          `[jobs-cto]: CTO operation completed successfully for token ${data.tokenAddress}`
        );
      } else {
        // Handle partial success or complete failure
        const isPartialSuccess =
          result.successfulBuys && result.successfulBuys > 0;

        emitCTOProgress(
          jobId,
          data.tokenAddress,
          data.userId,
          data.userChatId,
          5,
          5,
          isPartialSuccess ? "CTO Partially Completed" : "CTO Operation Failed",
          isPartialSuccess
            ? `Partial success: ${result.successfulBuys} buys completed on ${detectedPlatform}`
            : `Operation failed on ${detectedPlatform}: ${result.error || "Unknown error"}`,
          isPartialSuccess ? 80 : 0,
          isPartialSuccess ? "completed" : "failed",
          data.mode,
          detectedPlatform,
          data.buyAmount,
          data.socketUserId,
          {
            successfulBuys: result.successfulBuys || 0,
            failedBuys: result.failedBuys || 0,
            error: result.error,
            currentOperation: isPartialSuccess
              ? `Partially completed on ${detectedPlatform}`
              : `Failed on ${detectedPlatform}`,
            estimatedTimeRemaining: 0,
          }
        );

        // Record final result
        recordCTOResult(
          jobId,
          Boolean(isPartialSuccess),
          result.successfulBuys || 0,
          result.failedBuys || 0,
          data.mode === "prefunded"
            ? (result as unknown as { totalSpent?: number }).totalSpent || 0
            : data.buyAmount, // Use actual spent amount for prefunded mode
          [], // Transaction signatures would come from result if available
          result.error,
          startTime
        );

        if (!isPartialSuccess) {
          // Provide more specific error messages based on failure type
          let enhancedError = result.error || "CTO operation failed";

          if (result.error?.includes("insufficient balance")) {
            enhancedError =
              "Insufficient wallet balances. Most wallets need funding before CTO operations can succeed.";
          } else if (
            result.error?.includes("BONDING_CURVE_COMPLETE") ||
            result.error?.includes('Custom":6005')
          ) {
            enhancedError =
              "Token has graduated from PumpFun to Raydium. The system should automatically handle this, but if issues persist, try again.";
          } else if (result.error?.includes("All buy methods failed")) {
            enhancedError =
              "All trading methods failed. This could be due to network issues, token liquidity problems, or wallet funding issues.";
          }

          throw new Error(enhancedError);
        }

        logger.warn(
          `[jobs-cto]: CTO operation partially completed for token ${data.tokenAddress}`
        );
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        `[jobs-cto]: CTO operation failed for token ${data.tokenAddress}:`,
        errorMessage
      );

      emitCTOProgress(
        jobId,
        data.tokenAddress,
        data.userId,
        data.userChatId,
        5,
        5,
        "CTO Operation Failed",
        `Operation failed: ${errorMessage}`,
        0,
        "failed",
        data.mode,
        data.platform || "unknown",
        data.buyAmount,
        data.socketUserId,
        {
          error: errorMessage,
          currentOperation: "Failed with error",
          estimatedTimeRemaining: 0,
        }
      );

      // Record failed result
      recordCTOResult(jobId, false, 0, 0, 0, [], errorMessage, startTime);

      throw error;
    }
  },
  {
    connection: redisClient,
    concurrency: 1, // Process CTO operations one at a time to avoid conflicts
  }
);

ctoWorker.on("completed", (job) => {
  logger.info(`[jobs-cto]: CTO job ${job.id} completed successfully`);
});

ctoWorker.on("failed", (job, err) => {
  logger.error(`[jobs-cto]: CTO job ${job?.id} failed:`, err);
});

ctoWorker.on("closed", () => {
  logger.info("CTO worker closed successfully");
});

// External Buy Worker
export const externalBuyWorker = new Worker<ExternalBuyJob>(
  externalBuyQueue.name,
  async (job) => {
    const data = job.data;
    const jobId = job.id?.toString() || "unknown";

    const startTime = Date.now();

    try {
      logger.info("[jobs]: External Buy Job starting...");
      logger.info("[jobs-external-buy]: Job Data", {
        userId: data.userId,
        tokenAddress: data.tokenAddress.slice(0, 8) + "...",
        buyAmount: data.buyAmount,
        slippage: data.slippage,
        priorityFee: data.priorityFee,
        platform: data.platform,
      });

      // Phase 1: Job Started
      emitExternalBuyProgress(
        jobId,
        data.tokenAddress,
        data.userId,
        data.userChatId,
        1,
        4,
        "Buy Operation Started",
        `Initiating external token purchase`,
        10,
        "started",
        data.buyAmount,
        data.socketUserId,
        {
          currentOperation: "Initializing buy operation",
          estimatedTimeRemaining: 20000, // 20 seconds
        }
      );

      // Phase 2: Preparing wallet and validation
      emitExternalBuyProgress(
        jobId,
        data.tokenAddress,
        data.userId,
        data.userChatId,
        2,
        4,
        "Preparing Wallet",
        "Setting up wallet and validating parameters",
        35,
        "in_progress",
        data.buyAmount,
        data.socketUserId,
        {
          currentOperation: "Validating wallet and balance",
          estimatedTimeRemaining: 15000,
        }
      );

      // Import necessary functions
      const { secretKeyToKeypair } = await import("../blockchain/common/utils");
      const { executeExternalBuy } = await import(
        "../blockchain/pumpfun/externalBuy"
      );

      // Create keypair from private key
      const buyerKeypair = secretKeyToKeypair(data.walletPrivateKey);

      // Phase 3: Executing purchase
      emitExternalBuyProgress(
        jobId,
        data.tokenAddress,
        data.userId,
        data.userChatId,
        3,
        4,
        "Executing Purchase",
        `Purchasing tokens with ${data.buyAmount.toFixed(6)} SOL`,
        70,
        "in_progress",
        data.buyAmount,
        data.socketUserId,
        {
          currentOperation: "Executing buy transaction on platform",
          estimatedTimeRemaining: 10000,
        }
      );

      // Execute the external buy
      const result = await executeExternalBuy(
        data.tokenAddress,
        buyerKeypair,
        data.buyAmount,
        data.slippage || 3,
        data.priorityFee || 0.002,
        undefined as any // We don't have a Telegram context here
      );

      // Phase 4: Operation Completed
      if (result.success) {
        emitExternalBuyProgress(
          jobId,
          data.tokenAddress,
          data.userId,
          data.userChatId,
          4,
          4,
          "Purchase Successful",
          `Successfully purchased tokens via ${result.platform}`,
          100,
          "completed",
          data.buyAmount,
          data.socketUserId,
          {
            currentOperation: "Purchase completed successfully",
            transactionSignature: result.signature,
            platform: result.platform,
            actualSolSpent: result.solReceived,
          }
        );

        // Record successful result
        recordExternalBuyResult(
          jobId,
          true,
          data.buyAmount,
          parseFloat(result.solReceived || "0"),
          result.signature,
          result.platform || "unknown",
          null,
          startTime
        );

        logger.info(`[jobs-external-buy]: Job ${jobId} completed successfully`);
        return {
          success: true,
          signature: result.signature,
          platform: result.platform,
          solSpent: result.solReceived,
          message: "External token purchase completed successfully",
        };
      } else {
        throw new Error(result.error || "External buy failed");
      }
    } catch (error: any) {
      const errorMessage = error.message || "Unknown error occurred";

      logger.error(`[jobs-external-buy]: Job ${jobId} failed:`, error);

      // Emit failure progress
      emitExternalBuyProgress(
        jobId,
        data.tokenAddress,
        data.userId,
        data.userChatId,
        4,
        4,
        "Purchase Failed",
        errorMessage,
        100,
        "failed",
        data.buyAmount,
        data.socketUserId,
        {
          currentOperation: "Purchase failed",
          error: errorMessage,
        }
      );

      // Record failed result
      recordExternalBuyResult(
        jobId,
        false,
        data.buyAmount,
        0,
        "",
        data.platform || "unknown",
        errorMessage,
        startTime
      );

      throw error;
    }
  },
  {
    connection: redisClient,
    concurrency: 3, // Allow multiple external buys in parallel
  }
);

externalBuyWorker.on("completed", (job) => {
  logger.info(
    `[jobs-external-buy]: External buy job ${job.id} completed successfully`
  );
});

externalBuyWorker.on("failed", (job, err) => {
  logger.error(`[jobs-external-buy]: External buy job ${job?.id} failed:`, err);
});

externalBuyWorker.on("closed", () => {
  logger.info("External buy worker closed successfully");
});

// ============ PREMIX FUNDS WORKER ============

export const premixFundsWorker = new Worker<PremixFundsJob>(
  premixFundsQueue.name,
  async (job) => {
    const data = job.data;
    const loadingKey = `${data.userChatId}-premix_funds-${Date.now()}`;
    const jobId = job.id?.toString() || "unknown";

    try {
      logger.info("[jobs]: Premix Funds Job starting...");
      logger.info("[jobs-premix-funds]: Job Data", data);

      // Phase 1: Job Started
      emitWorkerProgress(
        jobId,
        "premix_funds",
        "funding_wallet",
        data.userId,
        data.userChatId,
        1,
        6,
        "Premix Started",
        "Initiating funds premixing from funding wallet",
        10,
        "started",
        {
          mixAmount: data.mixAmount,
          mode: data.mode || "standard",
        }
      );

      // Phase 2: Validating parameters and fetching wallet data
      emitWorkerProgress(
        jobId,
        "premix_funds",
        "funding_wallet",
        data.userId,
        data.userChatId,
        2,
        6,
        "Validating Parameters",
        "Checking user wallets and mix parameters",
        20,
        "in_progress"
      );

      // Get user wallet data
      const {
        getFundingWallet,
        getAllBuyerWallets,
        calculateRequiredWallets,
        generateBuyDistribution,
      } = await import("../backend/functions");

      const fundingWallet = await getFundingWallet(data.userId);
      if (!fundingWallet) {
        throw new Error("Funding wallet not found");
      }

      const buyerWallets = await getAllBuyerWallets(data.userId);
      if (buyerWallets.length === 0) {
        throw new Error("No buyer wallets found. Create buyer wallets first.");
      }

      logger.info(
        `[jobs-premix-funds]: Found ${buyerWallets.length} total buyer wallets`
      );

      // ✅ FIX: Filter wallets to only those needing funding (< 0.1 SOL)
      // This prevents double-funding wallets that already have SOL
      const { getWalletBalance } = await import("../backend/functions-main");
      const BALANCE_THRESHOLD = 0.1; // Only fund wallets with less than 0.1 SOL
      const walletsNeedingFunding = [];

      logger.info(
        `[jobs-premix-funds]: Checking balances to filter wallets needing funding...`
      );

      for (const wallet of buyerWallets) {
        try {
          const balance = await getWalletBalance(wallet.publicKey);
          if (balance < BALANCE_THRESHOLD) {
            walletsNeedingFunding.push({
              ...wallet,
              currentBalance: balance,
            });
          } else {
            logger.info(
              `[jobs-premix-funds]: Skipping wallet ${wallet.publicKey.slice(0, 8)}... (already has ${balance.toFixed(6)} SOL)`
            );
          }
        } catch (error) {
          logger.warn(
            `[jobs-premix-funds]: Failed to check balance for ${wallet.publicKey.slice(0, 8)}..., including in funding list`
          );
          walletsNeedingFunding.push({
            ...wallet,
            currentBalance: 0,
          });
        }
      }

      logger.info(
        `[jobs-premix-funds]: ${walletsNeedingFunding.length} wallets need funding (< ${BALANCE_THRESHOLD} SOL), ${buyerWallets.length - walletsNeedingFunding.length} already funded`
      );

      // Validate we have wallets that need funding
      if (walletsNeedingFunding.length === 0) {
        throw new Error(
          `All ${buyerWallets.length} buyer wallets already have ≥${BALANCE_THRESHOLD} SOL. No wallets need funding.`
        );
      }

      // Phase 3: Calculating distribution
      emitWorkerProgress(
        jobId,
        "premix_funds",
        "funding_wallet",
        data.userId,
        data.userChatId,
        3,
        6,
        "Calculating Distribution",
        `Distributing to ${walletsNeedingFunding.length} empty wallets`,
        35,
        "in_progress"
      );

      // Calculate how many wallets we actually need for this amount
      // Use filtered wallets instead of all wallets
      const walletsNeeded =
        data.maxWallets || calculateRequiredWallets(data.mixAmount);
      const actualWalletsToUse = Math.min(
        walletsNeeded,
        walletsNeedingFunding.length
      );

      // Generate the proper 73-wallet distribution
      const distributionAmounts = generateBuyDistribution(
        data.mixAmount,
        actualWalletsToUse,
        0.01 // randomSeed
      );

      // Get destination addresses (only the wallets that need funding)
      const destinationAddresses = walletsNeedingFunding
        .slice(0, actualWalletsToUse)
        .map((wallet) => wallet.publicKey);

      logger.info(
        `[jobs-premix-funds]: Mixing ${data.mixAmount} SOL to ${actualWalletsToUse} empty wallets (${walletsNeedingFunding.length} available, ${buyerWallets.length} total)`
      );

      // Phase 4: Checking balances
      emitWorkerProgress(
        jobId,
        "premix_funds",
        "funding_wallet",
        data.userId,
        data.userChatId,
        4,
        6,
        "Checking Balances",
        "Verifying funding wallet balance and calculating fees",
        50,
        "in_progress"
      );

      // getWalletBalance already imported above for filtering
      const fundingBalance = await getWalletBalance(fundingWallet.publicKey);

      if (fundingBalance < data.mixAmount + 0.01) {
        // Add buffer for fees
        throw new Error(
          `Insufficient funding wallet balance. Have: ${fundingBalance.toFixed(6)} SOL, Need: ${(data.mixAmount + 0.01).toFixed(6)} SOL`
        );
      }

      // Phase 5: Initializing mixer
      emitWorkerProgress(
        jobId,
        "premix_funds",
        "funding_wallet",
        data.userId,
        data.userChatId,
        5,
        6,
        "Initializing Mixer",
        `Preparing ${data.mode === "fast" ? "fast" : "standard"} mixing operation`,
        70,
        "in_progress"
      );

      // Use the appropriate mixer based on mode
      const { initializeMixerWithCustomAmounts, initializeFastMixer } =
        await import("../blockchain/mixer/init-mixer");

      let mixerResult;
      if (data.mode === "fast") {
        mixerResult = await initializeFastMixer(
          fundingWallet.privateKey,
          fundingWallet.privateKey,
          data.mixAmount,
          destinationAddresses,
          loadingKey
        );
      } else {
        mixerResult = await initializeMixerWithCustomAmounts(
          fundingWallet.privateKey,
          fundingWallet.privateKey,
          destinationAddresses,
          distributionAmounts,
          loadingKey
        );
      }

      // Phase 6: Completing operation
      emitWorkerProgress(
        jobId,
        "premix_funds",
        "funding_wallet",
        data.userId,
        data.userChatId,
        6,
        6,
        "Premix Complete",
        "Funds successfully distributed to buyer wallets",
        100,
        "completed",
        {
          successCount: mixerResult?.successCount || 0,
          totalRoutes: mixerResult?.totalRoutes || actualWalletsToUse,
          walletsUsed: actualWalletsToUse,
          totalWallets: buyerWallets.length,
        }
      );

      await completeLoadingState(loadingKey);

      // Send success notification
      const alreadyFundedCount =
        buyerWallets.length - walletsNeedingFunding.length;
      await sendNotification(
        bot,
        data.userChatId,
        `✅ <b>Premix Complete!</b>\n\n` +
          `Mixed ${data.mixAmount.toFixed(6)} SOL using ${data.mode === "fast" ? "⚡ Fast" : "🔒 Standard"} mode.\n\n` +
          `<b>Distribution:</b>\n` +
          `• Funded: ${actualWalletsToUse} wallets\n` +
          `• Success: ${mixerResult?.successCount || 0}/${mixerResult?.totalRoutes || actualWalletsToUse} transfers\n` +
          `• Available: ${walletsNeedingFunding.length} empty wallets\n` +
          `• Already funded: ${alreadyFundedCount} wallets (skipped)\n` +
          `• Total wallets: ${buyerWallets.length}\n\n` +
          `<i>Your buyer wallets are now ready for token launches!</i>`
      );

      logger.info(
        `[jobs-premix-funds]: Premix completed successfully for user ${data.userId}`
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(
        `[jobs-premix-funds]: Premix failed for user ${data.userId}:`,
        error
      );

      await failLoadingState(loadingKey, errorMessage);

      // Send failure notification
      await sendNotification(
        bot,
        data.userChatId,
        `❌ <b>Premix Failed</b>\n\n` +
          `Error: ${errorMessage}\n\n` +
          `<i>Please try again or check your wallet balance.</i>`
      );

      emitWorkerProgress(
        jobId,
        "premix_funds",
        "funding_wallet",
        data.userId,
        data.userChatId,
        6,
        6,
        "Premix Failed",
        errorMessage,
        0,
        "failed",
        {
          error: errorMessage,
        }
      );

      throw error;
    }
  },
  {
    connection: redisClient,
    concurrency: 1, // Process one premix at a time per worker
  }
);

premixFundsWorker.on("completed", (job) => {
  logger.info(
    `[jobs-premix-funds]: Premix funds job ${job.id} completed successfully`
  );
});

premixFundsWorker.on("failed", (job, err) => {
  logger.error(`[jobs-premix-funds]: Premix funds job ${job?.id} failed:`, err);
});

premixFundsWorker.on("closed", () => {
  logger.info("Premix funds worker closed successfully");
});

// ============ WALLET WARMING WORKER ============

// Helper function to track warming errors
async function trackWarmingError(
  walletId: string,
  stage: number,
  error: Error | string,
  errorType: string,
  platform?: string,
  transactionData?: string,
  retryAttempt: number = 0
) {
  const { WalletModel } = await import("../backend/models");
  const errorMessage = error instanceof Error ? error.message : error;

  await WalletModel.updateOne(
    { _id: walletId },
    {
      $set: {
        "warming.hasError": true,
        "warming.errorStage": stage,
        "warming.errorMessage": errorMessage,
        "warming.errorOccurredAt": new Date(),
        "warming.errorDetails.errorType": errorType,
        "warming.errorDetails.originalError": errorMessage,
        "warming.errorDetails.retryAttempt": retryAttempt,
        "warming.errorDetails.platform": platform,
        "warming.errorDetails.transactionData": transactionData,
        "warming.retryCount": retryAttempt,
        "warming.lastRetryAt": retryAttempt > 0 ? new Date() : undefined,
      },
    }
  );

  logger.error(
    `[jobs-wallet-warming]: Error tracked for wallet ${walletId} at stage ${stage}: ${errorMessage}`
  );
}

// Helper function to track stage timing
async function trackStageCompletion(
  walletId: string,
  stage: number,
  startTime: number,
  signature?: string
) {
  const { WalletModel } = await import("../backend/models");
  const duration = (Date.now() - startTime) / 1000; // Convert to seconds

  const updateFields: Record<string, any> = {};

  // Track stage-specific timings
  switch (stage) {
    case 1:
      updateFields["warming.stageTimings.fundingDuration"] = duration;
      updateFields["warming.isFunded"] = true;
      break;
    case 2:
      updateFields["warming.stageTimings.firstBuyDuration"] = duration;
      updateFields["warming.firstBuyCompleted"] = true;
      updateFields["warming.firstBuySignature"] = signature;
      break;
    case 3:
      updateFields["warming.stageTimings.firstSellDuration"] = duration;
      updateFields["warming.firstSellCompleted"] = true;
      updateFields["warming.firstSellSignature"] = signature;
      break;
    case 4:
      updateFields["warming.stageTimings.secondBuyDuration"] = duration;
      updateFields["warming.secondBuyCompleted"] = true;
      updateFields["warming.secondBuySignature"] = signature;
      break;
    case 5:
      updateFields["warming.stageTimings.secondSellDuration"] = duration;
      updateFields["warming.secondSellCompleted"] = true;
      updateFields["warming.secondSellSignature"] = signature;
      break;
    case 6:
      updateFields["warming.stageTimings.returnDuration"] = duration;
      updateFields["warming.fundsReturned"] = true;
      break;
  }

  updateFields["warming.stage"] = stage + 1;

  await WalletModel.updateOne({ _id: walletId }, { $set: updateFields });

  logger.info(
    `[jobs-wallet-warming]: Stage ${stage} completed for wallet ${walletId} in ${duration.toFixed(2)}s`
  );
}

// Helper function to clear error state on successful retry
async function clearWarmingError(walletId: string) {
  const { WalletModel } = await import("../backend/models");

  await WalletModel.updateOne(
    { _id: walletId },
    {
      $set: {
        "warming.hasError": false,
        "warming.recoveredFromError": true,
      },
      $unset: {
        "warming.errorStage": "",
        "warming.errorMessage": "",
        "warming.errorOccurredAt": "",
        "warming.errorDetails": "",
      },
    }
  );

  logger.info(
    `[jobs-wallet-warming]: Error state cleared for wallet ${walletId} - recovery successful`
  );
}

export const walletWarmingWorker = new Worker<WalletWarmingJob>(
  walletWarmingQueue.name,
  async (job) => {
    const data = job.data;
    const loadingKey = `${data.userChatId}-wallet_warming-${Date.now()}`;
    const jobId = job.id?.toString() || "unknown";

    try {
      logger.info("[jobs]: Comprehensive Wallet Warming Job starting...");
      logger.info("[jobs-wallet-warming]: Job Data", data);

      const { getFundingWallet, getWalletBalance } = await import(
        "../backend/functions-main"
      );
      const { hasSwapHistory } = await import("../backend/wallet-history");
      const { initializeMixerWithCustomAmounts } = await import(
        "../blockchain/mixer/init-mixer"
      );
      const { WalletModel } = await import("../backend/models");
      const { detectTokenPlatformWithCache } = await import(
        "../service/token-detection-service"
      );
      const { executeExternalBuy } = await import(
        "../blockchain/pumpfun/externalBuy"
      );
      const { executeExternalSell } = await import(
        "../blockchain/pumpfun/externalSell"
      );
      const { Keypair } = await import("@solana/web3.js");
      const bs58 = await import("bs58");

      // Validate funding wallet
      const fundingWallet = await getFundingWallet(data.userId);
      if (!fundingWallet) {
        throw new Error("Funding wallet not found");
      }

      // Constants for wallet warming
      const WARMING_AMOUNT = 0.05; // Fixed amount per wallet
      const BUY_AMOUNT = 0.01; // SOL amount for each buy
      const totalRequired = data.walletIds.length * WARMING_AMOUNT + 0.05; // + buffer for fees

      const fundingBalance = await getWalletBalance(fundingWallet.publicKey);
      if (fundingBalance < totalRequired) {
        throw new Error(
          `Insufficient funding wallet balance. Have: ${fundingBalance.toFixed(6)} SOL, Need: ${totalRequired.toFixed(6)} SOL`
        );
      }

      // Detect the warming token platform
      logger.info(
        `[jobs-wallet-warming]: Detecting platform for warming token: ${data.warmingTokenAddress}`
      );
      const platform = await detectTokenPlatformWithCache(
        data.warmingTokenAddress
      );
      logger.info(
        `[jobs-wallet-warming]: Token platform detected as: ${platform}`
      );

      emitWorkerProgress(
        jobId,
        "wallet_warming",
        "warming",
        data.userId,
        data.userChatId,
        1,
        data.walletIds.length * 6 + 2, // 6 stages per wallet + setup/cleanup
        "Warming Started",
        `Preparing to warm ${data.walletIds.length} wallets using ${platform} token`,
        1,
        "started"
      );

      // Get wallet details
      const wallets = await WalletModel.find({
        _id: { $in: data.walletIds },
        user: data.userId,
        isBuyer: true,
      });

      if (wallets.length !== data.walletIds.length) {
        throw new Error(
          `Found ${wallets.length} wallets but expected ${data.walletIds.length}`
        );
      }

      let successCount = 0;
      let failedCount = 0;
      let currentStep = 2;
      const results: Array<{
        walletId: string;
        success: boolean;
        error?: string;
        completedStages: number;
      }> = [];

      // Process each wallet through complete warming cycle
      for (let i = 0; i < wallets.length; i++) {
        const wallet = wallets[i];
        const walletNum = i + 1;
        let completedStages = 0;

        try {
          logger.info(
            `[jobs-wallet-warming]: Processing wallet ${walletNum}/${wallets.length}: ${wallet.publicKey.slice(0, 8)}...`
          );

          // Check if already warmed
          const alreadyWarmed = await hasSwapHistory(wallet.publicKey);
          if (alreadyWarmed) {
            logger.info(
              `[jobs-wallet-warming]: Wallet ${wallet.publicKey.slice(0, 8)}... already warmed, skipping`
            );
            successCount++;
            results.push({
              walletId: wallet._id.toString(),
              success: true,
              completedStages: 6,
            });
            currentStep += 6;
            continue;
          }

          // Initialize warming state in database
          await WalletModel.updateOne(
            { _id: wallet._id },
            {
              $set: {
                "warming.isWarming": true,
                "warming.stage": 1,
                "warming.warmingStartedAt": new Date(),
                "warming.currentWarmingToken.address": data.warmingTokenAddress,
                "warming.currentWarmingToken.assignedAt": new Date(),
              },
            }
          );

          // Stage 1: Fund wallet with 0.05 SOL using custom mixer
          emitWorkerProgress(
            jobId,
            "wallet_warming",
            "warming",
            data.userId,
            data.userChatId,
            currentStep,
            data.walletIds.length * 6 + 2,
            `Funding Wallet ${walletNum}/${wallets.length}`,
            `Sending ${WARMING_AMOUNT} SOL to ${wallet.publicKey.slice(0, 8)}...`,
            Math.floor((currentStep / (data.walletIds.length * 6 + 2)) * 100),
            "in_progress"
          );

          logger.info(
            `[jobs-wallet-warming]: Stage 1 - Funding wallet with ${WARMING_AMOUNT} SOL`
          );

          const stage1StartTime = Date.now();

          try {
            await initializeMixerWithCustomAmounts(
              fundingWallet.privateKey,
              fundingWallet.privateKey,
              [wallet.publicKey],
              [WARMING_AMOUNT],
              loadingKey
            );

            // Wait for balance to settle
            await new Promise((resolve) => setTimeout(resolve, 3000));

            // Verify funding
            const balance = await getWalletBalance(wallet.publicKey);
            if (balance < WARMING_AMOUNT * 0.9) {
              throw new Error(
                `Funding failed: wallet only has ${balance.toFixed(6)} SOL, expected at least ${(WARMING_AMOUNT * 0.9).toFixed(6)} SOL`
              );
            }

            // Track successful stage completion
            await trackStageCompletion(
              wallet._id.toString(),
              1,
              stage1StartTime
            );
            completedStages = 1;
            currentStep++;

            logger.info(
              `[jobs-wallet-warming]: Stage 1 complete - Wallet funded with ${balance.toFixed(6)} SOL`
            );
          } catch (fundingError) {
            await trackWarmingError(
              wallet._id.toString(),
              1,
              fundingError instanceof Error
                ? fundingError
                : new Error(String(fundingError)),
              "funding",
              "mixer",
              `WARMING_AMOUNT: ${WARMING_AMOUNT}, fundingWallet: ${fundingWallet.publicKey}`
            );
            throw fundingError;
          }

          // Create keypair for wallet
          const walletKeypair = Keypair.fromSecretKey(
            bs58.default.decode(wallet.privateKey)
          );

          // Stage 2: First Buy
          emitWorkerProgress(
            jobId,
            "wallet_warming",
            "warming",
            data.userId,
            data.userChatId,
            currentStep,
            data.walletIds.length * 6 + 2,
            `First Buy ${walletNum}/${wallets.length}`,
            `Buying ${BUY_AMOUNT} SOL worth of tokens`,
            Math.floor((currentStep / (data.walletIds.length * 6 + 2)) * 100),
            "in_progress"
          );

          logger.info(
            `[jobs-wallet-warming]: Stage 2 - First buy of ${BUY_AMOUNT} SOL`
          );

          const stage2StartTime = Date.now();

          try {
            const firstBuyResult = await executeExternalBuy(
              data.warmingTokenAddress,
              walletKeypair,
              BUY_AMOUNT,
              3, // 3% slippage
              0.001, // priority fee
              { chat: { id: data.userChatId } } as Context // minimal context for logging
            );

            if (!firstBuyResult.success) {
              throw new Error(
                `First buy failed: ${firstBuyResult.error || "Unknown buy error"}`
              );
            }

            // Track successful stage completion
            await trackStageCompletion(
              wallet._id.toString(),
              2,
              stage2StartTime,
              firstBuyResult.signature
            );
            completedStages = 2;
            currentStep++;

            logger.info(
              `[jobs-wallet-warming]: Stage 2 complete - First buy: ${firstBuyResult.signature}`
            );
          } catch (buyError) {
            await trackWarmingError(
              wallet._id.toString(),
              2,
              buyError instanceof Error
                ? buyError
                : new Error(String(buyError)),
              "buy",
              platform,
              `BUY_AMOUNT: ${BUY_AMOUNT}, token: ${data.warmingTokenAddress}, wallet: ${wallet.publicKey}`
            );
            throw buyError;
          }

          // Wait between buy and sell
          await new Promise((resolve) => setTimeout(resolve, 2000));

          // Stage 3: First Sell (50% of tokens)
          emitWorkerProgress(
            jobId,
            "wallet_warming",
            "warming",
            data.userId,
            data.userChatId,
            currentStep,
            data.walletIds.length * 6 + 2,
            `First Sell ${walletNum}/${wallets.length}`,
            `Selling 50% of tokens`,
            Math.floor((currentStep / (data.walletIds.length * 6 + 2)) * 100),
            "in_progress"
          );

          logger.info(
            `[jobs-wallet-warming]: Stage 3 - First sell (50% of tokens)`
          );

          // Get actual token balance for selling
          const JupiterPumpswapService = (
            await import("../service/jupiter-pumpswap-service")
          ).default;
          const jupiterService = new JupiterPumpswapService();
          let tokenBalance = 0;

          try {
            tokenBalance = await jupiterService.checkTokenBalance(
              data.warmingTokenAddress,
              walletKeypair
            );
            logger.info(
              `[jobs-wallet-warming]: Wallet token balance: ${tokenBalance}`
            );
          } catch {
            // Fallback: Use estimated amount based on recent buy
            tokenBalance = 50000; // Conservative estimate for 0.01 SOL buy
            logger.warn(
              `[jobs-wallet-warming]: Could not get exact token balance, using estimate: ${tokenBalance}`
            );
          }

          const firstSellAmount = Math.floor(tokenBalance * 0.5); // Sell 50% of tokens
          const stage3StartTime = Date.now();
          let firstSellSignature: string | undefined;

          try {
            const firstSellResult = await executeExternalSell(
              data.warmingTokenAddress,
              walletKeypair,
              firstSellAmount,
              { chat: { id: data.userChatId } } as Context // minimal context for logging
            );

            if (!firstSellResult.success) {
              throw new Error(
                `First sell failed: ${firstSellResult.error || "Unknown sell error"}`
              );
            }

            firstSellSignature = firstSellResult.signature;

            // Track successful stage completion
            await trackStageCompletion(
              wallet._id.toString(),
              3,
              stage3StartTime,
              firstSellSignature
            );
            completedStages = 3;
            currentStep++;

            logger.info(
              `[jobs-wallet-warming]: Stage 3 complete - First sell: ${firstSellSignature}`
            );
          } catch (sellError) {
            await trackWarmingError(
              wallet._id.toString(),
              3,
              sellError instanceof Error
                ? sellError
                : new Error(String(sellError)),
              "sell",
              platform,
              `sellAmount: ${firstSellAmount}, tokenBalance: ${tokenBalance}, token: ${data.warmingTokenAddress}`
            );
            throw sellError;
          }

          logger.info(
            `[jobs-wallet-warming]: Stage 3 complete - First sell: ${firstSellSignature}`
          ); // Wait between transactions
          await new Promise((resolve) => setTimeout(resolve, 2000));

          // Stage 4: Second Buy
          emitWorkerProgress(
            jobId,
            "wallet_warming",
            "warming",
            data.userId,
            data.userChatId,
            currentStep,
            data.walletIds.length * 6 + 2,
            `Second Buy ${walletNum}/${wallets.length}`,
            `Buying ${BUY_AMOUNT} SOL worth of tokens again`,
            Math.floor((currentStep / (data.walletIds.length * 6 + 2)) * 100),
            "in_progress"
          );

          logger.info(
            `[jobs-wallet-warming]: Stage 4 - Second buy of ${BUY_AMOUNT} SOL`
          );

          const stage4StartTime = Date.now();
          let secondBuySignature: string | undefined;

          try {
            const secondBuyResult = await executeExternalBuy(
              data.warmingTokenAddress,
              walletKeypair,
              BUY_AMOUNT,
              3, // 3% slippage
              0.001, // priority fee
              { chat: { id: data.userChatId } } as Context // minimal context for logging
            );

            if (!secondBuyResult.success) {
              throw new Error(
                `Second buy failed: ${secondBuyResult.error || "Unknown buy error"}`
              );
            }

            secondBuySignature = secondBuyResult.signature;

            // Track successful stage completion
            await trackStageCompletion(
              wallet._id.toString(),
              4,
              stage4StartTime,
              secondBuySignature
            );
            completedStages = 4;
            currentStep++;

            logger.info(
              `[jobs-wallet-warming]: Stage 4 complete - Second buy: ${secondBuySignature}`
            );
          } catch (buyError) {
            await trackWarmingError(
              wallet._id.toString(),
              4,
              buyError instanceof Error
                ? buyError
                : new Error(String(buyError)),
              "buy",
              platform,
              `buyAmount: ${BUY_AMOUNT} SOL, slippage: 3%, priorityFee: 0.001, token: ${data.warmingTokenAddress}`
            );
            throw buyError;
          }

          // Wait between buy and sell
          await new Promise((resolve) => setTimeout(resolve, 2000));

          // Stage 5: Second Sell (remaining tokens)
          emitWorkerProgress(
            jobId,
            "wallet_warming",
            "warming",
            data.userId,
            data.userChatId,
            currentStep,
            data.walletIds.length * 6 + 2,
            `Second Sell ${walletNum}/${wallets.length}`,
            `Selling remaining tokens`,
            Math.floor((currentStep / (data.walletIds.length * 6 + 2)) * 100),
            "in_progress"
          );

          logger.info(
            `[jobs-wallet-warming]: Stage 5 - Second sell (remaining tokens)`
          );

          // Get current token balance for final sell (sell all remaining tokens)
          let remainingTokens = 0;
          try {
            remainingTokens = await jupiterService.checkTokenBalance(
              data.warmingTokenAddress,
              walletKeypair
            );
            logger.info(
              `[jobs-wallet-warming]: Current token balance for final sell: ${remainingTokens}`
            );
          } catch {
            // Fallback: Estimate remaining tokens (original balance + second buy - first sell)
            remainingTokens = Math.floor(tokenBalance * 0.5) + 50000; // Remaining 50% + estimated second buy
            logger.warn(
              `[jobs-wallet-warming]: Could not get exact remaining balance, using estimate: ${remainingTokens}`
            );
          }

          const stage5StartTime = Date.now();
          let secondSellSignature: string | undefined;

          try {
            const secondSellResult = await executeExternalSell(
              data.warmingTokenAddress,
              walletKeypair,
              remainingTokens,
              { chat: { id: data.userChatId } } as Context // minimal context for logging
            );

            if (!secondSellResult.success) {
              throw new Error(
                `Second sell failed: ${secondSellResult.error || "Unknown sell error"}`
              );
            }

            secondSellSignature = secondSellResult.signature;

            // Track successful stage completion
            await trackStageCompletion(
              wallet._id.toString(),
              5,
              stage5StartTime,
              secondSellSignature
            );
            completedStages = 5;
            currentStep++;

            logger.info(
              `[jobs-wallet-warming]: Stage 5 complete - Second sell: ${secondSellSignature}`
            );
          } catch (sellError) {
            await trackWarmingError(
              wallet._id.toString(),
              5,
              sellError instanceof Error
                ? sellError
                : new Error(String(sellError)),
              "sell",
              platform,
              `sellAmount: ${remainingTokens}, tokenBalance: ${remainingTokens}, token: ${data.warmingTokenAddress}`
            );
            throw sellError;
          }

          // Stage 6: Return funds to funding wallet using custom mixer
          emitWorkerProgress(
            jobId,
            "wallet_warming",
            "warming",
            data.userId,
            data.userChatId,
            currentStep,
            data.walletIds.length * 6 + 2,
            `Returning Funds ${walletNum}/${wallets.length}`,
            `Sending remaining SOL back to funding wallet`,
            Math.floor((currentStep / (data.walletIds.length * 6 + 2)) * 100),
            "in_progress"
          );

          logger.info(
            `[jobs-wallet-warming]: Stage 6 - Returning funds to funding wallet`
          );

          const stage6StartTime = Date.now();
          let returnAmount: number = 0;

          try {
            // Get current balance and return most of it (leave small amount for rent)
            const currentBalance = await getWalletBalance(wallet.publicKey);
            returnAmount = Math.max(0, currentBalance - 0.005); // Leave 0.005 SOL for rent

            if (returnAmount > 0.001) {
              await initializeMixerWithCustomAmounts(
                wallet.privateKey,
                wallet.privateKey,
                [fundingWallet.publicKey],
                [returnAmount],
                loadingKey
              );
            }

            // Track successful stage completion
            await trackStageCompletion(
              wallet._id.toString(),
              6,
              stage6StartTime
            );

            // Clear any warming errors since we completed successfully
            await clearWarmingError(wallet._id.toString());

            completedStages = 6;
            currentStep++;

            logger.info(
              `[jobs-wallet-warming]: Stage 6 complete - Wallet ${wallet.publicKey.slice(0, 8)}... fully warmed!`
            );
          } catch (returnError) {
            await trackWarmingError(
              wallet._id.toString(),
              6,
              returnError instanceof Error
                ? returnError
                : new Error(String(returnError)),
              "transfer",
              platform,
              `returnAmount: ${returnAmount}, fundingWallet: ${fundingWallet.publicKey}`
            );
            throw returnError;
          }

          successCount++;
          results.push({
            walletId: wallet._id.toString(),
            success: true,
            completedStages: 6,
          });
        } catch (walletError) {
          const errorMessage =
            walletError instanceof Error
              ? walletError.message
              : "Unknown error";
          logger.error(
            `[jobs-wallet-warming]: Failed to warm wallet ${wallet.publicKey}:`,
            walletError
          );

          // Update database to reflect partial completion
          await WalletModel.updateOne(
            { _id: wallet._id },
            {
              $set: {
                "warming.isWarming": false,
                "warming.stage": 0, // Reset on failure
              },
            }
          );

          failedCount++;
          results.push({
            walletId: wallet._id.toString(),
            success: false,
            error: errorMessage,
            completedStages,
          });

          // Still increment currentStep for remaining stages of this wallet
          currentStep += 6 - completedStages;
        }
      }

      // Complete
      emitWorkerProgress(
        jobId,
        "wallet_warming",
        "warming",
        data.userId,
        data.userChatId,
        data.walletIds.length * 6 + 2,
        data.walletIds.length * 6 + 2,
        "Warming Complete",
        `Successfully warmed ${successCount}/${wallets.length} wallets`,
        100,
        "completed",
        {
          successCount,
          failedCount,
          total: wallets.length,
          results,
          platform,
          warmingToken: data.warmingTokenAddress,
        }
      );

      await completeLoadingState(loadingKey);

      // Send notification
      await sendNotification(
        bot,
        data.userChatId,
        `✅ <b>Comprehensive Wallet Warming Complete!</b>\n\n` +
          `<b>Results:</b>\n` +
          `• Successfully warmed: ${successCount} wallets\n` +
          `• Failed: ${failedCount} wallets\n` +
          `• Total processed: ${wallets.length} wallets\n\n` +
          `<b>Warming Process:</b>\n` +
          `• Platform: ${platform.toUpperCase()}\n` +
          `• Token: ${data.warmingTokenAddress.slice(0, 8)}...\n` +
          `• Each wallet completed: Fund → Buy → Sell → Buy → Sell → Return\n\n` +
          `<i>Your buyer wallets now have comprehensive transaction history!</i>`
      );

      logger.info(
        `[jobs-wallet-warming]: Comprehensive warming completed for user ${data.userId}`
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(
        `[jobs-wallet-warming]: Warming failed for user ${data.userId}:`,
        error
      );

      await failLoadingState(loadingKey, errorMessage);

      await sendNotification(
        bot,
        data.userChatId,
        `❌ <b>Wallet Warming Failed</b>\n\n` +
          `Error: ${errorMessage}\n\n` +
          `<i>Please check your funding wallet balance and try again.</i>`
      );

      emitWorkerProgress(
        jobId,
        "wallet_warming",
        "warming",
        data.userId,
        data.userChatId,
        1,
        1,
        "Warming Failed",
        errorMessage,
        0,
        "failed",
        {
          error: errorMessage,
        }
      );

      throw error;
    }
  },
  {
    connection: redisClient,
    concurrency: 1, // Process one warming job at a time
  }
);

walletWarmingWorker.on("completed", (job) => {
  logger.info(
    `[jobs-wallet-warming]: Wallet warming job ${job.id} completed successfully`
  );
});

walletWarmingWorker.on("failed", (job, err) => {
  logger.error(
    `[jobs-wallet-warming]: Wallet warming job ${job?.id} failed:`,
    err
  );
});

walletWarmingWorker.on("closed", () => {
  logger.info("Wallet warming worker closed successfully");
});
