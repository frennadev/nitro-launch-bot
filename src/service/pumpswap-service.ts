import { SYSTEM_PROGRAM_ID } from "@raydium-io/raydium-sdk-v2";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  TokenInstruction,
} from "@solana/spl-token";
import { TransactionInstruction } from "@solana/web3.js";
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
import {
  getBuyAmountOut,
  getSellAmountOut,
  getTokenPoolInfo,
} from "../backend/get-poolInfo";

import { connection } from "../blockchain/common/connection";
import { getCreatorVaultAuthority } from "../backend/creator-authority";
// Inline helper functions since they don't exist in the current codebase
// import { getBuyAmountOut, getSellAmountOut, getTokenPoolInfo } from "../lib/get-poolInfo";
// import { connection } from "../config";
// import { getBondingCurve, getBondingCurveData, getCreatorVaultAuthority } from "../lib/solana-lib";
// import { getCreatorVault } from "../lib/creator-vault";
// // import { connection } from "../blockchain/common/connection";

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
  poolInfo: { coinCreator: PublicKey }; // Add poolInfo to get coin_creator for correct vault authority derivation
  // 🚀 SELL: 21 accounts needed (includes fee accounts but no volume accumulators)
}

interface BuyData {
  mint: PublicKey;
  amount: bigint;
  privateKey: string;
  // 🚀 NEW: Nitro integration parameters
  slippage?: number; // User's slippage percentage
  priorityFee?: number; // User's priority fee in microLamports
}

interface SellData {
  mint: PublicKey;
  privateKey: string;
  amount?: number; // Optional: specific amount to sell. If not provided, sells all
  slippage?: number; // 🚀 NITRO: User-configurable slippage
  priorityFee?: number; // 🚀 NITRO: User-configurable priority fee in microLamports
}
interface CloseAccountInstructionData {
  instruction: TokenInstruction.CloseAccount;
}

export const closeAccountInstructionData = struct<CloseAccountInstructionData>([
  u8("instruction"),
]);

// 🎯 UPDATED PUMPSWAP CONSTANTS: Based on successful transaction analysis
const global_config = new PublicKey(
  "ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw"
);
const pumpfun_amm_protocol_fee = new PublicKey(
  "FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz"
);
const token_program_id = TOKEN_PROGRAM_ID;
const system_program_id = SYSTEM_PROGRAM_ID;
const associated_token_program_id = ASSOCIATED_TOKEN_PROGRAM_ID;
const event_authority = new PublicKey(
  "GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR"
);
export const pumpswap_amm_program_id = new PublicKey(
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"
);
export const WSOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112"
);

// 🚀 CORRECT PUMPSWAP WRAPPER PROGRAM (from successful transaction 51ibXT8wzK...)
const pump_fees_program = new PublicKey(
  "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"
);

const BUY_DISCRIMINATOR = [102, 6, 61, 18, 1, 218, 235, 234];
const SELL_DISCRIMINATOR = [51, 230, 133, 164, 1, 127, 131, 173];

