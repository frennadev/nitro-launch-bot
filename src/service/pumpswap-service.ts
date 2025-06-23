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
import { getBuyAmountOut, getSellAmountOut, getTokenPoolInfo, PoolInfo } from "../backend/get-poolInfo";
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
  amount?: bigint; // Optional: if provided, sell this specific amount; if not provided, sell full balance
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
      lastUpdated: Date.now()
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
        timestamp: Date.now()
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
      quoteBalance: cached.reserveBalances.quoteBalance
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
            connection.getTokenAccountBalance(poolInfo.poolQuoteTokenAccount)
          ]);
          
          const baseBalance = BigInt(baseInfo.value?.amount || 0);
          const quoteBalance = BigInt(quoteInfo.value?.amount || 0);
          this.setReserveBalances(tokenMint, baseBalance, quoteBalance);
          
          console.log(`[PumpswapCache] Optimized preload completed for ${tokenMint} in ${Date.now() - start}ms`);
        } catch (err) {
          console.warn(`[PumpswapCache] Failed to preload reserve balances for ${tokenMint}:`, err);
          // Still cache pool info even if balance fetch fails
          console.log(`[PumpswapCache] Pool info cached despite balance fetch failure for ${tokenMint} in ${Date.now() - start}ms`);
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
  private async prepareTransactionData(tokenMint: string, userPublicKey: PublicKey): Promise<PreparedTransactionData> {
    const cached = this.cache.getPreparedData(tokenMint);
    if (cached) {
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
    const mint = new PublicKey(tokenMint);
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
        tokenAta
      },
      creatorVault: {
        authority: creatorVaultAuthority,
        ata: creatorVaultAta
      },
      protocolFeeAta
    };

    this.cache.setPreparedData(tokenMint, preparedData);
    console.log(`[PumpswapService] Transaction data prepared in ${Date.now() - start}ms`);
    
    return preparedData;
  }

  // Optimized amount calculation with caching
  private async getOptimizedBuyAmountOut(tokenMint: string, poolInfo: PoolInfo, amountIn: bigint, slippage: number): Promise<bigint> {
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
      connection.getTokenAccountBalance(poolInfo.poolQuoteTokenAccount)
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
  private async getOptimizedSellAmountOut(tokenMint: string, poolInfo: PoolInfo, amountIn: bigint, slippage: number): Promise<bigint> {
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
      connection.getTokenAccountBalance(poolInfo.poolQuoteTokenAccount)
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
    console.log("[PumpswapService] Starting optimized buy transaction");
    const start = Date.now();
    const { mint, amount, privateKey } = buyData;
    const slippage = 5;
    const payer = Keypair.fromSecretKey(base58.decode(privateKey));
    const tokenMint = mint.toBase58();

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
      mint
    );

    const syncNativeInstruction = createSyncNativeInstruction(associatedTokenAccounts.wsolAta);

    const instructions = [
      addPriorityFee,
      createTokenAccountBase,
      createTokenAccountWsol,
      transferForWsol,
      syncNativeInstruction,
      buyInstruction,
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
    console.log("[PumpswapService] Starting optimized sell transaction");
    const start = Date.now();
    const { mint, privateKey, amount } = sellData;
    const slippage = 5;
    const payer = Keypair.fromSecretKey(base58.decode(privateKey));
    const tokenMint = mint.toBase58();

    console.log(`[PumpswapService] Preparing transaction data...`);
    const prepareStart = Date.now();
    const preparedData = await this.prepareTransactionData(tokenMint, payer.publicKey);
    const { poolInfo, associatedTokenAccounts, creatorVault, protocolFeeAta } = preparedData;
    console.log(`[PumpswapService] Transaction data prepared in ${Date.now() - prepareStart}ms`);

    console.log(`[PumpswapService] Getting user token balance...`);
    const balanceStart = Date.now();
    const userBaseTokenBalanceInfo = await connection.getTokenAccountBalance(associatedTokenAccounts.tokenAta);
    const userBalance = BigInt(userBaseTokenBalanceInfo.value.amount || 0);
    console.log(`[PumpswapService] User balance: ${userBalance} tokens (fetched in ${Date.now() - balanceStart}ms)`);

    if (userBalance === BigInt(0)) {
      throw new Error("No tokens to sell");
    }

    // Determine amount to sell: use provided amount or full balance
    const amountToSell = amount !== undefined ? amount : userBalance;
    
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

    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 151591,
    });

    const tokenAccountInstruction = createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      associatedTokenAccounts.wsolAta,
      payer.publicKey,
      NATIVE_MINT
    );

    // Close account instruction to close WSOL account and get SOL back
    const closeAccount = createCloseAccountInstruction(associatedTokenAccounts.wsolAta, payer.publicKey, payer.publicKey);

    const instructions = [modifyComputeUnits, addPriorityFee, tokenAccountInstruction, sellInstruction, closeAccount];

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
