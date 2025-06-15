import { Connection, PublicKey, Keypair, VersionedTransaction, TransactionMessage, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { connection } from "../common/connection";
import { secretKeyToKeypair } from "../common/utils";
import { decryptPrivateKey } from "../../backend/utils";
import { logger } from "../common/logger";
import { sellInstruction } from "./instructions";
import { getGlobalSetting, getBondingCurve, getBondingCurveData, applySlippage } from "./utils";

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
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const slippage = baseSlippage + (attempt - 1) * 50; // Increase slippage by 50% each retry
          
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
            setup.wallet.publicKey, // Use wallet as token creator for external tokens
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