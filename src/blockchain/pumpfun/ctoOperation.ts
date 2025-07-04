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

    // CRITICAL FIX: Use the same dynamic amount distribution as the mixer
    // Instead of fixed amount per wallet, use incremental sequence
    const incrementalSequence = [0.5, 0.7, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1];
    
    // Calculate how many wallets we actually need based on the total amount
    let cumulativeTotal = 0;
    let walletsNeeded = 0;
    for (let i = 0; i < incrementalSequence.length && cumulativeTotal < totalAmount; i++) {
      cumulativeTotal += incrementalSequence[i];
      walletsNeeded++;
    }
    
    // Use only the wallets that were actually funded by the mixer
    const walletsToUse = Math.min(walletsNeeded, buyerWallets.length, mixerResult.successCount);
    const selectedWallets = buyerWallets.slice(0, walletsToUse);
    
    logger.info(`[CTO] Using dynamic amount distribution: ${walletsToUse} wallets from ${incrementalSequence.slice(0, walletsToUse).join(', ')} SOL sequence`);

    // Execute buy transactions in parallel
    const buyPromises = selectedWallets.map(async (wallet, index) => {
      const buyAmount = incrementalSequence[index]; // Use the corresponding amount from the sequence
      try {
        const keypair = secretKeyToKeypair(wallet.privateKey);
        const result = await executeExternalBuy(tokenAddress, keypair, buyAmount);
        
        if (result.success) {
          logger.info(`[CTO] Buy ${index + 1}/${selectedWallets.length} successful: ${result.signature}`);
          
          // Record the successful CTO buy transaction
          try {
            const { recordTransactionWithActualAmounts } = await import("../../backend/utils");
            await recordTransactionWithActualAmounts(
              tokenAddress,
              wallet.publicKey,
              "external_buy", // New transaction type for CTO buys
              result.signature,
              true,
              0, // CTO operations don't have launch attempts
              {
                amountSol: buyAmount,
                amountTokens: "0", // Will be parsed from blockchain
                errorMessage: undefined,
                retryAttempt: 0,
              },
              true // Parse actual amounts from blockchain
            );
            logger.info(`[CTO] Transaction recorded for wallet ${wallet.publicKey}`);
          } catch (recordError: any) {
            logger.warn(`[CTO] Failed to record transaction for wallet ${wallet.publicKey}:`, recordError);
          }
          
          return { success: true, signature: result.signature, walletAddress: wallet.publicKey };
        } else {
          logger.warn(`[CTO] Buy ${index + 1}/${selectedWallets.length} failed: ${result.error}`);
          
          // Record the failed CTO buy transaction
          try {
            const { recordTransaction } = await import("../../backend/functions");
            await recordTransaction(
              tokenAddress,
              wallet.publicKey,
              "external_buy",
              "", // No signature for failed transactions
              false,
              0,
              {
                amountSol: buyAmount,
                amountTokens: "0",
                errorMessage: result.error,
                retryAttempt: 0,
              }
            );
          } catch (recordError: any) {
            logger.warn(`[CTO] Failed to record failed transaction for wallet ${wallet.publicKey}:`, recordError);
          }
          
          return { success: false, error: result.error, walletAddress: wallet.publicKey };
        }
      } catch (error: any) {
        logger.error(`[CTO] Buy ${index + 1}/${selectedWallets.length} error:`, error);
        
        // Record the error transaction
        try {
          const { recordTransaction } = await import("../../backend/functions");
          await recordTransaction(
            tokenAddress,
            wallet.publicKey,
            "external_buy",
            "",
            false,
            0,
            {
              amountSol: buyAmount,
              amountTokens: "0",
              errorMessage: error.message,
              retryAttempt: 0,
            }
          );
        } catch (recordError: any) {
          logger.warn(`[CTO] Failed to record error transaction for wallet ${wallet.publicKey}:`, recordError);
        }
        
        return { success: false, error: error.message, walletAddress: wallet.publicKey };
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