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
  platform?: 'pumpswap' | 'pumpfun';
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
  const walletId = sellerKeypair.publicKey.toBase58().substring(0, 8);
  
  logger.info(`[${logId}] Starting external sell: ${tokenAmount} tokens of ${tokenAddress} from wallet ${walletId}...`);
  
  try {
    // Validate inputs
    if (tokenAmount <= 0) {
      throw new Error('Token amount must be greater than 0');
    }
    
    // Try to get platform from cache first (for speed)
    let detection: any;
    try {
      const { getPlatformFromCache } = await import('../../bot/index');
      const cachedPlatform = getPlatformFromCache(tokenAddress);
      
      if (cachedPlatform) {
        logger.info(`[${logId}] Using cached platform detection: ${cachedPlatform}`);
        detection = {
          isPumpswap: cachedPlatform === 'pumpswap',
          isPumpfun: cachedPlatform === 'pumpfun',
          error: cachedPlatform === 'unknown' ? 'Token not found on supported platforms' : undefined
        };
      } else {
        logger.info(`[${logId}] No cached platform found, detecting token platform...`);
        detection = await detectTokenPlatform(tokenAddress);
      }
    } catch (cacheError) {
      logger.warn(`[${logId}] Cache access failed, falling back to detection:`, cacheError);
      logger.info(`[${logId}] Detecting token platform...`);
      detection = await detectTokenPlatform(tokenAddress);
    }
    
    if (detection.error) {
      logger.error(`[${logId}] Token detection failed:`, detection.error);
      return {
        success: false,
        error: detection.error
      };
    }
    
    // Try Pumpswap first if available
    if (detection.isPumpswap) {
      logger.info(`[${logId}] Token detected on Pumpswap, using Pumpswap service`);
      
      try {
        const pumpswapService = new PumpswapService();
        const privateKeyBase58 = bs58.encode(sellerKeypair.secretKey);
        
        const sellData = {
          mint: new PublicKey(tokenAddress),
          amount: BigInt(Math.floor(tokenAmount)),
          privateKey: privateKeyBase58
        };
        
        logger.info(`[${logId}] Creating Pumpswap sell transaction...`);
        const sellTx = await pumpswapService.sellTx(sellData);
        
        logger.info(`[${logId}] Sending Pumpswap transaction...`);
        const { connection } = await import('../../service/config');
        const signature = await connection.sendTransaction(sellTx, {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 3
        });
        
        logger.info(`[${logId}] Pumpswap transaction sent: ${signature}`);
        
        // Wait for confirmation
        const confirmation = await connection.confirmTransaction(signature, 'confirmed');
        
        if (confirmation.value.err) {
          throw new Error(`Pumpswap transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }
        
        logger.info(`[${logId}] Pumpswap sell successful: ${signature}`);
        
        return {
          success: true,
          signature,
          platform: 'pumpswap'
        };
        
      } catch (pumpswapError: any) {
        logger.error(`[${logId}] Pumpswap sell failed:`, pumpswapError);
        
        // If Pumpswap fails, try PumpFun as fallback
        if (detection.isPumpfun) {
          logger.info(`[${logId}] Falling back to PumpFun after Pumpswap failure`);
        } else {
          return {
            success: false,
            error: `Pumpswap sell failed: ${pumpswapError.message}`,
            platform: 'pumpswap'
          };
        }
      }
    }
    
    // Use PumpFun if token is on PumpFun or as fallback
    if (detection.isPumpfun) {
      logger.info(`[${logId}] Using PumpFun for token sell`);
      
      try {
        const mintPublicKey = new PublicKey(tokenAddress);
        const ata = getAssociatedTokenAddressSync(mintPublicKey, sellerKeypair.publicKey);
        
        // Check token balance
        const balance = (await connection.getTokenAccountBalance(ata)).value.amount;
        const availableTokens = BigInt(balance);
        
        if (availableTokens <= BigInt(0)) {
          throw new Error('No tokens available to sell');
        }
        
        // Use the minimum of requested amount and available balance
        const tokensToSell = BigInt(tokenAmount) > availableTokens ? availableTokens : BigInt(tokenAmount);
        
        // Get bonding curve data
        const { bondingCurve } = getBondingCurve(mintPublicKey);
        const bondingCurveData = await getBondingCurveData(bondingCurve);
        
        if (!bondingCurveData) {
          throw new Error('Token bonding curve not found - token may not be a PumpFun token');
        }
        
        // Quote the sell
        const { solOut } = quoteSell(
          tokensToSell,
          bondingCurveData.virtualTokenReserves,
          bondingCurveData.virtualSolReserves,
          bondingCurveData.realTokenReserves,
        );
        
        const solOutWithSlippage = applySlippage(solOut, 50); // 50% slippage
        
        // Create sell instruction
        const sellIx = sellInstruction(
          mintPublicKey,
          new PublicKey(bondingCurveData.creator),
          sellerKeypair.publicKey,
          tokensToSell,
          solOutWithSlippage,
        );
        
        // Create and send transaction
        const blockHash = await connection.getLatestBlockhash("processed");
        const sellTx = new VersionedTransaction(
          new TransactionMessage({
            instructions: [sellIx],
            payerKey: sellerKeypair.publicKey,
            recentBlockhash: blockHash.blockhash,
          }).compileToV0Message(),
        );
        
        sellTx.sign([sellerKeypair]);
        
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
          throw new Error(`PumpFun transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }
        
        const solReceived = Number(solOut) / LAMPORTS_PER_SOL;
        logger.info(`[${logId}] PumpFun sell successful: ${signature} - ${solReceived.toFixed(6)} SOL received`);
        
        return {
          success: true,
          signature,
          platform: 'pumpfun',
          solReceived: solReceived.toString()
        };
        
      } catch (pumpfunError: any) {
        logger.error(`[${logId}] PumpFun sell error:`, pumpfunError);
        return {
          success: false,
          error: `PumpFun sell failed: ${pumpfunError.message}`,
          platform: 'pumpfun'
        };
      }
    }
    
    // Token not found on either platform
    logger.error(`[${logId}] Token not available on supported platforms`);
    return {
      success: false,
      error: 'Token not available on supported platforms (Pumpswap or PumpFun)'
    };
    
  } catch (error: any) {
    logger.error(`[${logId}] External sell error:`, error);
    return {
      success: false,
      error: `External sell failed: ${error.message}`
    };
  }
} 