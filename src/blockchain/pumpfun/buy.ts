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

    // CRITICAL: Check wallet balance and reserve SOL for future sell transactions
    const walletBalance = await connection.getBalance(devKeypair.publicKey, "confirmed");
    const walletBalanceSOL = walletBalance / LAMPORTS_PER_SOL;
    
    // Reserve fees for buy transaction AND future sell transactions
    const transactionFeeReserve = 0.01; // Priority fees + base fees for current buy
    const sellFeeReserve = 0.01; // Reserve 0.01 SOL for future sell transaction fees
    const buyFeePercent = 0.01; // 1% buy fee
    const estimatedBuyFee = solAmount * buyFeePercent;
    const totalFeeReserve = transactionFeeReserve + sellFeeReserve + estimatedBuyFee;
    const availableForTrade = walletBalanceSOL - totalFeeReserve;
    
    console.log(`[${logId}]: Wallet balance: ${walletBalanceSOL.toFixed(6)} SOL`);
    console.log(`[${logId}]: Transaction fee reserve: ${transactionFeeReserve.toFixed(6)} SOL`);
    console.log(`[${logId}]: Sell fee reserve: ${sellFeeReserve.toFixed(6)} SOL (for future sells)`);
    console.log(`[${logId}]: Estimated 1% buy fee: ${estimatedBuyFee.toFixed(6)} SOL`);
    console.log(`[${logId}]: Total fee reserve: ${totalFeeReserve.toFixed(6)} SOL`);
    console.log(`[${logId}]: Available for trade: ${availableForTrade.toFixed(6)} SOL`);
    
    // Validate we have enough balance
    if (availableForTrade <= 0) {
      throw new Error(`Insufficient balance: ${walletBalanceSOL.toFixed(6)} SOL available, need at least ${totalFeeReserve.toFixed(6)} SOL for fees (${transactionFeeReserve.toFixed(6)} SOL tx fees + ${sellFeeReserve.toFixed(6)} SOL sell reserve + ${estimatedBuyFee.toFixed(6)} SOL buy fee)`);
    }
    
    // Use the minimum of requested amount or available balance
    const actualTradeAmount = Math.min(solAmount, availableForTrade);
    
    if (actualTradeAmount < solAmount) {
      console.warn(`[${logId}]: Adjusted trade amount from ${solAmount} SOL to ${actualTradeAmount.toFixed(6)} SOL due to fee reservations (keeping ${sellFeeReserve} SOL for future sells)`);
    }

    const { bondingCurve } = getBondingCurve(mintPk);
    console.log(`[${logId}]: bondingCurve = ${bondingCurve.toBase58()}`);

    const bondingCurveData = await getBondingCurveData(bondingCurve);
    console.log(`[${logId}]: bondingCurveData fetched`);
    if (!bondingCurveData) {
      throw new Error("Bonding curve data not found");
    }

    const solLamports = BigInt(Math.ceil(actualTradeAmount * LAMPORTS_PER_SOL));
    console.log(`[${logId}]: solLamports = ${solLamports} (adjusted from ${solAmount} SOL)`);

    const { tokenOut } = quoteBuy(
      solLamports,
      bondingCurveData.virtualTokenReserves,
      bondingCurveData.virtualSolReserves,
      bondingCurveData.realTokenReserves
    );
    console.log(`[${logId}]: Quoted tokenOut = ${tokenOut.toString()}`);

    const tokensWithSlippage = applySlippage(tokenOut, 1);
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
          amountSol: actualTradeAmount,
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
      const feeResult = await collectTransactionFee(bs58.encode(devKeypair.secretKey), actualTradeAmount, "buy");
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

    // CRITICAL: Check wallet balance and reserve SOL for future sell transactions
    const walletBalance = await connection.getBalance(fundingKeypair.publicKey, "confirmed");
    const walletBalanceSOL = walletBalance / LAMPORTS_PER_SOL;
    
    // Reserve fees for buy transaction AND future sell transactions
    const transactionFeeReserve = 0.01; // Priority fees + base fees for current buy
    const sellFeeReserve = 0.01; // Reserve 0.01 SOL for future sell transaction fees
    const buyFeePercent = 0.01; // 1% buy fee
    const estimatedBuyFee = solAmount * buyFeePercent;
    const totalFeeReserve = transactionFeeReserve + sellFeeReserve + estimatedBuyFee;
    const availableForTrade = walletBalanceSOL - totalFeeReserve;
    
    console.log(`[${logId}]: Wallet balance: ${walletBalanceSOL.toFixed(6)} SOL`);
    console.log(`[${logId}]: Transaction fee reserve: ${transactionFeeReserve.toFixed(6)} SOL`);
    console.log(`[${logId}]: Sell fee reserve: ${sellFeeReserve.toFixed(6)} SOL (for future sells)`);
    console.log(`[${logId}]: Estimated 1% buy fee: ${estimatedBuyFee.toFixed(6)} SOL`);
    console.log(`[${logId}]: Total fee reserve: ${totalFeeReserve.toFixed(6)} SOL`);
    console.log(`[${logId}]: Available for trade: ${availableForTrade.toFixed(6)} SOL`);
    
    // Validate we have enough balance
    if (availableForTrade <= 0) {
      throw new Error(`Insufficient balance: ${walletBalanceSOL.toFixed(6)} SOL available, need at least ${totalFeeReserve.toFixed(6)} SOL for fees (${transactionFeeReserve.toFixed(6)} SOL tx fees + ${sellFeeReserve.toFixed(6)} SOL sell reserve + ${estimatedBuyFee.toFixed(6)} SOL buy fee)`);
    }
    
    // Use the minimum of requested amount or available balance
    const actualTradeAmount = Math.min(solAmount, availableForTrade);
    
    if (actualTradeAmount < solAmount) {
      console.warn(`[${logId}]: Adjusted trade amount from ${solAmount} SOL to ${actualTradeAmount.toFixed(6)} SOL due to fee reservations (keeping ${sellFeeReserve} SOL for future sells)`);
    }

    const { bondingCurve } = getBondingCurve(mintPk);
    console.log(`[${logId}]: bondingCurve = ${bondingCurve.toBase58()}`);

    const bondingCurveData = await getBondingCurveData(bondingCurve);
    console.log(`[${logId}]: bondingCurveData fetched`);
    if (!bondingCurveData) {
      throw new Error("Bonding curve data not found");
    }

    console.log(`[${logId}]: bondingCurveData fetched successfully`);

    const solLamports = BigInt(Math.ceil(actualTradeAmount * LAMPORTS_PER_SOL));
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
          amountSol: actualTradeAmount,
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
      const feeResult = await collectTransactionFee(bs58.encode(fundingKeypair.secretKey), actualTradeAmount, "buy");
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
