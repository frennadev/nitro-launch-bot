import { PublicKey } from "@solana/web3.js";

import base58 from "bs58";

import { struct, u16, u8 } from "@solana/buffer-layout";
import { publicKey, u64 } from "@solana/buffer-layout-utils";
import { connection } from "../blockchain/common/connection";
import { pumpswap_amm_program_id } from "../service/pumpswap-service";

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

export interface PoolInfo extends PumpSwapPool {
  poolId: PublicKey;
}

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

// Enhanced caching system for pool discovery
class PoolDiscoveryCache {
  private static instance: PoolDiscoveryCache;
  private allPoolsCache: { pools: PoolInfo[]; lastUpdated: number } | null = null;
  private poolByTokenCache = new Map<string, PoolInfo>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes for full pool scan cache
  private readonly TOKEN_CACHE_TTL = 10 * 60 * 1000; // 10 minutes for individual token pools

  static getInstance(): PoolDiscoveryCache {
    if (!PoolDiscoveryCache.instance) {
      PoolDiscoveryCache.instance = new PoolDiscoveryCache();
    }
    return PoolDiscoveryCache.instance;
  }

  // Cache all pools data
  setAllPools(pools: PoolInfo[]): void {
    this.allPoolsCache = {
      pools,
      lastUpdated: Date.now()
    };

    // Also cache individual token lookups
    for (const pool of pools) {
      const baseKey = pool.baseMint.toBase58();
      const quoteKey = pool.quoteMint.toBase58();
      this.poolByTokenCache.set(baseKey, pool);
      this.poolByTokenCache.set(quoteKey, pool);
    }

    console.log(`[PoolDiscoveryCache] Cached ${pools.length} pools`);
  }

  // Get all pools from cache if available
  getAllPools(): PoolInfo[] | null {
    if (!this.allPoolsCache) return null;

    const isExpired = Date.now() - this.allPoolsCache.lastUpdated > this.CACHE_TTL;
    if (isExpired) {
      this.allPoolsCache = null;
      console.log(`[PoolDiscoveryCache] All pools cache expired`);
      return null;
    }

    console.log(`[PoolDiscoveryCache] Using cached pools (${this.allPoolsCache.pools.length} pools)`);
    return this.allPoolsCache.pools;
  }

  // Get specific token pool from cache
  getPoolByToken(tokenMint: string): PoolInfo | null {
    const cached = this.poolByTokenCache.get(tokenMint);
    if (!cached) return null;

    console.log(`[PoolDiscoveryCache] Found cached pool for token ${tokenMint}`);
    return cached;
  }

  // Cache individual token pool
  setPoolByToken(tokenMint: string, pool: PoolInfo): void {
    this.poolByTokenCache.set(tokenMint, pool);
    console.log(`[PoolDiscoveryCache] Cached pool for token ${tokenMint}`);
  }

  // Preload all pools in background (non-blocking)
  async preloadAllPools(): Promise<void> {
    try {
      console.log(`[PoolDiscoveryCache] Preloading all pools in background...`);
      const start = Date.now();
      
      const accounts = await connection.getProgramAccounts(pumpswap_amm_program_id);
      const pools: PoolInfo[] = [];
      
      for (const { pubkey, account } of accounts) {
        try {
          const poolInfo = POOL_LAYOUT.decode(account.data as Buffer);
          pools.push({
            ...poolInfo,
            poolId: pubkey,
          });
        } catch (err) {
          console.warn(`[PoolDiscoveryCache] Failed to decode pool ${pubkey.toBase58()}:`, err);
        }
      }
      
      this.setAllPools(pools);
      console.log(`[PoolDiscoveryCache] Preloaded ${pools.length} pools in ${Date.now() - start}ms`);
    } catch (err) {
      console.warn(`[PoolDiscoveryCache] Failed to preload pools:`, err);
    }
  }

  // Clear expired entries
  clearExpired(): void {
    if (this.allPoolsCache && Date.now() - this.allPoolsCache.lastUpdated > this.CACHE_TTL) {
      this.allPoolsCache = null;
      this.poolByTokenCache.clear();
      console.log(`[PoolDiscoveryCache] Cleared expired cache`);
    }
  }
}

// Global cache instance
const poolCache = PoolDiscoveryCache.getInstance();

// Start background pool preloading immediately
poolCache.preloadAllPools();

// Refresh pools every 4 minutes to stay ahead of cache expiry
setInterval(() => {
  poolCache.preloadAllPools();
}, 4 * 60 * 1000);

export const getTokenPoolInfo = async (tokenMint: string): Promise<PoolInfo | null> => {
  const start = Date.now();
  console.log(`[getTokenPoolInfo] Looking for pool with token ${tokenMint}`);

  // First check individual token cache
  const cachedPool = poolCache.getPoolByToken(tokenMint);
  if (cachedPool) {
    console.log(`[getTokenPoolInfo] Found cached pool in ${Date.now() - start}ms`);
    return cachedPool;
  }

  // Check if we have all pools cached
  const allPools = poolCache.getAllPools();
  if (allPools) {
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

  // Fallback to fresh RPC call
  console.log(`[getTokenPoolInfo] No cache available, fetching from RPC...`);
  let decoded: any = null;
  let poolPubkey: PublicKey | null = null;

  const accounts = await connection.getProgramAccounts(pumpswap_amm_program_id);

  for (const { pubkey, account } of accounts) {
    const poolInfo = POOL_LAYOUT.decode(account.data as Buffer);
    if (poolInfo.baseMint.toBase58() === tokenMint || poolInfo.quoteMint.toBase58() === tokenMint) {
      console.log("Matched Base Mint:", poolInfo.baseMint.toBase58());
      decoded = poolInfo;
      poolPubkey = pubkey;
      break;
    }
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

// Export cache for external use (like preloading)
export const preloadPumpswapPools = () => {
  return poolCache.preloadAllPools();
};
