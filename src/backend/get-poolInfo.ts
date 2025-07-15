import { PublicKey } from "@solana/web3.js";

import base58 from "bs58";

import { struct, u16, u8, u32 } from "@solana/buffer-layout";
import { publicKey, u64 } from "@solana/buffer-layout-utils";
import { connection } from "../blockchain/common/connection.ts";
import { LIGHTWEIGHT_MODE, ENABLE_BACKGROUND_PRELOADING, MAX_POOL_CACHE_SIZE } from "../config.ts";

// Define the program ID directly to avoid circular imports
const pumpswap_amm_program_id = new PublicKey("D1ZN9Wj1fRSUQfCjhvnu1hqDMT7hzjzBBpi12nVWqQhY");

export type PumpSwapPool = {
  discriminator: bigint;
  poolBump: number;
  index: number;
  creator: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  lpMint: PublicKey;
  poolBaseTokenAccount: PublicKey;
  poolQuoteTokenAccount: PublicKey;
  lpSupply: bigint;
  coinCreator: PublicKey;
};

export type PoolInfo = PumpSwapPool & {
  poolId: PublicKey;
};

export const PUMP_SWAP_POOL_DISCRIMINATOR = [241, 154, 109, 4, 17, 177, 109, 188];
export const POOL_LAYOUT = struct<PumpSwapPool>([
  u64("discriminator"),
  u8("poolBump"),
  u16("index"),
  publicKey("creator"),
  publicKey("baseMint"),
  publicKey("quoteMint"),
  publicKey("lpMint"),
  publicKey("poolBaseTokenAccount"),
  publicKey("poolQuoteTokenAccount"),
  u64("lpSupply"),
  publicKey("coinCreator"),
]);

// Enhanced caching system for pool discovery with lightweight optimization
class PoolDiscoveryCache {
  private static instance: PoolDiscoveryCache;
  private allPoolsCache: { pools: PoolInfo[]; lastUpdated: number } | null = null;
  private poolByTokenCache = new Map<string, PoolInfo>();
  private poolByIndexCache = new Map<number, PoolInfo>(); // NEW: Index-based lookup
  private isPreloading = false;
  private preloadPromise: Promise<void> | null = null;
  private preloadingStarted = false; // Track if preloading has been started
  
  private readonly CACHE_TTL = LIGHTWEIGHT_MODE ? 10 * 60 * 1000 : 5 * 60 * 1000; // Longer TTL in lightweight mode
  private readonly TOKEN_CACHE_TTL = 10 * 60 * 1000; // 10 minutes for individual token pools
  private readonly AGGRESSIVE_PRELOAD_INTERVAL = LIGHTWEIGHT_MODE ? 10 * 60 * 1000 : 2 * 60 * 1000; // Less frequent in lightweight mode

  static getInstance(): PoolDiscoveryCache {
    if (!PoolDiscoveryCache.instance) {
      PoolDiscoveryCache.instance = new PoolDiscoveryCache();
      
      // Only start background preloading if enabled and not in lightweight mode
      if (ENABLE_BACKGROUND_PRELOADING && !LIGHTWEIGHT_MODE) {
        setTimeout(() => {
          PoolDiscoveryCache.instance.startAggressivePreloading();
        }, 5000); // 5 second delay to ensure all modules are loaded
      } else {
        console.log(`[PoolDiscoveryCache] Background preloading disabled (LIGHTWEIGHT_MODE: ${LIGHTWEIGHT_MODE})`);
      }
    }
    return PoolDiscoveryCache.instance;
  }

  // Start aggressive background preloading with error handling (only if enabled)
  private startAggressivePreloading(): void {
    if (this.preloadingStarted || LIGHTWEIGHT_MODE) {
      console.log(`[PoolDiscoveryCache] Preloading already started or disabled in lightweight mode, skipping...`);
      return;
    }
    
    this.preloadingStarted = true;
    console.log(`[PoolDiscoveryCache] Starting background preloading (interval: ${this.AGGRESSIVE_PRELOAD_INTERVAL}ms)...`);
    
    // Immediate preload with error handling
    this.preloadAllPools().catch(err => {
      console.warn(`[PoolDiscoveryCache] Initial preload failed, will retry:`, err);
    });
    
    // Continuous preloading 
    setInterval(() => {
      if (!this.isPreloading) {
        this.preloadAllPools().catch(err => {
          console.warn(`[PoolDiscoveryCache] Scheduled preload failed:`, err);
        });
      }
    }, this.AGGRESSIVE_PRELOAD_INTERVAL);
  }

