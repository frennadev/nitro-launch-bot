import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  formatMilliseconds,
  secretKeyToKeypair,
  sendAndConfirmTransactionWithRetry,
} from "../common/utils";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { logger } from "../common/logger";
import { sellInstruction } from "./instructions";
import { connection } from "../common/connection";
import { collectTransactionFee } from "../../backend/functions-main";
import bs58 from "bs58";

export const executeDevSell = async (
  tokenAddress: string,
  devWallet: string,
  sellPercent: number,
) => {
  if (sellPercent < 1 || sellPercent > 100) {
    throw new Error("Sell % cannot be less than 1 or greater than 100");
  }
  const logIdentifier = `sell-dev-${tokenAddress}`;
  logger.info("Starting dev sell");
  const start = performance.now();

  const mintPublicKey = new PublicKey(tokenAddress);
  const devKeypair = secretKeyToKeypair(devWallet);
  const ata = getAssociatedTokenAddressSync(
    mintPublicKey,
    devKeypair.publicKey,
  );
  const devBalance = BigInt(
    (await connection.getTokenAccountBalance(ata)).value.amount,
  );
  const tokensToSell =
    sellPercent === 100
      ? devBalance
      : (BigInt(sellPercent) * BigInt(100) * devBalance) / BigInt(10_000);
  const sellIx = sellInstruction(
    mintPublicKey,
    devKeypair.publicKey,
    devKeypair.publicKey,
    tokensToSell,
    BigInt(0),
  );
  const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
    units: 151595,
  });
  const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 1_000_000,
  });
  const blockHash = await connection.getLatestBlockhash("processed");
  const sellTx = new VersionedTransaction(
    new TransactionMessage({
      instructions: [modifyComputeUnits, addPriorityFee, sellIx],
      payerKey: devKeypair.publicKey,
      recentBlockhash: blockHash.blockhash,
    }).compileToV0Message(),
  );
  sellTx.sign([devKeypair]);
  const result = await sendAndConfirmTransactionWithRetry(
    sellTx,
    {
      payer: devKeypair.publicKey,
      signers: [devKeypair],
      instructions: [modifyComputeUnits, addPriorityFee, sellIx],
    },
    10_000,
    3,
    1000,
    logIdentifier,
  );
  logger.info(`[${logIdentifier}]: Dev Sell result`, result);
  if (!result.success) {
    throw new Error("Dev sell failed");
  }

  // ------- COLLECT TRANSACTION FEE FROM DEV SELL -------
  logger.info(`[${logIdentifier}]: Collecting transaction fee from dev sell`);
  try {
    // Calculate the SOL amount received from the sell (approximate)
    // For now, we'll use a conservative estimate based on token balance sold
    const devBalance = await connection.getBalance(devKeypair.publicKey);
    const devBalanceInSol = devBalance / 1000000000; // Convert lamports to SOL
    
    // Estimate transaction amount (this is approximate - in a real implementation you'd track the exact SOL received)
    const estimatedSolReceived = Math.min(devBalanceInSol * 0.1, 1.0); // Conservative estimate
    
    if (estimatedSolReceived > 0.001) { // Only collect if meaningful amount
      const feeResult = await collectTransactionFee(devWallet, estimatedSolReceived, "sell");
      
      if (feeResult.success) {
        logger.info(`[${logIdentifier}]: Dev sell transaction fee collected: ${feeResult.feeAmount} SOL`);
      } else {
        logger.warn(`[${logIdentifier}]: Dev sell transaction fee collection failed: ${feeResult.error}`);
      }
    } else {
      logger.info(`[${logIdentifier}]: Dev sell transaction amount too small for fee collection`);
    }
  } catch (error: any) {
    logger.error(`[${logIdentifier}]: Error collecting dev sell transaction fee:`, error);
    // Don't throw error here - transaction fees are secondary to main sell success
  }

  logger.info(
    `[${logIdentifier}]: Dev Sell completed in ${formatMilliseconds(performance.now() - start)}`,
  );
  return result;
};

