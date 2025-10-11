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
import { getBuyAmountOut, getSellAmountOut, getTokenPoolInfo } from "../backend/get-poolInfo.ts";
import type { PoolInfo } from "../backend/get-poolInfo.ts";
import { connection } from "./config.ts";
import { getCreatorVaultAuthority } from "../backend/creator-authority.ts";
// import { connection } from "../blockchain/common/connection";
import { createMaestroFeeInstruction } from "../utils/maestro-fee";

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
  amount?: bigint;
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
const fee_program = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
export const pumpswap_amm_program_id = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

const BUY_DISCRIMINATOR = [102, 6, 61, 18, 1, 218, 235, 234];
const SELL_DISCRIMINATOR = [51, 230, 133, 164, 1, 127, 131, 173];

// Fee config PDA derivation based on the new pumpswap schema
const FEE_CONFIG_SEED = "fee_config";
const FEE_CONFIG_CONSTANT = new Uint8Array([
  12, 20, 222, 252, 130, 94, 198, 118, 148, 37, 8, 24, 187, 101, 64, 101,
  244, 41, 141, 49, 86, 213, 113, 180, 212, 248, 9, 12, 24, 233, 168, 99
]);

function getFeeConfigPDA(): PublicKey {
  const [feeConfigPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(FEE_CONFIG_SEED, "utf8"),
      Buffer.from(FEE_CONFIG_CONSTANT)
    ],
    fee_program
  );
  return feeConfigPDA;
}

// Volume accumulator PDA derivations for buy instruction
function getGlobalVolumeAccumulatorPDA(): PublicKey {
  const [globalVolumeAccumulatorPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_volume_accumulator", "utf8")],
    pumpswap_amm_program_id
  );
  return globalVolumeAccumulatorPDA;
}

function getUserVolumeAccumulatorPDA(user: PublicKey): PublicKey {
  const [userVolumeAccumulatorPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("user_volume_accumulator", "utf8"),
      user.toBuffer()
    ],
    pumpswap_amm_program_id
  );
  return userVolumeAccumulatorPDA;
}

// New caching interfaces and types
interface CachedPoolData {
  poolInfo: PoolInfo;
  lastUpdated: number;
  reserveBalances?: {
    baseBalance: bigint;
    quoteBalance: bigint;
    timestamp: number;
  };
}

interface PreparedTransactionData {
  poolInfo: PoolInfo;
  associatedTokenAccounts: {
    wsolAta: PublicKey;
    tokenAta: PublicKey;
  };
  creatorVault: {
    authority: PublicKey;
    ata: PublicKey;
  };
  protocolFeeAta: PublicKey;
  mintPublicKey: PublicKey; // Store the exact PublicKey object used for ATA derivation
}

class PumpswapCache {
  private static instance: PumpswapCache;
  private poolCache = new Map<string, CachedPoolData>();
  private preparedDataCache = new Map<string, PreparedTransactionData>();
  private preloadingPromises = new Map<string, Promise<void>>(); // Track ongoing preloads

  // Cache TTL configurations
  private readonly POOL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes for pool data
  private readonly RESERVE_CACHE_TTL = 30 * 1000; // 30 seconds for reserve balances
  private readonly PREPARED_DATA_TTL = 10 * 60 * 1000; // 10 minutes for prepared transaction data

  static getInstance(): PumpswapCache {
    if (!PumpswapCache.instance) {
      PumpswapCache.instance = new PumpswapCache();
    }
    return PumpswapCache.instance;
  }

  // Cache pool information with automatic TTL management
  setPoolInfo(tokenMint: string, poolInfo: PoolInfo): void {
    this.poolCache.set(tokenMint, {
      poolInfo,
      lastUpdated: Date.now(),
    });
    console.log(`[PumpswapCache] Cached pool info for ${tokenMint}`);
  }

  // Get cached pool info with TTL check
  getPoolInfo(tokenMint: string): PoolInfo | null {
    const cached = this.poolCache.get(tokenMint);
    if (!cached) return null;

    const isExpired = Date.now() - cached.lastUpdated > this.POOL_CACHE_TTL;
    if (isExpired) {
      this.poolCache.delete(tokenMint);
      console.log(`[PumpswapCache] Pool cache expired for ${tokenMint}`);
      return null;
    }

    console.log(`[PumpswapCache] Using cached pool info for ${tokenMint}`);
    return cached.poolInfo;
  }

  // Cache reserve balances for pricing calculations
  setReserveBalances(tokenMint: string, baseBalance: bigint, quoteBalance: bigint): void {
    const cached = this.poolCache.get(tokenMint);
    if (cached) {
      cached.reserveBalances = {
        baseBalance,
        quoteBalance,
        timestamp: Date.now(),
      };
      console.log(`[PumpswapCache] Cached reserve balances for ${tokenMint}`);
    }
  }