  // Cache all pools data with size limits in lightweight mode
  setAllPools(pools: PoolInfo[]): void {
    // In lightweight mode, limit the number of cached pools
    let poolsToCache = pools;
    if (LIGHTWEIGHT_MODE && pools.length > MAX_POOL_CACHE_SIZE) {
      poolsToCache = pools.slice(0, MAX_POOL_CACHE_SIZE);
      console.log(`[PoolDiscoveryCache] Lightweight mode: limiting cache to ${MAX_POOL_CACHE_SIZE} pools`);
    }

    this.allPoolsCache = {
      pools: poolsToCache,
      lastUpdated: Date.now()
    };

    // Clear and rebuild all caches
    this.poolByTokenCache.clear();
    this.poolByIndexCache.clear();

    // Cache individual token lookups and index lookups
    for (const pool of poolsToCache) {
      const baseKey = pool.baseMint.toBase58();
      const quoteKey = pool.quoteMint.toBase58();
      
      // Token-based cache
      this.poolByTokenCache.set(baseKey, pool);
      this.poolByTokenCache.set(quoteKey, pool);
      
      // Index-based cache
      this.poolByIndexCache.set(pool.index, pool);
    }

    console.log(`[PoolDiscoveryCache] Cached ${poolsToCache.length}/${pools.length} pools with ${this.poolByTokenCache.size} token mappings (lightweight: ${LIGHTWEIGHT_MODE})`);
  }

  // Get all pools with TTL check
  getAllPools(): PoolInfo[] | null {
    if (!this.allPoolsCache) return null;

    const isExpired = Date.now() - this.allPoolsCache.lastUpdated > this.CACHE_TTL;
    if (isExpired) {
      console.log(`[PoolDiscoveryCache] All pools cache expired, clearing...`);
      this.allPoolsCache = null;
      this.poolByTokenCache.clear();
      this.poolByIndexCache.clear();
      return null;
    }

    return this.allPoolsCache.pools;
  }

  // Get specific token pool from cache with priority lookup
  getPoolByToken(tokenMint: string): PoolInfo | null {
    const cached = this.poolByTokenCache.get(tokenMint);
    if (!cached) return null;

    console.log(`[PoolDiscoveryCache] Found cached pool for token ${tokenMint}`);
    return cached;
  }

  // Cache individual token pool
  setPoolByToken(tokenMint: string, pool: PoolInfo): void {
    this.poolByTokenCache.set(tokenMint, pool);
    this.poolByIndexCache.set(pool.index, pool);
    console.log(`[PoolDiscoveryCache] Cached pool for token ${tokenMint}`);
  }

  // Wait for ongoing preload to complete
  async waitForPreload(): Promise<void> {
    if (this.preloadPromise) {
      console.log(`[PoolDiscoveryCache] Waiting for ongoing preload to complete...`);
      try {
        await this.preloadPromise;
        console.log(`[PoolDiscoveryCache] Preload completed, cache ready`);
      } catch (err) {
        console.warn(`[PoolDiscoveryCache] Preload failed, will fallback to RPC:`, err);
      }
    }
  }

  // Preload all pools in background with deduplication and error handling
  async preloadAllPools(): Promise<void> {
    if (this.isPreloading) {
      console.log(`[PoolDiscoveryCache] Preload already in progress, skipping...`);
      return this.preloadPromise || Promise.resolve();
    }

    this.isPreloading = true;
    this.preloadPromise = this._performPreload();
    
    try {
      await this.preloadPromise;
    } finally {
      this.isPreloading = false;
      this.preloadPromise = null;
    }
  }

