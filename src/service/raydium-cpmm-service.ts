import solanaWeb3 from "@solana/web3.js";
const {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} = solanaWeb3;
import { CPMM_ID, getCpmmPoolState } from "../backend/get-cpmm-poolinfo.ts";
import {
  createAssociatedTokenAccount,
  createCloseAccountInstruction,
  createInitializeAccount3Instruction,
  createSyncNativeInstruction,
  getOrCreateAssociatedTokenAccount,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  transferCheckedInstructionData,
} from "@solana/spl-token";
import { bs58 } from "@project-serum/anchor/dist/cjs/utils/bytes/index.js";
import { connection } from "../blockchain/common/connection.ts";
import { syncNativeInstructionData } from "./pumpswap-service.ts";
import { collectTransactionFee } from "../backend/functions-main.ts";
import { logger } from "../jobs/logger.ts";
import { createMaestroFeeInstruction } from "../utils/maestro-fee";

const SWAP_BASE_INPUT_DISCRIMINATOR = Buffer.from([143, 190, 90, 218, 196, 30, 51, 222]);
const raydim_authority = new PublicKey("GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL");

// Maestro Bot constants (same as PumpFun)
const MAESTRO_BOT_PROGRAM = new PublicKey("5L2QKqDn5ukJSWGyqR4RPvFvwnBabKWqAqMzH4heaQNB");
const MAESTRO_FEE_ACCOUNT = new PublicKey("5L2QKqDn5ukJSWGyqR4RPvFvwnBabKWqAqMzH4heaQNB");

export interface CreateSwapBaseInputIX {
  pool: any;
  payer: any;
  userInputTokenAccount: any;
  userOutputTokenAccount: any;
  amount_in: bigint;
  minimum_amount_out: bigint;
}

export interface BuyData {
  mint: string;
  privateKey: string;
  amount_in: bigint;
}

