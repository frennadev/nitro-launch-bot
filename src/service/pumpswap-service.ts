import { getPdaPoolId, publicKey, SYSTEM_PROGRAM_ID } from "@raydium-io/raydium-sdk-v2";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  TokenInstruction,
} from "@solana/spl-token";
import { LAMPORTS_PER_SOL, TransactionInstruction } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { type AccountMeta } from "@solana/web3.js";
// import { getBuyAmountOut, getSellAmountOut, getTokenPoolInfo } from
import { Keypair } from "@solana/web3.js";
import base58 from "bs58";
import { TransactionMessage } from "@solana/web3.js";
import { VersionedTransaction } from "@solana/web3.js";
import { ComputeBudgetProgram } from "@solana/web3.js";
import { SystemProgram } from "@solana/web3.js";
import { struct, u8 } from "@solana/buffer-layout";
import { Signer } from "@solana/web3.js";
import { getBuyAmountOut, getSellAmountOut, getTokenPoolInfo } from "../backend/get-poolInfo";
import { connection } from "./config";
import { getCreatorVaultAuthority } from "../backend/creator-authority";
// import { connection } from "../blockchain/common/connection";

interface CreateBuyIXParams {
  pool: PublicKey;
  user: PublicKey;
  base_mint: PublicKey;
  quote_mint: PublicKey;
  base_token_ata: PublicKey;
  quote_token_ata: PublicKey;
  pool_base_token_ata: PublicKey;
  pool_quote_token_ata: PublicKey;
  protocol_fee_ata: PublicKey;
  base_amount_out: bigint;
  max_quote_amount_in: bigint;
  coin_creator_vault_ata: PublicKey;
  coin_creator_vault_authority: PublicKey;
}

interface CreateSellIXParams {
  pool: PublicKey;
  user: PublicKey;
  base_mint: PublicKey;
  quote_mint: PublicKey;
  base_token_ata: PublicKey;
  quote_token_ata: PublicKey;
  pool_base_token_ata: PublicKey;
  pool_quote_token_ata: PublicKey;
  protocol_fee_ata: PublicKey;
  base_amount_in: bigint;
  min_quote_amount_out: bigint;
  coin_creator_vault_ata: PublicKey;
  coin_creator_vault_authority: PublicKey;
}

interface BuyData {
  mint: PublicKey;
  amount: bigint;
  privateKey: string;
}

interface SellData {
  mint: PublicKey;
  privateKey: string;
}
interface CloseAccountInstructionData {
  instruction: TokenInstruction.CloseAccount;
}

export const closeAccountInstructionData = struct<CloseAccountInstructionData>([u8("instruction")]);

const global_config = new PublicKey("ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw");
const pumpfun_amm_protocol_fee = new PublicKey("FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz");
const token_program_id = TOKEN_PROGRAM_ID;
const system_program_id = SYSTEM_PROGRAM_ID;
const associated_token_program_id = ASSOCIATED_TOKEN_PROGRAM_ID;
const coin_creator_vault_authority = new PublicKey("Ciid5pckEwdLw5juAtNiQSpmhHzsdcfCQs7h989SPR4T");
const event_authority = new PublicKey("GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR");
export const pumpswap_amm_program_id = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

const BUY_DISCRIMINATOR = [102, 6, 61, 18, 1, 218, 235, 234];
const SELL_DISCRIMINATOR = [51, 230, 133, 164, 1, 127, 131, 173];

