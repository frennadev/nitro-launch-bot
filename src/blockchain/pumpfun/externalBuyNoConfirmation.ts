import { Keypair, PublicKey } from "@solana/web3.js";
import { Context } from "grammy";
import { connection } from "../../service/config";
import { logger } from "../common/logger";
import { getSolBalance } from "../../backend/utils";
import { JupiterPumpswapService } from "../../service/jupiter-pumpswap-service";
import bs58 from "bs58";

export interface ExternalBuyResult {
  success: boolean;
  signature: string;
  error?: string;
  platform?: "jupiter" | "pumpswap" | "pumpfun" | "bonk" | "cpmm" | "unknown";
  solReceived?: string;
}

/**
 * Execute external token buy WITHOUT waiting for confirmation (for CTO operations)
 * Automatically detects platform and uses appropriate buy logic
 */
export async function executeExternalBuyNoConfirmation(
  tokenAddress: string,
  buyerKeypair: Keypair,
  solAmount: number,
  slippage: number = 3, // Default slippage percentage
  priorityFee: number = 0.001, // Default priority fee in SOL
  ctx: Context
): Promise<ExternalBuyResult> {
  const logId = `external-buy-no-confirm-${tokenAddress.substring(0, 8)}`;

  try {
    logger.info(`[${logId}] Starting external token buy (no confirmation) for ${solAmount} SOL`);
    const solBalance = await getSolBalance(buyerKeypair.publicKey.toString());
    const solBuyAmount = 0.95 * solBalance; // this is 95% of wallet sol balance

    // First, detect the platform to use the appropriate buy logic
    const { detectTokenPlatformWithCache } = await import(
      "../../service/token-detection-service"
    );
    const platform = await detectTokenPlatformWithCache(tokenAddress);

    logger.info(
      `[${logId}] Detected platform: ${platform} for token ${tokenAddress}`
    );

    // Use platform-specific buy logic
    if (platform === "bonk") {
      logger.info(`[${logId}] Using Bonk-specific buy logic (no confirmation)`);
      return await executeBonkBuyNoConfirmation(tokenAddress, buyerKeypair, solAmount, logId);
    } else if (platform === "cpmm") {
      logger.info(`[${logId}] Using CPMM-specific buy logic (no confirmation)`);
      return await executeCpmmBuyNoConfirmation(tokenAddress, buyerKeypair, solAmount, logId);
    } else {
      logger.info(
        `[${logId}] Using unified Jupiter-PumpSwap service for ${platform} platform (no confirmation)`
      );
      
      // CRITICAL FIX: Check wallet balance and reserve SOL for transaction costs
      const walletBalance = await connection.getBalance(buyerKeypair.publicKey, "confirmed");
      const walletBalanceSOL = walletBalance / 1_000_000_000;
      
      // Reserve fees for buy transaction AND account creation costs
      const transactionFeeReserve = 0.01; // Priority fees + base fees for current buy
      const accountCreationReserve = 0.008; // ATA creation costs (WSOL + token accounts)
      const totalFeeReserve = transactionFeeReserve + accountCreationReserve;
      const availableForTrade = walletBalanceSOL - totalFeeReserve;
      
      logger.info(`[${logId}] Wallet balance: ${walletBalanceSOL.toFixed(6)} SOL`);
      logger.info(`[${logId}] Transaction fee reserve: ${transactionFeeReserve.toFixed(6)} SOL`);
      logger.info(`[${logId}] Account creation reserve: ${accountCreationReserve.toFixed(6)} SOL`);
      logger.info(`[${logId}] Total fee reserve: ${totalFeeReserve.toFixed(6)} SOL`);
      logger.info(`[${logId}] Available for trade: ${availableForTrade.toFixed(6)} SOL`);
      
      // Validate we have enough balance
      if (availableForTrade <= 0) {
        const errorMsg = `Insufficient balance: ${walletBalanceSOL.toFixed(6)} SOL available, need at least ${totalFeeReserve.toFixed(6)} SOL for fees`;
        logger.error(`[${logId}] ${errorMsg}`);
        return {
          success: false,
          signature: '',
          error: errorMsg
        };
      }
      
      // Use the minimum of requested amount or available balance
      const actualTradeAmount = Math.min(solAmount, availableForTrade);
      
      if (actualTradeAmount < solAmount) {
        logger.warn(`[${logId}] Adjusted trade amount from ${solAmount} SOL to ${actualTradeAmount.toFixed(6)} SOL due to fee reservations`);
      }
      
      // Use the unified Jupiter-Pumpswap service for PumpFun/PumpSwap/Jupiter tokens
      const jupiterPumpswapService = new JupiterPumpswapService();

      const result = await jupiterPumpswapService.executeBuy(
        tokenAddress,
        buyerKeypair,
        actualTradeAmount, // Use adjusted amount instead of solBuyAmount
        3 // 3% slippage
      );

      if (result.success) {
        logger.info(
          `[${logId}] External buy sent successfully via ${result.platform}: ${result.signature}`
        );
        return {
          success: true,
          signature: result.signature,
          platform: result.platform,
          solReceived: result.actualSolSpent || actualTradeAmount.toString(),
        };
      } else {
        logger.error(`[${logId}] External buy failed to send: ${result.error}`);
        return {
          success: false,
          signature: "",
          error: result.error || "External buy failed",
        };
      }
    }
  } catch (error: any) {
    logger.error(`[${logId}] External buy failed with error:`, error);
    return {
      success: false,
      signature: "",
      platform: "unknown",
      error: `External buy error: ${error.message}`,
    };
  }
}

