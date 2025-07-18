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
  detectedPlatform?: string;
}

export const executeCTOOperation = async (
  tokenAddress: string,
  userId: string,
  totalAmount: number,
  detectedPlatform?: string
): Promise<CTOResult> => {
  try {
    logger.info(`[CTO] Starting CTO operation for token ${tokenAddress}, user ${userId}, amount ${totalAmount} SOL, platform: ${detectedPlatform || 'auto-detected'}`);

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

    // CRITICAL FIX: Don't fail completely if mixer has partial success
    // Check if we have any successful routes to work with
    const successfulRoutes = mixerResult.results?.filter(result => result.success) || [];
    
    if (successfulRoutes.length === 0) {
      logger.error(`[CTO] Mixer failed completely - no successful routes:`, mixerResult);
      return {
        success: false,
        error: `Mixer failed completely: ${mixerResult.results?.[0]?.error || "Unknown mixer error"}`
      };
    }

    logger.info(`[CTO] Mixer completed with ${mixerResult.successCount || successfulRoutes.length}/${mixerResult.totalRoutes || mixerResult.results?.length} successful routes`);
    
    // Log partial success details
    if (mixerResult.successCount < mixerResult.totalRoutes) {
      logger.info(`[CTO] Proceeding with partial mixer success: ${successfulRoutes.length} funded wallets available`);
    }

    // Wait a moment for funds to propagate
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Use the mixer's actual amount distribution from successful routes only
    const actualAmountsFromMixer = successfulRoutes.map(result => result.route.amount);

    logger.info(`[CTO] Using mixer's actual amount distribution: ${actualAmountsFromMixer.map(amt => (amt / 1e9).toFixed(6)).join(', ')} SOL`);

    // Use only the wallets that were actually funded by the mixer
    const walletsToUse = successfulRoutes.length;
    const selectedWallets = buyerWallets.slice(0, walletsToUse);

    logger.info(`[CTO] Using ${walletsToUse} wallets that were successfully funded by mixer`);

    // Execute buy transactions with 20ms delay between each buy
    const buyResults = [];
    for (let index = 0; index < selectedWallets.length; index++) {
      const wallet = selectedWallets[index];
      const buyAmountLamports = actualAmountsFromMixer[index];
      const buyAmountSol = buyAmountLamports / 1e9; // Convert lamports to SOL for external buy
      
      // CRITICAL FIX: Reserve 0.01 SOL in each wallet for future sell transactions
      const sellReserve = 0.01; // Reserve 0.01 SOL for sell transaction fees
      const adjustedBuyAmountSol = Math.max(0.001, buyAmountSol - sellReserve); // Ensure minimum 0.001 SOL for buy
      
      logger.info(`[CTO] Wallet ${index + 1}/${selectedWallets.length}: Original amount ${buyAmountSol.toFixed(6)} SOL, Adjusted for sell reserve: ${adjustedBuyAmountSol.toFixed(6)} SOL (reserving ${sellReserve} SOL for sells)`);
      
      try {
        const keypair = secretKeyToKeypair(wallet.privateKey);
        const result = await executeExternalBuy(tokenAddress, keypair, adjustedBuyAmountSol);
        
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
                amountSol: adjustedBuyAmountSol,
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
          
          buyResults.push({ success: true, signature: result.signature, walletAddress: wallet.publicKey });
        } else {
          logger.warn(`[CTO] Buy ${index + 1}/${selectedWallets.length} failed: ${result.error}`);
          
          // Record the failed CTO buy transaction
          try {
            const { recordTransaction } = await import("../../backend/functions");
            await recordTransaction(
              tokenAddress,
              wallet.publicKey,
              "external_buy",
              result.signature || "failed_cto_buy", // Provide a default signature for failed transactions
              false,
              0,
              {
                amountSol: adjustedBuyAmountSol,
                amountTokens: "0",
                errorMessage: result.error,
                retryAttempt: 0,
              }
            );
          } catch (recordError: any) {
            logger.warn(`[CTO] Failed to record failed transaction for wallet ${wallet.publicKey}:`, recordError);
          }
          
          buyResults.push({ success: false, error: result.error, walletAddress: wallet.publicKey });
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
            "error_cto_buy", // Provide a default signature for error transactions
            false,
            0,
            {
              amountSol: adjustedBuyAmountSol,
              amountTokens: "0",
              errorMessage: error.message,
              retryAttempt: 0,
            }
          );
        } catch (recordError: any) {
          logger.warn(`[CTO] Failed to record error transaction for wallet ${wallet.publicKey}:`, recordError);
        }
        
        buyResults.push({ success: false, error: error.message, walletAddress: wallet.publicKey });
      }
      
      // Add 20ms delay between buys (except for the last one)
      if (index < selectedWallets.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }

    // Count successful and failed buys
    const successfulBuys = buyResults.filter(r => r.success).length;
    const failedBuys = buyResults.filter(r => !r.success).length;

    logger.info(`[CTO] CTO operation completed: ${successfulBuys} successful, ${failedBuys} failed`);

    return {
      success: successfulBuys > 0, // Consider success if at least one buy succeeded
      successfulBuys,
      failedBuys,
      mixerSuccessRate: Math.round(((mixerResult.successCount || successfulRoutes.length) / (mixerResult.totalRoutes || mixerResult.results?.length || 1)) * 100),
      detectedPlatform
    };

  } catch (error: any) {
    logger.error(`[CTO] CTO operation failed:`, error);
    return {
      success: false,
      error: error.message || "Unknown error occurred"
    };
  }
}; 