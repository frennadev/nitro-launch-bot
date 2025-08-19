// Heaven DEX Service - Universal integration following Meteora pattern
// Integrates with existing external buy/sell system

import { PublicKey, Keypair } from "@solana/web3.js";
import { logger } from "../../utils/logger";

// Fee constants (same as other DEX services)
const MAESTRO_FEE_ACCOUNT = new PublicKey(
  "5L2QKqDn5ukJSWGyqR4RPvFvwnBabKWqAqMzH4heaQNB"
);
const MAESTRO_FEE_AMOUNT = BigInt(1000000); // 0.001 SOL

interface HeavenBuyResult {
  success: boolean;
  signature?: string;
  error?: string;
  platform: "heaven";
}

interface HeavenSellResult {
  success: boolean;
  signature?: string;
  error?: string;
  platform: "heaven";
}

/**
 * Execute Heaven DEX buy transaction
 * Follows same pattern as executeMeteoraBuy
 */
export async function executeHeavenBuy(
  tokenAddress: string,
  buyerPrivateKey: string,
  solAmount: number
): Promise<HeavenBuyResult> {
  const logId = `heaven-buy-${tokenAddress.substring(0, 8)}`;
  logger.info(`[${logId}] Starting Heaven DEX buy for ${solAmount} SOL`);

  try {
    // Import and use the working heaven-buy implementation
    const { buyHeavenUngraduated } = await import("./heaven-buy");

    const signature = await buyHeavenUngraduated(
      tokenAddress,
      buyerPrivateKey,
      solAmount
    );

    if (signature) {
      logger.info(`[${logId}] Heaven DEX buy successful: ${signature}`);
      return {
        success: true,
        signature,
        platform: "heaven",
      };
    } else {
      throw new Error("No signature returned from Heaven buy");
    }
  } catch (error: any) {
    logger.error(`[${logId}] Heaven DEX buy failed: ${error.message}`);
    return {
      success: false,
      error: error.message,
      platform: "heaven",
    };
  }
}

/**
 * Execute Heaven DEX sell transaction
 * Follows same pattern as executeMeteoraSell
 */
export async function executeHeavenSell(
  tokenAddress: string,
  sellerPrivateKey: string,
  tokenAmount: bigint
): Promise<HeavenSellResult> {
  const logId = `heaven-sell-${tokenAddress.substring(0, 8)}`;
  logger.info(`[${logId}] Starting Heaven DEX sell for ${tokenAmount} tokens`);

  try {
    // Import the comprehensive Heaven sell implementation
    const { sellHeavenUngraduated } = await import("./heaven-sell");

    // Convert bigint to number (tokens)
    const tokenAmountNumber = Number(tokenAmount) / Math.pow(10, 9); // Convert lamports to tokens

    const signature = await sellHeavenUngraduated(
      tokenAddress,
      sellerPrivateKey,
      tokenAmountNumber
    );

    if (signature) {
      logger.info(`[${logId}] Heaven DEX sell successful: ${signature}`);
      return {
        success: true,
        signature,
        platform: "heaven",
      };
    } else {
      throw new Error("No signature returned from Heaven sell");
    }
  } catch (error: any) {
    logger.error(`[${logId}] Heaven DEX sell failed: ${error.message}`);
    return {
      success: false,
      error: error.message,
      platform: "heaven",
    };
  }
}

/**
 * Create Maestro fee instruction (same as other DEX services)
 * Used for collecting fees on Heaven DEX transactions
 */
export function createHeavenMaestroFeeInstruction(user: PublicKey) {
  return import("@solana/web3.js").then(({ SystemProgram }) =>
    SystemProgram.transfer({
      fromPubkey: user,
      toPubkey: MAESTRO_FEE_ACCOUNT,
      lamports: Number(MAESTRO_FEE_AMOUNT),
    })
  );
}
