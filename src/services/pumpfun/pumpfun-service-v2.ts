import {
  Connection,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { logger } from "../../blockchain/common/logger";
import { connection } from "../../blockchain/common/connection";
import { getBondingCurve, getBondingCurveData, quoteBuy, quoteSell, applySlippage } from "../../blockchain/pumpfun/utils";

// 🔥 LATEST WORKING DISCRIMINATORS
const BUY_DISCRIMINATOR = [0x66, 0x06, 0x3d, 0x12, 0x01, 0xda, 0xeb, 0xea];
const SELL_DISCRIMINATOR = [51, 230, 133, 164, 1, 127, 131, 173];

// 🎯 CURRENT WORKING CONSTANTS (Updated December 2024)
const PUMPFUN_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const GLOBAL_CONFIG = new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
const FEE_RECIPIENT = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");
const EVENT_AUTHORITY = new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1");
const MINT_AUTHORITY = new PublicKey("TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM");
const RENT_SYSVAR = new PublicKey("SysvarRent111111111111111111111111111111111");

export interface PumpFunBuyParams {
  mint: PublicKey;
  user: Keypair;
  solAmount: number;
  slippage?: number;
  priorityFee?: number;
}

export interface PumpFunSellParams {
  mint: PublicKey;
  user: Keypair;
  tokenAmount: number;
  slippage?: number;
  priorityFee?: number;
}

export class PumpfunServiceV2 {
  
  /**
   * 🚀 Create optimized PumpFun buy transaction
   */
  async createBuyTransaction(params: PumpFunBuyParams): Promise<VersionedTransaction> {
    const { mint, user, solAmount, slippage = 5, priorityFee = 0 } = params;
    const logId = `pumpfun-buy-${mint.toBase58().substring(0, 8)}`;

    logger.info(`[${logId}] Creating buy transaction: ${solAmount} SOL with ${slippage}% slippage`);

    // Get bonding curve info
    const { bondingCurve, associatedBondingCurve } = getBondingCurve(mint);
    const curveData = await getBondingCurveData(bondingCurve);
    
    if (!curveData) {
      throw new Error("Bonding curve data not found - token may not exist on PumpFun");
    }

    // Calculate token amount out
    const solAmountLamports = BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL));
    const { tokenOut } = quoteBuy(
      solAmountLamports,
      curveData.virtualTokenReserves,
      curveData.virtualSolReserves,
      curveData.realTokenReserves
    );

    const minTokenOut = applySlippage(tokenOut, slippage);

    logger.info(`[${logId}] Expected: ${Number(tokenOut)} tokens (min: ${Number(minTokenOut)})`);

    // Get user's token account
    const userTokenAccount = getAssociatedTokenAddressSync(mint, user.publicKey);

    // Build instructions
    const instructions: TransactionInstruction[] = [];

    // Add priority fee if specified
    if (priorityFee > 0) {
      instructions.push(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee })
      );
    }

    // Create token account if needed
    const tokenAccountInfo = await connection.getAccountInfo(userTokenAccount);
    if (!tokenAccountInfo) {
      instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(
          user.publicKey,
          userTokenAccount,
          user.publicKey,
          mint
        )
      );
    }

    // Create buy instruction
    instructions.push(
      this.createBuyInstruction({
        mint,
        bondingCurve,
        associatedBondingCurve,
        userTokenAccount,
        user: user.publicKey,
        solAmount: solAmountLamports,
        minTokenOut,
      })
    );

    // Build and sign transaction
    const { blockhash } = await connection.getLatestBlockhash("finalized");
    const messageV0 = new TransactionMessage({
      payerKey: user.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);
    tx.sign([user]);

    return tx;
  }

  /**
   * 🚀 Create optimized PumpFun sell transaction
   */
  async createSellTransaction(params: PumpFunSellParams): Promise<VersionedTransaction> {
    const { mint, user, tokenAmount, slippage = 5, priorityFee = 0 } = params;
    const logId = `pumpfun-sell-${mint.toBase58().substring(0, 8)}`;

    logger.info(`[${logId}] Creating sell transaction: ${tokenAmount} tokens with ${slippage}% slippage`);

    // Get bonding curve info
    const { bondingCurve, associatedBondingCurve } = getBondingCurve(mint);
    const curveData = await getBondingCurveData(bondingCurve);
    
    if (!curveData) {
      throw new Error("Bonding curve data not found - token may not exist on PumpFun");
    }

    // Calculate SOL amount out
    const tokenAmountBigInt = BigInt(tokenAmount);
    const { solOut } = quoteSell(
      tokenAmountBigInt,
      curveData.virtualTokenReserves,
      curveData.virtualSolReserves,
      curveData.realTokenReserves
    );

    const minSolOut = applySlippage(solOut, slippage);

    logger.info(`[${logId}] Expected: ${Number(solOut) / LAMPORTS_PER_SOL} SOL (min: ${Number(minSolOut) / LAMPORTS_PER_SOL})`);

    // Get user's token account
    const userTokenAccount = getAssociatedTokenAddressSync(mint, user.publicKey);

    // Build instructions
    const instructions: TransactionInstruction[] = [];

    // Add priority fee if specified
    if (priorityFee > 0) {
      instructions.push(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee })
      );
    }

    // Create sell instruction
    instructions.push(
      this.createSellInstruction({
        mint,
        bondingCurve,
        associatedBondingCurve,
        userTokenAccount,
        user: user.publicKey,
        tokenAmount: tokenAmountBigInt,
        minSolOut,
      })
    );

    // Build and sign transaction
    const { blockhash } = await connection.getLatestBlockhash("finalized");
    const messageV0 = new TransactionMessage({
      payerKey: user.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);
    tx.sign([user]);

    return tx;
  }

  /**
   * 🔥 Create PumpFun buy instruction with latest working structure
   */
  private createBuyInstruction(params: {
    mint: PublicKey;
    bondingCurve: PublicKey;
    associatedBondingCurve: PublicKey;
    userTokenAccount: PublicKey;
    user: PublicKey;
    solAmount: bigint;
    minTokenOut: bigint;
  }): TransactionInstruction {
    const {
      mint,
      bondingCurve,
      associatedBondingCurve,
      userTokenAccount,
      user,
      solAmount,
      minTokenOut,
    } = params;

    // 🎯 LATEST WORKING ACCOUNT STRUCTURE
    const keys = [
      { pubkey: GLOBAL_CONFIG, isWritable: false, isSigner: false },
      { pubkey: FEE_RECIPIENT, isWritable: true, isSigner: false },
      { pubkey: mint, isWritable: false, isSigner: false },
      { pubkey: bondingCurve, isWritable: true, isSigner: false },
      { pubkey: associatedBondingCurve, isWritable: true, isSigner: false },
      { pubkey: userTokenAccount, isWritable: true, isSigner: false },
      { pubkey: user, isWritable: true, isSigner: true },
      { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
      { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
      { pubkey: RENT_SYSVAR, isWritable: false, isSigner: false },
      { pubkey: EVENT_AUTHORITY, isWritable: false, isSigner: false },
      { pubkey: PUMPFUN_PROGRAM, isWritable: false, isSigner: false },
    ];

    // 🔥 PROVEN DATA STRUCTURE
    const data = Buffer.alloc(24);
    Buffer.from(BUY_DISCRIMINATOR).copy(data, 0);
    data.writeBigUInt64LE(minTokenOut, 8);
    data.writeBigUInt64LE(solAmount, 16);

    return new TransactionInstruction({
      keys,
      programId: PUMPFUN_PROGRAM,
      data,
    });
  }

  /**
   * 🔥 Create PumpFun sell instruction with latest working structure
   */
  private createSellInstruction(params: {
    mint: PublicKey;
    bondingCurve: PublicKey;
    associatedBondingCurve: PublicKey;
    userTokenAccount: PublicKey;
    user: PublicKey;
    tokenAmount: bigint;
    minSolOut: bigint;
  }): TransactionInstruction {
    const {
      mint,
      bondingCurve,
      associatedBondingCurve,
      userTokenAccount,
      user,
      tokenAmount,
      minSolOut,
    } = params;

    // 🎯 LATEST WORKING ACCOUNT STRUCTURE
    const keys = [
      { pubkey: GLOBAL_CONFIG, isWritable: false, isSigner: false },
      { pubkey: FEE_RECIPIENT, isWritable: true, isSigner: false },
      { pubkey: mint, isWritable: false, isSigner: false },
      { pubkey: bondingCurve, isWritable: true, isSigner: false },
      { pubkey: associatedBondingCurve, isWritable: true, isSigner: false },
      { pubkey: userTokenAccount, isWritable: true, isSigner: false },
      { pubkey: user, isWritable: true, isSigner: true },
      { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
      { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
      { pubkey: RENT_SYSVAR, isWritable: false, isSigner: false },
      { pubkey: EVENT_AUTHORITY, isWritable: false, isSigner: false },
      { pubkey: PUMPFUN_PROGRAM, isWritable: false, isSigner: false },
    ];

    // 🔥 PROVEN SELL DATA STRUCTURE
    const data = Buffer.alloc(24);
    Buffer.from(SELL_DISCRIMINATOR).copy(data, 0);
    data.writeBigUInt64LE(tokenAmount, 8);
    data.writeBigUInt64LE(minSolOut, 16);

    return new TransactionInstruction({
      keys,
      programId: PUMPFUN_PROGRAM,
      data,
    });
  }

  /**
   * 🎯 Quick buy with automatic slippage and retry
   */
  async quickBuy(params: {
    tokenAddress: string;
    privateKey: string;
    solAmount: number;
    slippage?: number;
    maxRetries?: number;
  }): Promise<{ success: boolean; signature?: string; error?: string }> {
    const { tokenAddress, privateKey, solAmount, slippage = 5, maxRetries = 3 } = params;
    
    try {
      const mint = new PublicKey(tokenAddress);
      const user = Keypair.fromSecretKey(Buffer.from(privateKey, 'base64'));

      const tx = await this.createBuyTransaction({
        mint,
        user,
        solAmount,
        slippage,
      });

      // Send with retries
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const signature = await connection.sendTransaction(tx, {
            maxRetries: 3,
            skipPreflight: false,
          });

          const confirmation = await connection.confirmTransaction(signature, "confirmed");
          
          if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
          }

          return { success: true, signature };
        } catch (error: any) {
          if (attempt === maxRetries) {
            return { success: false, error: error.message };
          }
          
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }

      return { success: false, error: "Max retries exceeded" };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 🎯 Quick sell with automatic slippage and retry
   */
  async quickSell(params: {
    tokenAddress: string;
    privateKey: string;
    tokenAmount: number;
    slippage?: number;
    maxRetries?: number;
  }): Promise<{ success: boolean; signature?: string; error?: string }> {
    const { tokenAddress, privateKey, tokenAmount, slippage = 5, maxRetries = 3 } = params;
    
    try {
      const mint = new PublicKey(tokenAddress);
      const user = Keypair.fromSecretKey(Buffer.from(privateKey, 'base64'));

      const tx = await this.createSellTransaction({
        mint,
        user,
        tokenAmount,
        slippage,
      });

      // Send with retries
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const signature = await connection.sendTransaction(tx, {
            maxRetries: 3,
            skipPreflight: false,
          });

          const confirmation = await connection.confirmTransaction(signature, "confirmed");
          
          if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
          }

          return { success: true, signature };
        } catch (error: any) {
          if (attempt === maxRetries) {
            return { success: false, error: error.message };
          }
          
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }

      return { success: false, error: "Max retries exceeded" };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

// Export singleton instance
export const pumpfunServiceV2 = new PumpfunServiceV2();