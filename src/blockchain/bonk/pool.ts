import { struct, u16, u8, blob } from "@solana/buffer-layout";
import { publicKey, u64 } from "@solana/buffer-layout-utils";
import { PublicKey } from "@solana/web3.js";
import { connection } from "../../blockchain/common/connection";

export const BONK_PROGRAM_ID = new PublicKey(
  "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj"
);

export type BonkPoolState = {
  epoch: bigint;
  authBump: number;
  status: number;
  baseDecimals: number;
  quoteDecimals: number;
  migrateType: number;
  supply: bigint;
  totalBaseSell: bigint;
  virtualBase: bigint;
  virtualQuote: bigint;
  realBase: bigint;
  realQuote: bigint;
  totalQuoteFundRaising: bigint;
  quoteProtocolFee: bigint;
  platformFee: bigint;
  migrateFee: bigint;
  vestingSchedule: any;
  globalConfig: PublicKey;
  platformConfig: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  creator: PublicKey;
  padding: Buffer;
};

export interface PoolState extends BonkPoolState {
  poolId: PublicKey;
}

// Pool data layout for decoding
export const POOL_STATE_LAYOUT = struct<BonkPoolState>([
  u64("discriminator"),
  u64("epoch"),
  u8("authBump"),
  u8("status"),
  u8("baseDecimals"),
  u8("quoteDecimals"),
  u8("migrateType"),
  u64("supply"),
  u64("totalBaseSell"),
  u64("virtualBase"),
  u64("virtualQuote"),
  u64("realBase"),
  u64("realQuote"),
  u64("totalQuoteFundRaising"),
  u64("quoteProtocolFee"),
  u64("platformFee"),
  u64("migrateFee"),
  blob(40, "vestingSchedule"),
  publicKey("globalConfig"),
  publicKey("platformConfig"),
  publicKey("baseMint"),
  publicKey("quoteMint"),
  publicKey("baseVault"),
  publicKey("quoteVault"),
  publicKey("creator"),
  blob(8 * 8, "padding"),
]);

// Pre-cached known pools for instant access
const KNOWN_POOLS = new Map<string, { poolId: string; lastUpdated: number }>([
  [
    "2K2dBWwncM2ySZKMigXNpwgoarUJ5iJTHmqGmM87bonk",
    {
      poolId: "H3tHKk7fWk1JAEkxF5D5anSQ4EG5XmkHTYhhDx7eWcNN",
      lastUpdated: Date.now(),
    },
  ],
  [
    "24YQMHardsYbBgRJi5RDgNUi6VdVhMcfmmXWHEanbonk",
    {
      poolId: "7uH5emw81YG6gMMSXkNJn9yFoYTBEM5ADWFEFY8VnLMC",
      lastUpdated: Date.now(),
    },
  ],
  [
    "h3Sq2JCpcqzP9AudqJ4Vxy6M3TAaEhvZ9JPyDsobonk",
    {
      poolId: "C7BhhvjmeQGX1XoqWHgmtuQ8SjKSXrJ4qMApUM9i7tZW",
      lastUpdated: Date.now(),
    },
  ],
]);

