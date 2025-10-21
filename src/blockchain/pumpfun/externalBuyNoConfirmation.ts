import { Keypair, PublicKey } from "@solana/web3.js";
import { Context } from "grammy";
import { connection } from "../../service/config";
import { logger } from "../common/logger";
import { JupiterPumpswapService } from "../../service/jupiter-pumpswap-service";
import bs58 from "bs58";
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

// Helper function to collect transaction fees (non-blocking)
async function collectFeeAsync(
  privateKey: string,
  amount: number,
  type: "buy" | "sell",
  logId: string
): Promise<void> {
  try {
    const feeResult = await collectTransactionFee(privateKey, amount, type);
    if (feeResult.success) {
      logger.info(
        `[${logId}] Transaction fee collected: ${feeResult.feeAmount} SOL`
      );
    } else {
      logger.warn(
        `[${logId}] Transaction fee collection failed: ${feeResult.error}`
      );
    }
  } catch (feeError: any) {
    logger.warn(
      `[${logId}] Transaction fee collection error: ${feeError.message}`
    );
  }
}

/**
 * Execute external token buy WITHOUT waiting for confirmation (for CTO operations)
 * Automatically detects platform and uses appropriate buy logic
 * Fee collection happens in background after confirmation
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
    logger.info(
      `[${logId}] Starting external token buy (no confirmation) for ${solAmount} SOL`
    );

    // First, detect the platform to use the appropriate buy logic
    const { detectTokenPlatformWithCache } = await import(
      "../../service/token-detection-service"
    );
    const platform = await detectTokenPlatformWithCache(tokenAddress);

    logger.info(
      `[${logId}] Detected platform: ${platform} for token ${tokenAddress}`
    );

    // Use platform-specific buy logic (fee collection happens in background)
    if (platform === "bonk") {
      logger.info(
        `[${logId}] Using Bonk-specific buy logic (no confirmation, fees in background)`
      );
      return await executeBonkBuyNoConfirmation(
        tokenAddress,
        buyerKeypair,
        solAmount,
        logId
      );
    } else if (platform === "cpmm") {
      logger.info(
        `[${logId}] Using CPMM-specific buy logic (no confirmation, fees in background)`
      );
      return await executeCpmmBuyNoConfirmation(
        tokenAddress,
        buyerKeypair,
        solAmount,
        logId
      );
    } else if (platform === "heaven") {
      logger.info(`
        [${logId}] Using Heaven-specific buy logic (no confirmation, fees in background)`);
      return await executeHeavenBuyNoConfirmation(
        tokenAddress,
        buyerKeypair,
        solAmount,
        logId
      );
    } else if (platform === "meteora") {
      logger.info(`
        [${logId}] Using Meteora DBC-specific buy logic (no confirmation, fees in background)`);
      return await executeMeteoraBuyNoConfirmation(
        tokenAddress,
        buyerKeypair,
        solAmount,
        logId
      );
    } else {
      logger.info(
        `[${logId}] Using unified Jupiter-PumpSwap service for ${platform} platform (no confirmation, fees in background)`
      );

      // Use the unified Jupiter-Pumpswap service for PumpFun/PumpSwap/Jupiter tokens
      const jupiterPumpswapService = new JupiterPumpswapService();

      const result = await jupiterPumpswapService.executeBuy(
        tokenAddress,
        buyerKeypair,
        solAmount, // Use the exact requested amount
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
          solReceived: result.actualSolSpent || solAmount.toString(),
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
 * Execute Bonk-specific buy using BonkService (WITHOUT confirmation, fees in background)
 */
