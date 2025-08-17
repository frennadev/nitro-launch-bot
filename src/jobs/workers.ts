import { Worker } from "bullmq";
import {
  tokenLaunchQueue,
  devSellQueue,
  walletSellQueue,
  prepareLaunchQueue,
  executeLaunchQueue,
} from "./queues";
import type {
  LaunchTokenJob,
  PrepareTokenLaunchJob,
  ExecuteTokenLaunchJob,
  SellDevJob,
  SellWalletJob,
} from "./types";
import { redisClient } from "./db";
import {
  releaseDevSellLock,
  releaseWalletSellLock,
  updateTokenState,
  handleTokenLaunchFailure,
  enqueueExecuteTokenLaunch,
  getTransactionFinancialStats,
  getTransactionStats,
  getAccurateSpendingStats,
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
import { executeDevSell, executeWalletSell } from "../blockchain/pumpfun/sell";
import { logger } from "./logger";
import {
  updateLoadingState,
  completeLoadingState,
  failLoadingState,
  updateMixerProgress,
  updateMixerStatus,
  startMixerHeartbeat,
} from "../bot/loading";
import { Keypair } from "@solana/web3.js";
import { connection } from "../service/config";

export const launchTokenWorker = new Worker<LaunchTokenJob>(
  tokenLaunchQueue.name,
  async (job) => {
    const data = job.data;
    const loadingKey = `${data.userChatId}-token_launch-${data.tokenAddress}`;

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
        "normal"
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
    const loadingKey = `${data.userChatId}-dev_sell-${data.tokenAddress}`;

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
    const loadingKey = `${data.userChatId}-wallet_sell-${data.tokenAddress}`;
    const logIdentifier = `jobs-sell-wallet-${data.tokenAddress}`;

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

      // Complete loading state with detailed information
      await completeLoadingState(
        loadingKey,
        undefined,
        `<b>💸 Wallet Sells Complete</b>\n\n` +
          `✅ <b>Success Rate:</b> ${sellSummary.successfulWallets}/${sellSummary.totalWallets} wallets (${sellSummary.successRate}%)\n` +
          `💰 <b>SOL Received:</b> ${sellSummary.solReceived.toFixed(6)} SOL\n` +
          `🪙 <b>Tokens Sold:</b> ${tokensSoldFormatted} tokens (${data.sellPercent}%)\n\n` +
          `📊 <b>Overall Performance:</b>\n` +
          `   • <b>Total P&L:</b> ${sellSummary.isProfit ? "🟢" : "🔴"} ${sellSummary.netProfitLoss >= 0 ? "+" : ""}${sellSummary.netProfitLoss.toFixed(6)} SOL\n` +
          `   • <b>Return:</b> ${sellSummary.profitLossPercentage >= 0 ? "📈" : "📉"} ${sellSummary.profitLossPercentage >= 0 ? "+" : ""}${sellSummary.profitLossPercentage.toFixed(1)}%\n\n` +
          `${sellSummary.failedWallets > 0 ? `⚠️ ${sellSummary.failedWallets} wallet(s) failed to sell\n\n` : ""}` +
          `🎯 <b>All wallet sells completed successfully!</b>`
      );

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
        // Always send a new message as well
        await bot.api.sendMessage(data.userChatId, finalMessage, {
          parse_mode: "HTML",
        });
      } catch (error) {
        logger.warn(
          `[${logIdentifier}] Failed to edit notification, sending new message:`,
          error
        );
        // Fallback: send new message if editing fails
        await sendNotification(bot, data.userChatId, finalMessage);
      }
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
    const loadingKey = `${data.userChatId}-prepare_launch-${data.tokenAddress}`;

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

export const executeLaunchWorker = new Worker<ExecuteTokenLaunchJob>(
  executeLaunchQueue.name,
  async (job) => {
    const data = job.data;
    const loadingKey = `${data.userChatId}-execute_launch-${data.tokenAddress}`;

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
    } catch (error: any) {
      logger.error(
        "[jobs-execute-launch]: Error Occurred while executing token launch",
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
    "❌ Dev Wallet Sell Failed. Please try again 🔄"
  );
});
sellDevWorker.on("closed", () => {
  logger.error("Dev Sell Worker closed successfully");
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
    "❌ Wallet Sells Failed. Please try again 🔄"
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
