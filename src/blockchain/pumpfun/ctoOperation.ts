import { logger } from "../common/logger";
import { getAllTradingWallets, getFundingWallet } from "../../backend/functions";
import { secretKeyToKeypair } from "../common/utils";
import { Context } from "grammy";

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
    const fundedWallets = buyerWallets.slice(0, walletsToUse);

    logger.info(`[CTO] Using ${walletsToUse} wallets that were successfully funded by mixer`);

    // NEW: Execute buy transactions sequentially with 50ms delays (no confirmation waiting)
    logger.info(`[CTO] Starting sequential buy execution with 50ms delays between wallets`);
    
    const buyResults = [];
    const transactionPromises = []; // Store promises for background confirmation
    
    for (let index = 0; index < fundedWallets.length; index++) {
      const wallet = fundedWallets[index];
      const buyAmountLamports = actualAmountsFromMixer[index];
      const buyAmountSol = buyAmountLamports / 1e9; // Convert lamports to SOL for external buy
      
      // CRITICAL FIX: Reserve 0.01 SOL in each wallet for future sell transactions
      const sellReserve = 0.01; // Reserve 0.01 SOL for sell transaction fees
      const adjustedBuyAmountSol = Math.max(0.001, buyAmountSol - sellReserve); // Ensure minimum 0.001 SOL for buy
      
      logger.info(`[CTO] Wallet ${index + 1}/${fundedWallets.length}: Original amount ${buyAmountSol.toFixed(6)} SOL, Adjusted for sell reserve: ${adjustedBuyAmountSol.toFixed(6)} SOL (reserving ${sellReserve} SOL for sells)`);
      
      try {
        const keypair = secretKeyToKeypair(wallet.privateKey);
        
        // NEW: Use non-confirmation version for fast sequential execution
        const { executeExternalBuyNoConfirmation } = await import("./externalBuyNoConfirmation");
        const result = await executeExternalBuyNoConfirmation(tokenAddress, keypair, adjustedBuyAmountSol, 3, 0.001, {} as Context);
        
        if (result.success) {
          logger.info(`[CTO] Buy ${index + 1}/${fundedWallets.length} sent successfully: ${result.signature}`);
          
          // Store the transaction for background confirmation and recording
          transactionPromises.push(
            confirmAndRecordTransaction(
              tokenAddress,
              wallet.publicKey,
              result.signature,
              adjustedBuyAmountSol,
              result.platform || "unknown"
            )
          );
          
          buyResults.push({ success: true, signature: result.signature, walletAddress: wallet.publicKey });
        } else {
          logger.warn(`[CTO] Buy ${index + 1}/${fundedWallets.length} failed to send: ${result.error}`);
          buyResults.push({ success: false, error: result.error, walletAddress: wallet.publicKey });
        }
      } catch (error: any) {
        logger.error(`[CTO] Buy ${index + 1}/${fundedWallets.length} error:`, error);
        buyResults.push({ success: false, error: error.message, walletAddress: wallet.publicKey });
      }
      
      // Add 50ms delay between wallets (except for the last one)
      if (index < fundedWallets.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    
    logger.info(`[CTO] All ${fundedWallets.length} buy transactions sent sequentially. Starting background confirmation...`);

    // Wait for all background confirmations to complete
    const confirmationResults = await Promise.allSettled(transactionPromises);
    
    // Update results based on confirmation outcomes
    let confirmedSuccesses = 0;
    let confirmedFailures = 0;
    
    confirmationResults.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.success) {
        confirmedSuccesses++;
        logger.info(`[CTO] Background confirmation successful for wallet ${index + 1}`);
      } else {
        confirmedFailures++;
        const error = result.status === 'rejected' ? result.reason : result.value?.error;
        logger.warn(`[CTO] Background confirmation failed for wallet ${index + 1}: ${error}`);
      }
    });

    // Count successful and failed buys
    const successfulBuys = confirmedSuccesses;
    const failedBuys = confirmedFailures;

    logger.info(`[CTO] CTO operation completed: ${successfulBuys} confirmed successful, ${failedBuys} confirmed failed`);

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

// NEW: Helper function to confirm and record transactions in background
async function confirmAndRecordTransaction(
  tokenAddress: string,
  walletPublicKey: string,
  signature: string,
  amountSol: number,
  platform: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { connection } = await import("../../service/config");
    
    // Wait for confirmation in background
    const confirmation = await connection.confirmTransaction(signature, "confirmed");
    
    if (confirmation.value.err) {
      const errorMsg = `Transaction failed: ${JSON.stringify(confirmation.value.err)}`;
      logger.warn(`[CTO Background] ${errorMsg}`);
      
      // Record failed transaction
      try {
        const { recordTransaction } = await import("../../backend/functions");
        await recordTransaction(
          tokenAddress,
          walletPublicKey,
          "external_buy",
          signature,
          false,
          0,
          {
            amountSol: amountSol,
            amountTokens: "0",
            errorMessage: errorMsg,
            retryAttempt: 0,
          }
        );
      } catch (recordError: any) {
        logger.warn(`[CTO Background] Failed to record failed transaction:`, recordError);
      }
      
      return { success: false, error: errorMsg };
    }
    
    // Record successful transaction
    try {
      const { recordTransactionWithActualAmounts } = await import("../../backend/utils");
      await recordTransactionWithActualAmounts(
        tokenAddress,
        walletPublicKey,
        "external_buy",
        signature,
        true,
        0,
        {
          amountSol: amountSol,
          amountTokens: "0", // Will be parsed from blockchain
          errorMessage: undefined,
          retryAttempt: 0,
        },
        true // Parse actual amounts from blockchain
      );
      logger.info(`[CTO Background] Transaction recorded successfully: ${signature}`);
    } catch (recordError: any) {
      logger.warn(`[CTO Background] Failed to record successful transaction:`, recordError);
    }
    
    return { success: true };
    
  } catch (error: any) {
    logger.error(`[CTO Background] Confirmation error:`, error);
    return { success: false, error: error.message };
  }
}
