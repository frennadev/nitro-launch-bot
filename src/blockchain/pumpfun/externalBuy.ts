import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { logger } from "../common/logger";
import { connection } from "../common/connection";
import JupiterPumpswapService from "../../service/jupiter-pumpswap-service";
import bs58 from "bs58";
import { getSolBalance } from "../../backend/utils";
import { type Context } from "grammy";
import { collectTransactionFee } from "../../backend/functions-main";

export interface ExternalBuyResult {
  success: boolean;
  signature: string;
  error?: string;
  platform?:
    | "jupiter"
    | "pumpswap"
    | "pumpfun"
    | "bonk"
    | "cpmm"
    | "meteora"
    | "heaven"
    | "unknown";
  solReceived?: string;
}

/**
 * Execute external token buy using platform-specific services
 * Automatically detects platform and uses appropriate buy logic
 */
export async function executeExternalBuy(
  tokenAddress: string,
  buyerKeypair: Keypair,
  solAmount: number,
  slippage: number = 3, // Default slippage percentage
  priorityFee: number = 0.001, // Default priority fee in SOL
  ctx: Context
): Promise<ExternalBuyResult> {
  const logId = `external-buy-${tokenAddress.substring(0, 8)}`;

  try {
    logger.info(`[${logId}] Starting external token buy for ${solAmount} SOL`);
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
      logger.info(`[${logId}] Using Bonk-specific buy logic`);
      return await executeBonkBuy(tokenAddress, buyerKeypair, solAmount, logId);
    } else if (platform === "cpmm") {
      logger.info(`[${logId}] Using CPMM-specific buy logic`);
      return await executeCpmmBuy(tokenAddress, buyerKeypair, solAmount, logId);
    } else {
      logger.info(
        `[${logId}] Using unified Jupiter-PumpSwap service for ${platform} platform`
      );
      // Use the unified Jupiter-Pumpswap service for PumpFun/PumpSwap/Jupiter tokens
      const jupiterPumpswapService = new JupiterPumpswapService();

      const result = await jupiterPumpswapService.executeBuy(
        tokenAddress,
        buyerKeypair,
        solBuyAmount,
        3 // 3% slippage
      );

      if (result.success) {
        logger.info(
          `[${logId}] External buy successful via ${result.platform}: ${result.signature}`
        );
        return {
          success: true,
          signature: result.signature,
          platform: result.platform,
          solReceived: result.actualSolSpent || solAmount.toString(),
        };
      } else {
        logger.error(`[${logId}] External buy failed: ${result.error}`);
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
 * Execute Bonk-specific buy using BonkService
 */
async function executeBonkBuy(
  tokenAddress: string,
  buyerKeypair: Keypair,
  solAmount: number,
  logId: string
): Promise<ExternalBuyResult> {
  try {
    logger.info(`[${logId}] Starting Bonk buy for ${solAmount} SOL`);

    // CRITICAL FIX: Check wallet balance and reserve SOL for transaction costs
    const walletBalance = await connection.getBalance(
      buyerKeypair.publicKey,
      "confirmed"
    );
    const walletBalanceSOL = walletBalance / 1_000_000_000;

    // Reserve fees for buy transaction AND account creation costs
    const transactionFeeReserve = 0.01; // Priority fees + base fees for current buy
    const accountCreationReserve = 0.005; // ATA creation costs (WSOL + token accounts)
    const totalFeeReserve = transactionFeeReserve + accountCreationReserve;
    const availableForTrade = walletBalanceSOL - totalFeeReserve;

    logger.info(
      `[${logId}] Wallet balance: ${walletBalanceSOL.toFixed(6)} SOL`
    );
    logger.info(
      `[${logId}] Transaction fee reserve: ${transactionFeeReserve.toFixed(6)} SOL`
    );
    logger.info(
      `[${logId}] Account creation reserve: ${accountCreationReserve.toFixed(6)} SOL`
    );
    logger.info(
      `[${logId}] Total fee reserve: ${totalFeeReserve.toFixed(6)} SOL`
    );
    logger.info(
      `[${logId}] Available for trade: ${availableForTrade.toFixed(6)} SOL`
    );

    // Validate we have enough balance
    if (availableForTrade <= 0) {
      const errorMsg = `Insufficient balance: ${walletBalanceSOL.toFixed(6)} SOL available, need at least ${totalFeeReserve.toFixed(6)} SOL for fees (${transactionFeeReserve.toFixed(6)} SOL tx fees + ${accountCreationReserve.toFixed(6)} SOL account creation)`;
      logger.error(`[${logId}] ${errorMsg}`);
      return {
        success: false,
        signature: "",
        error: errorMsg,
      };
    }

    // Use the minimum of requested amount or available balance
    const actualTradeAmount = Math.min(solAmount, availableForTrade);

    if (actualTradeAmount < solAmount) {
      logger.warn(
        `[${logId}] Adjusted trade amount from ${solAmount} SOL to ${actualTradeAmount.toFixed(6)} SOL due to fee reservations`
      );
    }

    // Import BonkService
    const BonkService = (await import("../../service/bonk-service")).default;

    // Create BonkService instance with default config
    const bonkService = new BonkService();

    // Convert SOL amount to lamports using the adjusted amount
    const buyAmountLamports = BigInt(
      Math.floor(actualTradeAmount * 1_000_000_000)
    );

    logger.info(
      `[${logId}] Creating Bonk buy transaction for ${actualTradeAmount.toFixed(6)} SOL (${buyAmountLamports} lamports)...`
    );

    // Create the buy transaction
    const buyTx = await bonkService.buyTx({
      mint: new PublicKey(tokenAddress),
      amount: buyAmountLamports,
      privateKey: bs58.encode(buyerKeypair.secretKey),
    });

    logger.info(`[${logId}] Sending Bonk buy transaction...`);

    // Send the transaction
    const signature = await connection.sendTransaction(buyTx, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    });

    logger.info(`[${logId}] Waiting for Bonk transaction confirmation...`);

    // Wait for confirmation
    const confirmation = await connection.confirmTransaction(
      signature,
      "confirmed"
    );

    if (confirmation.value.err) {
      const errorMsg = `Bonk transaction failed: ${JSON.stringify(confirmation.value.err)}`;
      logger.error(`[${logId}] ${errorMsg}`);
      return {
        success: false,
        signature: signature,
        error: errorMsg,
      };
    }

    logger.info(`[${logId}] Bonk buy successful: ${signature}`);

    // Collect 1% transaction fee after successful buy
    try {
      const { collectTransactionFee } = await import("../../backend/functions-main");
      const feeResult = await collectTransactionFee(
        bs58.encode(buyerKeypair.secretKey),
        actualTradeAmount,
        "buy"
      );
      
      if (feeResult.success) {
        logger.info(`[${logId}] Bonk buy transaction fee collected: ${feeResult.feeAmount} SOL`);
      } else {
        logger.warn(`[${logId}] Failed to collect Bonk buy transaction fee: ${feeResult.error}`);
      }
    } catch (feeError: any) {
      logger.warn(`[${logId}] Error collecting Bonk buy transaction fee: ${feeError.message}`);
    }

    // Record the successful Bonk buy transaction
    try {
      const { recordTransactionWithActualAmounts } = await import(
        "../../backend/utils"
      );
      await recordTransactionWithActualAmounts(
        tokenAddress,
        buyerKeypair.publicKey.toBase58(),
        "external_buy", // Use external_buy type for Bonk buys
        signature,
        true,
        0, // CTO operations don't have launch attempts
        {
          amountSol: actualTradeAmount, // Use the actual amount that was traded
          amountTokens: "0", // Will be parsed from blockchain
          errorMessage: undefined,
          retryAttempt: 0,
        },
        true // Parse actual amounts from blockchain
      );
      logger.info(`[${logId}] Bonk transaction recorded`);
    } catch (recordError: any) {
      logger.warn(`[${logId}] Failed to record Bonk transaction:`, recordError);
    }

    return {
      success: true,
      signature: signature,
      platform: "bonk",
      solReceived: actualTradeAmount.toString(), // Return the actual amount that was traded
    };
  } catch (error: any) {
    logger.error(`[${logId}] Bonk buy error: ${error.message}`);
    return {
      success: false,
      signature: "",
      error: `Bonk buy failed: ${error.message}`,
    };
  }
}

/**
 * Execute CPMM-specific buy using RaydiumCpmmService
 */
async function executeCpmmBuy(
  tokenAddress: string,
  buyerKeypair: Keypair,
  solAmount: number,
  logId: string
): Promise<ExternalBuyResult> {
  try {
    logger.info(`[${logId}] Starting CPMM buy for ${solAmount} SOL`);

    // Import RaydiumCpmmService
    const RaydiumCpmmService = (
      await import("../../service/raydium-cpmm-service")
    ).default;

    // Create RaydiumCpmmService instance
    const cpmmService = new RaydiumCpmmService();

    // Convert SOL amount to lamports
    const buyAmountLamports = BigInt(Math.floor(solAmount * 1_000_000_000));

    logger.info(`[${logId}] Creating CPMM buy transaction...`);

    // Create the buy transaction
    const buyTx = await cpmmService.buyTx({
      mint: tokenAddress,
      privateKey: bs58.encode(buyerKeypair.secretKey),
      amount_in: buyAmountLamports,
    });

    logger.info(`[${logId}] Sending CPMM buy transaction...`);

    // Send the transaction
    const signature = await connection.sendTransaction(buyTx, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    });

    logger.info(`[${logId}] Waiting for CPMM transaction confirmation...`);

    // Wait for confirmation
    const confirmation = await connection.confirmTransaction(
      signature,
      "confirmed"
    );

    if (confirmation.value.err) {
      const errorMsg = `CPMM transaction failed: ${JSON.stringify(confirmation.value.err)}`;
      logger.error(`[${logId}] ${errorMsg}`);
      return {
        success: false,
        signature: signature,
        error: errorMsg,
      };
    }

    logger.info(`[${logId}] CPMM buy successful: ${signature}`);

    // Collect 1% transaction fee after successful buy
    try {
      const { collectTransactionFee } = await import("../../backend/functions-main");
      const feeResult = await collectTransactionFee(
        bs58.encode(buyerKeypair.secretKey),
        solAmount,
        "buy"
      );
      
      if (feeResult.success) {
        logger.info(`[${logId}] CPMM buy transaction fee collected: ${feeResult.feeAmount} SOL`);
      } else {
        logger.warn(`[${logId}] Failed to collect CPMM buy transaction fee: ${feeResult.error}`);
      }
    } catch (feeError: any) {
      logger.warn(`[${logId}] Error collecting CPMM buy transaction fee: ${feeError.message}`);
    }

    // Record the successful CPMM buy transaction
    try {
      const { recordTransactionWithActualAmounts } = await import(
        "../../backend/utils"
      );
      await recordTransactionWithActualAmounts(
        tokenAddress,
        buyerKeypair.publicKey.toBase58(),
        "external_buy", // Use external_buy type for CPMM buys
        signature,
        true,
        0, // CTO operations don't have launch attempts
        {
          amountSol: solAmount,
          amountTokens: "0", // Will be parsed from blockchain
          errorMessage: undefined,
          retryAttempt: 0,
        },
        true // Parse actual amounts from blockchain
      );
      logger.info(`[${logId}] CPMM transaction recorded`);
    } catch (recordError: any) {
      logger.warn(`[${logId}] Failed to record CPMM transaction:`, recordError);
    }

    return {
      success: true,
      signature: signature,
      platform: "cpmm",
      solReceived: solAmount.toString(),
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