/**
 * Execute Bonk-specific buy using BonkService (WITHOUT confirmation)
 */
async function executeBonkBuyNoConfirmation(
  tokenAddress: string,
  buyerKeypair: Keypair,
  solAmount: number,
  logId: string
): Promise<ExternalBuyResult> {
  try {
    logger.info(`[${logId}] Starting Bonk buy (no confirmation) for ${solAmount} SOL`);
    
    // CRITICAL FIX: Pre-adjust amount to match BonkService's balance requirements
    const walletBalance = await connection.getBalance(buyerKeypair.publicKey, "confirmed");
    const walletBalanceSOL = walletBalance / 1_000_000_000;
    
    // Use same fee reserves as BonkService
    const transactionFeeReserve = 0.01; // Priority fees + base fees for current buy
    const accountCreationReserve = 0.008; // ATA creation costs (WSOL + token accounts)
    const totalFeeReserve = transactionFeeReserve + accountCreationReserve;
    const availableForTrade = walletBalanceSOL - totalFeeReserve;
    
    logger.info(`[${logId}] Wallet balance: ${walletBalanceSOL.toFixed(6)} SOL`);
    logger.info(`[${logId}] Transaction fee reserve: ${transactionFeeReserve.toFixed(6)} SOL`);
    logger.info(`[${logId}] Account creation reserve: ${accountCreationReserve.toFixed(6)} SOL`);
    logger.info(`[${logId}] Total fee reserve: ${totalFeeReserve.toFixed(6)} SOL`);
    logger.info(`[${logId}] Available for trade: ${availableForTrade.toFixed(6)} SOL`);
    
    // Validate we have enough balance
    if (availableForTrade <= 0) {
      const errorMsg = `Insufficient balance: ${walletBalanceSOL.toFixed(6)} SOL available, need at least ${totalFeeReserve.toFixed(6)} SOL for fees`;
      logger.error(`[${logId}] ${errorMsg}`);
      return {
        success: false,
        signature: '',
        error: errorMsg
      };
    }
    
    // Use the minimum of requested amount or available balance
    const actualTradeAmount = Math.min(solAmount, availableForTrade);
    
    if (actualTradeAmount < solAmount) {
      logger.warn(`[${logId}] Adjusted trade amount from ${solAmount} SOL to ${actualTradeAmount.toFixed(6)} SOL due to fee reservations`);
    }
    
    // Import BonkService
    const BonkService = (await import("../../service/bonk-service")).default;
    
    // Create BonkService instance with default config
    const bonkService = new BonkService();
    
    logger.info(`[${logId}] Creating Bonk buy transaction for ${actualTradeAmount.toFixed(6)} SOL...`);
    
    // Create the buy transaction with the adjusted amount
    const buyTx = await bonkService.buyTx({
      mint: new PublicKey(tokenAddress),
      amount: BigInt(Math.floor(actualTradeAmount * 1_000_000_000)), // Use adjusted amount
      privateKey: bs58.encode(buyerKeypair.secretKey),
    });
    
    logger.info(`[${logId}] Sending Bonk buy transaction (no confirmation wait)...`);
    
    // Send the transaction WITHOUT waiting for confirmation
    const signature = await connection.sendTransaction(buyTx, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    });
    
    logger.info(`[${logId}] Bonk buy transaction sent successfully: ${signature} (confirmation will happen in background)`);
    
    return {
      success: true,
      signature: signature,
      platform: "bonk",
      solReceived: actualTradeAmount.toString() // Return the actual amount that was traded
    };
    
  } catch (error: any) {
    logger.error(`[${logId}] Bonk buy error: ${error.message}`);
    return {
      success: false,
      signature: '',
      error: `Bonk buy failed: ${error.message}`
    };
  }
}