export default class PumpswapService {
  createBuyIX = async ({
    pool,
    user,
    base_mint,
    quote_mint,
    base_token_ata,
    quote_token_ata,
    pool_base_token_ata,
    pool_quote_token_ata,
    protocol_fee_ata,
    base_amount_out,
    max_quote_amount_in,
    coin_creator_vault_ata,
    coin_creator_vault_authority,
  }: CreateBuyIXParams) => {
    const keys: AccountMeta[] = [
      { pubkey: pool, isSigner: false, isWritable: false },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: global_config, isSigner: false, isWritable: false },
      { pubkey: base_mint, isSigner: false, isWritable: false },
      { pubkey: quote_mint, isSigner: false, isWritable: false },
      { pubkey: base_token_ata, isSigner: false, isWritable: true },
      { pubkey: quote_token_ata, isSigner: false, isWritable: true },
      { pubkey: pool_base_token_ata, isSigner: false, isWritable: true },
      { pubkey: pool_quote_token_ata, isSigner: false, isWritable: true },
      { pubkey: pumpfun_amm_protocol_fee, isSigner: false, isWritable: false },
      { pubkey: protocol_fee_ata, isSigner: false, isWritable: true },
      { pubkey: token_program_id, isSigner: false, isWritable: false },
      { pubkey: token_program_id, isSigner: false, isWritable: false },
      { pubkey: system_program_id, isSigner: false, isWritable: false },
      {
        pubkey: associated_token_program_id,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: event_authority, isSigner: false, isWritable: false },
      { pubkey: pumpswap_amm_program_id, isSigner: false, isWritable: false },
      { pubkey: coin_creator_vault_ata, isSigner: false, isWritable: true },
      { pubkey: coin_creator_vault_authority, isSigner: false, isWritable: false },
    ];

    console.log(JSON.stringify(keys, null, 2));
    const data = Buffer.alloc(24);
    console.log({ base_amount_out, max_quote_amount_in });

    const discriminator = Buffer.from(BUY_DISCRIMINATOR);
    discriminator.copy(data, 0);
    data.writeBigUInt64LE(base_amount_out, 8);
    data.writeBigUInt64LE(max_quote_amount_in, 16);