  // Get cached reserve balances with TTL check
  getReserveBalances(tokenMint: string): { baseBalance: bigint; quoteBalance: bigint } | null {
    const cached = this.poolCache.get(tokenMint);
    if (!cached?.reserveBalances) return null;

    const isExpired = Date.now() - cached.reserveBalances.timestamp > this.RESERVE_CACHE_TTL;
    if (isExpired) {
      cached.reserveBalances = undefined;
      console.log(`[PumpswapCache] Reserve cache expired for ${tokenMint}`);
      return null;
    }

    console.log(`[PumpswapCache] Using cached reserve balances for ${tokenMint}`);
    return {
      baseBalance: cached.reserveBalances.baseBalance,
      quoteBalance: cached.reserveBalances.quoteBalance,
    };
  }

  // Cache prepared transaction data (addresses, accounts, etc.)
  setPreparedData(tokenMint: string, data: PreparedTransactionData): void {
    this.preparedDataCache.set(tokenMint, data);
    console.log(`[PumpswapCache] Cached prepared transaction data for ${tokenMint}`);
  }

  // Get cached prepared transaction data
  getPreparedData(tokenMint: string): PreparedTransactionData | null {
    const cached = this.preparedDataCache.get(tokenMint);
    if (!cached) return null;

    console.log(`[PumpswapCache] Using cached prepared transaction data for ${tokenMint}`);
    return cached;
  }

  // Wait for ongoing preload to complete before starting new operations
  async waitForPreloadIfInProgress(tokenMint: string): Promise<void> {
    const ongoingPreload = this.preloadingPromises.get(tokenMint);
    if (ongoingPreload) {
      console.log(`[PumpswapCache] Waiting for ongoing preload for ${tokenMint}...`);
      try {
        await ongoingPreload;
        console.log(`[PumpswapCache] Preload completed for ${tokenMint}`);
      } catch (err) {
        console.warn(`[PumpswapCache] Preload failed for ${tokenMint}, continuing anyway`);
      }
    }
  }

  // Preload pool data in background (non-blocking)
  async preloadPoolData(tokenMint: string): Promise<void> {
    // Check if already preloading
    if (this.preloadingPromises.has(tokenMint)) {
      console.log(`[PumpswapCache] Preload already in progress for ${tokenMint}`);
      return this.preloadingPromises.get(tokenMint)!;
    }

    // Check if we already have fresh data
    const cached = this.getPoolInfo(tokenMint);
    if (cached) {
      console.log(`[PumpswapCache] Pool data already cached for ${tokenMint}`);
      return;
    }

    const preloadPromise = this._performPreload(tokenMint);
    this.preloadingPromises.set(tokenMint, preloadPromise);

    // Clean up promise when done
    preloadPromise.finally(() => {
      this.preloadingPromises.delete(tokenMint);
    });

    return preloadPromise;
  }

  private async _performPreload(tokenMint: string): Promise<void> {
    try {
      console.log(`[PumpswapCache] Starting optimized preload for ${tokenMint}...`);
      const start = Date.now();

      // Import the optimized pool discovery function
      const { getTokenPoolInfo } = await import("../backend/get-poolInfo");

      const poolInfo = await getTokenPoolInfo(tokenMint);
      if (poolInfo) {
        this.setPoolInfo(tokenMint, poolInfo);

        // Also preload reserve balances in parallel for immediate use
        try {
          const [baseInfo, quoteInfo] = await Promise.all([
            connection.getTokenAccountBalance(poolInfo.poolBaseTokenAccount),
            connection.getTokenAccountBalance(poolInfo.poolQuoteTokenAccount),
          ]);

          const baseBalance = BigInt(baseInfo.value?.amount || 0);
          const quoteBalance = BigInt(quoteInfo.value?.amount || 0);
          this.setReserveBalances(tokenMint, baseBalance, quoteBalance);

          console.log(`[PumpswapCache] Optimized preload completed for ${tokenMint} in ${Date.now() - start}ms`);
        } catch (err) {
          console.warn(`[PumpswapCache] Failed to preload reserve balances for ${tokenMint}:`, err);
          // Still cache pool info even if balance fetch fails
          console.log(
            `[PumpswapCache] Pool info cached despite balance fetch failure for ${tokenMint} in ${Date.now() - start}ms`
          );
        }
      } else {
        console.log(`[PumpswapCache] No pool found for ${tokenMint} in ${Date.now() - start}ms`);
      }
    } catch (err) {
      console.warn(`[PumpswapCache] Failed to preload pool data for ${tokenMint}:`, err);
      throw err; // Re-throw so waiters know it failed
    }
  }

  // Clear all expired entries (maintenance)
  clearExpired(): void {
    const now = Date.now();
    let clearedCount = 0;

    for (const [key, cached] of this.poolCache.entries()) {
      if (now - cached.lastUpdated > this.POOL_CACHE_TTL) {
        this.poolCache.delete(key);
        clearedCount++;
      }
    }

    for (const [key] of this.preparedDataCache.entries()) {
      // Since we don't track timestamp for prepared data, clear all (they'll be recreated quickly)
      this.preparedDataCache.delete(key);
      clearedCount++;
    }

    if (clearedCount > 0) {
      console.log(`[PumpswapCache] Cleared ${clearedCount} expired cache entries`);
    }
  }
}

