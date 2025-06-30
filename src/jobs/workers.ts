import { Worker } from "bullmq";
import { tokenLaunchQueue, devSellQueue, walletSellQueue, prepareLaunchQueue, executeLaunchQueue } from "./queues";
import type { LaunchTokenJob, PrepareTokenLaunchJob, ExecuteTokenLaunchJob, SellDevJob, SellWalletJob } from "./types";
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
import { executeTokenLaunch, prepareTokenLaunch } from "../blockchain/pumpfun/launch";
import { executeDevSell, executeWalletSell } from "../blockchain/pumpfun/sell";
import { logger } from "./logger";
import { updateLoadingState, completeLoadingState, failLoadingState, updateMixerProgress, updateMixerStatus, startMixerHeartbeat } from "../bot/loading";

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
      );
      
      // Update loading state - Phase 5: Finalizing
      await updateLoadingState(loadingKey, 5);
      
      await updateTokenState(data.tokenAddress, TokenState.LAUNCHED, data.userId);
      
      // Release pump address on successful launch
      const { releasePumpAddress } = await import("../backend/functions");
      await releasePumpAddress(data.tokenAddress);
      logger.info(`Released pump address ${data.tokenAddress} after successful launch`);
      
      // Complete loading state
      await completeLoadingState(
        loadingKey,
        undefined,
        `**Token:** ${data.tokenName} ($${data.tokenSymbol})\n**Address:** \`${data.tokenAddress}\``
      );
      
      await sendLaunchSuccessNotification(
        data.userChatId,
        data.tokenAddress,
        data.tokenName,
        data.tokenSymbol,
      );
    } catch (error: any) {
      logger.error(
        "[jobs-launch-token]: Error Occurred while launching token",
        error,
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
  },
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
      
      const result = await executeDevSell(
        data.tokenAddress,
        data.devWallet,
        data.sellPercent,
      );
      
      // Update loading state - Phase 3: Confirming
      await updateLoadingState(loadingKey, 3);
      
      await releaseDevSellLock(data.tokenAddress);
      
      // Get transaction stats and financial data for detailed reporting
      const transactionStats = await getTransactionStats(data.tokenAddress);
      const financialStats = await getAccurateSpendingStats(data.tokenAddress);
      
      // Calculate sell-specific statistics
      const devSellTransactions = transactionStats.byType.dev_sell.filter((t: any) => t.success);
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
      const tokensSoldFormatted = (Number(sellSummary.tokensSold) / 1e6).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      });
      
      // Complete loading state with detailed information
      await completeLoadingState(
        loadingKey,
        undefined,
        `**💸 Dev Sell Complete**\n\n` +
        `**SOL Received:** ${sellSummary.solReceived.toFixed(6)} SOL\n` +
        `**Tokens Sold:** ${tokensSoldFormatted} tokens (${data.sellPercent}%)\n` +
        `**Transaction:** [View on Solscan](https://solscan.io/tx/${result.signature})\n\n` +
        `**Overall P&L:** ${sellSummary.isProfit ? '🟢' : '🔴'} ${sellSummary.netProfitLoss >= 0 ? '+' : ''}${sellSummary.netProfitLoss.toFixed(6)} SOL (${sellSummary.profitLossPercentage >= 0 ? '+' : ''}${sellSummary.profitLossPercentage.toFixed(1)}%)`
      );
      
      await sendNotification(
        data.userChatId,
        `🎉 **Dev Sell completed successfully\\!**\n\n` +
        `💰 **Received:** ${sellSummary.solReceived.toFixed(6).replace(/\./g, '\\.')} SOL\n` +
        `🪙 **Sold:** ${tokensSoldFormatted.replace(/\./g, '\\.')} tokens \\(${data.sellPercent}%\\)\n` +
        `📊 **Overall P&L:** ${sellSummary.isProfit ? '🟢' : '🔴'} ${sellSummary.netProfitLoss >= 0 ? '\\+' : '\\-'}${Math.abs(sellSummary.netProfitLoss).toFixed(6).replace(/\./g, '\\.')} SOL \\(${sellSummary.profitLossPercentage >= 0 ? '\\+' : '\\-'}${Math.abs(sellSummary.profitLossPercentage).toFixed(1).replace(/\./g, '\\.')}%\\)\n\n` +
        `[View Transaction](https://solscan\\.io/tx/${result.signature})`,
      );
    } catch (error: any) {
      logger.error(
        "[jobs-sell-dev]: Error Occurred while selling dev supply",
        error,
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
  },
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
      
      const results = await executeWalletSell(
        data.tokenAddress,
        data.buyerWallets,
        data.devWallet,
        data.sellPercent,
      );
      
      // Update loading state - Phase 3: Confirming
      await updateLoadingState(loadingKey, 3);
      
      await releaseWalletSellLock(data.tokenAddress);
      
      // Calculate immediate sell statistics
      const successfulSells = results.filter(r => r.success);
      const failedSells = results.filter(r => !r.success);
      const immediateSuccessRate = Math.round((successfulSells.length / results.length) * 100);
      
      // Send immediate success notification with basic info
      const initialMessage = `🎉 **Wallet Sells completed successfully\\!**\n\n` +
        `✅ **Success Rate:** ${successfulSells.length}/${results.length} wallets \\(${immediateSuccessRate}%\\)\n` +
        `💰 **Total Received:** Calculating\\.\\.\\.\n` +
        `🪙 **Tokens Sold:** Calculating\\.\\.\\.\n` +
        `📊 **Overall P&L:** Calculating\\.\\.\\.\n\n` +
        `${failedSells.length > 0 ? `⚠️ ${failedSells.length} wallet\\(s\\) failed to sell\n\n` : ''}` +
        `⏳ **Fetching detailed transaction data\\.\\.\\.**`;
      
      const initialNotification = await bot.api.sendMessage(data.userChatId, initialMessage, { 
        parse_mode: "MarkdownV2" 
      });
      
      // Wait for transaction confirmation and parsing (3-5 seconds)
      logger.info(`[${logIdentifier}] Waiting 4 seconds for transaction parsing to complete...`);
      await new Promise(resolve => setTimeout(resolve, 4000));
      
      // Now get accurate transaction stats and financial data
      const transactionStats = await getTransactionStats(data.tokenAddress);
      const financialStats = await getAccurateSpendingStats(data.tokenAddress);
      
      // Calculate wallet sell-specific statistics
      const walletSellTransactions = transactionStats.byType.wallet_sell.filter((t: any) => t.success);
      
      // Calculate totals from this sell batch
      const totalSolReceived = successfulSells.reduce((sum, r) => sum + (r.expectedSolOut || 0), 0);
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
        successRate: Math.round((successfulSells.length / results.length) * 100),
      };
      
      // Format tokens sold for display
      const tokensSoldFormatted = (Number(sellSummary.tokensSold) / 1e6).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      });
      
      // Complete loading state with detailed information
      await completeLoadingState(
        loadingKey,
        undefined,
        `**💸 Wallet Sells Complete**\n\n` +
        `**Successful:** ${sellSummary.successfulWallets}/${sellSummary.totalWallets} wallets (${sellSummary.successRate}%)\n` +
        `**SOL Received:** ${sellSummary.solReceived.toFixed(6)} SOL\n` +
        `**Tokens Sold:** ${tokensSoldFormatted} tokens (${data.sellPercent}%)\n\n` +
        `**Overall P&L:** ${sellSummary.isProfit ? '🟢' : '🔴'} ${sellSummary.netProfitLoss >= 0 ? '+' : ''}${sellSummary.netProfitLoss.toFixed(6)} SOL (${sellSummary.profitLossPercentage >= 0 ? '+' : ''}${sellSummary.profitLossPercentage.toFixed(1)}%)`
      );
      
      // Update the initial notification with accurate data
      const finalMessage = `🎉 **Wallet Sells completed successfully\\!**\n\n` +
        `✅ **Success Rate:** ${sellSummary.successfulWallets}/${sellSummary.totalWallets} wallets \\(${sellSummary.successRate}%\\)\n` +
        `💰 **Total Received:** ${sellSummary.solReceived.toFixed(6).replace(/\./g, '\\.')} SOL\n` +
        `🪙 **Tokens Sold:** ${tokensSoldFormatted.replace(/\./g, '\\.')} tokens \\(${data.sellPercent}%\\)\n` +
        `📊 **Overall P&L:** ${sellSummary.isProfit ? '🟢' : '🔴'} ${sellSummary.netProfitLoss >= 0 ? '\\+' : '\\-'}${Math.abs(sellSummary.netProfitLoss).toFixed(6).replace(/\./g, '\\.')} SOL \\(${sellSummary.profitLossPercentage >= 0 ? '\\+' : '\\-'}${Math.abs(sellSummary.profitLossPercentage).toFixed(1).replace(/\./g, '\\.')}%\\)\n\n` +
        `${sellSummary.failedWallets > 0 ? `⚠️ ${sellSummary.failedWallets} wallet\\(s\\) failed to sell\n\n` : ''}` +
        `💡 View individual transactions in your token list for more details\\.`;
      
      try {
        await bot.api.editMessageText(data.userChatId, initialNotification.message_id, finalMessage, {
          parse_mode: "MarkdownV2"
        });
        logger.info(`[${logIdentifier}] Updated notification with accurate transaction data`);
      } catch (error) {
        logger.warn(`[${logIdentifier}] Failed to edit notification, sending new message:`, error);
        // Fallback: send new message if editing fails
        await sendNotification(data.userChatId, finalMessage);
      }
    } catch (error: any) {
      logger.error(
        "[jobs-sell-wallet]: Error Occurred while selling wallet supply",
        error,
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
  },
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
      
      // Update loading state - Phase 2: Initializing mixer
      await updateLoadingState(loadingKey, 2);
      
      // Start heartbeat for long mixing operations (with safety wrapper)
      let heartbeatInterval: NodeJS.Timeout | null = null;
      try {
        heartbeatInterval = startMixerHeartbeat(loadingKey, 15);
      } catch (heartbeatError) {
        // If heartbeat fails to start, log but continue with operation
        logger.warn("Failed to start mixer heartbeat, continuing without it:", heartbeatError);
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
        `**Token:** ${data.tokenName} ($${data.tokenSymbol})\n**Status:** Ready for launch`
      );
      
      // Automatically enqueue the execution phase
      const executeResult = await enqueueExecuteTokenLaunch(
        data.userId,
        data.userChatId,
        data.tokenAddress
      );
      
      if (!executeResult.success) {
        throw new Error(`Failed to enqueue execution phase: ${executeResult.message}`);
      }
      
      await sendNotification(
        data.userChatId,
        `🛠️ **Preparation Complete\\!**\n\n✅ Wallets funded via mixer\n\n🚀 **Now launching your token\\.\\.\\.**`,
      );
      
    } catch (error: any) {
      logger.error(
        "[jobs-prepare-launch]: Error Occurred while preparing token launch",
        error,
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
  },
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
      const buyDistribution = generateBuyDistribution(data.buyAmount, data.buyerWallets.length);
      
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
      );
      
      // Update loading state - Phase 3: Finalizing
      await updateLoadingState(loadingKey, 3);
      
      await updateTokenState(data.tokenAddress, TokenState.LAUNCHED, data.userId);
      
      // Release pump address on successful launch
      const { releasePumpAddress } = await import("../backend/functions");
      await releasePumpAddress(data.tokenAddress);
      logger.info(`Released pump address ${data.tokenAddress} after successful launch`);
      
      // Complete loading state
      await completeLoadingState(
        loadingKey,
        undefined,
        `**Token:** ${data.tokenName} ($${data.tokenSymbol})\n**Address:** \`${data.tokenAddress}\``
      );
      
      await sendLaunchSuccessNotification(
        data.userChatId,
        data.tokenAddress,
        data.tokenName,
        data.tokenSymbol,
      );
    } catch (error: any) {
      logger.error(
        "[jobs-execute-launch]: Error Occurred while executing token launch",
        error,
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
  },
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
  await updateTokenState(job!.data.tokenAddress, TokenState.LISTED, job!.data.userId);
  
  // Handle pump address release on launch failure with error context
  await handleTokenLaunchFailure(job!.data.tokenAddress, job?.failedReason);
  
  const token = job!.data;
  await sendLaunchFailureNotification(
    job!.data.userChatId,
    token.tokenAddress,
    token.tokenName,
    token.tokenSymbol,
  );
});
launchTokenWorker.on("closed", () => {
  logger.info("Launch Token worker closed successfully")
})

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
    job!.data.userChatId,
    "❌ Dev Wallet Sell Failed\\. Please try again 🔄",
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
    job!.data.userChatId,
    "❌ Wallet Sells Failed\\. Please try again 🔄",
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
  await updateTokenState(job!.data.tokenAddress, TokenState.LISTED, job!.data.userId);
  
  const token = job!.data;
  await sendNotification(
    job!.data.userChatId,
    `❌ **Token preparation failed**\n\nToken: ${token.tokenName} \\($${token.tokenSymbol}\\)\n\n🔄 You can try again from your tokens list\\.`,
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
  await updateTokenState(job!.data.tokenAddress, TokenState.LISTED, job!.data.userId);
  
  // Handle pump address release on execution failure with error context
  await handleTokenLaunchFailure(job!.data.tokenAddress, job?.failedReason);
  
  const token = job!.data;
  await sendLaunchFailureNotification(
    job!.data.userChatId,
    token.tokenAddress,
    token.tokenName,
    token.tokenSymbol,
  );
});
executeLaunchWorker.on("closed", () => {
  logger.info("Execute launch worker closed successfully")
});