    const buyIx = new TransactionInstruction({
      keys,
      programId: pumpswap_amm_program_id,
      data,
    });
    return buyIx;
  };

  buyTx = async (buyData: BuyData) => {
    console.log("buy pumpSwap started");
    const start = Date.now();
    const { mint, amount, privateKey } = buyData;
    const slippage = 5;
    const payer = Keypair.fromSecretKey(base58.decode(privateKey));
    console.log("CHecking 1 ...");

    const poolInfo = await getTokenPoolInfo(mint.toBase58());

    if (!poolInfo) {
      throw new Error("Pool not found");
    }

    const { poolId, baseMint, quoteMint, poolBaseTokenAccount, poolQuoteTokenAccount } = poolInfo;
    console.log("CHecking 2 ...");

    // Get associated token addresses without creating accounts (they will be created in transaction)
    const wsolAtaAddress = getAssociatedTokenAddressSync(NATIVE_MINT, payer.publicKey);
    const tokenAtaAddress = getAssociatedTokenAddressSync(mint, payer.publicKey);

    const quoteTokenAta = { address: wsolAtaAddress };
    const baseTokenAta = { address: tokenAtaAddress };
    console.log("CHecking 3 ...");
    const protocol_fee_ata = new PublicKey("7xQYoUjUJF1Kg6WVczoTAkaNhn5syQYcbvjmFrhjWpx");
    const amountOut = await getBuyAmountOut(poolInfo, amount, slippage);

    const creatorVaultAuthority = getCreatorVaultAuthority(new PublicKey(poolInfo.coinCreator));
    const creatorVaultAta = getAssociatedTokenAddressSync(poolInfo.quoteMint, creatorVaultAuthority, true);

    console.log({
      creatorVaultAuthority: creatorVaultAuthority.toBase58(),
      creatorVaultAta: creatorVaultAta.toBase58(),
    });

    const ixData: CreateBuyIXParams = {
      pool: poolId,
      user: payer.publicKey,
      base_mint: baseMint,
      quote_mint: quoteMint,
      base_token_ata: baseTokenAta.address,
      quote_token_ata: quoteTokenAta.address,
      pool_base_token_ata: poolBaseTokenAccount,
      pool_quote_token_ata: poolQuoteTokenAccount,
      protocol_fee_ata,
      max_quote_amount_in: amount,
      base_amount_out: amountOut,
      coin_creator_vault_ata: creatorVaultAta,
      coin_creator_vault_authority: creatorVaultAuthority,
    };

    const buyInstruction = await this.createBuyIX(ixData);
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 1_100_100,
    });

    const transferForWsol = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: quoteTokenAta.address,
      lamports: amount,
    });

    const createTokenAccountWsol = buildAssociatedTokenAccountInstruction(
      payer.publicKey,
      quoteTokenAta.address,
      payer.publicKey,
      NATIVE_MINT,
      Buffer.from([1])
    );

    const createTokenAccountBase = createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      baseTokenAta.address,
      payer.publicKey,
      mint
    );

    const syncNativeInstruction = createSyncNativeInstruction(quoteTokenAta.address);

    const instructions = [
      addPriorityFee,
      createTokenAccountBase,
      createTokenAccountWsol,
      transferForWsol,
      syncNativeInstruction,
      buyInstruction,
    ];

    const { blockhash } = await connection.getLatestBlockhash("finalized");
    const messageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);
    tx.sign([payer]);

    console.log("createSwapIx total time:", `${Date.now() - start}ms`);

    return tx;
  };

  createSellIX = async ({
    pool,
    user,
    base_mint,
    quote_mint,
    base_token_ata,
    quote_token_ata,
    pool_base_token_ata,
    pool_quote_token_ata,
    protocol_fee_ata,
    base_amount_in,
    min_quote_amount_out,
    coin_creator_vault_ata,
    coin_creator_vault_authority,
  }: CreateSellIXParams) => {
    const keys: AccountMeta[] = [
      { pubkey: pool, isSigner: false, isWritable: false },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: global_config, isSigner: false, isWritable: false },
      { pubkey: base_mint, isSigner: false, isWritable: false },
      { pubkey: quote_mint, isSigner: false, isWritable: false },
      { pubkey: base_token_ata, isSigner: false, isWritable: true },
      { pubkey: quote_token_ata, isSigner: false, isWritable: true },
      { pubkey: pool_base_token_ata, isSigner: false, isWritable: true },
      { pubkey: pool_quote_token_ata, isSigner: false, isWritable: true },
      { pubkey: pumpfun_amm_protocol_fee, isSigner: false, isWritable: false },
      { pubkey: protocol_fee_ata, isSigner: false, isWritable: true },
      { pubkey: token_program_id, isSigner: false, isWritable: false },
      { pubkey: token_program_id, isSigner: false, isWritable: false },
      { pubkey: system_program_id, isSigner: false, isWritable: false },
      {
        pubkey: associated_token_program_id,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: event_authority, isSigner: false, isWritable: false },
      { pubkey: pumpswap_amm_program_id, isSigner: false, isWritable: false },
      { pubkey: coin_creator_vault_ata, isSigner: false, isWritable: true },
      { pubkey: coin_creator_vault_authority, isSigner: false, isWritable: false },
    ];

    const data = Buffer.alloc(24);

    const discriminator = Buffer.from(SELL_DISCRIMINATOR);
    discriminator.copy(data, 0);
    data.writeBigUInt64LE(base_amount_in, 8);
    data.writeBigUInt64LE(min_quote_amount_out, 16);

    const sellIx = new TransactionInstruction({
      keys,
      programId: pumpswap_amm_program_id,
      data,
    });
    return sellIx;
  };

  sellTx = async (sellData: SellData) => {
    const { mint, privateKey } = sellData;
    const slippage = 5;
    const payer = Keypair.fromSecretKey(base58.decode(privateKey));

    const poolInfo = await getTokenPoolInfo(mint.toBase58());
    if (!poolInfo) {
      throw new Error("Pool not found");
    }
    const { poolId, baseMint, quoteMint, poolBaseTokenAccount, poolQuoteTokenAccount } = poolInfo;

    // Get associated token addresses without creating accounts (they will be created in transaction if needed)
    const wsolAtaAddress = getAssociatedTokenAddressSync(NATIVE_MINT, payer.publicKey);
    const tokenAtaAddress = getAssociatedTokenAddressSync(mint, payer.publicKey);

    const quoteTokenAta = { address: wsolAtaAddress };
    const baseTokenAta = { address: tokenAtaAddress };
    const protocol_fee_ata = new PublicKey("7xQYoUjUJF1Kg6WVczoTAkaNhn5syQYcbvjmFrhjWpx");
    const userBaseTokenBalanceInfo = await connection.getTokenAccountBalance(baseTokenAta.address);
    const amount = BigInt(userBaseTokenBalanceInfo.value.amount || 0);
    console.log(amount, "amount");

    if (amount === BigInt(0)) {
      throw new Error("No tokens to sell");
    }

    const minQuoteOut = await getSellAmountOut(poolInfo, amount, slippage);
    const creatorVaultAuthority = getCreatorVaultAuthority(new PublicKey(poolInfo.coinCreator));
    const creatorVaultAta = getAssociatedTokenAddressSync(poolInfo.quoteMint, creatorVaultAuthority, true);

    const ixData: CreateSellIXParams = {
      pool: poolId,
      user: payer.publicKey,
      base_mint: baseMint,
      quote_mint: quoteMint,
      base_token_ata: baseTokenAta.address,
      quote_token_ata: quoteTokenAta.address,
      pool_base_token_ata: poolBaseTokenAccount,
      pool_quote_token_ata: poolQuoteTokenAccount,
      protocol_fee_ata,
      base_amount_in: amount,
      min_quote_amount_out: minQuoteOut,
      coin_creator_vault_ata: creatorVaultAta,
      coin_creator_vault_authority: creatorVaultAuthority,
    };

    console.log("LLLLLLLL");

    const sellInstruction = await this.createSellIX(ixData);

    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 1_100_100,
    });

    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 151591,
    });

    const tokenAccountInstruction = createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      quoteTokenAta.address,
      payer.publicKey,
      NATIVE_MINT
    );

    console.log("MMMMMMMM");

    // Close account instruction to close WSOL account and get SOL back
    const closeAccount = createCloseAccountInstruction(quoteTokenAta.address, payer.publicKey, payer.publicKey);

    console.log("KKKKKKK");

    const instructions = [modifyComputeUnits, addPriorityFee, tokenAccountInstruction, sellInstruction, closeAccount];

    console.log("OOOOOOOOO");

    const { blockhash } = await connection.getLatestBlockhash("finalized");
    const messageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    console.log("11111111111");

    const tx = new VersionedTransaction(messageV0);
    tx.sign([payer]);

    return tx;
  };
}