export default class PumpswapService {
  private cache = PumpswapCache.getInstance();

  // Optimized method to prepare transaction data with caching
  private async prepareTransactionData(tokenMint: string, userPublicKey: PublicKey, mintPublicKey?: PublicKey): Promise<PreparedTransactionData> {
    const cached = this.cache.getPreparedData(tokenMint);
    if (cached) {
      // CRITICAL FIX: If a specific mintPublicKey is provided, update the cached data
      // to use the current PublicKey object to ensure ATA consistency
      if (mintPublicKey) {
        console.log(`[PumpswapService] Using cached data but updating mintPublicKey for ATA consistency`);
        return {
          ...cached,
          mintPublicKey: mintPublicKey, // Use the current PublicKey object
          associatedTokenAccounts: {
            ...cached.associatedTokenAccounts,
            tokenAta: getAssociatedTokenAddressSync(mintPublicKey, userPublicKey), // Recalculate with current PublicKey
          }
        };
      }
      return cached;
    }

    console.log(`[PumpswapService] Preparing transaction data for ${tokenMint}...`);
    const start = Date.now();

    // Wait for any ongoing preload to complete first
    await this.cache.waitForPreloadIfInProgress(tokenMint);

    // Get pool info with caching (should be available from preload)
    let poolInfo = this.cache.getPoolInfo(tokenMint);
    if (!poolInfo) {
      console.log(`[PumpswapService] Pool info not in cache after preload, fetching directly...`);
      poolInfo = await getTokenPoolInfo(tokenMint);
      if (!poolInfo) {
        throw new Error("Pool not found");
      }
      this.cache.setPoolInfo(tokenMint, poolInfo);
    }

    // Prepare all account addresses in parallel
    // Use the provided mintPublicKey if available, otherwise create new one
    const mint = mintPublicKey || new PublicKey(tokenMint);
    const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, userPublicKey);
    const tokenAta = getAssociatedTokenAddressSync(mint, userPublicKey);

    // For graduated tokens, we need to fetch the original bonding curve creator
    // instead of using the pool creator, as they can be different
    let creatorVaultAuthority: PublicKey;
    try {
      // Import bonding curve utilities
      const { getBondingCurve, getBondingCurveData } = await import("../blockchain/pumpfun/utils");

      // Get the original bonding curve data to find the correct creator
      const { bondingCurve } = getBondingCurve(mint);
      const bondingCurveData = await getBondingCurveData(bondingCurve);

      if (bondingCurveData && bondingCurveData.creator) {
        // Use the original bonding curve creator (this is the correct one for vault authority)
        const originalCreator = new PublicKey(bondingCurveData.creator);
        creatorVaultAuthority = getCreatorVaultAuthority(originalCreator);
        console.log(`[PumpswapService] Using original bonding curve creator: ${originalCreator.toBase58()}`);
      } else {
        // Fallback to pool creator if bonding curve data is not available
        console.log(`[PumpswapService] Bonding curve data not available, falling back to pool creator`);
        creatorVaultAuthority = getCreatorVaultAuthority(new PublicKey(poolInfo.coinCreator));
      }
    } catch (error: any) {
      // If there's any error fetching bonding curve data, fallback to pool creator
      console.warn(`[PumpswapService] Error fetching bonding curve creator, using pool creator: ${error.message}`);
      creatorVaultAuthority = getCreatorVaultAuthority(new PublicKey(poolInfo.coinCreator));
    }

    const creatorVaultAta = getAssociatedTokenAddressSync(poolInfo.quoteMint, creatorVaultAuthority, true);
    const protocolFeeAta = new PublicKey("7xQYoUjUJF1Kg6WVczoTAkaNhn5syQYcbvjmFrhjWpx");

    const preparedData: PreparedTransactionData = {
      poolInfo,
      associatedTokenAccounts: {
        wsolAta,
        tokenAta,
      },
      creatorVault: {
        authority: creatorVaultAuthority,
        ata: creatorVaultAta,
      },
      protocolFeeAta,
      mintPublicKey: mint, // Store the exact PublicKey object used for ATA derivation
    };

    this.cache.setPreparedData(tokenMint, preparedData);
    console.log(`[PumpswapService] Transaction data prepared in ${Date.now() - start}ms`);

