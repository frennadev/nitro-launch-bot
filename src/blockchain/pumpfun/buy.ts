import {
  PublicKey,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  SystemProgram,
} from "@solana/web3.js";
import { connection } from "../common/connection";
import { getBondingCurve, getBondingCurveData, quoteBuy, applySlippage } from "./utils";
import { buyInstruction } from "./index";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction
} from "@solana/spl-token";
import { 
  MAESTRO_FEE_AMOUNT, 
  MAESTRO_FEE_ACCOUNT, 
  PLATFORM_FEE_WALLET, 
  DEFAULT_PLATFORM_FEE_PERCENTAGE 
} from "./constants";

export interface BuyResult {
  success: boolean;
  signature?: string;
  error?: string;
  tokensReceived?: string;
  solSpent?: string;
}

/**
 * Execute a buy transaction on PumpFun
 */
export const executePumpFunBuy = async (
  tokenAddress: string,
  buyerKeypair: Keypair,
  solAmount: number,
  platformFeePercentage: number = DEFAULT_PLATFORM_FEE_PERCENTAGE
): Promise<BuyResult> => {
  const logId = `pumpfun-buy-${tokenAddress.substring(0, 8)}`;
  console.log(`[${logId}]: Starting PumpFun buy for ${solAmount} SOL with ${platformFeePercentage}% platform fee`);

  try {
    const mintPk = new PublicKey(tokenAddress);
    console.log(`[${logId}]: Token address = ${mintPk.toBase58()}`);

    // Calculate fees
    const maestroFee = Number(MAESTRO_FEE_AMOUNT) / LAMPORTS_PER_SOL; // 0.001 SOL
    const platformFee = (solAmount * platformFeePercentage) / 100; // Platform fee percentage
    const totalFees = maestroFee + platformFee;
    const totalSpend = solAmount + totalFees;
    
    console.log(`[${logId}]: Fee breakdown:`);
    console.log(`[${logId}]:   - Maestro fee: ${maestroFee.toFixed(6)} SOL`);
    console.log(`[${logId}]:   - Platform fee (${platformFeePercentage}%): ${platformFee.toFixed(6)} SOL`);
    console.log(`[${logId}]:   - Total fees: ${totalFees.toFixed(6)} SOL`);
    console.log(`[${logId}]:   - Trade amount (SOL sent to buy): ${solAmount.toFixed(6)} SOL`);
    console.log(`[${logId}]:   - Total spend (trade + fees): ${totalSpend.toFixed(6)} SOL`);

    // Check wallet balance
    const walletBalance = await connection.getBalance(buyerKeypair.publicKey, "confirmed");
    const walletBalanceSOL = walletBalance / LAMPORTS_PER_SOL;
    
    // Reserve fees for transaction
    const transactionFeeReserve = 0.01; // Priority fees + base fees
    const availableForTrade = walletBalanceSOL - transactionFeeReserve;
    
    console.log(`[${logId}]: Wallet balance: ${walletBalanceSOL.toFixed(6)} SOL`);
    console.log(`[${logId}]: Available for trade: ${availableForTrade.toFixed(6)} SOL`);
    
    if (availableForTrade <= 0) {
      return {
        success: false,
        error: `Insufficient balance: ${walletBalanceSOL.toFixed(6)} SOL available, need at least ${transactionFeeReserve.toFixed(6)} SOL for fees`
      };
    }
    
    // Check if we have enough for the total amount (trade + fees)
    if (totalSpend > availableForTrade) {
      return {
        success: false,
        error: `Insufficient balance: ${walletBalanceSOL.toFixed(6)} SOL available, need ${totalSpend.toFixed(6)} SOL (trade + fees)`
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

    // Calculate token amount to receive
    const solLamports = BigInt(Math.ceil(solAmount * LAMPORTS_PER_SOL));
    console.log(`[${logId}]: SOL amount in lamports = ${solLamports}`);

    const { tokenOut } = quoteBuy(
      solLamports,
      bondingCurveData.virtualTokenReserves,
      bondingCurveData.virtualSolReserves,
      bondingCurveData.realTokenReserves
    );
    console.log(`[${logId}]: Quoted tokenOut = ${tokenOut.toString()}`);

    // Apply slippage tolerance
    const tokensWithSlippage = applySlippage(tokenOut, 1); // 1% slippage
    console.log(`[${logId}]: Tokens with slippage = ${tokensWithSlippage.toString()}`);

    // --- NEW: Check if ATA exists, create if not ---
    const buyerAta = getAssociatedTokenAddressSync(mintPk, buyerKeypair.publicKey);
    let ataExists = true;
    try {
      await connection.getTokenAccountBalance(buyerAta);
    } catch (e) {
      ataExists = false;
    }

    const instructions = [];
    if (!ataExists) {
      console.log(`[${logId}]: Creating associated token account for buyer...`);
      instructions.push(
        createAssociatedTokenAccountInstruction(
          buyerKeypair.publicKey, // payer
          buyerAta, // ata
          buyerKeypair.publicKey, // owner
          mintPk
        )
      );
    }

    // Create transaction instructions
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 151595,
    });

    const buyIx = buyInstruction(
      mintPk,
      new PublicKey(bondingCurveData.creator),
      buyerKeypair.publicKey,
      tokensWithSlippage, // amount: token amount to receive
      solLamports // maxSolCost: maximum SOL to spend
    );

    // Maestro fee transfer (AFTER main buy instruction)
    const maestroFeeIx = SystemProgram.transfer({
      fromPubkey: buyerKeypair.publicKey,
      toPubkey: MAESTRO_FEE_ACCOUNT,
      lamports: Number(MAESTRO_FEE_AMOUNT),
    });

    // Add platform fee transfer (AFTER Maestro fee)
    const platformFeeIx = SystemProgram.transfer({
      fromPubkey: buyerKeypair.publicKey,
      toPubkey: PLATFORM_FEE_WALLET,
      lamports: Math.ceil(platformFee * LAMPORTS_PER_SOL),
    });

    instructions.push(modifyComputeUnits, buyIx, maestroFeeIx, platformFeeIx);

    // Get latest blockhash
    const blockhash = await connection.getLatestBlockhash("processed");
    console.log(`[${logId}]: Latest blockhash = ${blockhash.blockhash}`);

    // Create and sign transaction
    const tx = new VersionedTransaction(
      new TransactionMessage({
        instructions,
        payerKey: buyerKeypair.publicKey,
        recentBlockhash: blockhash.blockhash,
      }).compileToV0Message()
    );
    tx.sign([buyerKeypair]);
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

    console.log(`[${logId}]: Buy transaction confirmed successfully`);
    
    return {
      success: true,
      signature,
      tokensReceived: tokensWithSlippage.toString(),
      solSpent: totalSpend.toString()
    };

  } catch (error: any) {
    console.error(`[${logId}]: Buy failed:`, error);
    return {
      success: false,
      error: error.message || "Unknown error occurred"
    };
  }
}; 