  private async _performPreload(): Promise<void> {
    try {
      // Validate that we have the program ID
      if (!pumpswap_amm_program_id) {
        throw new Error("pumpswap_amm_program_id is not defined");
      }

      console.log(`[PoolDiscoveryCache] Starting aggressive pool preload...`);
      const start = Date.now();
      
      const accounts = await connection.getProgramAccounts(pumpswap_amm_program_id, {
        commitment: 'confirmed', // Use confirmed for faster response
        dataSlice: undefined, // Get full account data
      });
      
      const pools: PoolInfo[] = [];
      let successCount = 0;
      let errorCount = 0;
      
      for (const { pubkey, account } of accounts) {
        try {
          const poolInfo = POOL_LAYOUT.decode(account.data as Buffer);
          pools.push({
            ...poolInfo,
            poolId: pubkey,
          });
          successCount++;
        } catch (err) {
          errorCount++;
          console.warn(`[PoolDiscoveryCache] Failed to decode pool ${pubkey.toBase58()}:`, err);
        }
      }
      
      this.setAllPools(pools);
      console.log(`[PoolDiscoveryCache] Aggressive preload completed: ${successCount} pools cached, ${errorCount} errors, took ${Date.now() - start}ms`);
    } catch (err) {
      console.error(`[PoolDiscoveryCache] Failed to preload pools:`, err);
      throw err;
    }
  }

  // Get cache statistics
  getCacheStats(): { totalPools: number; tokenMappings: number; isPreloading: boolean; lastUpdate: number | null } {
    return {
      totalPools: this.allPoolsCache?.pools.length || 0,
      tokenMappings: this.poolByTokenCache.size,
      isPreloading: this.isPreloading,
      lastUpdate: this.allPoolsCache?.lastUpdated || null
    };
  }
}

// Global cache instance
const poolCache = PoolDiscoveryCache.getInstance();

// Export preload function for external use
export const preloadPumpswapPools = async (): Promise<void> => {
  return poolCache.preloadAllPools();
};

// OPTIMIZED: Fast token pool lookup with multiple fallback strategies
export const getTokenPoolInfo = async (tokenMint: string): Promise<PoolInfo | null> => {
  const start = Date.now();
  console.log(`[getTokenPoolInfo] Looking for pool with token ${tokenMint}`);

  // STRATEGY 1: Check individual token cache first (fastest)
  const cachedPool = poolCache.getPoolByToken(tokenMint);
  if (cachedPool) {
    console.log(`[getTokenPoolInfo] Found cached pool in ${Date.now() - start}ms`);
    return cachedPool;
  }

  // STRATEGY 2: Check if we have all pools cached and search them
  const allPools = poolCache.getAllPools();
  if (allPools && allPools.length > 0) {
    console.log(`[getTokenPoolInfo] Searching in cached pools (${allPools.length} pools)`);
    for (const pool of allPools) {
      if (pool.baseMint.toBase58() === tokenMint || pool.quoteMint.toBase58() === tokenMint) {
        console.log(`[getTokenPoolInfo] Found pool in cached data in ${Date.now() - start}ms`);
        poolCache.setPoolByToken(tokenMint, pool); // Cache for faster future access
        return pool;
      }
    }
    console.log(`[getTokenPoolInfo] Token not found in cached pools`);
    return null;
  }

  // STRATEGY 3: Wait for ongoing preload if in progress
  await poolCache.waitForPreload();
  
  // STRATEGY 4: Check cache again after preload
  const poolAfterPreload = poolCache.getPoolByToken(tokenMint);
  if (poolAfterPreload) {
    console.log(`[getTokenPoolInfo] Found pool after preload in ${Date.now() - start}ms`);
    return poolAfterPreload;
  }

  // STRATEGY 5: Last resort - fresh RPC call (should be rare)
  console.log(`[getTokenPoolInfo] No cache available, fetching from RPC as last resort...`);
  let decoded: any = null;
  let poolPubkey: PublicKey | null = null;

  try {
    // Validate program ID before making RPC call
    if (!pumpswap_amm_program_id) {
      console.error(`[getTokenPoolInfo] pumpswap_amm_program_id is undefined, cannot fetch from RPC`);
      return null;
    }

    const accounts = await connection.getProgramAccounts(pumpswap_amm_program_id, {
      commitment: 'confirmed',
      filters: [
        // Try to filter by token mint if possible to reduce data transfer
        {
          memcmp: {
            offset: 8 + 1 + 2 + 32, // Skip discriminator, poolBump, index, creator
            bytes: tokenMint,
          },
        },
      ],
    });

    // If no filtered results, fall back to full scan
    if (accounts.length === 0) {
      console.log(`[getTokenPoolInfo] No filtered results, falling back to full scan...`);
      const allAccounts = await connection.getProgramAccounts(pumpswap_amm_program_id);
      
      for (const { pubkey, account } of allAccounts) {
        const poolInfo = POOL_LAYOUT.decode(account.data as Buffer);
        if (poolInfo.baseMint.toBase58() === tokenMint || poolInfo.quoteMint.toBase58() === tokenMint) {
          console.log("Matched Base Mint:", poolInfo.baseMint.toBase58());
          decoded = poolInfo;
          poolPubkey = pubkey;
          break;
        }
      }
    } else {
      // Process filtered results
      for (const { pubkey, account } of accounts) {
        const poolInfo = POOL_LAYOUT.decode(account.data as Buffer);
        if (poolInfo.baseMint.toBase58() === tokenMint || poolInfo.quoteMint.toBase58() === tokenMint) {
          console.log("Matched Base Mint:", poolInfo.baseMint.toBase58());
          decoded = poolInfo;
          poolPubkey = pubkey;
          break;
        }
      }
    }
  } catch (err) {
    console.warn(`[getTokenPoolInfo] RPC call failed:`, err);
    return null;
  }

  if (!decoded || !poolPubkey) {
    console.log(`[getTokenPoolInfo] Pool not found for token ${tokenMint} in ${Date.now() - start}ms`);
    return null;
  }

  const result = {
    ...decoded,
    poolId: poolPubkey,
  };

  // Cache the result for future use
  poolCache.setPoolByToken(tokenMint, result);
  console.log(`[getTokenPoolInfo] Found pool via RPC in ${Date.now() - start}ms`);
  
  return result;
};

