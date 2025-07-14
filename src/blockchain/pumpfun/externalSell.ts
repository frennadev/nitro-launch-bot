import {
  Connection,
  PublicKey,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { connection } from "../common/connection";
import { quoteSell, secretKeyToKeypair } from "../common/utils";
import { logger } from "../common/logger";
import { sellInstruction } from "./instructions";
import { getGlobalSetting, getBondingCurve, getBondingCurveData, applySlippage } from "./utils";
import { detectTokenPlatform } from "../../service/token-detection-service";
import PumpswapService from "../../service/pumpswap-service";
import bs58 from "bs58";
import { ComputeBudgetProgram } from "@solana/web3.js";
import { sendAndConfirmTransactionWithRetry } from "../common/utils";
import { collectTransactionFee } from "../../backend/functions-main";
import JupiterPumpswapService from "../../service/jupiter-pumpswap-service";

interface ExternalSellResult {
  success: boolean;
  successfulSells: number;
  failedSells: number;
  totalSolReceived?: number;
  error?: string;
}

// Quote sell function - calculates SOL output for token input
export const executeExternalTokenSell = async (
  tokenAddress: string,
  buyerWallets: string[],
  sellPercent: number
): Promise<ExternalSellResult> => {
  if (sellPercent < 1 || sellPercent > 100) {
    return {
      success: false,
      successfulSells: 0,
      failedSells: 0,
      error: "Sell percentage must be between 1 and 100",
    };
  }

  const logIdentifier = `external-sell-${tokenAddress}`;
  logger.info(`[${logIdentifier}]: Starting external token sell`);
  const start = performance.now();

  try {
    const mintPublicKey = new PublicKey(tokenAddress);
    const buyerKeypairs = buyerWallets.map((w) => secretKeyToKeypair(w));

    // Get bonding curve data for this specific token
    const { bondingCurve } = getBondingCurve(mintPublicKey);
    const bondingCurveData = await getBondingCurveData(bondingCurve);

    if (!bondingCurveData) {
      return {
        success: false,
        successfulSells: 0,
        failedSells: 0,
        error: "Token bonding curve not found - token may not be a PumpFun token",
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
        error: "No tokens found in any buyer wallets",
      };
    }

    const totalBalance = walletBalances.reduce((sum, { balance }) => sum + balance, BigInt(0));

    let tokensToSell =
      sellPercent === 100 ? totalBalance : (BigInt(sellPercent) * BigInt(100) * totalBalance) / BigInt(10_000);

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
          const { minSolOut: solOut } = quoteSell(
            setup.amount,
            bondingCurveData.virtualTokenReserves,
            bondingCurveData.virtualSolReserves,
            bondingCurveData.realTokenReserves
          );

          // const solOutWithSlippage = applySlippage(solOut, slippage);

          // Create sell instruction
          const sellIx = sellInstruction(
            mintPublicKey,
            new PublicKey(bondingCurveData.creator),
            setup.wallet.publicKey,
            setup.amount,
            solOut
          );

          // Create and send transaction
          const sellTx = new VersionedTransaction(
            new TransactionMessage({
              instructions: [sellIx],
              payerKey: setup.wallet.publicKey,
              recentBlockhash: blockHash.blockhash,
            }).compileToV0Message()
          );

          sellTx.sign([setup.wallet]);

          const signature = await connection.sendTransaction(sellTx, {
            skipPreflight: false,
            preflightCommitment: "processed",
          });

          // Wait for confirmation
          const confirmation = await connection.confirmTransaction(
            {
              signature,
              blockhash: blockHash.blockhash,
              lastValidBlockHeight: blockHash.lastValidBlockHeight,
            },
            "confirmed"
          );

          if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${confirmation.value.err}`);
          }

          const solReceived = Number(solOut) / LAMPORTS_PER_SOL;
          logger.info(
            `[${logIdentifier}]: Wallet ${index + 1} sell successful - ${solReceived.toFixed(6)} SOL received`
          );

          // Collect 1% transaction fee after successful PumpFun sell
          try {
            const feeResult = await collectTransactionFee(
              bs58.encode(setup.wallet.secretKey),
              solReceived,
              "sell"
            );
            
            if (feeResult.success) {
              logger.info(`[${logIdentifier}]: Wallet ${index + 1} sell transaction fee collected: ${feeResult.feeAmount} SOL, Signature: ${feeResult.signature}`);
            } else {
              logger.warn(`[${logIdentifier}]: Failed to collect wallet ${index + 1} sell transaction fee: ${feeResult.error}`);
            }
          } catch (feeError: any) {
            logger.warn(`[${logIdentifier}]: Error collecting wallet ${index + 1} sell transaction fee: ${feeError.message}`);
          }

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
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
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

    const successfulSells = results.filter((r) => r.success).length;
    const failedSells = results.filter((r) => !r.success).length;
    const totalSolReceived = results.filter((r) => r.success).reduce((sum, r) => sum + (r.solReceived || 0), 0);

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
  platform?: string;
  solReceived?: string;
}

/**
 * Execute external token sell using the unified Jupiter-Pumpswap service
 * This service automatically handles Jupiter -> Pumpswap -> PumpFun fallback chain
 */
export async function executeExternalSell(
  tokenAddress: string,
  sellerKeypair: Keypair,
  tokenAmount: number
): Promise<SimpleExternalSellResult> {
  const logId = `external-sell-${tokenAddress.substring(0, 8)}`;
  
  try {
    logger.info(`[${logId}] Starting external token sell using unified service`);
    
    // Use the new unified Jupiter-Pumpswap service for all external sells
    const jupiterPumpswapService = new JupiterPumpswapService();
    
    const result = await jupiterPumpswapService.executeSell(
      tokenAddress,
      sellerKeypair,
      tokenAmount
    );
    
    if (result.success) {
      logger.info(`[${logId}] External sell successful via ${result.platform}: ${result.signature}`);
      return {
        success: true,
        signature: result.signature,
        platform: result.platform,
        solReceived: result.solReceived || "Success"
      };
    } else {
      logger.error(`[${logId}] External sell failed: ${result.error}`);
      return {
        success: false,
        error: result.error || 'External sell failed'
      };
    }
    
  } catch (error: any) {
    logger.error(`[${logId}] External sell error: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}