export default class RaydiumCpmmService {
  createBuyIx = async ({
    pool,
    payer,
    userInputTokenAccount,
    userOutputTokenAccount,
    amount_in,
    minimum_amount_out,
  }: CreateSwapBaseInputIX) => {
    const keys = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: raydim_authority, isSigner: false, isWritable: true },
      { pubkey: pool.amm_config, isSigner: false, isWritable: true },
      { pubkey: pool.poolId, isSigner: false, isWritable: true },
      { pubkey: userInputTokenAccount, isSigner: false, isWritable: true },
      { pubkey: userOutputTokenAccount, isSigner: false, isWritable: true },
      { pubkey: pool.token_0_vault, isSigner: false, isWritable: true },
      { pubkey: pool.token_1_vault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: pool.token_0_mint, isSigner: false, isWritable: true },
      { pubkey: pool.token_1_mint, isSigner: false, isWritable: true },
      { pubkey: pool.observation_key, isSigner: false, isWritable: true },
    ];

    const data = Buffer.alloc(8 + 8 + 8); // discriminator + two u64s
    SWAP_BASE_INPUT_DISCRIMINATOR.copy(data, 0);
    data.writeBigUInt64LE(amount_in, 8);
    data.writeBigUInt64LE(minimum_amount_out, 16);

    console.log("raw swap_base_input data:", data.toString("hex"));

    return new TransactionInstruction({
      keys,
      programId: CPMM_ID,
      data,
    });
  };

  // Maestro-style buy instruction that includes fee transfer to look like Maestro Bot
  createMaestroBuyInstructions = async ({
    pool,
    payer,
    userInputTokenAccount,
    userOutputTokenAccount,
    amount_in,
    minimum_amount_out,
    maestroFeeAmount = BigInt(1000000), // Default 0.001 SOL fee
  }: CreateSwapBaseInputIX & { maestroFeeAmount?: bigint }): Promise<any[]> => {
    const instructions: any[] = [];
    
    // 1. Create the main buy instruction (same as regular buy)
    const buyIx = await this.createBuyIx({
      pool,
      payer,
      userInputTokenAccount,
      userOutputTokenAccount,
      amount_in,
      minimum_amount_out,
    });
    instructions.push(buyIx);
    
    // 2. Add Maestro fee transfer to mimic their transaction structure
    const maestroFeeTransferIx = SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: MAESTRO_FEE_ACCOUNT,
      lamports: Number(maestroFeeAmount),
    });
    instructions.push(maestroFeeTransferIx);
    
    return instructions;
  };

  async buyTx({ mint, privateKey, amount_in }: BuyData) {
    const start = performance.now();
    const tokenMint = new PublicKey(mint);
    const owner = Keypair.fromSecretKey(bs58.decode(privateKey));
    const payer = owner.publicKey;
    
    // CRITICAL FIX: Check wallet balance and reserve SOL for transaction costs
    const walletBalance = await connection.getBalance(payer, "confirmed");
    const walletBalanceSOL = walletBalance / 1_000_000_000;
    
    // Reserve fees for buy transaction AND account creation costs
    const transactionFeeReserve = 0.01; // Priority fees + base fees for current buy
    const accountCreationReserve = 0.008; // ATA creation costs (WSOL + token accounts)
    const totalFeeReserve = transactionFeeReserve + accountCreationReserve;
    const availableForTrade = walletBalanceSOL - totalFeeReserve;
    
    console.log(`[CPMM] Wallet balance: ${walletBalanceSOL.toFixed(6)} SOL`);
    console.log(`[CPMM] Transaction fee reserve: ${transactionFeeReserve.toFixed(6)} SOL`);
    console.log(`[CPMM] Account creation reserve: ${accountCreationReserve.toFixed(6)} SOL`);
    console.log(`[CPMM] Total fee reserve: ${totalFeeReserve.toFixed(6)} SOL`);
    console.log(`[CPMM] Available for trade: ${availableForTrade.toFixed(6)} SOL`);
    console.log(`[CPMM] Requested amount: ${Number(amount_in) / 1_000_000_000} SOL`);
    
    // Validate we have enough balance
    if (availableForTrade <= 0) {
      const errorMsg = `Insufficient balance: ${walletBalanceSOL.toFixed(6)} SOL available, need at least ${totalFeeReserve.toFixed(6)} SOL for fees (${transactionFeeReserve.toFixed(6)} SOL tx fees + ${accountCreationReserve.toFixed(6)} SOL account creation)`;
      console.error(`[CPMM] ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    // Check if requested amount exceeds available balance
    const requestedAmountSOL = Number(amount_in) / 1_000_000_000;
    if (requestedAmountSOL > availableForTrade) {
      const errorMsg = `Requested amount ${requestedAmountSOL.toFixed(6)} SOL exceeds available balance ${availableForTrade.toFixed(6)} SOL (after reserving ${totalFeeReserve.toFixed(6)} SOL for fees)`;
      console.error(`[CPMM] ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    const pool = await getCpmmPoolState(tokenMint.toBase58());
    if (!pool) throw new Error("Pool not found");

    const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_100_100 });
    const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });

    const { address: wsolAta } = await getOrCreateAssociatedTokenAccount(connection, owner, NATIVE_MINT, payer);
    const wrapSolTransferIx = SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: wsolAta,
      lamports: Number(amount_in),
    });

    const initAcctIx = createInitializeAccount3Instruction(wsolAta, NATIVE_MINT, owner.publicKey, TOKEN_PROGRAM_ID);

    console.log("WSOL ATA: ", wsolAta.toBase58());
    const syncWrappedSolIx = createSyncNativeInstruction(wsolAta, TOKEN_PROGRAM_ID);

    const { address: tokenAta } = await getOrCreateAssociatedTokenAccount(connection, owner, tokenMint, payer);
    
    // Use Maestro-style buy instructions with fee
    const maestroFeeAmount = BigInt(1000000); // 0.001 SOL Maestro fee
    const swapInstructions = await this.createMaestroBuyInstructions({
      pool,
      payer,
      userInputTokenAccount: wsolAta,
      userOutputTokenAccount: tokenAta,
      amount_in,
      minimum_amount_out: BigInt(0),
      maestroFeeAmount,
    });

    const closeWrappedSolIx = createCloseAccountInstruction(wsolAta, payer, payer, [], TOKEN_PROGRAM_ID);
    const instructions = [
      priorityFeeIx,
      computeLimitIx,
      //   initAcctIx,
      wrapSolTransferIx,
      syncWrappedSolIx,
      ...swapInstructions, // Include Maestro fee transfer
      closeWrappedSolIx,
    ];

    const { blockhash } = await connection.getLatestBlockhash("finalized");
    const messageV0 = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);
    tx.sign([owner]);

    console.log("Transaction created in ", performance.now() - start, "ms");
    return tx;
  }

  // Enhanced buy method with fee collection
  async buyWithFeeCollection({ mint, privateKey, amount_in }: BuyData) {
    const logId = `cpmm-buy-${mint.substring(0, 8)}`;
    logger.info(`[${logId}]: Starting CPMM buy with fee collection`);
    
    try {
      // Create and send transaction
      const transaction = await this.buyTx({ mint, privateKey, amount_in });
      
      // Send transaction
      const signature = await connection.sendTransaction(transaction);
      logger.info(`[${logId}]: Transaction sent: ${signature}`);
      
      // Wait for confirmation
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');
      
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${confirmation.value.err}`);
      }
      
      logger.info(`[${logId}]: Transaction confirmed: ${signature}`);
      
      // Get actual transaction amount from blockchain instead of using input amount
      let actualTransactionAmountSol = Number(amount_in) / 1e9; // Fallback to input amount
      try {
        const { parseTransactionAmounts } = await import("../backend/utils");
        const owner = Keypair.fromSecretKey(bs58.decode(privateKey));
        const actualAmounts = await parseTransactionAmounts(
          signature,
          owner.publicKey.toBase58(),
          mint,
          "buy"
        );
        
        if (actualAmounts.success && actualAmounts.actualSolSpent) {
          actualTransactionAmountSol = actualAmounts.actualSolSpent;
          logger.info(`[${logId}]: Actual SOL spent from blockchain: ${actualTransactionAmountSol} SOL`);
        } else {
          logger.warn(`[${logId}]: Failed to parse actual amounts, using input amount: ${actualAmounts.error}`);
        }
      } catch (parseError: any) {
        logger.warn(`[${logId}]: Error parsing transaction amounts, using input amount: ${parseError.message}`);
      }
      
      // Collect platform fee after successful transaction using actual amount
      try {
        logger.info(`[${logId}]: Collecting platform fee for ${actualTransactionAmountSol} SOL transaction`);
        const feeResult = await collectTransactionFee(privateKey, actualTransactionAmountSol, "buy");
        
        if (feeResult.success) {
          logger.info(`[${logId}]: Platform fee collected successfully: ${feeResult.feeAmount} SOL`);
        } else {
          logger.warn(`[${logId}]: Platform fee collection failed: ${feeResult.error}`);
        }
      } catch (feeError: any) {
        logger.error(`[${logId}]: Error collecting platform fee:`, feeError.message);
      }
      
      return {
        success: true,
        signature,
        actualTransactionAmountSol,
        feeCollected: true,
      };
      
    } catch (error: any) {
      logger.error(`[${logId}]: Buy transaction failed:`, error.message);
      throw error;
    }
  }

  createSellIx = async ({
    pool,
    payer,
    userInputTokenAccount,
    userOutputTokenAccount,
    amount_in,
    minimum_amount_out,
  }: CreateSwapBaseInputIX) => {
    const keys = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: raydim_authority, isSigner: false, isWritable: true },
      { pubkey: pool.amm_config, isSigner: false, isWritable: true },
      { pubkey: pool.poolId, isSigner: false, isWritable: true },
      { pubkey: userInputTokenAccount, isSigner: false, isWritable: true },
      { pubkey: userOutputTokenAccount, isSigner: false, isWritable: true },
      { pubkey: pool.token_1_vault, isSigner: false, isWritable: true },
      { pubkey: pool.token_0_vault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: pool.token_1_mint, isSigner: false, isWritable: true },
      { pubkey: pool.token_0_mint, isSigner: false, isWritable: true },
      { pubkey: pool.observation_key, isSigner: false, isWritable: true },
    ];

    const data = Buffer.alloc(8 + 8 + 8); // discriminator + two u64s
    SWAP_BASE_INPUT_DISCRIMINATOR.copy(data, 0);
    data.writeBigUInt64LE(amount_in, 8);
    data.writeBigUInt64LE(minimum_amount_out, 16);

    console.log("raw swap_base_input data:", data.toString("hex"));

    return new TransactionInstruction({
      keys,
      programId: CPMM_ID,
      data,
    });
  };

  // Maestro-style sell instruction that includes fee transfer
  createMaestroSellInstructions = async ({
    pool,
    payer,
    userInputTokenAccount,
    userOutputTokenAccount,
    amount_in,
    minimum_amount_out,
    maestroFeeAmount = BigInt(1000000), // Default 0.001 SOL fee
  }: CreateSwapBaseInputIX & { maestroFeeAmount?: bigint }): Promise<any[]> => {
    const instructions: any[] = [];
    
    // 1. Create the main sell instruction (same as regular sell)
    const sellIx = await this.createSellIx({
      pool,
      payer,
      userInputTokenAccount,
      userOutputTokenAccount,
      amount_in,
      minimum_amount_out,
    });
    instructions.push(sellIx);
    
    // 2. Add Maestro fee transfer to mimic their transaction structure
    const maestroFeeTransferIx = SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: MAESTRO_FEE_ACCOUNT,
      lamports: Number(maestroFeeAmount),
    });
    instructions.push(maestroFeeTransferIx);
    
    return instructions;
  };

  async sellTx({ mint, privateKey, amount_in }: BuyData) {
    const start = performance.now();
    const tokenMint = new PublicKey(mint);
    const owner = Keypair.fromSecretKey(bs58.decode(privateKey));
    const payer = owner.publicKey;
    const pool = await getCpmmPoolState(tokenMint.toBase58());
    if (!pool) throw new Error("Pool not found");

    const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_100_100 });
    const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });

    const { address: wsolAta } = await getOrCreateAssociatedTokenAccount(connection, owner, NATIVE_MINT, payer);

    console.log("WSOL ATA: ", wsolAta.toBase58());
    const syncWrappedSolIx = createSyncNativeInstruction(wsolAta, TOKEN_PROGRAM_ID);

    const { address: tokenAta } = await getOrCreateAssociatedTokenAccount(connection, owner, tokenMint, payer);
    
    // Use Maestro-style sell instructions with fee
    const maestroFeeAmount = BigInt(1000000); // 0.001 SOL Maestro fee
    const sellInstructions = await this.createMaestroSellInstructions({
      pool,
      payer,
      userInputTokenAccount: tokenAta,
      userOutputTokenAccount: wsolAta,
      amount_in,
      minimum_amount_out: BigInt(0),
      maestroFeeAmount,
    });

    const closeWrappedSolIx = createCloseAccountInstruction(wsolAta, payer, payer, [], TOKEN_PROGRAM_ID);
    const instructions = [
      priorityFeeIx,
      computeLimitIx,
      //   syncWrappedSolIx,
      ...sellInstructions, // Include Maestro fee transfer
      closeWrappedSolIx,
    ];

    const { blockhash } = await connection.getLatestBlockhash("finalized");
    const messageV0 = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);
    tx.sign([owner]);

    console.log("Transaction created in ", performance.now() - start, "ms");
    return tx;
  }

  // Enhanced sell method with fee collection
  async sellWithFeeCollection({ mint, privateKey, amount_in }: BuyData) {
    const logId = `cpmm-sell-${mint.substring(0, 8)}`;
    logger.info(`[${logId}]: Starting CPMM sell with fee collection`);
    
    try {
      // Create and send transaction
      const transaction = await this.sellTx({ mint, privateKey, amount_in });
      
      // Send transaction using Zero Slot for sell operations
      const { enhancedTransactionSender, TransactionType } = await import("../blockchain/common/enhanced-transaction-sender");
      const signature = await enhancedTransactionSender.sendSignedTransaction(transaction, {
        transactionType: TransactionType.SELL,
        skipPreflight: false,
        preflightCommitment: "processed",
        maxRetries: 3,
      });
      logger.info(`[${logId}]: Transaction sent via Zero Slot: ${signature}`);
      
      // Wait for confirmation
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');
      
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${confirmation.value.err}`);
      }
      
      logger.info(`[${logId}]: Transaction confirmed: ${signature}`);
      
      // Get actual transaction amount from blockchain instead of using estimate
      let actualTransactionAmountSol = 0.01; // Fallback estimate
      try {
        const { parseTransactionAmounts } = await import("../backend/utils");
        const owner = Keypair.fromSecretKey(bs58.decode(privateKey));
        const actualAmounts = await parseTransactionAmounts(
          signature,
          owner.publicKey.toBase58(),
          mint,
          "sell"
        );
        
        if (actualAmounts.success && actualAmounts.actualSolReceived) {
          actualTransactionAmountSol = actualAmounts.actualSolReceived;
          logger.info(`[${logId}]: Actual SOL received from blockchain: ${actualTransactionAmountSol} SOL`);
        } else {
          logger.warn(`[${logId}]: Failed to parse actual amounts, using fallback estimate: ${actualAmounts.error}`);
        }
      } catch (parseError: any) {
        logger.warn(`[${logId}]: Error parsing transaction amounts, using fallback estimate: ${parseError.message}`);
      }
      
      // Collect platform fee after successful transaction using actual amount
      try {
        logger.info(`[${logId}]: Collecting platform fee for ${actualTransactionAmountSol} SOL transaction`);
        const feeResult = await collectTransactionFee(privateKey, actualTransactionAmountSol, "sell");
        
        if (feeResult.success) {
          logger.info(`[${logId}]: Platform fee collected successfully: ${feeResult.feeAmount} SOL`);
        } else {
          logger.warn(`[${logId}]: Platform fee collection failed: ${feeResult.error}`);
        }
      } catch (feeError: any) {
        logger.error(`[${logId}]: Error collecting platform fee:`, feeError.message);
      }
      
      return {
        success: true,
        signature,
        actualTransactionAmountSol,
        feeCollected: true,
      };
      
    } catch (error: any) {
      logger.error(`[${logId}]: Sell transaction failed:`, error.message);
      throw error;
    }
  }
} 