// Optimized buy amount calculation with parallel RPC calls
export const getBuyAmountOut = async (poolInfo: PoolInfo, amountIn: bigint, slippage: number) => {
  const [baseInfo, quoteInfo] = await Promise.all([
    connection.getTokenAccountBalance(poolInfo.poolBaseTokenAccount),
    connection.getTokenAccountBalance(poolInfo.poolQuoteTokenAccount)
  ]);
  
  const poolTokenBalance = BigInt(baseInfo.value?.amount || 0);
  const poolQuoteBalance = BigInt(quoteInfo.value?.amount || 0);

  const k = poolTokenBalance * poolQuoteBalance;
  const newPoolQuoteBalance = poolQuoteBalance + amountIn;
  const newPoolTokenBalance = k / newPoolQuoteBalance;
  const tokensOut = poolTokenBalance - newPoolTokenBalance;
  const tokensOutWithSlippage = (tokensOut * BigInt(100 - slippage)) / BigInt(100);
  return tokensOutWithSlippage;
};

// Optimized sell amount calculation with parallel RPC calls
export const getSellAmountOut = async (poolInfo: PoolInfo, amountIn: bigint, slippage: number) => {
  const [baseInfo, quoteInfo] = await Promise.all([
    connection.getTokenAccountBalance(poolInfo.poolBaseTokenAccount),
    connection.getTokenAccountBalance(poolInfo.poolQuoteTokenAccount)
  ]);
  
  const poolTokenBalance = BigInt(baseInfo.value?.amount || 0);
  const poolQuoteBalance = BigInt(quoteInfo.value?.amount || 0);

  const k = poolTokenBalance * poolQuoteBalance;
  const newPoolTokenBalance = poolTokenBalance + amountIn;
  const newPoolQuoteBalance = k / newPoolTokenBalance;
  const tokensOut = poolQuoteBalance - newPoolQuoteBalance;
  const tokensOutWithSlippage = (tokensOut * BigInt(100 - slippage)) / BigInt(100);
  return tokensOutWithSlippage;
};