/**
 * Execute CPMM-specific buy using RaydiumCpmmService (WITHOUT confirmation)
 */
async function executeCpmmBuyNoConfirmation(
  tokenAddress: string,
  buyerKeypair: Keypair,
  solAmount: number,
  logId: string
): Promise<ExternalBuyResult> {
  try {
    logger.info(`[${logId}] Starting CPMM buy (no confirmation) for ${solAmount} SOL`);

    // CRITICAL FIX: Check wallet balance and reserve SOL for transaction costs
    const walletBalance = await connection.getBalance(buyerKeypair.publicKey, "confirmed");
    const walletBalanceSOL = walletBalance / 1_000_000_000;
    
    // Reserve fees for buy transaction AND account creation costs
    const transactionFeeReserve = 0.01; // Priority fees + base fees for current buy
    const accountCreationReserve = 0.008; // ATA creation costs (WSOL + token accounts)
    const totalFeeReserve = transactionFeeReserve + accountCreationReserve;
    const availableForTrade = walletBalanceSOL - totalFeeReserve;
    
    logger.info(`[${logId}] Wallet balance: ${walletBalanceSOL.toFixed(6)} SOL`);
    logger.info(`[${logId}] Transaction fee reserve: ${transactionFeeReserve.toFixed(6)} SOL`);
    logger.info(`[${logId}] Account creation reserve: ${accountCreationReserve.toFixed(6)} SOL`);
    logger.info(`[${logId}] Total fee reserve: ${totalFeeReserve.toFixed(6)} SOL`);
    logger.info(`[${logId}] Available for trade: ${availableForTrade.toFixed(6)} SOL`);
    
    // Validate we have enough balance
    if (availableForTrade <= 0) {
      const errorMsg = `Insufficient balance: ${walletBalanceSOL.toFixed(6)} SOL available, need at least ${totalFeeReserve.toFixed(6)} SOL for fees`;
      logger.error(`[${logId}] ${errorMsg}`);
      return {
        success: false,
        signature: '',
        error: errorMsg
      };
    }
    
    // Use the minimum of requested amount or available balance
    const actualTradeAmount = Math.min(solAmount, availableForTrade);
    
    if (actualTradeAmount < solAmount) {
      logger.warn(`[${logId}] Adjusted trade amount from ${solAmount} SOL to ${actualTradeAmount.toFixed(6)} SOL due to fee reservations`);
    }

    // Import RaydiumCpmmService
    const RaydiumCpmmService = (
      await import("../../service/raydium-cpmm-service")
    ).default;

    // Create RaydiumCpmmService instance
    const cpmmService = new RaydiumCpmmService();

    // Convert SOL amount to lamports using the adjusted amount
    const buyAmountLamports = BigInt(Math.floor(actualTradeAmount * 1_000_000_000));

    logger.info(`[${logId}] Creating CPMM buy transaction for ${actualTradeAmount.toFixed(6)} SOL...`);

    // Create the buy transaction with the adjusted amount
    const buyTx = await cpmmService.buyTx({
      mint: tokenAddress,
      privateKey: bs58.encode(buyerKeypair.secretKey),
      amount_in: buyAmountLamports,
    });

    logger.info(`[${logId}] Sending CPMM buy transaction (no confirmation wait)...`);

    // Send the transaction WITHOUT waiting for confirmation
    const signature = await connection.sendTransaction(buyTx, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    });

    logger.info(`[${logId}] CPMM buy transaction sent successfully: ${signature} (confirmation will happen in background)`);

    return {
      success: true,
      signature: signature,
      platform: "cpmm",
      solReceived: actualTradeAmount.toString(), // Return the actual amount that was traded
    };
  } catch (error: any) {
    logger.error(`[${logId}] CPMM buy error: ${error.message}`);
    return {
      success: false,
      signature: "",
      error: `CPMM buy failed: ${error.message}`,
    };
  }
} 