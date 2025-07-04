import { logger } from "../common/logger";
import { getAllTradingWallets, getFundingWallet } from "../../backend/functions";
import { executeExternalBuy } from "./externalBuy";
import { secretKeyToKeypair } from "../common/utils";

interface CTOResult {
  success: boolean;
  successfulBuys?: number;
  failedBuys?: number;
  mixerSuccessRate?: number;
  error?: string;
}

export const executeCTOOperation = async (
  tokenAddress: string,
  userId: string,
  totalAmount: number
): Promise<CTOResult> => {
  try {
    logger.info(`[CTO] Starting CTO operation for token ${tokenAddress}, user ${userId}, amount ${totalAmount} SOL`);

    // Get buyer wallets with private keys
    const buyerWallets = await getAllTradingWallets(userId);
    if (!buyerWallets || buyerWallets.length === 0) {
      return {
        success: false,
        error: "No buyer wallets found. Please configure buyer wallets first."
      };
    }

    logger.info(`[CTO] Found ${buyerWallets.length} buyer wallets`);

    // Get funding wallet
    const fundingWallet = await getFundingWallet(userId);
    if (!fundingWallet) {
      return {
        success: false,
        error: "No funding wallet found. Please configure a funding wallet first."
      };
    }

    // Use mixer to distribute funds to buy wallets
    const { runMixer } = await import("../mixer/index");
    const destinationAddresses = buyerWallets.map(wallet => wallet.publicKey);
    
    logger.info(`[CTO] Starting mixer: ${totalAmount} SOL to ${destinationAddresses.length} wallets`);
    
    const mixerResult = await runMixer(
      fundingWallet.privateKey,
      fundingWallet.privateKey, // Use same wallet for fees
      totalAmount,
      destinationAddresses
    );

    if (!mixerResult.success) {
      logger.error(`[CTO] Mixer failed:`, mixerResult);
      return {
        success: false,
        error: `Mixer failed: ${mixerResult.results?.[0]?.error || "Unknown mixer error"}`
      };
    }

    logger.info(`[CTO] Mixer completed with ${mixerResult.successCount}/${mixerResult.totalRoutes} successful routes`);

    // Wait a moment for funds to propagate
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Calculate buy amount per wallet
    const buyAmountPerWallet = totalAmount / buyerWallets.length;
    
    logger.info(`[CTO] Executing buy transactions: ${buyAmountPerWallet.toFixed(6)} SOL per wallet`);

    // Execute buy transactions in parallel
    const buyPromises = buyerWallets.map(async (wallet, index) => {
      try {
        const keypair = secretKeyToKeypair(wallet.privateKey);
        const result = await executeExternalBuy(tokenAddress, keypair, buyAmountPerWallet);
        
        if (result.success) {
          logger.info(`[CTO] Buy ${index + 1}/${buyerWallets.length} successful: ${result.signature}`);
          return { success: true, signature: result.signature };
        } else {
          logger.warn(`[CTO] Buy ${index + 1}/${buyerWallets.length} failed: ${result.error}`);
          return { success: false, error: result.error };
        }
      } catch (error: any) {
        logger.error(`[CTO] Buy ${index + 1}/${buyerWallets.length} error:`, error);
        return { success: false, error: error.message };
      }
    });

    // Wait for all buy transactions to complete
    const buyResults = await Promise.all(buyPromises);
    
    // Count successful and failed buys
    const successfulBuys = buyResults.filter(r => r.success).length;
    const failedBuys = buyResults.filter(r => !r.success).length;

    logger.info(`[CTO] CTO operation completed: ${successfulBuys} successful, ${failedBuys} failed`);

    return {
      success: successfulBuys > 0, // Consider success if at least one buy succeeded
      successfulBuys,
      failedBuys,
      mixerSuccessRate: Math.round((mixerResult.successCount / mixerResult.totalRoutes) * 100)
    };

  } catch (error: any) {
    logger.error(`[CTO] CTO operation failed:`, error);
    return {
      success: false,
      error: error.message || "Unknown error occurred"
    };
  }
}; 