export const executeWalletSell = async (
  tokenAddress: string,
  buyWallets: string[],
  devWallet: string,
  sellPercent: number,
) => {
  if (sellPercent < 1 || sellPercent > 100) {
    throw new Error("Sell % cannot be less than 1 or greater than 100");
  }
  const logIdentifier = `sell-${tokenAddress}`;
  logger.info("Starting wallets sell");
  const start = performance.now();

  const mintPublicKey = new PublicKey(tokenAddress);
  const buyKeypairs = buyWallets.map((w) => secretKeyToKeypair(w));
  const devKeypair = secretKeyToKeypair(devWallet);

  const walletBalances = (
    await Promise.all(
      buyKeypairs.map(async (kp) => {
        const ata = getAssociatedTokenAddressSync(mintPublicKey, kp.publicKey);
        let balance = 0;
        try {
          balance = Number(
            (await connection.getTokenAccountBalance(ata)).value.amount,
          );
        } catch (error) {
          logger.error(
            `[${logIdentifier}] Error fetching token balance for: ${kp.publicKey.toBase58()} with ATA: ${ata.toBase58()}`,
          );
        }
        return {
          wallet: kp,
          ata,
          balance,
        };
      }),
    )
  ).filter(({ balance }) => BigInt(balance) > BigInt(0));
  if (walletBalances.length == 0) {
    throw new Error("No wallet has tokens");
  }
  walletBalances.sort((a, b) => a.balance - b.balance);

  const totalTokens = walletBalances.reduce(
    (acc, { balance }) => acc + BigInt(balance),
    BigInt(0),
  );
  let tokensToSell =
    sellPercent === 100
      ? totalTokens
      : (BigInt(sellPercent) * BigInt(100) * totalTokens) / BigInt(10_000);

  const sellSetups: { wallet: Keypair; ata: PublicKey; amount: bigint }[] = [];
  for (const walletInfo of walletBalances) {
    if (tokensToSell <= BigInt(0)) {
      break;
    }
    if (tokensToSell <= BigInt(walletInfo.balance)) {
      sellSetups.push({
        wallet: walletInfo.wallet,
        ata: walletInfo.ata,
        amount: tokensToSell,
      });
      break;
    }
    tokensToSell -= BigInt(walletInfo.balance);
    sellSetups.push({
      wallet: walletInfo.wallet,
      ata: walletInfo.ata,
      amount: BigInt(walletInfo.balance),
    });
  }
  const blockHash = await connection.getLatestBlockhash("processed");
  const tasks = sellSetups.map(async ({ wallet, amount }) => {
    const sellIx = sellInstruction(
      mintPublicKey,
      devKeypair.publicKey,
      wallet.publicKey,
      amount,
      BigInt(0),
    );
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 151595,
    });
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 1_000_000,
    });
    const sellTx = new VersionedTransaction(
      new TransactionMessage({
        instructions: [modifyComputeUnits, addPriorityFee, sellIx],
        payerKey: wallet.publicKey,
        recentBlockhash: blockHash.blockhash,
      }).compileToV0Message(),
    );
    sellTx.sign([wallet]);
    return await sendAndConfirmTransactionWithRetry(
      sellTx,
      {
        payer: devKeypair.publicKey,
        signers: [devKeypair],
        instructions: [modifyComputeUnits, addPriorityFee, sellIx],
      },
      10_000,
      3,
      1000,
      logIdentifier,
    );
  });
  const results = await Promise.all(tasks);
  logger.info(`[${logIdentifier}]: Wallet Sell results`, results);
  const success = results.filter((res) => res.success);
  if (success.length == 0) {
    throw new Error("Wallet sells failed");
  }

  // ------- COLLECT TRANSACTION FEES FROM WALLET SELLS -------
  logger.info(`[${logIdentifier}]: Collecting transaction fees from wallet sells`);
  try {
    const feeCollectionPromises = [];
    
    for (let i = 0; i < sellSetups.length; i++) {
      if (results[i] && results[i].success) {
        const walletPrivateKey = bs58.encode(sellSetups[i].wallet.secretKey);
        const walletBalance = await connection.getBalance(sellSetups[i].wallet.publicKey);
        const walletBalanceInSol = walletBalance / 1000000000; // Convert lamports to SOL
        
        // Estimate transaction amount (conservative estimate based on wallet balance)
        const estimatedSolReceived = Math.min(walletBalanceInSol * 0.1, 0.5); // Conservative estimate
        
        if (estimatedSolReceived > 0.001) { // Only collect if meaningful amount
          feeCollectionPromises.push(
            collectTransactionFee(walletPrivateKey, estimatedSolReceived, "sell")
          );
        }
      }
    }

    if (feeCollectionPromises.length > 0) {
      const feeResults = await Promise.all(feeCollectionPromises);
      const successfulFees = feeResults.filter((result: any) => result.success);
      const failedFees = feeResults.filter((result: any) => !result.success);
      
      const totalFeesCollected = successfulFees.reduce((sum: number, result: any) => {
        return sum + (result.feeAmount || 0);
      }, 0);
      
      logger.info(`[${logIdentifier}]: Wallet sell transaction fee collection results`, {
        successful: successfulFees.length,
        failed: failedFees.length,
        totalFeesCollected
      });

      if (failedFees.length > 0) {
        logger.warn(`[${logIdentifier}]: Some wallet sell transaction fees failed to collect`, failedFees);
      }
    } else {
      logger.info(`[${logIdentifier}]: No wallet sell transaction fees to collect`);
    }
  } catch (error: any) {
    logger.error(`[${logIdentifier}]: Error collecting wallet sell transaction fees:`, error);
    // Don't throw error here - transaction fees are secondary to main sell success
  }

  logger.info(
    `[${logIdentifier}]: Wallet Sells completed in ${formatMilliseconds(performance.now() - start)}`,
  );
};
