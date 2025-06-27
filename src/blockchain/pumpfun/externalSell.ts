import { Connection, PublicKey, Keypair, VersionedTransaction, TransactionMessage, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { connection } from "../common/connection";
import { secretKeyToKeypair } from "../common/utils";
import { decryptPrivateKey } from "../../backend/utils";
import { logger } from "../common/logger";
import { sellInstruction } from "./instructions";
import { getGlobalSetting, getBondingCurve, getBondingCurveData, applySlippage } from "./utils";
import { detectTokenPlatform } from "../../service/token-detection-service";
import PumpswapService from "../../service/pumpswap-service";
import bs58 from "bs58";
import { ComputeBudgetProgram } from "@solana/web3.js";
import { sendAndConfirmTransactionWithRetry } from "../common/utils";

interface ExternalSellResult {
  success: boolean;
  successfulSells: number;
  failedSells: number;
  totalSolReceived?: number;
  error?: string;
}

// Quote sell function - calculates SOL output for token input
const quoteSell = (
  tokenAmountIn: bigint,
  virtualTokenReserves: bigint,
  virtualSolReserves: bigint,
  realTokenReserves: bigint,
) => {
  if (tokenAmountIn > realTokenReserves) {
    tokenAmountIn = realTokenReserves;
  }

  const virtualTokenAmount = virtualSolReserves * virtualTokenReserves;
  const newVirtualTokenReserves = virtualTokenReserves + tokenAmountIn;
  const newVirtualSolReserves = virtualTokenAmount / newVirtualTokenReserves + BigInt(1);
  const solOut = virtualSolReserves - newVirtualSolReserves;

  return {
    solOut,
    newVirtualTokenReserves,
    newVirtualSolReserves,
    newRealTokenReserves: realTokenReserves - tokenAmountIn,
  };
};

export const executeExternalTokenSell = async (
  tokenAddress: string,
  buyerWallets: string[],
  sellPercent: number,
): Promise<ExternalSellResult> => {
  if (sellPercent < 1 || sellPercent > 100) {
    return {
      success: false,
      successfulSells: 0,
      failedSells: 0,
      error: "Sell percentage must be between 1 and 100"
    };
  }

  const logIdentifier = `external-sell-${tokenAddress}`;
  logger.info(`[${logIdentifier}]: Starting external token sell`);
  const start = performance.now();

  try {
    const mintPublicKey = new PublicKey(tokenAddress);
    const buyerKeypairs = buyerWallets.map((w) =>
      secretKeyToKeypair(decryptPrivateKey(w)),
    );

    // Get bonding curve data for this specific token
    const { bondingCurve } = getBondingCurve(mintPublicKey);
    const bondingCurveData = await getBondingCurveData(bondingCurve);
    
    if (!bondingCurveData) {
      return {
        success: false,
        successfulSells: 0,
        failedSells: 0,
        error: "Token bonding curve not found - token may not be a PumpFun token"
      };
    }

    // Check wallet balances and prepare sell setups
    const walletBalances = [];
    for (const wallet of buyerKeypairs) {
      try {
        const ata = getAssociatedTokenAddressSync(mintPublicKey, wallet.publicKey);
        const balance = (await connection.getTokenAccountBalance(ata)).value.amount;
        if (BigInt(balance) > 0) {
          walletBalances.push({
            wallet,
            ata,
            balance: BigInt(balance),
          });
        }
      } catch (error) {
        logger.warn(`[${logIdentifier}]: Error checking balance for wallet ${wallet.publicKey.toBase58()}:`, error);
      }
    }

    if (walletBalances.length === 0) {
      return {
        success: false,
        successfulSells: 0,
        failedSells: 0,
        error: "No tokens found in any buyer wallets"
      };
    }

    const totalBalance = walletBalances.reduce(
      (sum, { balance }) => sum + balance,
      BigInt(0),
    );

    let tokensToSell =
      sellPercent === 100
        ? totalBalance
        : (BigInt(sellPercent) * BigInt(100) * totalBalance) / BigInt(10_000);

    const sellSetups: {
      wallet: Keypair;
      ata: PublicKey;
      amount: bigint;
    }[] = [];

    // Distribute tokens to sell across wallets
    for (const walletInfo of walletBalances) {
      if (tokensToSell <= BigInt(0)) {
        break;
      }
      if (tokensToSell <= walletInfo.balance) {
        sellSetups.push({
          wallet: walletInfo.wallet,
          ata: walletInfo.ata,
          amount: tokensToSell,
        });
        break;
      }
      tokensToSell -= walletInfo.balance;
      sellSetups.push({
        wallet: walletInfo.wallet,
        ata: walletInfo.ata,
        amount: walletInfo.balance,
      });
    }

    logger.info(`[${logIdentifier}]: Prepared ${sellSetups.length} sell transactions`);

    // Get latest blockhash
    const blockHash = await connection.getLatestBlockhash("processed");

    // Execute sells with retry logic
    const sellPromises = sellSetups.map(async (setup, index) => {
      const maxRetries = 3;
      let baseSlippage = 50; // Start with 50% slippage
      const maxSlippage = 90; // Maximum slippage cap
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const slippage = Math.min(baseSlippage + (attempt - 1) * 20, maxSlippage); // Increase slippage by 20% each retry, capped at 90%
          
          logger.info(`[${logIdentifier}]: Wallet ${index + 1} - Attempt ${attempt} with ${slippage}% slippage`);

          // Quote the sell using current bonding curve data
          const { solOut } = quoteSell(
            setup.amount,
            bondingCurveData.virtualTokenReserves,
            bondingCurveData.virtualSolReserves,
            bondingCurveData.realTokenReserves,
          );

          const solOutWithSlippage = applySlippage(solOut, slippage);

          // Create sell instruction
          const sellIx = sellInstruction(
            mintPublicKey,
            new PublicKey(bondingCurveData.creator),
            setup.wallet.publicKey,
            setup.amount,
            solOutWithSlippage,
          );

          // Create and send transaction
          const sellTx = new VersionedTransaction(
            new TransactionMessage({
              instructions: [sellIx],
              payerKey: setup.wallet.publicKey,
              recentBlockhash: blockHash.blockhash,
            }).compileToV0Message(),
          );

          sellTx.sign([setup.wallet]);

          const signature = await connection.sendTransaction(sellTx, {
            skipPreflight: false,
            preflightCommitment: "processed",
          });

          // Wait for confirmation
          const confirmation = await connection.confirmTransaction({
            signature,
            blockhash: blockHash.blockhash,
            lastValidBlockHeight: blockHash.lastValidBlockHeight,
          }, "confirmed");

          if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${confirmation.value.err}`);
          }

          const solReceived = Number(solOut) / LAMPORTS_PER_SOL;
          logger.info(`[${logIdentifier}]: Wallet ${index + 1} sell successful - ${solReceived.toFixed(6)} SOL received`);

          return {
            success: true,
            solReceived,
            signature,
            wallet: setup.wallet.publicKey.toBase58(),
          };

        } catch (error: any) {
          logger.warn(`[${logIdentifier}]: Wallet ${index + 1} - Attempt ${attempt} failed:`, error.message);
          
          if (attempt === maxRetries) {
            return {
              success: false,
              error: error.message,
              wallet: setup.wallet.publicKey.toBase58(),
            };
          }
          
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }

      return {
        success: false,
        error: "Max retries exceeded",
        wallet: setup.wallet.publicKey.toBase58(),
      };
    });

    // Wait for all sells to complete
    const results = await Promise.all(sellPromises);
    
    const successfulSells = results.filter(r => r.success).length;
    const failedSells = results.filter(r => !r.success).length;
    const totalSolReceived = results
      .filter(r => r.success)
      .reduce((sum, r) => sum + (r.solReceived || 0), 0);

    const end = performance.now();
    logger.info(`[${logIdentifier}]: External sell completed in ${(end - start).toFixed(2)}ms`, {
      successfulSells,
      failedSells,
      totalSolReceived: totalSolReceived.toFixed(6),
    });

    return {
      success: successfulSells > 0,
      successfulSells,
      failedSells,
      totalSolReceived,
    };

  } catch (error: any) {
    logger.error(`[${logIdentifier}]: External sell failed:`, error);
    return {
      success: false,
      successfulSells: 0,
      failedSells: buyerWallets.length,
      error: error.message,
    };
  }
};

// Simple external sell interface for individual wallet sells
interface SimpleExternalSellResult {
  success: boolean;
  signature?: string;
  error?: string;
  platform?: 'pumpswap' | 'pumpfun' | 'unknown';
  solReceived?: string;
}

/**
 * Executes a sell transaction for an external token from a single wallet.
 * Automatically detects if token is on Pumpswap or PumpFun and uses appropriate method.
 * @param tokenAddress The address of the token to sell
 * @param sellerKeypair The keypair of the seller wallet
 * @param tokenAmount The amount of tokens to sell
 * @returns The transaction result
 */
export async function executeExternalSell(tokenAddress: string, sellerKeypair: Keypair, tokenAmount: number): Promise<SimpleExternalSellResult> {
  const logId = `external-sell-${tokenAddress.substring(0, 8)}`;
  logger.info(`[${logId}] Starting external sell for ${tokenAmount} tokens`);
  
  try {
    const mintPublicKey = new PublicKey(tokenAddress);
    
    // **CRITICAL FIX: Validate actual balance before attempting to sell**
    const ata = getAssociatedTokenAddressSync(mintPublicKey, sellerKeypair.publicKey);
    let actualBalance: bigint;
    
    try {
      const balanceInfo = await connection.getTokenAccountBalance(ata);
      actualBalance = BigInt(balanceInfo.value.amount);
      logger.info(`[${logId}] DEBUG: Actual wallet balance = ${actualBalance.toString()}`);
    } catch (balanceError: any) {
      logger.error(`[${logId}] Failed to get token balance:`, balanceError);
      return {
        success: false,
        error: `Failed to get token balance: ${balanceError.message}`
      };
    }
    
    // Convert tokenAmount to BigInt and ensure it doesn't exceed actual balance
    const requestedAmount = BigInt(Math.floor(Math.abs(tokenAmount))); // Ensure positive
    const tokensToSell = requestedAmount > actualBalance ? actualBalance : requestedAmount;
    
    // **DEBUG LOGGING - Track exact values being used**
    logger.info(`[${logId}] DEBUG: tokenAmount parameter = ${tokenAmount}`);
    logger.info(`[${logId}] DEBUG: requestedAmount = ${requestedAmount.toString()}`);
    logger.info(`[${logId}] DEBUG: actualBalance = ${actualBalance.toString()}`);
    logger.info(`[${logId}] DEBUG: tokensToSell (adjusted) = ${tokensToSell.toString()}`);
    
    // Early validation: ensure we have tokens to sell
    if (tokensToSell === BigInt(0)) {
      logger.warn(`[${logId}] No tokens to sell - balance is zero or insufficient`);
      return {
        success: false,
        error: `No tokens available to sell. Actual balance: ${actualBalance.toString()}`
      };
    }
    
    // Warn if we had to adjust the amount
    if (tokensToSell < requestedAmount) {
      logger.warn(`[${logId}] Adjusted sell amount from ${requestedAmount.toString()} to ${tokensToSell.toString()} due to insufficient balance`);
    }

    // Start Pumpswap data preloading immediately (coordinated with transaction)
    const pumpswapService = new PumpswapService();
    const preloadPromise = pumpswapService.preloadTokenData(tokenAddress);
    
    // Check if we have cached platform info from token display
    const { getCachedPlatform, markTokenAsPumpFun, markTokenAsPumpswap, isTokenGraduated } = await import('../../service/token-detection-service');
    const cachedPlatform = getCachedPlatform(tokenAddress);
    
    if (cachedPlatform === 'pumpswap') {
      logger.info(`[${logId}] Using cached Pumpswap detection - going directly to Pumpswap`);
      logger.info(`[${logId}] DEBUG: Calling Pumpswap with amount = ${tokensToSell.toString()}`);
      // Try Pumpswap first since it's cached as confirmed Pumpswap
      try {
        const sellTx = await pumpswapService.sellTx({
          mint: mintPublicKey,
          privateKey: bs58.encode(sellerKeypair.secretKey),
          amount: tokensToSell
        });
        
        const signature = await connection.sendTransaction(sellTx, {
          skipPreflight: false,
          preflightCommitment: "processed",
        });
        
        const confirmation = await connection.confirmTransaction({
          signature,
          blockhash: sellTx.message.recentBlockhash!,
          lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight,
        }, "confirmed");
        
        if (confirmation.value.err) {
          throw new Error(`Pumpswap transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }
        
        logger.info(`[${logId}] Pumpswap sell successful: ${signature}`);
        markTokenAsPumpswap(tokenAddress); // Mark as permanently Pumpswap
        return {
          success: true,
          signature,
          platform: 'pumpswap',
          solReceived: "Success"
        };
        
      } catch (pumpswapError: any) {
        logger.error(`[${logId}] Pumpswap sell failed for cached Pumpswap token:`, pumpswapError);
        // Fall through to try PumpFun
      }
    }
    
    if (cachedPlatform === 'pumpfun') {
      logger.info(`[${logId}] Using cached PumpFun detection`);
      
      // Even if cached as PumpFun, check if it has graduated (for optimal routing)
      try {
        const graduated = await isTokenGraduated(tokenAddress);
        if (graduated === true) {
          logger.info(`[${logId}] Cached PumpFun token has graduated - switching to Pumpswap for better performance`);
          logger.info(`[${logId}] DEBUG: Calling Pumpswap for graduated token with amount = ${tokensToSell.toString()}`);
          markTokenAsPumpswap(tokenAddress); // Update cache to Pumpswap
          
          // Route to Pumpswap for graduated tokens
          const sellTx = await pumpswapService.sellTx({
            mint: mintPublicKey,
            privateKey: bs58.encode(sellerKeypair.secretKey),
            amount: tokensToSell
          });
          
          const signature = await connection.sendTransaction(sellTx, {
            skipPreflight: false,
            preflightCommitment: "processed",
          });
          
          const confirmation = await connection.confirmTransaction({
            signature,
            blockhash: sellTx.message.recentBlockhash!,
            lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight,
          }, "confirmed");
          
          if (confirmation.value.err) {
            throw new Error(`Pumpswap transaction failed: ${JSON.stringify(confirmation.value.err)}`);
          }
          
          logger.info(`[${logId}] Pumpswap sell successful for graduated token: ${signature}`);
          return {
            success: true,
            signature,
            platform: 'pumpswap',
            solReceived: "Success"
          };
        }
      } catch (graduationError: any) {
        logger.warn(`[${logId}] Could not check graduation status, proceeding with cached PumpFun: ${graduationError.message}`);
      }
      
      // Try PumpFun directly since it's cached as confirmed PumpFun (and not graduated)
      try {
        logger.info(`[${logId}] DEBUG: Calling PumpFun with tokensToSell = ${tokensToSell.toString()}`);
        // Need to get token creator for sellInstruction (same as executeWalletSell)
        const { bondingCurve } = getBondingCurve(mintPublicKey);
        const bondingCurveData = await getBondingCurveData(bondingCurve);
        
        if (!bondingCurveData) {
          throw new Error("Token bonding curve not found - cached data may be incorrect");
        }
        
        // Use exact same sell logic as executeWalletSell (needs token creator)
        const sellIx = sellInstruction(
          mintPublicKey, 
          new PublicKey(bondingCurveData.creator), // Token creator (like executeWalletSell)
          sellerKeypair.publicKey, // Seller wallet
          tokensToSell, 
          BigInt(0) // No minimum SOL output
        );
        
        logger.info(`[${logId}] DEBUG: Created PumpFun sellInstruction with amount = ${tokensToSell.toString()}`);
        
        // Add compute budget instructions (same as launch sells)
        const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
          units: 151595,
        });
        const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: 1_000_000,
        });
        
        // Create and send transaction (same pattern as launch sells)
        const blockHash = await connection.getLatestBlockhash("processed");
        const sellTx = new VersionedTransaction(
          new TransactionMessage({
            instructions: [modifyComputeUnits, addPriorityFee, sellIx],
            payerKey: sellerKeypair.publicKey,
            recentBlockhash: blockHash.blockhash,
          }).compileToV0Message(),
        );
        
        sellTx.sign([sellerKeypair]);
        
        // Send with retry logic (same as launch sells)
        const result = await sendAndConfirmTransactionWithRetry(
          sellTx,
          {
            payer: sellerKeypair.publicKey,
            signers: [sellerKeypair],
            instructions: [modifyComputeUnits, addPriorityFee, sellIx],
          },
          10_000,
          3,
          1000,
          logId
        );
        
        if (!result.success) {
          throw new Error("PumpFun sell transaction failed");
        }
        
        logger.info(`[${logId}] PumpFun sell successful: ${result.signature}`);
        markTokenAsPumpFun(tokenAddress); // Mark as permanently PumpFun
        
        return {
          success: true,
          signature: result.signature!,
          platform: 'pumpfun',
          solReceived: "Success"
        };
        
      } catch (pumpfunError: any) {
        logger.error(`[${logId}] PumpFun sell failed for cached PumpFun token:`, pumpfunError);
        return {
          success: false,
          error: `PumpFun sell failed: ${pumpfunError.message}`,
          platform: 'pumpfun'
        };
      }
    }

    // No cache or unknown - use bonding curve detection approach with graduation check
    logger.info(`[${logId}] No cached platform, using bonding curve detection with graduation check`);
    
    // First, check if token has graduated (fast routing decision)
    try {
      const graduated = await isTokenGraduated(tokenAddress);
      if (graduated === true) {
        logger.info(`[${logId}] Token has graduated to Raydium - routing directly to Pumpswap`);
        logger.info(`[${logId}] DEBUG: Calling Pumpswap for graduated token (no cache) with amount = ${tokensToSell.toString()}`);
        
                  // Route directly to Pumpswap for graduated tokens
          const sellTx = await pumpswapService.sellTx({
            mint: mintPublicKey,
            privateKey: bs58.encode(sellerKeypair.secretKey),
            amount: tokensToSell
          });
        
        const signature = await connection.sendTransaction(sellTx, {
          skipPreflight: false,
          preflightCommitment: "processed",
        });
        
        const confirmation = await connection.confirmTransaction({
          signature,
          blockhash: sellTx.message.recentBlockhash!,
          lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight,
        }, "confirmed");
        
        if (confirmation.value.err) {
          throw new Error(`Pumpswap transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }
        
        logger.info(`[${logId}] Pumpswap sell successful for graduated token: ${signature}`);
        markTokenAsPumpswap(tokenAddress); // Mark as permanently Pumpswap
        return {
          success: true,
          signature,
          platform: 'pumpswap',
          solReceived: "Success"
        };
      } else if (graduated === false) {
        logger.info(`[${logId}] Token is still on PumpFun bonding curve - routing to PumpFun`);
        // Continue to PumpFun logic below
      } else {
        logger.info(`[${logId}] Could not determine graduation status - using fallback detection`);
        // Continue to fallback logic below
      }
    } catch (graduationError: any) {
      logger.warn(`[${logId}] Graduation check failed, falling back to standard detection: ${graduationError.message}`);
    }
    
    // Try PumpFun first using bonding curve detection (for non-graduated or unknown tokens)
    logger.info(`[${logId}] Attempting PumpFun sell with bonding curve detection`);
    try {
      // Use bonding curve fetching to detect if it's PumpFun (same logic as launch/buy)
      const { bondingCurve } = getBondingCurve(mintPublicKey);
      const bondingCurveData = await getBondingCurveData(bondingCurve);
      
      if (bondingCurveData) {
        // Successfully fetched bonding curve data = PumpFun token
        logger.info(`[${logId}] Bonding curve data found - confirmed PumpFun token`);
        
        // Check if it's graduated (should not happen if graduation check above worked)
        if (bondingCurveData.complete) {
          logger.info(`[${logId}] Token is graduated but missed earlier check - routing to Pumpswap`);
          logger.info(`[${logId}] DEBUG: Calling Pumpswap for missed graduated token with amount = ${tokensToSell.toString()}`);
          markTokenAsPumpswap(tokenAddress); // Mark as permanently Pumpswap
          
          // Route to Pumpswap for graduated tokens
          const sellTx = await pumpswapService.sellTx({
            mint: mintPublicKey,
            privateKey: bs58.encode(sellerKeypair.secretKey),
            amount: tokensToSell
          });
          
          const signature = await connection.sendTransaction(sellTx, {
            skipPreflight: false,
            preflightCommitment: "processed",
          });
          
          const confirmation = await connection.confirmTransaction({
            signature,
            blockhash: sellTx.message.recentBlockhash!,
            lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight,
          }, "confirmed");
          
          if (confirmation.value.err) {
            throw new Error(`Pumpswap transaction failed: ${JSON.stringify(confirmation.value.err)}`);
          }
          
          logger.info(`[${logId}] Pumpswap sell successful for graduated token: ${signature}`);
          return {
            success: true,
            signature,
            platform: 'pumpswap',
            solReceived: "Success"
          };
        }
        
        // Active bonding curve - use PumpFun
        logger.info(`[${logId}] Active bonding curve - using PumpFun sell`);
        logger.info(`[${logId}] DEBUG: Calling PumpFun (fallback detection) with tokensToSell = ${tokensToSell.toString()}`);
        
        // Use exact same sell logic as executeWalletSell (needs token creator)
        const sellIx = sellInstruction(
          mintPublicKey, 
          new PublicKey(bondingCurveData.creator), // Token creator (like executeWalletSell)
          sellerKeypair.publicKey, // Seller wallet
          tokensToSell, 
          BigInt(0) // No minimum SOL output
        );
        
        logger.info(`[${logId}] DEBUG: Created PumpFun sellInstruction (fallback) with amount = ${tokensToSell.toString()}`);
        
        // Add compute budget instructions (same as launch sells)
        const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
          units: 151595,
        });
        const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: 1_000_000,
        });
        
        // Create and send transaction (same pattern as launch sells)
        const blockHash = await connection.getLatestBlockhash("processed");
        const sellTx = new VersionedTransaction(
          new TransactionMessage({
            instructions: [modifyComputeUnits, addPriorityFee, sellIx],
            payerKey: sellerKeypair.publicKey,
            recentBlockhash: blockHash.blockhash,
          }).compileToV0Message(),
        );
        
        sellTx.sign([sellerKeypair]);
        
        // Send with retry logic (same as launch sells)
        const result = await sendAndConfirmTransactionWithRetry(
          sellTx,
          {
            payer: sellerKeypair.publicKey,
            signers: [sellerKeypair],
            instructions: [modifyComputeUnits, addPriorityFee, sellIx],
          },
          10_000,
          3,
          1000,
          logId
        );
        
        if (!result.success) {
          throw new Error("PumpFun sell transaction failed");
        }
        
        logger.info(`[${logId}] PumpFun sell successful: ${result.signature}`);
        markTokenAsPumpFun(tokenAddress);
        
        return {
          success: true,
          signature: result.signature!,
          platform: 'pumpfun',
          solReceived: "Success"
        };
        
      } else {
        // Could not fetch bonding curve data = likely Pumpswap token
        logger.info(`[${logId}] No bonding curve data found - token is likely Pumpswap`);
      }
      
    } catch (pumpfunError: any) {
      logger.info(`[${logId}] Bonding curve detection failed (likely Pumpswap token): ${pumpfunError.message}`);
      // If bonding curve detection fails, it's likely a Pumpswap token
    }

    // Try Pumpswap as fallback
    logger.info(`[${logId}] Attempting Pumpswap sell as fallback`);
    logger.info(`[${logId}] DEBUG: Calling Pumpswap (final fallback) with amount = ${tokensToSell.toString()}`);
    try {
      const sellTx = await pumpswapService.sellTx({
        mint: mintPublicKey,
        privateKey: bs58.encode(sellerKeypair.secretKey),
        amount: tokensToSell
      });
      
      const signature = await connection.sendTransaction(sellTx, {
        skipPreflight: false,
        preflightCommitment: "processed",
      });
      
      const confirmation = await connection.confirmTransaction({
        signature,
        blockhash: sellTx.message.recentBlockhash!,
        lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight,
      }, "confirmed");
      
      if (confirmation.value.err) {
        throw new Error(`Pumpswap transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }
      
      logger.info(`[${logId}] Pumpswap sell successful: ${signature}`);
      markTokenAsPumpswap(tokenAddress); // Mark as permanently Pumpswap
      return {
        success: true,
        signature,
        platform: 'pumpswap',
        solReceived: "Success"
      };
      
    } catch (pumpswapError: any) {
      logger.error(`[${logId}] Pumpswap sell failed:`, pumpswapError);
      return {
        success: false,
        error: `Both platforms failed. PumpFun: bonding curve not found. Pumpswap: ${pumpswapError.message}`
      };
    }

  } catch (error: any) {
    logger.error(`[${logId}] External sell error:`, error);
    return {
      success: false,
      error: error.message
    };
  }
} 