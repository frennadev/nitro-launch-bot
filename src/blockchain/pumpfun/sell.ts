import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { formatMilliseconds, secretKeyToKeypair, sendAndConfirmTransactionWithRetry } from "../common/utils";
import { ComputeBudgetProgram, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { logger } from "../common/logger";
import { sellInstruction } from "./instructions";
import { connection } from "../common/connection";
import { executeExternalSell } from "./externalSell";
import { Context } from "grammy";
import { decryptKeypairBot } from "../../backend/utils";

/**
 * Enhanced dev sell using external sell mechanism with platform detection
 */
export const executeDevSell = async (tokenAddress: string, devWallet: string, sellPercent: number) => {
  if (sellPercent < 1 || sellPercent > 100) {
    throw new Error("Sell % cannot be less than 1 or greater than 100");
  }
  
  // Validate devWallet parameter
  if (!devWallet || typeof devWallet !== 'string') {
    throw new Error("devWallet must be a non-empty string");
  }
  
  const logIdentifier = `sell-dev-${tokenAddress}`;
  logger.info(`[${logIdentifier}] Starting enhanced dev sell using external sell mechanism`);
  const start = performance.now();

  try {
    const mintPublicKey = new PublicKey(tokenAddress);
    // Use bot decryption method (handles encrypted wallet keys)
    const devKeypair = decryptKeypairBot(devWallet);
    
    // Get the current token balance to calculate amount to sell
    const ata = getAssociatedTokenAddressSync(mintPublicKey, devKeypair.publicKey);
    const devBalance = BigInt((await connection.getTokenAccountBalance(ata)).value.amount);
    
    // Calculate tokens to sell based on percentage
    const tokensToSell = sellPercent === 100 ? devBalance : (BigInt(sellPercent) * BigInt(100) * devBalance) / BigInt(10_000);
    
    logger.info(`[${logIdentifier}] Dev balance: ${devBalance.toString()}, selling ${sellPercent}% = ${tokensToSell.toString()} tokens`);
    
    // Use external sell mechanism for better platform detection and robustness
    const result = await executeExternalSell(tokenAddress, devKeypair, Number(tokensToSell), {} as Context);
    
    if (!result.success) {
      throw new Error(`External sell failed: ${result.error}`);
    }
    
    // Record the transaction with actual amounts from blockchain
    try {
      const { recordTransactionWithActualAmounts } = await import("../../backend/utils");
      await recordTransactionWithActualAmounts(
        tokenAddress,
        devKeypair.publicKey.toBase58(),
        "dev_sell",
        result.signature || "",
        result.success,
        0, // Sells don't have launch attempts
        {
          sellPercent: sellPercent,
          amountSol: 0, // Will be parsed from blockchain
          amountTokens: tokensToSell.toString(), // Estimated amount
          errorMessage: result.success ? undefined : "Sell failed",
        },
        true // Enable actual amount parsing
      );
      logger.info(`[${logIdentifier}] Dev sell transaction recorded`);
    } catch (err: any) {
      logger.error(`[${logIdentifier}] Error recording dev sell transaction`, err);
    }
    
    logger.info(`[${logIdentifier}] Enhanced dev sell completed in ${formatMilliseconds(performance.now() - start)} via ${result.platform}`);
    
    return {
      success: true,
      signature: result.signature,
      platform: result.platform,
      solReceived: result.solReceived,
      expectedSolOut: 0 // External sell doesn't provide this info
    };
    
  } catch (error: any) {
    logger.error(`[${logIdentifier}] Enhanced dev sell failed:`, error);
    throw error;
  }
};

/**
 * Enhanced wallet sell using external sell mechanism with platform detection
 * Processes multiple wallets with improved reliability
 */
export const executeWalletSell = async (
  tokenAddress: string,
  buyWallets: string[],
  devWallet: string,
  sellPercent: number
) => {
  if (sellPercent < 1 || sellPercent > 100) {
    throw new Error("Sell % cannot be less than 1 or greater than 100");
  }
  
  // Validate buyWallets parameter
  if (!Array.isArray(buyWallets)) {
    throw new Error("buyWallets must be an array");
  }
  
  if (buyWallets.length === 0) {
    throw new Error("buyWallets cannot be empty");
  }
  
  // Validate devWallet parameter
  if (!devWallet || typeof devWallet !== 'string') {
    throw new Error("devWallet must be a non-empty string");
  }
  
  const logIdentifier = `sell-${tokenAddress}`;
  logger.info(`[${logIdentifier}] Starting enhanced wallet sell using external sell mechanism for ${buyWallets.length} wallets`);
  const start = performance.now();

  try {
    const mintPublicKey = new PublicKey(tokenAddress);
    
    // Use bot decryption method (handles encrypted wallet keys)
    const buyKeypairs = buyWallets.map((w, index) => {
      try {
        return decryptKeypairBot(w);
      } catch (error) {
        logger.error(`[${logIdentifier}] Failed to decrypt wallet ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    });

    // Get wallet balances efficiently
    const walletBalances = (
      await Promise.all(
        buyKeypairs.map(async (kp) => {
          const ata = getAssociatedTokenAddressSync(mintPublicKey, kp.publicKey);
          let balance = 0;
          try {
            balance = Number((await connection.getTokenAccountBalance(ata)).value.amount);
          } catch (error) {
            logger.error(
              `[${logIdentifier}] Error fetching token balance for: ${kp.publicKey.toBase58()} with ATA: ${ata.toBase58()}`
            );
          }
          return {
            wallet: kp,
            ata,
            balance: BigInt(balance),
          };
        })
      )
    ).filter(({ balance }) => balance > BigInt(0));

    if (walletBalances.length === 0) {
      throw new Error("No wallet has tokens");
    }

    logger.info(`[${logIdentifier}] Found ${walletBalances.length} wallets with tokens`);

    // Sort by balance (ascending) for optimal distribution
    walletBalances.sort((a, b) => Number(a.balance - b.balance));

    const totalTokens = walletBalances.reduce((acc, { balance }) => acc + balance, BigInt(0));
    let tokensToSell = sellPercent === 100 ? totalTokens : (BigInt(sellPercent) * BigInt(100) * totalTokens) / BigInt(10_000);

    logger.info(`[${logIdentifier}] Total tokens: ${totalTokens.toString()}, selling ${sellPercent}% = ${tokensToSell.toString()}`);

    // Calculate sell amounts per wallet
    const sellSetups: { wallet: Keypair; amount: bigint }[] = [];
    for (const walletInfo of walletBalances) {
      if (tokensToSell <= BigInt(0)) {
        break;
      }
      if (tokensToSell <= walletInfo.balance) {
        sellSetups.push({
          wallet: walletInfo.wallet,
          amount: tokensToSell,
        });
        break;
      }
      tokensToSell -= walletInfo.balance;
      sellSetups.push({
        wallet: walletInfo.wallet,
        amount: walletInfo.balance,
      });
    }

    logger.info(`[${logIdentifier}] Prepared ${sellSetups.length} sell transactions using external sell mechanism`);

    // Execute sells using external sell mechanism (with platform detection and retries)
    const tasks = sellSetups.map(async ({ wallet, amount }, index) => {
      try {
        logger.info(`[${logIdentifier}] Processing wallet ${index + 1}/${sellSetups.length}: ${wallet.publicKey.toBase58().slice(0, 8)}...`);
        
        const result = await executeExternalSell(tokenAddress, wallet, Number(amount), {} as Context);
        
        if (result.success) {
          logger.info(`[${logIdentifier}] Wallet ${index + 1} sell successful via ${result.platform}: ${result.signature}`);
          
          // Record the transaction with actual amounts from blockchain
          try {
            const { recordTransactionWithActualAmounts } = await import("../../backend/utils");
            await recordTransactionWithActualAmounts(
              tokenAddress,
              wallet.publicKey.toBase58(),
              "wallet_sell",
              result.signature || "",
              result.success,
              0, // Sells don't have launch attempts
              {
                sellPercent: sellPercent,
                amountSol: 0, // Will be parsed from blockchain
                amountTokens: amount.toString(), // Estimated amount
                errorMessage: result.success ? undefined : "Sell failed",
              },
              true // Enable actual amount parsing
            );
            logger.info(`[${logIdentifier}] Wallet ${index + 1} sell transaction recorded`);
          } catch (err: any) {
            logger.error(`[${logIdentifier}] Error recording wallet ${index + 1} sell transaction`, err);
          }
          
          return {
            success: true,
            signature: result.signature,
            platform: result.platform,
            solReceived: result.solReceived,
            expectedSolOut: 0, // External sell doesn't provide this info
            walletAddress: wallet.publicKey.toBase58()
          };
        } else {
          logger.error(`[${logIdentifier}] Wallet ${index + 1} sell failed: ${result.error}`);
          return {
            success: false,
            error: result.error,
            walletAddress: wallet.publicKey.toBase58()
          };
        }
      } catch (error: any) {
        logger.error(`[${logIdentifier}] Wallet ${index + 1} sell exception:`, error);
        return {
          success: false,
          error: error.message,
          walletAddress: wallet.publicKey.toBase58()
        };
      }
    });

    const results = await Promise.all(tasks);
    
    const successfulSells = results.filter((res) => res.success);
    const failedSells = results.filter((res) => !res.success);
    
    logger.info(`[${logIdentifier}] Enhanced wallet sell completed in ${formatMilliseconds(performance.now() - start)}`);
    logger.info(`[${logIdentifier}] Results: ${successfulSells.length} successful, ${failedSells.length} failed`);
    
    if (successfulSells.length === 0) {
      throw new Error("All wallet sells failed");
    }
    
    return results;

  } catch (error: any) {
    logger.error(`[${logIdentifier}] Enhanced wallet sell failed:`, error);
    throw error;
  }
};
