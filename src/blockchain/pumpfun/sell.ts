import {
  PublicKey,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  SystemProgram,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { connection } from "../common/connection";
import { getBondingCurve, getBondingCurveData, quoteSell, applySlippage } from "./utils";
import { sellInstruction } from "./index";
import {
  MAESTRO_FEE_AMOUNT, 
  PLATFORM_FEE_WALLET, 
  DEFAULT_PLATFORM_FEE_PERCENTAGE 
} from "./constants";

export interface SellResult {
  success: boolean;
  signature?: string;
  error?: string;
  solReceived?: string;
  tokensSold?: string;
}

/**
 * Execute a sell transaction on PumpFun
 */
export const executePumpFunSell = async (
  tokenAddress: string,
  sellerKeypair: Keypair,
  tokenAmount: number,
  platformFeePercentage: number = DEFAULT_PLATFORM_FEE_PERCENTAGE
): Promise<SellResult> => {
  const logId = `pumpfun-sell-${tokenAddress.substring(0, 8)}`;
  console.log(`[${logId}]: Starting PumpFun sell for ${tokenAmount} tokens with ${platformFeePercentage}% platform fee`);

  try {
    const mintPk = new PublicKey(tokenAddress);
    console.log(`[${logId}]: Token address = ${mintPk.toBase58()}`);

    // Get token balance
    const ata = getAssociatedTokenAddressSync(mintPk, sellerKeypair.publicKey);
    const tokenBalance = await connection.getTokenAccountBalance(ata);
    const currentBalance = Number(tokenBalance.value.amount);
    
    console.log(`[${logId}]: Current token balance: ${currentBalance}`);
    
    if (currentBalance < tokenAmount) {
      return {
        success: false,
        error: `Insufficient token balance: ${currentBalance} available, trying to sell ${tokenAmount}`
      };
    }

    // Get bonding curve data
    const { bondingCurve } = getBondingCurve(mintPk);
    console.log(`[${logId}]: Bonding curve = ${bondingCurve.toBase58()}`);

    const bondingCurveData = await getBondingCurveData(bondingCurve);
    console.log(`[${logId}]: Bonding curve data fetched`);
    
    if (!bondingCurveData) {
      return {
        success: false,
        error: "Bonding curve data not found - token may not be a PumpFun token"
      };
    }

    // Calculate SOL amount to receive
    const tokenAmountBigInt = BigInt(Math.floor(tokenAmount));
    console.log(`[${logId}]: Token amount to sell = ${tokenAmountBigInt}`);

    const { solOut } = quoteSell(
      tokenAmountBigInt,
      bondingCurveData.virtualTokenReserves,
      bondingCurveData.virtualSolReserves,
      bondingCurveData.realTokenReserves
    );
    console.log(`[${logId}]: Quoted SOL out = ${solOut.toString()}`);

    // Calculate fees
    const maestroFee = Number(MAESTRO_FEE_AMOUNT); // 0.001 SOL in lamports
    const platformFee = Math.ceil((Number(solOut) * platformFeePercentage) / 100); // Platform fee percentage
    const totalFees = maestroFee + platformFee;
    const actualSolOut = Number(solOut) - totalFees;
    
    console.log(`[${logId}]: Fee breakdown:`);
    console.log(`[${logId}]:   - Maestro fee: ${maestroFee} lamports`);
    console.log(`[${logId}]:   - Platform fee (${platformFeePercentage}%): ${platformFee} lamports`);
    console.log(`[${logId}]:   - Total fees: ${totalFees} lamports`);
    console.log(`[${logId}]:   - Actual SOL out (after fees): ${actualSolOut} lamports`);

    // Apply slippage tolerance to the actual SOL out
    const solWithSlippage = applySlippage(BigInt(actualSolOut), 5); // 5% slippage
    console.log(`[${logId}]: SOL with slippage = ${solWithSlippage.toString()}`);

    // Check if we have enough SOL for fees
    const walletBalance = await connection.getBalance(sellerKeypair.publicKey, "confirmed");
    const transactionFeeReserve = 0.01 * LAMPORTS_PER_SOL; // Priority fees + base fees
    
    if (walletBalance < transactionFeeReserve) {
      return {
        success: false,
        error: `Insufficient SOL for transaction fees: ${walletBalance / LAMPORTS_PER_SOL} SOL available, need at least 0.01 SOL`
      };
    }

    // Create transaction instructions
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 151595,
    });

    const sellIx = sellInstruction(
      mintPk,
      new PublicKey(bondingCurveData.creator),
      sellerKeypair.publicKey,
      tokenAmountBigInt,
      solWithSlippage
    );

    // Add platform fee transfer (AFTER main sell instruction)
    const platformFeeIx = SystemProgram.transfer({
      fromPubkey: sellerKeypair.publicKey,
      toPubkey: PLATFORM_FEE_WALLET,
      lamports: platformFee,
    });

    const instructions = [modifyComputeUnits, sellIx, platformFeeIx];

    // Get latest blockhash
    const blockhash = await connection.getLatestBlockhash("processed");
    console.log(`[${logId}]: Latest blockhash = ${blockhash.blockhash}`);

    // Create and sign transaction
    const tx = new VersionedTransaction(
      new TransactionMessage({
        instructions,
        payerKey: sellerKeypair.publicKey,
        recentBlockhash: blockhash.blockhash,
      }).compileToV0Message()
    );
    tx.sign([sellerKeypair]);
    console.log(`[${logId}]: Transaction signed`);

    // Send and confirm transaction
    const signature = await connection.sendTransaction(tx, {
      skipPreflight: false,
      preflightCommitment: "processed",
    });

    console.log(`[${logId}]: Transaction sent with signature: ${signature}`);

    // Wait for confirmation
    const confirmation = await connection.confirmTransaction(
      {
        signature,
        blockhash: blockhash.blockhash,
        lastValidBlockHeight: blockhash.lastValidBlockHeight,
      },
      "confirmed"
    );

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${confirmation.value.err}`);
    }

    console.log(`[${logId}]: Sell transaction confirmed successfully`);
    
    const solReceived = actualSolOut / LAMPORTS_PER_SOL;
    
    return {
      success: true,
      signature,
      solReceived: solReceived.toString(),
      tokensSold: tokenAmount.toString()
    };

  } catch (error: any) {
    console.error(`[${logId}]: Sell failed:`, error);
    return {
      success: false,
      error: error.message || "Unknown error occurred"
    };
  }
};

/**
 * Sell all tokens for a given token address
 */
export const executePumpFunSellAll = async (
  tokenAddress: string,
  sellerKeypair: Keypair
): Promise<SellResult> => {
  const logId = `pumpfun-sell-all-${tokenAddress.substring(0, 8)}`;
  console.log(`[${logId}]: Starting PumpFun sell all`);

  try {
    const mintPk = new PublicKey(tokenAddress);
    
    // Get token balance
    const ata = getAssociatedTokenAddressSync(mintPk, sellerKeypair.publicKey);
    const tokenBalance = await connection.getTokenAccountBalance(ata);
    const currentBalance = Number(tokenBalance.value.amount);
    
    console.log(`[${logId}]: Current token balance: ${currentBalance}`);
    
    if (currentBalance <= 0) {
      return {
        success: false,
        error: "No tokens to sell"
      };
    }

    // Sell all tokens
    return await executePumpFunSell(tokenAddress, sellerKeypair, currentBalance);

  } catch (error: any) {
    console.error(`[${logId}]: Sell all failed:`, error);
    return {
      success: false,
      error: error.message || "Unknown error occurred"
    };
  }
}; 