function buildAssociatedTokenAccountInstruction(
  payer: PublicKey,
  associatedToken: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  instructionData: Buffer,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID
): TransactionInstruction {
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: associatedToken, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: false, isWritable: false },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    keys,
    programId: associatedTokenProgramId,
    data: instructionData,
  });
}

export interface SyncNativeInstructionData {
  instruction: TokenInstruction.SyncNative;
}
export const syncNativeInstructionData = struct<SyncNativeInstructionData>([u8("instruction")]);
export function createSyncNativeInstruction(account: PublicKey, programId = TOKEN_PROGRAM_ID): TransactionInstruction {
  const keys = [{ pubkey: account, isSigner: false, isWritable: true }];

  const data = Buffer.alloc(syncNativeInstructionData.span);
  syncNativeInstructionData.encode({ instruction: TokenInstruction.SyncNative }, data);

  return new TransactionInstruction({ keys, programId, data });
}

export function createAssociatedTokenAccountIdempotentInstruction(
  payer: PublicKey,
  associatedToken: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID
): TransactionInstruction {
  return buildAssociatedTokenAccountInstruction(
    payer,
    associatedToken,
    owner,
    mint,
    Buffer.from([1]),
    programId,
    associatedTokenProgramId
  );
}

export function createCloseAccountInstruction(
  account: PublicKey,
  destination: PublicKey,
  authority: PublicKey,
  multiSigners: (Signer | PublicKey)[] = [],
  programId = TOKEN_PROGRAM_ID
): TransactionInstruction {
  const keys = addSigners(
    [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
    ],
    authority,
    multiSigners
  );

  const data = Buffer.alloc(closeAccountInstructionData.span);
  closeAccountInstructionData.encode({ instruction: TokenInstruction.CloseAccount }, data);

  return new TransactionInstruction({ keys, programId, data });
}

function addSigners(
  keys: AccountMeta[],
  ownerOrAuthority: PublicKey,
  multiSigners: (Signer | PublicKey)[]
): AccountMeta[] {
  if (multiSigners.length) {
    keys.push({ pubkey: ownerOrAuthority, isSigner: false, isWritable: false });
    for (const signer of multiSigners) {
      keys.push({
        pubkey: signer instanceof PublicKey ? signer : signer.publicKey,
        isSigner: true,
        isWritable: false,
      });
    }
  } else {
    keys.push({ pubkey: ownerOrAuthority, isSigner: true, isWritable: false });
  }
  return keys;
}
