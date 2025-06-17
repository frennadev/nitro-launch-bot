import { Connection, PublicKey, Keypair, VersionedTransaction, TransactionMessage, ComputeBudgetProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { connection } from "../common/connection";
import { secretKeyToKeypair } from "../common/utils";
import { decryptPrivateKey } from "../../backend/utils";
import { logger } from "../common/logger";
import { sellInstruction } from "./instructions";
import { formatMilliseconds, sendAndConfirmTransactionWithRetry } from "../common/utils";
import { collectTransactionFee } from "../../backend/functions-main";
import bs58 from "bs58";
import { 
  createSmartPriorityFeeInstruction, 
  getTransactionTypePriorityConfig, 
  logPriorityFeeInfo 
} from "../common/priority-fees";
import { getBondingCurve, getBondingCurveData, quoteSell, applySlippage } from "./utils";

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
  const devKeypair = secretKeyToKeypair(decryptPrivateKey(devWallet));
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

  // Get bonding curve data to calculate actual SOL output
  const { bondingCurve } = getBondingCurve(mintPublicKey);
  const bondingCurveData = await getBondingCurveData(bondingCurve);
  
  if (!bondingCurveData) {
    throw new Error("Token bonding curve not found - token may not be a PumpFun token");
  }

  // Calculate actual SOL output using quoteSell
  const { solOut } = quoteSell(
    tokensToSell,
    bondingCurveData.virtualTokenReserves,
    bondingCurveData.virtualSolReserves,
    bondingCurveData.realTokenReserves,
  );

  const solOutWithSlippage = applySlippage(solOut, 10); // 10% slippage
  const actualSolReceived = Number(solOut) / LAMPORTS_PER_SOL;

  const sellIx = sellInstruction(
    mintPublicKey,
    devKeypair.publicKey,
    devKeypair.publicKey,
    tokensToSell,
    solOutWithSlippage,
  );
  const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
    units: 151595,
  });
  
  // Use smart priority fees for sell transactions
  const priorityConfig = getTransactionTypePriorityConfig("sell");
  const smartPriorityFeeIx = createSmartPriorityFeeInstruction(0, priorityConfig);
  const priorityFee = smartPriorityFeeIx.data.readUInt32LE(4);
  
  logPriorityFeeInfo("sell", 0, priorityFee, logIdentifier);
  
  const blockHash = await connection.getLatestBlockhash("processed");
  const sellTx = new VersionedTransaction(
    new TransactionMessage({
      instructions: [modifyComputeUnits, smartPriorityFeeIx, sellIx],
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
      instructions: [modifyComputeUnits, smartPriorityFeeIx, sellIx],
    },
    10_000,
    3,
    1000,
    logIdentifier,
    {
      useSmartPriorityFees: true,
      transactionType: "sell",
    }
  );
  
  logger.info(`[${logIdentifier}]: Dev Sell result`, result);
  
  // Record the sell transaction in database
  try {
    const { recordSellTransaction } = await import("../../backend/functions-main");
    await recordSellTransaction(
      tokenAddress,
      devKeypair.publicKey.toBase58(),
      "dev_sell",
      result.signature || "",
      result.success,
      1, // sellAttempt
      {
        solReceived: result.success ? actualSolReceived : 0,
        tokensSold: tokensToSell.toString(),
        sellPercent: sellPercent,
        errorMessage: result.success ? undefined : "Transaction failed",
      }
    );
    logger.info(`[${logIdentifier}]: Dev sell transaction recorded in database`);
  } catch (error: any) {
    logger.error(`[${logIdentifier}]: Error recording dev sell transaction:`, error);
  }
  
  if (!result.success) {
    throw new Error("Dev sell failed");
  }

  // ------- COLLECT TRANSACTION FEE FROM DEV SELL -------
  logger.info(`[${logIdentifier}]: Collecting transaction fee from dev sell`);
  try {
    if (actualSolReceived > 0.001) { // Only collect if meaningful amount
      const feeResult = await collectTransactionFee(decryptPrivateKey(devWallet), actualSolReceived, "sell");
      
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
  devWallet: string,
  buyerWallets: string[],
  sellPercent: number,
) => {
  if (sellPercent < 1 || sellPercent > 100) {
    throw new Error("Sell % cannot be less than 1 or greater than 100");
  }
  const logIdentifier = `sell-wallets-${tokenAddress}`;
  logger.info("Starting wallet sell");
  const start = performance.now();

  const mintPublicKey = new PublicKey(tokenAddress);
  const devKeypair = secretKeyToKeypair(decryptPrivateKey(devWallet));
  const buyerKeypairs = buyerWallets.map((w) =>
    secretKeyToKeypair(decryptPrivateKey(w)),
  );

  // Get bonding curve data for SOL calculations
  const { bondingCurve } = getBondingCurve(mintPublicKey);
  const bondingCurveData = await getBondingCurveData(bondingCurve);
  
  if (!bondingCurveData) {
    throw new Error("Token bonding curve not found - token may not be a PumpFun token");
  }

  const walletBalances = [];
  for (const wallet of buyerKeypairs) {
    try {
      const ata = getAssociatedTokenAddressSync(mintPublicKey, wallet.publicKey);
      
      // Check if the token account exists first
      const accountInfo = await connection.getAccountInfo(ata);
      if (!accountInfo) {
        logger.info(`[${logIdentifier}]: Wallet ${wallet.publicKey.toBase58().slice(0, 8)} has no token account for this token, skipping`);
        continue;
      }
      
      const balance = (await connection.getTokenAccountBalance(ata)).value.amount;
      if (BigInt(balance) > 0) {
        walletBalances.push({
          wallet,
          ata,
          balance,
        });
      } else {
        logger.info(`[${logIdentifier}]: Wallet ${wallet.publicKey.toBase58().slice(0, 8)} has zero token balance, skipping`);
      }
    } catch (error: any) {
      logger.warn(`[${logIdentifier}]: Error checking balance for wallet ${wallet.publicKey.toBase58().slice(0, 8)}:`, error);
      continue;
    }
  }
  const totalBalance = walletBalances.reduce(
    (sum, { balance }) => sum + BigInt(balance),
    BigInt(0),
  );
  
  if (walletBalances.length === 0 || totalBalance === BigInt(0)) {
    throw new Error("No tokens found in any buyer wallets for this token");
  }
  
  let tokensToSell =
    sellPercent === 100
      ? totalBalance
      : (BigInt(sellPercent) * BigInt(100) * totalBalance) / BigInt(10_000);
  const sellSetups: {
    wallet: Keypair;
    ata: PublicKey;
    amount: bigint;
    expectedSolOut: number;
  }[] = [];

  // Track remaining reserves for accurate calculations
  let currentVirtualTokenReserves = bondingCurveData.virtualTokenReserves;
  let currentVirtualSolReserves = bondingCurveData.virtualSolReserves;
  let currentRealTokenReserves = bondingCurveData.realTokenReserves;

  for (const walletInfo of walletBalances) {
    if (tokensToSell <= BigInt(0)) {
      break;
    }
    const sellAmount = tokensToSell <= BigInt(walletInfo.balance) 
      ? tokensToSell 
      : BigInt(walletInfo.balance);

    // Calculate expected SOL output for this sell
    const { solOut, newVirtualTokenReserves, newVirtualSolReserves, newRealTokenReserves } = quoteSell(
      sellAmount,
      currentVirtualTokenReserves,
      currentVirtualSolReserves,
      currentRealTokenReserves,
    );

    // Update reserves for next calculation
    currentVirtualTokenReserves = newVirtualTokenReserves;
    currentVirtualSolReserves = newVirtualSolReserves;
    currentRealTokenReserves = newRealTokenReserves;

    sellSetups.push({
      wallet: walletInfo.wallet,
      ata: walletInfo.ata,
      amount: sellAmount,
      expectedSolOut: Number(solOut) / LAMPORTS_PER_SOL,
    });

    tokensToSell -= sellAmount;
    if (tokensToSell <= BigInt(0)) {
      break;
    }
  }

  const blockHash = await connection.getLatestBlockhash("processed");
  const tasks = sellSetups.map(async ({ wallet, amount, expectedSolOut }) => {
    const solOutWithSlippage = applySlippage(BigInt(expectedSolOut * LAMPORTS_PER_SOL), 10);
    
    const sellIx = sellInstruction(
      mintPublicKey,
      devKeypair.publicKey,
      wallet.publicKey,
      amount,
      solOutWithSlippage,
    );
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 151595,
    });
    
    // Use smart priority fees for wallet sell transactions
    const priorityConfig = getTransactionTypePriorityConfig("sell");
    const smartPriorityFeeIx = createSmartPriorityFeeInstruction(0, priorityConfig);
    const priorityFee = smartPriorityFeeIx.data.readUInt32LE(4);
    
    logPriorityFeeInfo("sell", 0, priorityFee, `${logIdentifier}-${wallet.publicKey.toBase58().slice(0, 8)}`);
    
    const sellTx = new VersionedTransaction(
      new TransactionMessage({
        instructions: [modifyComputeUnits, smartPriorityFeeIx, sellIx],
        payerKey: wallet.publicKey,
        recentBlockhash: blockHash.blockhash,
      }).compileToV0Message(),
    );
    sellTx.sign([wallet]);
    
    const result = await sendAndConfirmTransactionWithRetry(
      sellTx,
      {
        payer: wallet.publicKey,
        signers: [wallet],
        instructions: [modifyComputeUnits, smartPriorityFeeIx, sellIx],
      },
      10_000,
      3,
      1000,
      `${logIdentifier}-${wallet.publicKey.toBase58().slice(0, 8)}`,
      {
        useSmartPriorityFees: true,
        transactionType: "sell",
      }
    );

    // Record the sell transaction in database
    try {
      const { recordSellTransaction } = await import("../../backend/functions-main");
      await recordSellTransaction(
        tokenAddress,
        wallet.publicKey.toBase58(),
        "wallet_sell",
        result.signature || "",
        result.success,
        1, // sellAttempt
        {
          solReceived: result.success ? expectedSolOut : 0,
          tokensSold: amount.toString(),
          sellPercent: sellPercent,
          errorMessage: result.success ? undefined : "Transaction failed",
        }
      );
      logger.info(`[${logIdentifier}]: Wallet sell transaction recorded for ${wallet.publicKey.toBase58().slice(0, 8)}`);
    } catch (error: any) {
      logger.error(`[${logIdentifier}]: Error recording wallet sell transaction for ${wallet.publicKey.toBase58().slice(0, 8)}:`, error);
    }

    return { ...result, expectedSolOut, walletAddress: wallet.publicKey.toBase58() };
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
        const actualSolReceived = results[i].expectedSolOut;
        
        if (actualSolReceived > 0.001) { // Only collect if meaningful amount
          feeCollectionPromises.push(
            collectTransactionFee(walletPrivateKey, actualSolReceived, "sell")
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
    `[${logIdentifier}]: Wallet Sell completed in ${formatMilliseconds(performance.now() - start)}`,
  );
  return results;
};
