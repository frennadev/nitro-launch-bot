import {
  Connection,
  PublicKey,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { connection } from "../common/connection";
import { secretKeyToKeypair } from "../common/utils";
import { logger } from "../common/logger";
import { buyInstruction, marketOrderBuyInstruction } from "./instructions";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { formatMilliseconds, sendAndConfirmTransactionWithRetry } from "../common/utils";
import { collectTransactionFee } from "../../backend/functions-main";
import bs58 from "bs58";
import {
  createSmartPriorityFeeInstruction,
  getTransactionTypePriorityConfig,
  logPriorityFeeInfo,
} from "../common/priority-fees";
import { getBondingCurve, getBondingCurveData, quoteBuy, applySlippage } from "./utils";

export const executeFundingBuy = async (tokenAddress: string, devWallet: string, solAmount: number) => {
  const logId = `buy-dev-${tokenAddress}`;
  console.log(`[${logId}]: Starting dev buy`);
  const start = performance.now();

  try {
    const mintPk = new PublicKey(tokenAddress);
    console.log(`[${logId}]: mintPublicKey = ${mintPk.toBase58()}`);

    const devKeypair = secretKeyToKeypair(devWallet);
    console.log(`[${logId}]: Derived dev keypair`);

    const { bondingCurve } = getBondingCurve(mintPk);
    console.log(`[${logId}]: bondingCurve = ${bondingCurve.toBase58()}`);

    const bondingCurveData = await getBondingCurveData(bondingCurve);
    console.log(`[${logId}]: bondingCurveData fetched`);
    if (!bondingCurveData) {
      throw new Error("Bonding curve data not found");
    }

    const solLamports = BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL));
    console.log(`[${logId}]: solLamports = ${solLamports}`);

    const { tokenOut } = quoteBuy(
      solLamports,
      bondingCurveData.virtualTokenReserves,
      bondingCurveData.virtualSolReserves,
      bondingCurveData.realTokenReserves
    );
    console.log(`[${logId}]: Quoted tokenOut = ${tokenOut.toString()}`);

    const tokensWithSlippage = applySlippage(tokenOut, 10);
    console.log(`[${logId}]: tokensWithSlippage = ${tokensWithSlippage.toString()}`);

    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 151595,
    });
    console.log(`[${logId}]: Compute budget instruction created`);

    const priorityConfig = getTransactionTypePriorityConfig("buy");
    const smartFeeIx = createSmartPriorityFeeInstruction(0, priorityConfig);
    console.log(`[${logId}]: Priority fee instruction created`);
    logPriorityFeeInfo("buy", 0, smartFeeIx.data.readUInt32LE(4), logId);

    const blockhash = await connection.getLatestBlockhash("processed");
    console.log(`[${logId}]: Latest blockhash = ${blockhash.blockhash}`);

    const buyIx = buyInstruction(
      mintPk,
      new PublicKey(bondingCurveData.creator),
      devKeypair.publicKey,
      solLamports,
      tokensWithSlippage
    );
    console.log(`[${logId}]: Buy instruction created`);

    const tx = new VersionedTransaction(
      new TransactionMessage({
        instructions: [modifyComputeUnits, smartFeeIx, buyIx],
        payerKey: devKeypair.publicKey,
        recentBlockhash: blockhash.blockhash,
      }).compileToV0Message()
    );
    tx.sign([devKeypair]);
    console.log(`[${logId}]: Transaction signed`);

    const result = await sendAndConfirmTransactionWithRetry(
      tx,
      {
        payer: devKeypair.publicKey,
        signers: [devKeypair],
        instructions: [modifyComputeUnits, smartFeeIx, buyIx],
      },
      10_000,
      3,
      1000,
      logId,
      { useSmartPriorityFees: true, transactionType: "buy" }
    );
    console.log(`[${logId}]: Transaction result =`, result);

    if (!result.success) {
      throw new Error("Dev buy failed");
    }

    console.log(`[${logId}]: Recording transaction`);
    try {
      const { recordTransactionWithActualAmounts } = await import("../../backend/utils");
      await recordTransactionWithActualAmounts(
        tokenAddress,
        devKeypair.publicKey.toBase58(),
        "dev_buy",
        result.signature || "",
        result.success,
        0,
        {
          amountSol: solAmount,
          amountTokens: tokensWithSlippage.toString(),
          errorMessage: result.success ? undefined : "Transaction failed",
        },
        true
      );
      console.log(`[${logId}]: Transaction recorded`);
    } catch (err: any) {
      console.error(`[${logId}]: Error recording transaction`, err);
    }

    console.log(`[${logId}]: Collecting fee`);
    try {
      const feeResult = await collectTransactionFee(bs58.encode(devKeypair.secretKey), solAmount, "buy");
      console.log(`[${logId}]: Fee collection result =`, feeResult);
    } catch (err: any) {
      console.error(`[${logId}]: Fee collection error`, err);
    }

    console.log(`[${logId}]: Dev buy completed in ${formatMilliseconds(performance.now() - start)}`);
    return result;
  } catch (err: any) {
    console.error(`[${logId}]: Dev buy failed`, err);
    throw err;
  }
};