// Cache for pool data to avoid repeated RPC calls
const poolCache = new Map<string, { pool: PoolState; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export const getBonkPoolState = async (
  tokenMint: string
): Promise<PoolState | null> => {
  const logId = `bonk-pool-${tokenMint.substring(0, 8)}`;
  console.log(`[${logId}]: 🔍 Looking for BONK pool for mint: ${tokenMint}`);

  try {
    // Check pre-cached known pools first
    const knownPool = KNOWN_POOLS.get(tokenMint);
    if (knownPool) {
      console.log(`[${logId}]: ✅ Using pre-cached pool ID: ${knownPool.poolId}`);
      try {
        const poolAccount = await connection.getAccountInfo(
          new PublicKey(knownPool.poolId)
        );
        if (poolAccount) {
          const poolInfo = POOL_STATE_LAYOUT.decode(poolAccount.data as Buffer);
          const result = {
            ...poolInfo,
            poolId: new PublicKey(knownPool.poolId),
          };

          // Cache the result for future use
          poolCache.set(tokenMint, { pool: result, timestamp: Date.now() });
          console.log(`[${logId}]: ✅ Pool found via pre-cache!`);
          return result;
        }
      } catch (error) {
        console.warn(`[${logId}]: ⚠️ Pre-cached pool not found, falling back to search...`);
      }
    }

    // Check cache before searching
    const cached = poolCache.get(tokenMint);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      console.log(`[${logId}]: ✅ Using cached pool data`);
      return cached.pool;
    }

    console.log(`[${logId}]: 🔍 Searching for pool with memcmp filters...`);

    // Search for pools where baseMint matches our token
    const baseMintAccounts = await connection.getProgramAccounts(
      BONK_PROGRAM_ID,
      {
        commitment: "confirmed",
        filters: [
          {
            memcmp: {
              offset: 205, // baseMint offset
              bytes: tokenMint,
            },
          },
        ],
      }
    );

    // Search for pools where quoteMint matches our token
    const quoteMintAccounts = await connection.getProgramAccounts(
      BONK_PROGRAM_ID,
      {
        commitment: "confirmed",
        filters: [
          {
            memcmp: {
              offset: 237, // quoteMint offset (205 + 32)
              bytes: tokenMint,
            },
          },
        ],
      }
    );

    // Combine and deduplicate results
    const allMatchingAccounts = [...baseMintAccounts, ...quoteMintAccounts];
    const uniqueAccounts = new Map();

    for (const account of allMatchingAccounts) {
      uniqueAccounts.set(account.pubkey.toBase58(), account);
    }

    const matchingAccounts = Array.from(uniqueAccounts.values());

    console.log(
      `[${logId}]: 📊 Found ${matchingAccounts.length} BONK pools containing token ${tokenMint}`
    );
    console.log(`[${logId}]:    Base mint matches: ${baseMintAccounts.length}`);
    console.log(`[${logId}]:    Quote mint matches: ${quoteMintAccounts.length}`);

    if (matchingAccounts.length === 0) {
      console.log(`[${logId}]: ❌ No BONK pools found for this token`);
      return null;
    }

    // Process only the matching pools
    let decoded: any = null;
    let poolPubkey: PublicKey | null = null;

    console.log(`[${logId}]: 🔧 Processing ${matchingAccounts.length} matching pools...`);

    for (const { pubkey, account } of matchingAccounts) {
      try {
        // Decode the full pool data
        if (account.data.length === 429) {
          const poolInfo = POOL_STATE_LAYOUT.decode(account.data as Buffer);

          // Double-check that this pool actually contains our token
          if (
            poolInfo.baseMint.toBase58() === tokenMint ||
            poolInfo.quoteMint.toBase58() === tokenMint
          ) {
            console.log(`[${logId}]: ✅ Found matching pool!`);
            console.log(`[${logId}]:    Pool ID: ${pubkey.toBase58()}`);
            console.log(`[${logId}]:    Base Mint: ${poolInfo.baseMint.toBase58()}`);
            console.log(`[${logId}]:    Quote Mint: ${poolInfo.quoteMint.toBase58()}`);
            console.log(`[${logId}]:    Account Size: ${account.data.length} bytes`);

            decoded = poolInfo;
            poolPubkey = pubkey;
            break; // We found the pool!
          }
        }
      } catch (error) {
        console.warn(`[${logId}]: ⚠️ Failed to decode pool ${pubkey.toBase58()}: ${error}`);
        continue;
      }
    }

    if (!decoded || !poolPubkey) {
      console.log(`[${logId}]: ❌ No pool found for token mint: ${tokenMint}`);
      console.log(`[${logId}]: 💡 Searched ${matchingAccounts.length} matching pools`);
      return null;
    }

    const result = {
      ...decoded,
      poolId: poolPubkey,
    };

    // Cache the result for future use
    poolCache.set(tokenMint, { pool: result, timestamp: Date.now() });

    // Add to known pools for instant access next time
    KNOWN_POOLS.set(tokenMint, {
      poolId: poolPubkey.toBase58(),
      lastUpdated: Date.now(),
    });

    console.log(`[${logId}]: ✅ Pool found and cached successfully!`);
    return result;
  } catch (error) {
    console.error(`[${logId}]: ❌ Error fetching pool data:`, error);
    return null;
  }
};

/**
 * Clear pool cache for a specific token
 */
export function clearPoolCache(tokenMint: string) {
  poolCache.delete(tokenMint);
  console.log(`[pool-cache]: Cleared cache for ${tokenMint.substring(0, 8)}`);
}

/**
 * Clear all pool cache
 */
export function clearAllPoolCache() {
  poolCache.clear();
  console.log(`[pool-cache]: Cleared all pool cache`);
}

/**
 * Get pool cache statistics
 */
export function getPoolCacheStats() {
  return {
    cachedPools: poolCache.size,
    knownPools: KNOWN_POOLS.size,
  };
} 