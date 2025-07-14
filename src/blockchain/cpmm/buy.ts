import {
  AccountMeta,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { CpmmPool } from "./types";
import { getCpmmPoolState } from "./pool";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createInitializeAccount3Instruction,
  createSyncNativeInstruction,
  getOrCreateAssociatedTokenAccount,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  transferCheckedInstructionData,
} from "@solana/spl-token";
import bs58 from "bs58";
import { connection } from "../common/connection";
import {
  CPMM_ID,
  RAYDIUM_AUTHORITY,
  SWAP_BASE_INPUT_DISCRIMINATOR,
} from "./constants";

export interface CreateSwapBaseInputIX {
  pool: CpmmPool;
  payer: PublicKey;
  userInputTokenAccount: PublicKey;
  userOutputTokenAccount: PublicKey;
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
  }: CreateSwapBaseInputIX): Promise<TransactionInstruction> => {
    const keys: AccountMeta[] = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: RAYDIUM_AUTHORITY, isSigner: false, isWritable: true },
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

  async buyTx({ mint, privateKey, amount_in }: BuyData): Promise<VersionedTransaction> {
    const start = performance.now();
    const tokenMint = new PublicKey(mint);
    const owner = Keypair.fromSecretKey(bs58.decode(privateKey));
    const payer = owner.publicKey;
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
    
    // Create token account if it doesn't exist
    const createTokenAccountIx = createAssociatedTokenAccountIdempotentInstruction(
      payer,
      tokenAta,
      payer,
      tokenMint
    );
    
    const swapQuoteIx = await this.createBuyIx({
      pool,
      payer,
      userInputTokenAccount: wsolAta,
      userOutputTokenAccount: tokenAta,
      amount_in,
      minimum_amount_out: BigInt(0),
    });

    const closeWrappedSolIx = createCloseAccountInstruction(wsolAta, payer, payer, [], TOKEN_PROGRAM_ID);
    const instructions: TransactionInstruction[] = [
      priorityFeeIx,
      computeLimitIx,
      //   initAcctIx,
      wrapSolTransferIx,
      syncWrappedSolIx,
      createTokenAccountIx,
      swapQuoteIx,
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

  createSellIx = async ({
    pool,
    payer,
    userInputTokenAccount,
    userOutputTokenAccount,
    amount_in,
    minimum_amount_out,
  }: CreateSwapBaseInputIX): Promise<TransactionInstruction> => {
    const keys: AccountMeta[] = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: RAYDIUM_AUTHORITY, isSigner: false, isWritable: true },
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

  async sellTx({ mint, privateKey, amount_in }: BuyData): Promise<VersionedTransaction> {
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
    const sellIx = await this.createSellIx({
      pool,
      payer,
      userInputTokenAccount: tokenAta,
      userOutputTokenAccount: wsolAta,
      amount_in,
      minimum_amount_out: BigInt(0),
    });

    const closeWrappedSolIx = createCloseAccountInstruction(wsolAta, payer, payer, [], TOKEN_PROGRAM_ID);
    const instructions: TransactionInstruction[] = [
      priorityFeeIx,
      computeLimitIx,
      //   syncWrappedSolIx,
      sellIx,
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
} 