// Helper function for preparing ATA instruction (simplified version)
async function prepAtaInstruction(
  payer: Keypair,
  owner: PublicKey,
  mint: PublicKey
) {
  const ata = getAssociatedTokenAddressSync(mint, owner);

  try {
    const account = await connection.getAccountInfo(ata);
    if (account) {
      return { ata, ix: null };
    }
  } catch {
    // Account doesn't exist, need to create it
  }

  const ix = createAssociatedTokenAccountInstruction(
    payer.publicKey,
    ata,
    owner,
    mint
  );

  return { ata, ix };
}

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
    console.log(
      "🚀 Generating PumpSwap BUY transaction with AMM program (matching successful transaction)"
    );

    // 🎯 DERIVE REQUIRED PDAs based on official AMM schema
    const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_volume_accumulator")],
      pumpswap_amm_program_id
    );

    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_volume_accumulator"), user.toBuffer()],
      pumpswap_amm_program_id
    );

    const [feeConfig] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("fee_config"),
        Buffer.from([
          12, 20, 222, 252, 130, 94, 198, 118, 148, 37, 8, 24, 187, 101, 64,
          101, 244, 41, 141, 49, 86, 213, 113, 180, 212, 248, 9, 12, 24, 233,
          168, 99,
        ]),
      ],
      pump_fees_program
    );

    // 🎯 OFFICIAL AMM SCHEMA: EXACT 23-account structure from pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA!
    const ammKeys: AccountMeta[] = [
      { pubkey: pool, isSigner: false, isWritable: false }, // [0] pool
      { pubkey: user, isSigner: true, isWritable: true }, // [1] user (signer)
      { pubkey: global_config, isSigner: false, isWritable: false }, // [2] global_config
      { pubkey: base_mint, isSigner: false, isWritable: false }, // [3] base_mint
      { pubkey: quote_mint, isSigner: false, isWritable: false }, // [4] quote_mint
      { pubkey: base_token_ata, isSigner: false, isWritable: true }, // [5] user_base_token_account
      { pubkey: quote_token_ata, isSigner: false, isWritable: true }, // [6] user_quote_token_account
      { pubkey: pool_base_token_ata, isSigner: false, isWritable: true }, // [7] pool_base_token_account
      { pubkey: pool_quote_token_ata, isSigner: false, isWritable: true }, // [8] pool_quote_token_account
      { pubkey: pumpfun_amm_protocol_fee, isSigner: false, isWritable: false }, // [9] protocol_fee_recipient
      { pubkey: protocol_fee_ata, isSigner: false, isWritable: true }, // [10] protocol_fee_recipient_token_account
      { pubkey: token_program_id, isSigner: false, isWritable: false }, // [11] base_token_program
      { pubkey: token_program_id, isSigner: false, isWritable: false }, // [12] quote_token_program
      { pubkey: system_program_id, isSigner: false, isWritable: false }, // [13] system_program
      {
        pubkey: associated_token_program_id,
        isSigner: false,
        isWritable: false,
      }, // [14] associated_token_program
      { pubkey: event_authority, isSigner: false, isWritable: false }, // [15] event_authority
      { pubkey: pumpswap_amm_program_id, isSigner: false, isWritable: false }, // [16] program
      { pubkey: coin_creator_vault_ata, isSigner: false, isWritable: true }, // [17] coin_creator_vault_ata
      {
        pubkey: coin_creator_vault_authority,
        isSigner: false,
        isWritable: false,
      }, // [18] coin_creator_vault_authority
      { pubkey: globalVolumeAccumulator, isSigner: false, isWritable: true }, // [19] global_volume_accumulator
      { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true }, // [20] user_volume_accumulator
      { pubkey: feeConfig, isSigner: false, isWritable: false }, // [21] fee_config (PDA derived correctly)
      { pubkey: pump_fees_program, isSigner: false, isWritable: false }, // [22] fee_program
    ];

    // 🎯 Use AMM instruction format (24 bytes: 8-byte discriminator + 16 bytes parameters)
    const buyData = Buffer.alloc(24); // 24 bytes for AMM (8 discriminator + 16 parameters)
    buyData.set(BUY_DISCRIMINATOR, 0); // AMM buy discriminator (8 bytes)
    buyData.writeBigUInt64LE(base_amount_out, 8); // base_amount_out at offset 8
    buyData.writeBigUInt64LE(max_quote_amount_in, 16); // max_quote_amount_in at offset 16
    // Note: track_volume (OptionBool) defaults to None, so no additional bytes needed

    console.log(
      `🎯 OFFICIAL SCHEMA: 23-account structure with correct PDA derivations!`
    );
    console.log(
      `📊 AMM data: ${buyData.toString("hex")} (${buyData.length} bytes)`
    );
    console.log(
      `📊 Accounts: ${ammKeys.length} total (Official AMM schema with all PDAs!)`
    );

    const buyIx = new TransactionInstruction({
      keys: ammKeys,
      programId: pumpswap_amm_program_id, // pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA
      data: buyData,
    });

    return buyIx;
  };

  buyTx = async (buyData: BuyData) => {
    console.log("🚀 PumpSwap BUY started with official AMM schema");
    const start = Date.now();
    const {
      mint,
      amount,
      privateKey,
      slippage = 5,
      priorityFee = 5_000_000,
    } = buyData;

    console.log(
      `🎯 Nitro integration: slippage=${slippage}%, priorityFee=${priorityFee} microLamports`
    );
    const payer = Keypair.fromSecretKey(base58.decode(privateKey));

    const poolInfo = await getTokenPoolInfo(mint.toBase58());

    if (!poolInfo) {
      throw new Error("Pool not found");
    }

    const {
      poolId,
      baseMint,
      quoteMint,
      poolBaseTokenAccount,
      poolQuoteTokenAccount,
    } = poolInfo;

    // const wsolAta = await getOrCreateAssociatedTokenAccount(connection, payer, NATIVE_MINT, payer.publicKey);
    // const tokenAta = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey);

    const { ata: wsolAta, ix: createWsolIx } = await prepAtaInstruction(
      payer,
      payer.publicKey,
      NATIVE_MINT
    );
    const { ata: tokenAta, ix: createtokenAtaIx } = await prepAtaInstruction(
      payer,
      payer.publicKey,
      mint
    );

    const quoteTokenAta = wsolAta;
    const baseTokenAta = tokenAta;

    const protocol_fee_ata = new PublicKey(
      "7xQYoUjUJF1Kg6WVczoTAkaNhn5syQYcbvjmFrhjWpx"
    );
    const amountOut = await getBuyAmountOut(poolInfo, amount, slippage);

    const creatorVaultAuthority = getCreatorVaultAuthority(
      new PublicKey(poolInfo.coinCreator)
    );
    const creatorVaultAta = getAssociatedTokenAddressSync(
      poolInfo.quoteMint,
      creatorVaultAuthority,
      true
    );

    console.log({
      creatorVaultAuthority: creatorVaultAuthority.toBase58(),
      creatorVaultAta: creatorVaultAta.toBase58(),
    });

    const ixData: CreateBuyIXParams = {
      pool: poolId,
      user: payer.publicKey,
      base_mint: baseMint,
      quote_mint: quoteMint,
      base_token_ata: baseTokenAta,
      quote_token_ata: quoteTokenAta,
      pool_base_token_ata: poolBaseTokenAccount,
      pool_quote_token_ata: poolQuoteTokenAccount,
      protocol_fee_ata,
      max_quote_amount_in: amount,
      base_amount_out: amountOut,
      coin_creator_vault_ata: creatorVaultAta,
      coin_creator_vault_authority: creatorVaultAuthority,
    };

    const buyInstruction = await this.createBuyIX(ixData);

    // 🎯 NITRO INTEGRATION: Use user's priority fee settings
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: priorityFee, // Use Nitro's priority fee
    });

    // 🎯 NEW: Update compute unit limit to match successful transaction
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 200_000, // Successful transaction uses 200,000 (not 151,591)
    });

    console.log(
      `🎯 Using Nitro settings: ${priorityFee} microLamports, 200K compute units`
    );

    const transferForWsol = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: quoteTokenAta,
      lamports: amount,
    });

    const createTokenAccountWsol = buildAssociatedTokenAccountInstruction(
      payer.publicKey,
      quoteTokenAta,
      payer.publicKey,
      NATIVE_MINT,
      Buffer.from([1])
    );

    const syncNativeInstruction = createSyncNativeInstruction(quoteTokenAta);

    const instructions = [
      modifyComputeUnits, // 🚀 NEW: Add compute unit limit first
      addPriorityFee,
      ...(createWsolIx ? [createWsolIx] : []),
      ...(createtokenAtaIx ? [createtokenAtaIx] : []),
      createTokenAccountWsol,
      transferForWsol,
      syncNativeInstruction,
      buyInstruction, // 🎯 Now uses wrapper program with fee accounts
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
    poolInfo, // Add poolInfo to get coin_creator
  }: CreateSellIXParams) => {
    // 🎯 FIXED: PumpSwap sell needs event_authority and other accounts like the buy instruction
    // The error shows AccountNotEnoughKeys for event_authority - need to match buy structure

    // 🎯 CRITICAL FIX: Use pool.coin_creator (not base_mint) for creator vault authority
    const creatorVaultAuthority = getCreatorVaultAuthority(
      new PublicKey(poolInfo.coinCreator)
    );
    const creatorVaultAta = getAssociatedTokenAddressSync(
      quote_mint,
      creatorVaultAuthority,
      true
    );

    // 🎯 DERIVE REQUIRED PDAs for sell (same as buy but no volume accumulators)
    const [feeConfig] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("fee_config"),
        Buffer.from([
          12, 20, 222, 252, 130, 94, 198, 118, 148, 37, 8, 24, 187, 101, 64,
          101, 244, 41, 141, 49, 86, 213, 113, 180, 212, 248, 9, 12, 24, 233,
          168, 99,
        ]),
      ],
      pump_fees_program
    );

    // 🎯 OFFICIAL SELL SCHEMA: EXACT 21-account structure from pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA!
    const ammKeys: AccountMeta[] = [
      { pubkey: pool, isSigner: false, isWritable: false }, // [0] pool (NOT writable in sell)
      { pubkey: user, isSigner: true, isWritable: true }, // [1] user (signer)
      { pubkey: global_config, isSigner: false, isWritable: false }, // [2] global_config
      { pubkey: base_mint, isSigner: false, isWritable: false }, // [3] base_mint
      { pubkey: quote_mint, isSigner: false, isWritable: false }, // [4] quote_mint
      { pubkey: base_token_ata, isSigner: false, isWritable: true }, // [5] user_base_token_account
      { pubkey: quote_token_ata, isSigner: false, isWritable: true }, // [6] user_quote_token_account
      { pubkey: pool_base_token_ata, isSigner: false, isWritable: true }, // [7] pool_base_token_account
      { pubkey: pool_quote_token_ata, isSigner: false, isWritable: true }, // [8] pool_quote_token_account
      { pubkey: pumpfun_amm_protocol_fee, isSigner: false, isWritable: false }, // [9] protocol_fee_recipient
      { pubkey: protocol_fee_ata, isSigner: false, isWritable: true }, // [10] protocol_fee_recipient_token_account
      { pubkey: token_program_id, isSigner: false, isWritable: false }, // [11] base_token_program
      { pubkey: token_program_id, isSigner: false, isWritable: false }, // [12] quote_token_program
      { pubkey: system_program_id, isSigner: false, isWritable: false }, // [13] system_program
      {
        pubkey: associated_token_program_id,
        isSigner: false,
        isWritable: false,
      }, // [14] associated_token_program
      { pubkey: event_authority, isSigner: false, isWritable: false }, // [15] event_authority
      { pubkey: pumpswap_amm_program_id, isSigner: false, isWritable: false }, // [16] program
      { pubkey: creatorVaultAta, isSigner: false, isWritable: true }, // [17] coin_creator_vault_ata
      { pubkey: creatorVaultAuthority, isSigner: false, isWritable: false }, // [18] coin_creator_vault_authority
      { pubkey: feeConfig, isSigner: false, isWritable: false }, // [19] fee_config (PDA derived correctly)
      { pubkey: pump_fees_program, isSigner: false, isWritable: false }, // [20] fee_program
    ];

    // 🎯 FIXED: Use AMM program format for sells (matching successful transaction)
    // Successful sell uses AMM program with SELL_DISCRIMINATOR format
    const sellData = Buffer.alloc(24); // 24 bytes for sell (8 discriminator + 16 parameters)
    const discriminator = Buffer.from(SELL_DISCRIMINATOR);
    discriminator.copy(sellData, 0);
    sellData.writeBigUInt64LE(base_amount_in, 8); // base_amount_in at offset 8
    sellData.writeBigUInt64LE(min_quote_amount_out, 16); // min_quote_amount_out at offset 16

    console.log(
      `🚀 Generating PumpSwap SELL transaction with OFFICIAL AMM schema (21 accounts)`
    );
    console.log(
      `🎯 OFFICIAL SELL SCHEMA: 21-account structure with correct PDA derivations!`
    );
    console.log(
      `📊 AMM data: ${sellData.toString("hex")} (${sellData.length} bytes)`
    );
    console.log(
      `📊 Accounts: ${ammKeys.length} total (Official AMM sell schema!)`
    );

    const sellIx = new TransactionInstruction({
      keys: ammKeys,
      programId: pumpswap_amm_program_id, // 🚀 AMM: Use AMM program directly (official schema)
      data: sellData,
    });
    return sellIx;
  };

  sellTx = async (sellData: SellData) => {
    const {
      mint,
      privateKey,
      amount: specifiedAmount, // Optional amount to sell
      slippage = 5,
      priorityFee = 1_100_100,
    } = sellData;
    console.log(`🚀 PumpSwap SELL started with official AMM schema`);
    console.log(
      `🎯 Nitro integration: slippage=${slippage}%, priorityFee=${priorityFee} microLamports`
    );
    const payer = Keypair.fromSecretKey(base58.decode(privateKey));

    const poolInfo = await getTokenPoolInfo(mint.toBase58());
    if (!poolInfo) {
      throw new Error("Pool not found");
    }
    const {
      poolId,
      baseMint,
      quoteMint,
      poolBaseTokenAccount,
      poolQuoteTokenAccount,
    } = poolInfo;

    const wsolAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      NATIVE_MINT,
      payer.publicKey
    );
    const tokenAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      payer.publicKey
    );

    const quoteTokenAta = wsolAta;
    const baseTokenAta = tokenAta;
    const protocol_fee_ata = new PublicKey(
      "7xQYoUjUJF1Kg6WVczoTAkaNhn5syQYcbvjmFrhjWpx"
    );
    const userBaseTokenBalanceInfo = await connection.getTokenAccountBalance(
      baseTokenAta.address
    );
    const totalBalance = BigInt(userBaseTokenBalanceInfo.value.amount || 0);

    if (totalBalance === BigInt(0)) {
      throw new Error("No tokens to sell");
    }

    // Use specified amount if provided, otherwise sell all
    const amount = specifiedAmount ? BigInt(specifiedAmount) : totalBalance;

    // Ensure we don't try to sell more than we have
    const amountToSell = amount > totalBalance ? totalBalance : amount;

    console.log(
      `🎯 Selling ${amountToSell} tokens out of ${totalBalance} total balance`
    );

    if (amountToSell === BigInt(0)) {
      throw new Error("Amount to sell is zero");
    }

    if (amountToSell === BigInt(0)) {
      throw new Error("Amount to sell is zero");
    }

    const minQuoteOut = await getSellAmountOut(
      poolInfo,
      amountToSell,
      slippage
    );
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
      base_amount_in: amountToSell,
      min_quote_amount_out: minQuoteOut,
      poolInfo, // 🎯 CRITICAL: Add poolInfo for correct creator vault authority derivation
      // 🚀 SELL: 21 accounts needed (includes fee accounts but no volume accumulators)
    };

    const sellInstruction = await this.createSellIX(ixData);

    // 🎯 NITRO INTEGRATION: Use user's priority fee settings
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: priorityFee, // Use Nitro's priority fee
    });

    // 🎯 NEW: Update compute unit limit to match successful transaction
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 200_000, // Successful transaction uses 200,000 (not 151,591)
    });

    console.log(
      `🎯 Using Nitro settings: ${priorityFee} microLamports, 200K compute units`
    );

    const tokenAccountInstruction =
      createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey,
        quoteTokenAta.address,
        payer.publicKey,
        NATIVE_MINT
      );

    // console.log({ quoteTokenAta })

    const closeAccount = createCloseAccountInstruction(
      quoteTokenAta.address,
      payer.publicKey,
      payer.publicKey
    );

    const instructions = [
      modifyComputeUnits,
      addPriorityFee,
      tokenAccountInstruction,
      sellInstruction,
      closeAccount,
    ];

    const { blockhash } = await connection.getLatestBlockhash("finalized");
    const messageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);
    tx.sign([payer]);

    return tx;
  };

  // 🚀 NEW: Add buyWithFeeCollection method for compatibility with existing services
  buyWithFeeCollection = async (buyData: BuyData) => {
    try {
      const tx = await this.buyTx(buyData);
      const signature = await connection.sendTransaction(tx, {
        maxRetries: 3,
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });

      // Confirm transaction
      const latestBlockhash = await connection.getLatestBlockhash("confirmed");
      const confirmation = await connection.confirmTransaction({
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        signature: signature,
      });

      if (confirmation.value.err) {
        throw new Error(
          `Transaction failed: ${JSON.stringify(confirmation.value.err)}`
        );
      }

      return {
        success: true,
        signature,
      };
    } catch (error) {
      console.error("PumpSwap buy with fee collection failed:", error);

      // Check if this is the graduated token error (6005)
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes("6005") ||
        errorMessage.includes("BondingCurveComplete")
      ) {
        throw new Error("BONDING_CURVE_COMPLETE"); // Special error code for fallback
      }

      throw error;
    }
  };

  // 🚀 NEW: Add sellWithFeeCollection method for compatibility with existing services
  sellWithFeeCollection = async (sellData: SellData) => {
    try {
      const tx = await this.sellTx(sellData);
      const signature = await connection.sendTransaction(tx, {
        maxRetries: 3,
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });

      // Confirm transaction
      const latestBlockhash = await connection.getLatestBlockhash("confirmed");
      const confirmation = await connection.confirmTransaction({
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        signature: signature,
      });

      if (confirmation.value.err) {
        throw new Error(
          `Transaction failed: ${JSON.stringify(confirmation.value.err)}`
        );
      }

      return {
        success: true,
        signature,
      };
    } catch (error) {
      console.error("PumpSwap sell with fee collection failed:", error);

      // Check if this is the graduated token error (6005)
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes("6005") ||
        errorMessage.includes("BondingCurveComplete")
      ) {
        throw new Error("BONDING_CURVE_COMPLETE"); // Special error code for fallback
      }

      throw error;
    }
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
export const syncNativeInstructionData = struct<SyncNativeInstructionData>([
  u8("instruction"),
]);
export function createSyncNativeInstruction(
  account: PublicKey,
  programId = TOKEN_PROGRAM_ID
): TransactionInstruction {
  const keys = [{ pubkey: account, isSigner: false, isWritable: true }];

  const data = Buffer.alloc(syncNativeInstructionData.span);
  syncNativeInstructionData.encode(
    { instruction: TokenInstruction.SyncNative },
    data
  );

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
  closeAccountInstructionData.encode(
    { instruction: TokenInstruction.CloseAccount },
    data
  );

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