// New function for buying external PumpFun tokens with funding wallet
export const executeExternalPumpFunBuy = async (tokenAddress: string, fundingWallet: string, solAmount: number) => {
  const logId = `buy-external-pumpfun-${tokenAddress.substring(0, 8)}`;
  console.log(`[${logId}]: Starting external PumpFun buy`);
  const start = performance.now();

  try {
    const mintPk = new PublicKey(tokenAddress);
    console.log(`[${logId}]: mintPublicKey = ${mintPk.toBase58()}`);

    const fundingKeypair = secretKeyToKeypair(fundingWallet);
    console.log(`[${logId}]: Derived funding keypair`);

    const { bondingCurve } = getBondingCurve(mintPk);
    console.log(`[${logId}]: bondingCurve = ${bondingCurve.toBase58()}`);

    // Use robust bonding curve data fetching (same as launch process)
    console.log(`[${logId}]: Fetching bonding curve data with retry strategy...`);
    const curveDataStart = performance.now();
    
    let bondingCurveData = null;
    
    try {
      // Strategy 1: Parallel fetch with different commitment levels (fastest)
      const parallelFetchPromises = [
        // Most likely to succeed quickly
        (async () => {
          try {
            const accountInfo = await connection.getAccountInfo(bondingCurve, "processed");
            if (accountInfo?.data) {
              const data = await getBondingCurveData(bondingCurve);
              if (data) {
                console.log(`[${logId}]: Fast curve data fetch successful with 'processed' commitment`);
                return { data, commitment: "processed" };
              }
            }
          } catch (error) {
            return null;
          }
          return null;
        })(),
        
        // Backup with confirmed
        (async () => {
          await new Promise(resolve => setTimeout(resolve, 500)); // Small delay to prefer processed
          try {
            const accountInfo = await connection.getAccountInfo(bondingCurve, "confirmed");
            if (accountInfo?.data) {
              const data = await getBondingCurveData(bondingCurve);
              if (data) {
                console.log(`[${logId}]: Curve data fetch successful with 'confirmed' commitment`);
                return { data, commitment: "confirmed" };
              }
            }
          } catch (error) {
            return null;
          }
          return null;
        })(),
        
        // Final fallback with finalized
        (async () => {
          await new Promise(resolve => setTimeout(resolve, 1000)); // Delay to prefer faster options
          try {
            const accountInfo = await connection.getAccountInfo(bondingCurve, "finalized");
            if (accountInfo?.data) {
              const data = await getBondingCurveData(bondingCurve);
              if (data) {
                console.log(`[${logId}]: Curve data fetch successful with 'finalized' commitment`);
                return { data, commitment: "finalized" };
              }
            }
          } catch (error) {
            return null;
          }
          return null;
        })()
      ];
      
      // Race to get the first successful result
      const results = await Promise.allSettled(parallelFetchPromises);
      const successfulResult = results.find(result => 
        result.status === 'fulfilled' && result.value !== null
      );
      
      if (successfulResult && successfulResult.status === 'fulfilled' && successfulResult.value) {
        bondingCurveData = successfulResult.value.data;
        const fetchTime = performance.now() - curveDataStart;
        console.log(`[${logId}]: Parallel curve data fetch completed in ${Math.round(fetchTime)}ms using ${successfulResult.value.commitment} commitment`);
      }
      
    } catch (error: any) {
      console.warn(`[${logId}]: Parallel curve data fetch failed: ${error.message}`);
    }
    
    // Fallback to sequential retry logic if parallel fetch failed
    if (!bondingCurveData) {
      console.log(`[${logId}]: Parallel fetch failed, falling back to sequential retry logic...`);
      
      let retries = 0;
      const maxRetries = 5;
      const baseDelay = 1000;
      
      while (!bondingCurveData && retries < maxRetries) {
        try {
          const commitmentLevel = retries < 2 ? "processed" : retries < 4 ? "confirmed" : "finalized";
          
          const accountInfo = await connection.getAccountInfo(bondingCurve, commitmentLevel);
          if (accountInfo && accountInfo.data) {
            bondingCurveData = await getBondingCurveData(bondingCurve);
            if (bondingCurveData) {
              console.log(`[${logId}]: Sequential fallback successful on attempt ${retries + 1} with ${commitmentLevel} commitment`);
              break;
            }
          }
        } catch (error: any) {
          console.warn(`[${logId}]: Sequential fallback attempt ${retries + 1} failed: ${error.message}`);
        }
        
        retries += 1;
        if (!bondingCurveData && retries < maxRetries) {
          const delay = Math.min(baseDelay * Math.pow(1.5, retries), 3000) + Math.random() * 500;
          console.log(`[${logId}]: Retrying in ${Math.round(delay)}ms (attempt ${retries}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    if (!bondingCurveData) {
      console.error(`[${logId}]: Failed to fetch curve data after all attempts`);
      
      // Additional debugging - check if bonding curve account exists
      try {
        const accountInfo = await connection.getAccountInfo(bondingCurve, "finalized");
        if (!accountInfo) {
          throw new Error(`Bonding curve account does not exist: ${bondingCurve.toBase58()}`);
        } else {
          throw new Error(`Bonding curve account exists but data is invalid. Account owner: ${accountInfo.owner.toBase58()}, Data length: ${accountInfo.data.length}`);
        }
      } catch (debugError: any) {
        console.error(`[${logId}]: Bonding curve debug info: ${debugError.message}`);
        throw new Error(`Unable to fetch curve data: ${debugError.message}`);
      }
    }

    console.log(`[${logId}]: bondingCurveData fetched successfully`);

    const solLamports = BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL));
    console.log(`[${logId}]: solLamports = ${solLamports}`);

    const { tokenOut } = quoteBuy(
      solLamports,
      bondingCurveData.virtualTokenReserves,
      bondingCurveData.virtualSolReserves,
      bondingCurveData.realTokenReserves
    );
    console.log(`[${logId}]: Quoted tokenOut = ${tokenOut.toString()}`);

    // Use higher slippage for external tokens to account for market volatility
    const tokensWithSlippage = applySlippage(tokenOut, 25);
    console.log(`[${logId}]: tokensWithSlippage = ${tokensWithSlippage.toString()}`);

    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 151595,
    });
    console.log(`[${logId}]: Compute budget instruction created`);

    const priorityConfig = getTransactionTypePriorityConfig("buy");
    const smartFeeIx = createSmartPriorityFeeInstruction(0, priorityConfig);
    console.log(`[${logId}]: Priority fee instruction created`);
    logPriorityFeeInfo("buy", 0, smartFeeIx.data.readUInt32LE(4), logId);

    const blockhash = await connection.getLatestBlockhash("processed");
    console.log(`[${logId}]: Latest blockhash = ${blockhash.blockhash}`);

    // Create ATA instruction for external token (same as launch process)
    const buyerAta = getAssociatedTokenAddressSync(mintPk, fundingKeypair.publicKey);
    const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      fundingKeypair.publicKey,
      buyerAta,
      fundingKeypair.publicKey,
      mintPk
    );
    console.log(`[${logId}]: ATA instruction created`);

    // Use standard buy instruction for external tokens
    const buyIx = buyInstruction(
      mintPk,
      new PublicKey(bondingCurveData.creator),
      fundingKeypair.publicKey,
      tokensWithSlippage,
      solLamports
    );
    console.log(`[${logId}]: Buy instruction created`);

    const tx = new VersionedTransaction(
      new TransactionMessage({
        instructions: [modifyComputeUnits, smartFeeIx, createAtaIx, buyIx],
        payerKey: fundingKeypair.publicKey,
        recentBlockhash: blockhash.blockhash,
      }).compileToV0Message()
    );
    tx.sign([fundingKeypair]);
    console.log(`[${logId}]: Transaction signed`);

    const result = await sendAndConfirmTransactionWithRetry(
      tx,
      {
        payer: fundingKeypair.publicKey,
        signers: [fundingKeypair],
        instructions: [modifyComputeUnits, smartFeeIx, createAtaIx, buyIx],
      },
      10_000,
      3,
      1000,
      logId,
      { useSmartPriorityFees: true, transactionType: "buy" }
    );
    console.log(`[${logId}]: Transaction result =`, result);

    if (!result.success) {
      throw new Error("External PumpFun buy failed");
    }

    console.log(`[${logId}]: Recording transaction`);
    try {
      const { recordTransactionWithActualAmounts } = await import("../../backend/utils");
      await recordTransactionWithActualAmounts(
        tokenAddress,
        fundingKeypair.publicKey.toBase58(),
        "snipe_buy", // Use snipe_buy type for external purchases
        result.signature || "",
        result.success,
        0,
        {
          amountSol: solAmount,
          amountTokens: tokensWithSlippage.toString(),
          errorMessage: result.success ? undefined : "Transaction failed",
        },
        true
      );
      console.log(`[${logId}]: Transaction recorded`);
    } catch (err: any) {
      console.error(`[${logId}]: Error recording transaction`, err);
    }

    console.log(`[${logId}]: Collecting fee`);
    try {
      const feeResult = await collectTransactionFee(bs58.encode(fundingKeypair.secretKey), solAmount, "buy");
      console.log(`[${logId}]: Fee collection result =`, feeResult);
    } catch (err: any) {
      console.error(`[${logId}]: Fee collection error`, err);
    }

    console.log(`[${logId}]: External PumpFun buy completed in ${formatMilliseconds(performance.now() - start)}`);
    return result;
  } catch (err: any) {
    console.error(`[${logId}]: External PumpFun buy failed`, err);
    throw err;
  }
};