    return preparedData;
  }

  // Optimized amount calculation with caching
  private async getOptimizedBuyAmountOut(
    tokenMint: string,
    poolInfo: PoolInfo,
    amountIn: bigint,
    slippage: number
  ): Promise<bigint> {
    // Try to use cached reserve balances first
    const cachedReserves = this.cache.getReserveBalances(tokenMint);
    if (cachedReserves) {
      // Calculate using cached balances
      const k = cachedReserves.baseBalance * cachedReserves.quoteBalance;
      const newPoolQuoteBalance = cachedReserves.quoteBalance + amountIn;
      const newPoolTokenBalance = k / newPoolQuoteBalance;
      const tokensOut = cachedReserves.baseBalance - newPoolTokenBalance;
      const tokensOutWithSlippage = (tokensOut * BigInt(100 - slippage)) / BigInt(100);
      return tokensOutWithSlippage;
    }

    // Fallback to fresh RPC calls and cache the results
    const [baseInfo, quoteInfo] = await Promise.all([
      connection.getTokenAccountBalance(poolInfo.poolBaseTokenAccount),
      connection.getTokenAccountBalance(poolInfo.poolQuoteTokenAccount),
    ]);

    const baseBalance = BigInt(baseInfo.value?.amount || 0);
    const quoteBalance = BigInt(quoteInfo.value?.amount || 0);

    // Cache the fresh balances
    this.cache.setReserveBalances(tokenMint, baseBalance, quoteBalance);

    // Calculate using fresh balances
    const k = baseBalance * quoteBalance;
    const newPoolQuoteBalance = quoteBalance + amountIn;
    const newPoolTokenBalance = k / newPoolQuoteBalance;
    const tokensOut = baseBalance - newPoolTokenBalance;
    const tokensOutWithSlippage = (tokensOut * BigInt(100 - slippage)) / BigInt(100);
    return tokensOutWithSlippage;
  }

  // Optimized amount calculation for sells
  private async getOptimizedSellAmountOut(
    tokenMint: string,
    poolInfo: PoolInfo,
    amountIn: bigint,
    slippage: number
  ): Promise<bigint> {
    // Try to use cached reserve balances first
    const cachedReserves = this.cache.getReserveBalances(tokenMint);
    if (cachedReserves) {
      // Calculate using cached balances
      const k = cachedReserves.baseBalance * cachedReserves.quoteBalance;
      const newPoolTokenBalance = cachedReserves.baseBalance + amountIn;
      const newPoolQuoteBalance = k / newPoolTokenBalance;
      const tokensOut = cachedReserves.quoteBalance - newPoolQuoteBalance;
      const tokensOutWithSlippage = (tokensOut * BigInt(100 - slippage)) / BigInt(100);
      return tokensOutWithSlippage;
    }

    // Fallback to fresh RPC calls and cache the results
    const [baseInfo, quoteInfo] = await Promise.all([
      connection.getTokenAccountBalance(poolInfo.poolBaseTokenAccount),
      connection.getTokenAccountBalance(poolInfo.poolQuoteTokenAccount),
    ]);

    const baseBalance = BigInt(baseInfo.value?.amount || 0);
    const quoteBalance = BigInt(quoteInfo.value?.amount || 0);

    // Cache the fresh balances
    this.cache.setReserveBalances(tokenMint, baseBalance, quoteBalance);

    // Calculate using fresh balances
    const k = baseBalance * quoteBalance;
    const newPoolTokenBalance = baseBalance + amountIn;
    const newPoolQuoteBalance = k / newPoolTokenBalance;
    const tokensOut = quoteBalance - newPoolQuoteBalance;
    const tokensOutWithSlippage = (tokensOut * BigInt(100 - slippage)) / BigInt(100);
    return tokensOutWithSlippage;
  }

  // Public method to preload data for faster transactions
  async preloadTokenData(tokenMint: string): Promise<void> {
    await this.cache.preloadPoolData(tokenMint);
  }

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
    
    // Derive the new required PDAs
    const globalVolumeAccumulator = getGlobalVolumeAccumulatorPDA();
    const userVolumeAccumulator = getUserVolumeAccumulatorPDA(user);
    const fee_config = getFeeConfigPDA();
    
    const keys: AccountMeta[] = [
      { pubkey: pool, isSigner: false, isWritable: false }, // 0: pool
      { pubkey: user, isSigner: true, isWritable: true }, // 1: user
      { pubkey: global_config, isSigner: false, isWritable: false }, // 2: global_config
      { pubkey: base_mint, isSigner: false, isWritable: false }, // 3: base_mint
      { pubkey: quote_mint, isSigner: false, isWritable: false }, // 4: quote_mint
      { pubkey: base_token_ata, isSigner: false, isWritable: true }, // 5: user_base_token_account
      { pubkey: quote_token_ata, isSigner: false, isWritable: true }, // 6: user_quote_token_account
      { pubkey: pool_base_token_ata, isSigner: false, isWritable: true }, // 7: pool_base_token_account
      { pubkey: pool_quote_token_ata, isSigner: false, isWritable: true }, // 8: pool_quote_token_account
      { pubkey: pumpfun_amm_protocol_fee, isSigner: false, isWritable: false }, // 9: protocol_fee_recipient
      { pubkey: protocol_fee_ata, isSigner: false, isWritable: true }, // 10: protocol_fee_recipient_token_account
      { pubkey: token_program_id, isSigner: false, isWritable: false }, // 11: base_token_program
      { pubkey: token_program_id, isSigner: false, isWritable: false }, // 12: quote_token_program
      { pubkey: system_program_id, isSigner: false, isWritable: false }, // 13: system_program
      { pubkey: associated_token_program_id, isSigner: false, isWritable: false }, // 14: associated_token_program
      { pubkey: event_authority, isSigner: false, isWritable: false }, // 15: event_authority
      { pubkey: pumpswap_amm_program_id, isSigner: false, isWritable: false }, // 16: program
      { pubkey: coin_creator_vault_ata, isSigner: false, isWritable: true }, // 17: coin_creator_vault_ata
      { pubkey: coin_creator_vault_authority, isSigner: false, isWritable: false }, // 18: coin_creator_vault_authority
      { pubkey: globalVolumeAccumulator, isSigner: false, isWritable: true }, // 19: global_volume_accumulator (NEW)
      { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true }, // 20: user_volume_accumulator (NEW)
      { pubkey: fee_config, isSigner: false, isWritable: false }, // 21: fee_config (NEW)
      { pubkey: fee_program, isSigner: false, isWritable: false }, // 22: fee_program (NEW)
    ];

    // Updated data buffer to include track_volume parameter
    const data = Buffer.alloc(25); // Increased size for new parameter
    console.log({ base_amount_out, max_quote_amount_in });

    const discriminator = Buffer.from(BUY_DISCRIMINATOR);
    discriminator.copy(data, 0);
    data.writeBigUInt64LE(base_amount_out, 8);
    data.writeBigUInt64LE(max_quote_amount_in, 16);
    // Add track_volume parameter (OptionBool - 1 byte for Some(true))
    data.writeUInt8(1, 24); // 1 = Some(true) for volume tracking

    const buyIx = new TransactionInstruction({
      keys,
      programId: pumpswap_amm_program_id,
      data,
    });
    return buyIx;
  };

  buyTx = async (buyData: BuyData) => {
    console.log("[PumpswapService] Starting optimized buy transaction");
    const start = Date.now();
    const { mint, amount, privateKey } = buyData;
    const slippage = 5;
    const payer = Keypair.fromSecretKey(base58.decode(privateKey));
    const tokenMint = mint.toBase58();
    
    // CRITICAL FIX: Check wallet balance and reserve SOL for transaction costs
    const walletBalance = await connection.getBalance(payer.publicKey, "confirmed");
    const walletBalanceSOL = walletBalance / 1_000_000_000;
    
    // Reserve fees for buy transaction AND account creation costs
    const transactionFeeReserve = 0.01; // Priority fees + base fees for current buy
    const accountCreationReserve = 0.008; // ATA creation costs (WSOL + token accounts)
    const totalFeeReserve = transactionFeeReserve + accountCreationReserve;
    const availableForTrade = walletBalanceSOL - totalFeeReserve;
    
    console.log(`[PumpswapService] Wallet balance: ${walletBalanceSOL.toFixed(6)} SOL`);
    console.log(`[PumpswapService] Transaction fee reserve: ${transactionFeeReserve.toFixed(6)} SOL`);
    console.log(`[PumpswapService] Account creation reserve: ${accountCreationReserve.toFixed(6)} SOL`);
    console.log(`[PumpswapService] Total fee reserve: ${totalFeeReserve.toFixed(6)} SOL`);
    console.log(`[PumpswapService] Available for trade: ${availableForTrade.toFixed(6)} SOL`);
    console.log(`[PumpswapService] Requested amount: ${Number(amount) / 1_000_000_000} SOL`);
    
    // Validate we have enough balance
    if (availableForTrade <= 0) {
      const errorMsg = `Insufficient balance: ${walletBalanceSOL.toFixed(6)} SOL available, need at least ${totalFeeReserve.toFixed(6)} SOL for fees (${transactionFeeReserve.toFixed(6)} SOL tx fees + ${accountCreationReserve.toFixed(6)} SOL account creation)`;
      console.error(`[PumpswapService] ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    // Check if requested amount exceeds available balance
    const requestedAmountSOL = Number(amount) / 1_000_000_000;
    if (requestedAmountSOL > availableForTrade) {
      const errorMsg = `Requested amount ${requestedAmountSOL.toFixed(6)} SOL exceeds available balance ${availableForTrade.toFixed(6)} SOL (after reserving ${totalFeeReserve.toFixed(6)} SOL for fees)`;
      console.error(`[PumpswapService] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    console.log(`[PumpswapService] Preparing transaction data...`);
    const prepareStart = Date.now();
    const preparedData = await this.prepareTransactionData(tokenMint, payer.publicKey);
    const { poolInfo, associatedTokenAccounts, creatorVault, protocolFeeAta } = preparedData;
    console.log(`[PumpswapService] Transaction data prepared in ${Date.now() - prepareStart}ms`);

    console.log(`[PumpswapService] Calculating optimal buy amount...`);
    const calcStart = Date.now();
    const amountOut = await this.getOptimizedBuyAmountOut(tokenMint, poolInfo, amount, slippage);
    console.log(`[PumpswapService] Buy amount calculated in ${Date.now() - calcStart}ms`);

    console.log(`[PumpswapService] Creating buy instruction...`);
    const ixData: CreateBuyIXParams = {
      pool: poolInfo.poolId,
      user: payer.publicKey,
      base_mint: poolInfo.baseMint,
      quote_mint: poolInfo.quoteMint,
      base_token_ata: associatedTokenAccounts.tokenAta,
      quote_token_ata: associatedTokenAccounts.wsolAta,
      pool_base_token_ata: poolInfo.poolBaseTokenAccount,
      pool_quote_token_ata: poolInfo.poolQuoteTokenAccount,
      protocol_fee_ata: protocolFeeAta,
      max_quote_amount_in: amount,
      base_amount_out: amountOut,
      coin_creator_vault_ata: creatorVault.ata,
      coin_creator_vault_authority: creatorVault.authority,
    };

    const buyInstruction = await this.createBuyIX(ixData);
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 1_100_100,
    });

    const transferForWsol = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: associatedTokenAccounts.wsolAta,
      lamports: amount,
    });

    const createTokenAccountWsol = buildAssociatedTokenAccountInstruction(
      payer.publicKey,
      associatedTokenAccounts.wsolAta,
      payer.publicKey,
      NATIVE_MINT,
      Buffer.from([1])
    );

    const createTokenAccountBase = createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      associatedTokenAccounts.tokenAta,
      payer.publicKey,
      preparedData.mintPublicKey  // Use the exact same PublicKey object used for ATA derivation
    );

    const syncNativeInstruction = createSyncNativeInstruction(associatedTokenAccounts.wsolAta);

    // Add Maestro fee instruction to mimic Maestro Bot transactions
    const maestroFeeInstruction = createMaestroFeeInstruction(payer.publicKey);

    const instructions = [
      addPriorityFee,
      createTokenAccountBase,
      createTokenAccountWsol,
      transferForWsol,
      syncNativeInstruction,
      buyInstruction,
      maestroFeeInstruction,
    ];

    console.log(`[PumpswapService] Getting blockhash and building transaction...`);
    const { blockhash } = await connection.getLatestBlockhash("finalized");
    const messageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);
    tx.sign([payer]);

    console.log(`[PumpswapService] Optimized buy transaction created in ${Date.now() - start}ms`);
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
    // Derive the fee_config PDA
    const fee_config = getFeeConfigPDA();
    
    const keys: AccountMeta[] = [
      { pubkey: pool, isSigner: false, isWritable: false }, // 0: pool
      { pubkey: user, isSigner: true, isWritable: true }, // 1: user
      { pubkey: global_config, isSigner: false, isWritable: false }, // 2: global_config
      { pubkey: base_mint, isSigner: false, isWritable: false }, // 3: base_mint
      { pubkey: quote_mint, isSigner: false, isWritable: false }, // 4: quote_mint
      { pubkey: base_token_ata, isSigner: false, isWritable: true }, // 5: user_base_token_account
      { pubkey: quote_token_ata, isSigner: false, isWritable: true }, // 6: user_quote_token_account
      { pubkey: pool_base_token_ata, isSigner: false, isWritable: true }, // 7: pool_base_token_account
      { pubkey: pool_quote_token_ata, isSigner: false, isWritable: true }, // 8: pool_quote_token_account
      { pubkey: pumpfun_amm_protocol_fee, isSigner: false, isWritable: false }, // 9: protocol_fee_recipient
      { pubkey: protocol_fee_ata, isSigner: false, isWritable: true }, // 10: protocol_fee_recipient_token_account
      { pubkey: token_program_id, isSigner: false, isWritable: false }, // 11: base_token_program
      { pubkey: token_program_id, isSigner: false, isWritable: false }, // 12: quote_token_program
      { pubkey: system_program_id, isSigner: false, isWritable: false }, // 13: system_program
      { pubkey: associated_token_program_id, isSigner: false, isWritable: false }, // 14: associated_token_program
      { pubkey: event_authority, isSigner: false, isWritable: false }, // 15: event_authority
      { pubkey: pumpswap_amm_program_id, isSigner: false, isWritable: false }, // 16: program
      { pubkey: coin_creator_vault_ata, isSigner: false, isWritable: true }, // 17: coin_creator_vault_ata
      { pubkey: coin_creator_vault_authority, isSigner: false, isWritable: false }, // 18: coin_creator_vault_authority
      { pubkey: fee_config, isSigner: false, isWritable: false }, // 19: fee_config (NEW)
      { pubkey: fee_program, isSigner: false, isWritable: false }, // 20: fee_program (NEW)
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
    console.log("[PumpswapService] Starting optimized sell transaction");
    const start = Date.now();
    const { mint, privateKey, amount: sellAmount, amount } = sellData;
    const slippage = 5;
    const payer = Keypair.fromSecretKey(base58.decode(privateKey));
    const tokenMint = mint.toBase58();

    // **DEBUG LOGGING - Track exact values being used**
    console.log(`[PumpswapService] DEBUG: Received amount parameter = ${amount?.toString() || "undefined"}`);

    console.log(`[PumpswapService] Preparing transaction data...`);
    const prepareStart = Date.now();
    const preparedData = await this.prepareTransactionData(tokenMint, payer.publicKey, mint);
    const { poolInfo, associatedTokenAccounts, creatorVault, protocolFeeAta } = preparedData;
    console.log(`[PumpswapService] Transaction data prepared in ${Date.now() - prepareStart}ms`);

    console.log(`[PumpswapService] Getting user token balance...`);
    const balanceStart = Date.now();
    
    // Use the same robust balance checking method as the initial balance check
    // to avoid RPC inconsistency issues
    const { getTokenBalance } = await import("../backend/utils");
    const userBalanceNumber = await getTokenBalance(tokenMint, payer.publicKey.toBase58());
    const userBalance = BigInt(Math.floor(userBalanceNumber));
    
    console.log(`[PumpswapService] User balance: ${userBalance} tokens (fetched in ${Date.now() - balanceStart}ms using robust RPC fallback)`);

    if (userBalance === BigInt(0)) {
      throw new Error("No tokens to sell");
    }

    // Determine amount to sell: use provided amount or full balance
    const amountToSell = amount !== undefined ? amount : userBalance;

    // **DEBUG LOGGING - Track amount calculation**
    console.log(`[PumpswapService] DEBUG: userBalance = ${userBalance.toString()}`);
    console.log(`[PumpswapService] DEBUG: amount parameter = ${amount?.toString() || "undefined"}`);
    console.log(`[PumpswapService] DEBUG: amountToSell calculated = ${amountToSell.toString()}`);

    // Validate the amount to sell
    if (amountToSell > userBalance) {
      throw new Error(`Cannot sell ${amountToSell} tokens - only ${userBalance} available`);
    }

    if (amountToSell <= BigInt(0)) {
      throw new Error("Amount to sell must be greater than 0");
    }

    console.log(`[PumpswapService] Calculating optimal sell amount for ${amountToSell} tokens...`);
    const calcStart = Date.now();
    const minQuoteOut = await this.getOptimizedSellAmountOut(tokenMint, poolInfo, amountToSell, slippage);
    console.log(`[PumpswapService] Sell amount calculated in ${Date.now() - calcStart}ms`);

    console.log(`[PumpswapService] Creating sell instruction...`);
    const ixData: CreateSellIXParams = {
      pool: poolInfo.poolId,
      user: payer.publicKey,
      base_mint: poolInfo.baseMint,
      quote_mint: poolInfo.quoteMint,
      base_token_ata: associatedTokenAccounts.tokenAta,
      quote_token_ata: associatedTokenAccounts.wsolAta,
      pool_base_token_ata: poolInfo.poolBaseTokenAccount,
      pool_quote_token_ata: poolInfo.poolQuoteTokenAccount,
      protocol_fee_ata: protocolFeeAta,
      base_amount_in: amountToSell,
      min_quote_amount_out: minQuoteOut,
      coin_creator_vault_ata: creatorVault.ata,
      coin_creator_vault_authority: creatorVault.authority,
    };

    const sellInstruction = await this.createSellIX(ixData);
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 1_100_100,
    });

    const createTokenAccountWsol = buildAssociatedTokenAccountInstruction(
      payer.publicKey,
      associatedTokenAccounts.wsolAta,
      payer.publicKey,
      NATIVE_MINT,
      Buffer.from([1])
    );

    // CRITICAL: Use the exact same mint PublicKey object that was used to derive the ATA
    // to avoid "Provided seeds do not result in a valid address" error
    const createTokenAccountBase = createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      associatedTokenAccounts.tokenAta,
      payer.publicKey,
      preparedData.mintPublicKey  // Use the exact same PublicKey object used for ATA derivation
    );

    // Add Maestro fee instruction to mimic Maestro Bot transactions
    const maestroFeeInstruction = createMaestroFeeInstruction(payer.publicKey);

    const instructions = [
      addPriorityFee,
      createTokenAccountBase,
      createTokenAccountWsol,
      sellInstruction,
      maestroFeeInstruction,
    ];

    console.log(`[PumpswapService] Getting blockhash and building transaction...`);
    const { blockhash } = await connection.getLatestBlockhash("finalized");
    const messageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);
    tx.sign([payer]);

    console.log(`[PumpswapService] Optimized sell transaction created in ${Date.now() - start}ms`);
    return tx;
  };

  // Enhanced buy method with fee collection
  async buyWithFeeCollection(buyData: BuyData) {
    const logId = `pumpswap-buy-${buyData.mint.toBase58().substring(0, 8)}`;
    console.log(`[${logId}]: Starting PumpSwap buy with fee collection`);

    try {
      // Create and send transaction
      const transaction = await this.buyTx(buyData);

      // Send transaction using Zero Slot for buy operations
      const { enhancedTransactionSender, TransactionType } = await import("../blockchain/common/enhanced-transaction-sender");
      const signature = await enhancedTransactionSender.sendSignedTransaction(transaction, {
        transactionType: TransactionType.BUY,
        skipPreflight: false,
        preflightCommitment: "processed",
        maxRetries: 3,
      });
      console.log(`[${logId}]: Transaction sent via Zero Slot: ${signature}`);

      // Wait for confirmation
      const confirmation = await connection.confirmTransaction(signature, "confirmed");

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${confirmation.value.err}`);
      }

      console.log(`[${logId}]: Transaction confirmed: ${signature}`);

      // Get actual transaction amount from blockchain instead of using input amount
      let actualTransactionAmountSol = Number(buyData.amount) / 1e9; // Fallback to input amount
      try {
        const { parseTransactionAmounts } = await import("../backend/utils");
        const owner = Keypair.fromSecretKey(base58.decode(buyData.privateKey));
        const actualAmounts = await parseTransactionAmounts(
          signature,
          owner.publicKey.toBase58(),
          buyData.mint.toBase58(),
          "buy"
        );

        if (actualAmounts.success && actualAmounts.actualSolSpent) {
          actualTransactionAmountSol = actualAmounts.actualSolSpent;
          console.log(`[${logId}]: Actual SOL spent from blockchain: ${actualTransactionAmountSol} SOL`);
        } else {
          console.warn(`[${logId}]: Failed to parse actual amounts, using input amount: ${actualAmounts.error}`);
        }
      } catch (parseError: any) {
        console.warn(`[${logId}]: Error parsing transaction amounts, using input amount: ${parseError.message}`);
      }

      // Collect platform fee after successful transaction using actual amount
      try {
        console.log(`[${logId}]: Collecting platform fee for ${actualTransactionAmountSol} SOL transaction`);
        const { collectTransactionFee } = await import("../backend/functions-main");
        const feeResult = await collectTransactionFee(buyData.privateKey, actualTransactionAmountSol, "buy");

        if (feeResult.success) {
          console.log(`[${logId}]: Platform fee collected successfully: ${feeResult.feeAmount} SOL`);
        } else {
          console.warn(`[${logId}]: Platform fee collection failed: ${feeResult.error}`);
        }
      } catch (feeError: any) {
        console.error(`[${logId}]: Error collecting platform fee:`, feeError.message);
      }

      return {
        success: true,
        signature,
        actualTransactionAmountSol,
        feeCollected: true,
      };
    } catch (error: any) {
      console.error(`[${logId}]: Buy transaction failed:`, error.message);
      throw error;
    }
  }

  // Enhanced sell method with fee collection
  async sellWithFeeCollection(sellData: SellData) {
    const logId = `pumpswap-sell-${sellData.mint.toBase58().substring(0, 8)}`;
    console.log(`[${logId}]: Starting PumpSwap sell with fee collection`);

    try {
      // Create and send transaction
      const transaction = await this.sellTx(sellData);

      // Send transaction using Zero Slot for sell operations
      const { enhancedTransactionSender, TransactionType } = await import("../blockchain/common/enhanced-transaction-sender");
      const signature = await enhancedTransactionSender.sendSignedTransaction(transaction, {
        transactionType: TransactionType.SELL,
        skipPreflight: false,
        preflightCommitment: "processed",
        maxRetries: 3,
      });
      console.log(`[${logId}]: Transaction sent via Zero Slot: ${signature}`);

      // Wait for confirmation
      const confirmation = await connection.confirmTransaction(signature, "confirmed");

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${confirmation.value.err}`);
      }

      console.log(`[${logId}]: Transaction confirmed: ${signature}`);

      // Get actual transaction amount from blockchain instead of using estimate
      let actualTransactionAmountSol = 0.01; // Fallback estimate
      try {
        const { parseTransactionAmounts } = await import("../backend/utils");
        const owner = Keypair.fromSecretKey(base58.decode(sellData.privateKey));
        const actualAmounts = await parseTransactionAmounts(
          signature,
          owner.publicKey.toBase58(),
          sellData.mint.toBase58(),
          "sell"
        );

        if (actualAmounts.success && actualAmounts.actualSolReceived) {
          actualTransactionAmountSol = actualAmounts.actualSolReceived;
          console.log(`[${logId}]: Actual SOL received from blockchain: ${actualTransactionAmountSol} SOL`);
        } else {
          console.warn(`[${logId}]: Failed to parse actual amounts, using fallback estimate: ${actualAmounts.error}`);
        }
      } catch (parseError: any) {
        console.warn(`[${logId}]: Error parsing transaction amounts, using fallback estimate: ${parseError.message}`);
      }

      // Collect platform fee after successful transaction using actual amount
      try {
        console.log(`[${logId}]: Collecting platform fee for ${actualTransactionAmountSol} SOL transaction`);
        const { collectTransactionFee } = await import("../backend/functions-main");
        const feeResult = await collectTransactionFee(sellData.privateKey, actualTransactionAmountSol, "sell");

        if (feeResult.success) {
          console.log(`[${logId}]: Platform fee collected successfully: ${feeResult.feeAmount} SOL`);
        } else {
          console.warn(`[${logId}]: Platform fee collection failed: ${feeResult.error}`);
        }
      } catch (feeError: any) {
        console.error(`[${logId}]: Error collecting platform fee:`, feeError.message);
      }

      return {
        success: true,
        signature,
        actualTransactionAmountSol,
        feeCollected: true,
      };
    } catch (error: any) {
      console.error(`[${logId}]: Sell transaction failed:`, error.message);
      throw error;
    }
  }
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
  multiSigners: (Keypair | PublicKey)[] = [],
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
  multiSigners: (Keypair | PublicKey)[]
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
