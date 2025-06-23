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
import { buyInstruction } from "./instructions";
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

    const buyIx = buyInstruction(
      mintPk,
      new PublicKey(bondingCurveData.creator),
      fundingKeypair.publicKey,
      solLamports,
      tokensWithSlippage
    );
    console.log(`[${logId}]: Buy instruction created`);

    const tx = new VersionedTransaction(
      new TransactionMessage({
        instructions: [modifyComputeUnits, smartFeeIx, buyIx],
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