async function executeBonkBuyNoConfirmation(
  tokenAddress: string,
  buyerKeypair: Keypair,
  solAmount: number,
  logId: string
): Promise<ExternalBuyResult> {
  try {
    logger.info(
      `[${logId}] Starting Bonk buy (no confirmation, fees in background) for ${solAmount} SOL`
    );

    // CRITICAL FIX: Pre-adjust amount to match BonkService's balance requirements
    const walletBalance = await connection.getBalance(
      buyerKeypair.publicKey,
      "confirmed"
    );
    const walletBalanceSOL = walletBalance / 1_000_000_000;

    // Use same fee reserves as BonkService with safety buffer
    const transactionFeeReserve = 0.012; // Priority fees + base fees (increased buffer)
    const accountCreationReserve = 0.008; // ATA creation costs (WSOL + token accounts)
    const safetyBuffer = 0.005; // Additional safety buffer for gas price variations
    const totalFeeReserve =
      transactionFeeReserve + accountCreationReserve + safetyBuffer;
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
      const errorMsg = `Insufficient balance: ${walletBalanceSOL.toFixed(6)} SOL available, need at least ${totalFeeReserve.toFixed(6)} SOL for fees`;
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

    logger.info(
      `[${logId}] Creating Bonk buy transaction for ${actualTradeAmount.toFixed(6)} SOL...`
    );

    // Use buyWithFeeCollection for proper fee handling
    logger.info(
      `[${logId}] Executing Bonk buy with fee collection (no confirmation wait)...`
    );

    try {
      const result = await bonkService.buyWithFeeCollection({
        mint: new PublicKey(tokenAddress),
        amount: BigInt(Math.floor(actualTradeAmount * 1_000_000_000)), // Use adjusted amount
        privateKey: bs58.encode(buyerKeypair.secretKey),
      });

      const signature = result.signature;

      logger.info(
        `[${logId}] Bonk buy transaction sent successfully: ${signature} (confirmation and fee collection will happen in background)`
      );

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
  } catch (error: any) {
    logger.error(`[${logId}] Bonk buy outer error: ${error.message}`);
    return {
      success: false,
      signature: "",
      error: `Bonk buy failed: ${error.message}`,
    };
  }
}

/**
 * Execute CPMM-specific buy using RaydiumCpmmService (WITHOUT confirmation, fees in background)
 */
async function executeCpmmBuyNoConfirmation(
  tokenAddress: string,
  buyerKeypair: Keypair,
  solAmount: number,
  logId: string
): Promise<ExternalBuyResult> {
  try {
    logger.info(
      `[${logId}] Starting CPMM buy (no confirmation, fees in background) for ${solAmount} SOL`
    );

    // CRITICAL FIX: Check wallet balance and reserve SOL for transaction costs
    const walletBalance = await connection.getBalance(
      buyerKeypair.publicKey,
      "confirmed"
    );
    const walletBalanceSOL = walletBalance / 1_000_000_000;

    // Reserve fees for buy transaction AND account creation costs
    const transactionFeeReserve = 0.01; // Priority fees + base fees for current buy
    const accountCreationReserve = 0.008; // ATA creation costs (WSOL + token accounts)
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
      const errorMsg = `Insufficient balance: ${walletBalanceSOL.toFixed(6)} SOL available, need at least ${totalFeeReserve.toFixed(6)} SOL for fees`;
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

    // Import RaydiumCpmmService
    const RaydiumCpmmService = (
      await import("../../service/raydium-cpmm-service")
    ).default;

    // Create RaydiumCpmmService instance
    const cpmmService = new RaydiumCpmmService();

    // Convert SOL amount to lamports using the adjusted amount
    const buyAmountLamports = BigInt(
      Math.floor(actualTradeAmount * 1_000_000_000)
    );

    logger.info(
      `[${logId}] Creating CPMM buy transaction for ${actualTradeAmount.toFixed(6)} SOL...`
    );

    // Create the buy transaction with the adjusted amount (fee collection happens in background)
    // Use buyWithFeeCollection for proper fee handling
    logger.info(
      `[${logId}] Executing CPMM buy with fee collection (no confirmation wait)...`
    );

    try {
      const result = await cpmmService.buyWithFeeCollection({
        mint: tokenAddress,
        privateKey: bs58.encode(buyerKeypair.secretKey),
        amount_in: buyAmountLamports,
      });

      const signature = result.signature;

      logger.info(
        `[${logId}] CPMM buy transaction sent successfully: ${signature} (confirmation and fee collection will happen in background)`
      );

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
  } catch (error: any) {
    logger.error(`[${logId}] CPMM buy outer error: ${error.message}`);
    return {
      success: false,
      signature: "",
      error: `CPMM buy failed: ${error.message}`,
    };
  }
}

async function executeMeteoraBuyNoConfirmation(
  tokenAddress: string,
  buyerKeypair: Keypair,
  solAmount: number,
  logId: string
): Promise<ExternalBuyResult> {
  try {
    logger.info(
      `[${logId}] Starting Meteora buy (no confirmation, fees in background) for ${solAmount} SOL`
    );

    // CRITICAL FIX: Check wallet balance and reserve SOL for transaction costs
    const walletBalance = await connection.getBalance(
      buyerKeypair.publicKey,
      "confirmed"
    );
    const walletBalanceSOL = walletBalance / 1_000_000_000;

    // Reserve fees for buy transaction AND account creation costs
    const transactionFeeReserve = 0.01; // Priority fees + base fees for current buy
    const accountCreationReserve = 0.008; // ATA creation costs (WSOL + token accounts)
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
      const errorMsg = `Insufficient balance: ${walletBalanceSOL.toFixed(6)} SOL available, need at least ${totalFeeReserve.toFixed(6)} SOL for fees`;
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

    // Import Meteora buy service with proper path
    const { executeMeteoraBuy } = await import(
      "../../service/meteora/meteora-buy-service"
    );

    logger.info(
      `[${logId}] Executing Meteora buy with auto-detection for ${actualTradeAmount.toFixed(6)} SOL...`
    );

    // Use the executeMeteoraBuy function (which includes token type detection and smart routing)
    const result = await executeMeteoraBuy(
      tokenAddress,
      bs58.encode(buyerKeypair.secretKey),
      actualTradeAmount
    );

    if (result.success && result.signature) {
      logger.info(
        `[${logId}] Meteora buy successful: ${result.signature} (confirmation and fee collection will happen in background)`
      );

      return {
        success: true,
        signature: result.signature,
        platform: "meteora",
        solReceived: actualTradeAmount.toString(), // Return the actual amount that was traded
      };
    } else {
      throw new Error(result.error || "Meteora buy failed");
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Handle "PoolIsCompleted" error with smart routing fallback to CPMM
    if (
      errorMessage.includes("PoolIsCompleted") ||
      errorMessage.includes("0x177d") ||
      errorMessage.includes("Token is not a Meteora token")
    ) {
      logger.info(
        `[${logId}] Meteora failed - falling back to CPMM: ${errorMessage}`
      );

      try {
        // Use the minimum of requested amount or available balance
        const walletBalance = await connection.getBalance(
          buyerKeypair.publicKey,
          "confirmed"
        );
        const walletBalanceSOL = walletBalance / 1_000_000_000;
        const transactionFeeReserve = 0.01;
        const accountCreationReserve = 0.008;
        const totalFeeReserve = transactionFeeReserve + accountCreationReserve;
        const availableForTrade = walletBalanceSOL - totalFeeReserve;
        const actualTradeAmount = Math.min(solAmount, availableForTrade);

        // Import RaydiumCpmmService as fallback
        const RaydiumCpmmService = (
          await import("../../service/raydium-cpmm-service")
        ).default;

        // Create RaydiumCpmmService instance
        const cpmmService = new RaydiumCpmmService();

        // Convert SOL amount to lamports using the adjusted amount
        const buyAmountLamports = BigInt(
          Math.floor(actualTradeAmount * 1_000_000_000)
        );

        // Use buyWithFeeCollection for proper fee handling
        const result = await cpmmService.buyWithFeeCollection({
          mint: tokenAddress,
          privateKey: bs58.encode(buyerKeypair.secretKey),
          amount_in: buyAmountLamports,
        });

        const signature = result.signature;

        logger.info(
          `[${logId}] CPMM fallback success with fee collection: ${signature}`
        );

        // Fee collection is now handled by buyWithFeeCollection method

        return {
          success: true,
          signature: signature,
          platform: "cpmm",
          solReceived: actualTradeAmount.toString(),
        };
      } catch (fallbackError: unknown) {
        const fallbackErrorMessage =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError);
        logger.error(
          `[${logId}] Both Meteora and CPMM failed: ${fallbackErrorMessage}`
        );
        return {
          success: false,
          signature: "",
          error: `Smart routing failed: ${fallbackErrorMessage}`,
        };
      }
    } else {
      logger.error(`[${logId}] Meteora buy error: ${errorMessage}`);
      return {
        success: false,
        signature: "",
        error: `Meteora buy failed: ${errorMessage}`,
      };
    }
  }
}

async function executeHeavenBuyNoConfirmation(
  tokenAddress: string,
  buyerKeypair: Keypair,
  solAmount: number,
  logId: string
): Promise<ExternalBuyResult> {
  try {
    logger.info(
      `[${logId}] Starting Heaven buy (no confirmation, fees in background) for ${solAmount} SOL`
    );

    // CRITICAL FIX: Check wallet balance and reserve SOL for transaction costs
    const walletBalance = await connection.getBalance(
      buyerKeypair.publicKey,
      "confirmed"
    );
    const walletBalanceSOL = walletBalance / 1_000_000_000;

    // Reserve fees for buy transaction AND account creation costs
    const transactionFeeReserve = 0.01; // Priority fees + base fees for current buy
    const accountCreationReserve = 0.008; // ATA creation costs (WSOL + token accounts)
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
      const errorMsg = `Insufficient balance: ${walletBalanceSOL.toFixed(6)} SOL available, need at least ${totalFeeReserve.toFixed(6)} SOL for fees`;
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

    // Import Heaven buy service with proper path
    const { executeHeavenBuy } = await import(
      "../../service/heaven/heaven-service"
    );

    logger.info(
      `[${logId}] Executing Heaven buy with auto-detection for ${actualTradeAmount.toFixed(6)} SOL...`
    );

    // Use the executeHeavenBuy function
    const result = await executeHeavenBuy(
      tokenAddress,
      bs58.encode(buyerKeypair.secretKey),
      actualTradeAmount
    );

    if (result.success && result.signature) {
      logger.info(
        `[${logId}] Heaven buy successful: ${result.signature} (confirmation and fee collection will happen in background)`
      );

      // Collect transaction fee after successful buy (non-blocking)
      collectFeeAsync(
        bs58.encode(buyerKeypair.secretKey),
        actualTradeAmount,
        "buy",
        logId
      ).catch((feeError) => {
        logger.warn(
          `[${logId}] Fee collection promise failed: ${feeError.message}`
        );
      });

      return {
        success: true,
        signature: result.signature,
        platform: "heaven", // Heaven DEX platform
        solReceived: actualTradeAmount.toString(), // Return the actual amount that was traded
      };
    } else {
      throw new Error(result.error || "Heaven buy failed");
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Handle "PoolIsCompleted" error with smart routing fallback to CPMM
    if (
      errorMessage.includes("PoolIsCompleted") ||
      errorMessage.includes("0x177d") ||
      errorMessage.includes("Token is not a Heaven token")
    ) {
      logger.info(
        `[${logId}] Heaven failed - falling back to CPMM: ${errorMessage}`
      );

      try {
        // Use the minimum of requested amount or available balance
        const walletBalance = await connection.getBalance(
          buyerKeypair.publicKey,
          "confirmed"
        );
        const walletBalanceSOL = walletBalance / 1_000_000_000;
        const transactionFeeReserve = 0.01;
        const accountCreationReserve = 0.008;
        const totalFeeReserve = transactionFeeReserve + accountCreationReserve;
        const availableForTrade = walletBalanceSOL - totalFeeReserve;
        const actualTradeAmount = Math.min(solAmount, availableForTrade);

        // Import RaydiumCpmmService as fallback
        const RaydiumCpmmService = (
          await import("../../service/raydium-cpmm-service")
        ).default;

        // Create RaydiumCpmmService instance
        const cpmmService = new RaydiumCpmmService();

        // Convert SOL amount to lamports using the adjusted amount
        const buyAmountLamports = BigInt(
          Math.floor(actualTradeAmount * 1_000_000_000)
        );

        // Use buyWithFeeCollection for proper fee handling
        const result = await cpmmService.buyWithFeeCollection({
          mint: tokenAddress,
          privateKey: bs58.encode(buyerKeypair.secretKey),
          amount_in: buyAmountLamports,
        });

        const signature = result.signature;

        logger.info(
          `[${logId}] CPMM fallback success with fee collection: ${signature}`
        );

        // Fee collection is now handled by buyWithFeeCollection method

        return {
          success: true,
          signature: signature,
          platform: "cpmm",
          solReceived: actualTradeAmount.toString(),
        };
      } catch (fallbackError: unknown) {
        const fallbackErrorMessage =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError);
        logger.error(
          `[${logId}] Both Heaven and CPMM failed: ${fallbackErrorMessage}`
        );
        return {
          success: false,
          signature: "",
          error: `Smart routing failed: ${fallbackErrorMessage}`,
        };
      }
    } else {
      logger.error(`[${logId}] Heaven buy error: ${errorMessage}`);
      return {
        success: false,
        signature: "",
        error: `Heaven buy failed: ${errorMessage}`,
      };
    }
  }
}
