import {
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  VersionedTransaction,
} from "@solana/web3.js";
import { logger } from "../common/logger";
import {
  detectTokenPlatformWithCache,
  markTokenAsPumpFun,
  markTokenAsPumpswap,
  isTokenGraduated,
} from "../../service/token-detection-service";
import { executeExternalPumpFunBuy } from "./buy";
import PumpswapService from "../../service/pumpswap-service";
import JupiterPumpswapService from "../../service/jupiter-pumpswap-service";
import { TokenInfoService } from "../../service/token-info-service";
import bs58 from "bs58";
import { connection } from "../../service/config";
import { collectTransactionFee } from "../../backend/functions-main";
import { Context } from "grammy";
import { executeBonkBuy } from "./bonkHandler";
import axios from "axios";
// import { executeBonkBuy } from "../../bot/transactionHandlers/bonkHandler";

let solPriceCache = { price: 0, timestamp: 0 };
const SOL_PRICE_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export async function getSolPrice(): Promise<number> {
  const now = Date.now();

  // Return cached price if still valid
  if (
    solPriceCache.price > 0 &&
    now - solPriceCache.timestamp < SOL_PRICE_CACHE_DURATION
  ) {
    return solPriceCache.price;
  }

  try {
    // SOL token address on Solana
    const solAddress = "So11111111111111111111111111111111111111112";

    const response = await axios.get(
      `https://public-api.birdeye.so/defi/token_overview?address=${solAddress}`,
      {
        headers: {
          accept: "application/json",
          "x-chain": "solana",
          "X-API-KEY": "e750e17792ae478983170f78486de13c",
        },
        timeout: 5000,
      }
    );

    const solPrice = response.data?.data?.price || 0;

    // Update cache
    solPriceCache = { price: solPrice, timestamp: now };

    logger.info(`[SOL Price] Fetched SOL price: $${solPrice}`);
    return solPrice;
  } catch (error) {
    logger.warn(
      `[SOL Price] Failed to fetch SOL price, using cached value: $${solPriceCache.price}`
    );
    return solPriceCache.price || 100; // Fallback to $100 if no cache
  }
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

// Helper function to get token info for enhanced messaging (non-blocking)
async function getTokenInfoAsync(
  tokenAddress: string,
  logId: string
): Promise<ExternalBuyResult["tokenInfo"]> {
  try {
    const tokenInfoService = TokenInfoService.getInstance();
    const tokenInfo = await tokenInfoService.getTokenInfo(tokenAddress);

    if (tokenInfo) {
      return {
        name: tokenInfo.name,
        symbol: tokenInfo.symbol,
        price: tokenInfo.price,
        marketCap: tokenInfo.marketCap,
        decimals: tokenInfo.decimals,
      };
    }
  } catch (error: any) {
    logger.warn(`[${logId}] Could not fetch token info: ${error.message}`);
  }
  return undefined;
}

export interface ExternalBuyResult {
  success: boolean;
  signature: string;
  error?: string;
  platform?: "jupiter" | "pumpswap" | "pumpfun" | "unknown" | "bonkFun";
  solReceived?: string;
  tokensReceived?: string;
  actualSolSpent?: string; // Actual SOL spent from transaction
  priceImpact?: number; // Price impact from Jupiter
  tokenInfo?: {
    name?: string;
    symbol?: string;
    price?: number;
    marketCap?: number;
    decimals?: number;
  };
}

interface PumpswapBuyResult {
  success: boolean;
  signature: string;
  error?: string;
  solReceived?: string;
}

/**
 * Execute external token buy with proper platform detection
 * - PumpFun tokens: Use native PumpFun bonding curve
 * - Graduated tokens: Use Jupiter for optimal routing
 * - PumpSwap tokens: Use PumpSwap directly
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
  logger.info(
    `[${logId}] Starting external buy for ${solAmount} SOL with platform detection`
  );

  try {
    // First, detect the token platform and get token info
    const [platform, tokenInfo] = await Promise.all([
      detectTokenPlatformWithCache(tokenAddress),
      getTokenInfoAsync(tokenAddress, logId),
    ]);
    logger.info(`[${logId}] Detected platform: ${platform}`);

    // Handle PumpFun tokens with native bonding curve
    if (platform === "pumpfun") {
      logger.info(`[${logId}] Using native PumpFun bonding curve for buy`);

      try {
        const result = await executeExternalPumpFunBuy(
          tokenAddress,
          bs58.encode(buyerKeypair.secretKey),
          solAmount,
          slippage,
          ctx
        );

        if (result.success && result.signature) {
          logger.info(
            `[${logId}] Native PumpFun buy successful: ${result.signature}`
          );
          markTokenAsPumpFun(tokenAddress);

          // Collect transaction fee after successful buy (non-blocking)
          await collectFeeAsync(
            bs58.encode(buyerKeypair.secretKey),
            solAmount,
            "buy",
            logId
          );

          return {
            success: true,
            signature: result.signature,
            platform: "pumpfun",
            solReceived: solAmount.toString(),
            tokensReceived: (result as any).tokensReceived || "unknown", // Use actual token amount from PumpFun
            actualSolSpent: solAmount.toString(),
            priceImpact: 0,
            tokenInfo,
          };
        } else {
          logger.warn(
            `[${logId}] Native PumpFun buy failed: ${result.signature ? "Transaction failed" : "No signature returned"}`
          );
        }
      } catch (pumpfunError: any) {
        logger.warn(
          `[${logId}] Native PumpFun buy threw error: ${pumpfunError.message}`
        );
      }
    }

    // Handle graduated tokens with Jupiter (best routing and prices)
    if (platform === "pumpswap" || (await isTokenGraduated(tokenAddress))) {
      logger.info(
        `[${logId}] Token is graduated/external, using Jupiter for optimal routing`
      );
      // Final fallback: Try PumpSwap directly
      logger.info(`[${logId}] Trying PumpSwap as final fallback`);
      try {
        const sendVersionTx = async (tx: VersionedTransaction) => {
          const rawTx = tx.serialize();
          const signature = await connection.sendRawTransaction(rawTx, {
            skipPreflight: false,
            preflightCommitment: "confirmed",
          });
          return signature;
        };

        const pumpSwap = new PumpswapService();
        const buyTxn = await pumpSwap.buyTx({
          mint: new PublicKey(tokenAddress),
          amount: BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL)),
          privateKey: bs58.encode(buyerKeypair.secretKey),
        });

        const signature = await sendVersionTx(buyTxn!);

        const confirmation = await connection.confirmTransaction(
          signature,
          "confirmed"
        );

        if (!confirmation.value.err) {
          logger.info(
            `[${logId}] PumpSwap fallback buy successful: ${signature}`
          );
          markTokenAsPumpswap(tokenAddress);

          // Collect transaction fee after successful buy (non-blocking)
          await collectFeeAsync(
            bs58.encode(buyerKeypair.secretKey),
            solAmount,
            "buy",
            logId
          );

          return {
            success: true,
            signature,
            platform: "pumpswap",
            solReceived: solAmount.toString(),
            tokensReceived: "unknown", // PumpSwap doesn't return exact token amount
            actualSolSpent: solAmount.toString(),
            priceImpact: 0,
            tokenInfo,
          };
        }
      } catch (pumpswapError: any) {
        logger.error(
          `[${logId}] PumpSwap fallback failed: ${pumpswapError.message}`
        );
      }

      try {
        const execBonkBuy = await executeBonkBuy(
          bs58.encode(buyerKeypair.secretKey),
          tokenAddress,
          solAmount
        );

        if (execBonkBuy.success && execBonkBuy.signature) {
          logger.info(
            `[${logId}] PumpSwap fallback buy successful: ${execBonkBuy.signature}`
          );
          markTokenAsPumpswap(tokenAddress);

          // Collect transaction fee after successful buy (non-blocking)
          await collectFeeAsync(
            bs58.encode(buyerKeypair.secretKey),
            solAmount,
            "buy",
            logId
          );

          return {
            success: true,
            signature: execBonkBuy.signature,
            platform: "bonkFun",
            solReceived: solAmount.toString(),
            tokensReceived: "unknown", // PumpSwap doesn't return exact token amount
            actualSolSpent: solAmount.toString(),
            priceImpact: 0,
            tokenInfo,
          };
        }
      } catch (bonkError) {
        logger.error(
          `[${logId}] Bonk fallback failed: ${(bonkError as Error).message}`
        );
      }

      try {
        const jupiterService = new JupiterPumpswapService();
        const result = await jupiterService.executeBuy(
          tokenAddress,
          buyerKeypair,
          solAmount,
          slippage,
          ctx
        );

        if (result.success) {
          logger.info(
            `[${logId}] Jupiter buy successful via ${result.platform}: ${result.signature}`
          );

          // Collect transaction fee after successful buy (non-blocking)
          await collectFeeAsync(
            bs58.encode(buyerKeypair.secretKey),
            solAmount,
            "buy",
            logId
          );

          return {
            success: true,
            signature: result.signature,
            platform: result.platform,
            solReceived: solAmount.toString(),
            tokensReceived: result.tokensReceived,
            actualSolSpent: solAmount.toString(),
            priceImpact: result.priceImpact,
            tokenInfo,
          };
        } else {
          logger.warn(`[${logId}] Jupiter buy failed: ${result.error}`);
        }
      } catch (jupiterError: any) {
        logger.warn(
          `[${logId}] Jupiter buy threw error: ${jupiterError.message}`
        );
      }
    }

    return {
      success: false,
      signature: "",
      platform: "unknown",
      error: "All buy methods failed",
    };
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

// Legacy function kept for backward compatibility - now uses proper platform detection
async function executePumpswapBuy(
  tokenAddress: string,
  buyerKeypair: Keypair,
  solAmount: number
): Promise<PumpswapBuyResult> {
  const logId = `legacy-pumpswap-buy-${tokenAddress.substring(0, 8)}`;
  logger.info(
    `[${logId}] Legacy PumpSwap buy called - using new platform detection`
  );

  const result = await executeExternalBuy(
    tokenAddress,
    buyerKeypair,
    solAmount
  );

  return {
    success: result.success,
    signature: result.signature,
    error: result.error,
    solReceived: result.success ? solAmount.toString() : undefined,
  };
}
