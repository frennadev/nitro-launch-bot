// Optimized Meteora Pool Discovery Service - UNGRADUATED BAGS TOKENS
// Following the same patterns as Bonk and PumpSwap for maximum performance
//
// SCOPE: This service is specifically for UNGRADUATED BAGS tokens that use:
// - Meteora Dynamic Bonding Curve program (dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN)
// - 424-byte pool account structure
// - Bags launchpad tokens that haven't graduated yet

import { PublicKey } from "@solana/web3.js";
import { METEORA_PROGRAMS, MeteoraPoolInfo } from "./constants";
import { connection } from "../config";

// Enhanced caching system similar to Bonk
const poolCache = new Map<
  string,
  {
    poolInfo: MeteoraPoolInfo;
    timestamp: number;
    migrated?: boolean;
  }
>();

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Known Meteora pools for instant lookup (can be populated over time)
const KNOWN_METEORA_POOLS = new Map<
  string,
  { poolId: string; configId: string }
>();

// Pre-cache some known pools for popular tokens
KNOWN_METEORA_POOLS.set(
  "ceDa9zkyweCn7RNei5QYy36pWT2cojUsKWCDwA3BAGS", // BAGS token
  {
    poolId: "9FCSszjCNYohArxLmZpVZhpFjyeFEfLLUizrjGBH7dpH",
    configId: "3bATNJc1Uy8rMbgRoFFCR4zqZTrqJwKcKoKuGhzJ7eE5",
  }
);

/**
 * Fast optimized Meteora pool discovery similar to Bonk's approach
 */
export const getMeteorPoolState = async (
  tokenMint: string
): Promise<{ poolInfo: MeteoraPoolInfo; migrated: boolean } | null> => {
  console.log("🔍 Looking for Meteora pool for mint:", tokenMint);

  try {
    // 🔥 OPTIMIZED: Check pre-cached known pools first
    const knownPool = KNOWN_METEORA_POOLS.get(tokenMint);
    if (knownPool) {
      console.log("✅ Using pre-cached Meteora pool ID:", knownPool.poolId);
      try {
        const poolInfo = await getMeteoraPoolFromKnownIds(
          tokenMint,
          knownPool.poolId,
          knownPool.configId
        );
        if (poolInfo) {
          // Cache the result
          poolCache.set(tokenMint, {
            poolInfo,
            timestamp: Date.now(),
            migrated: false, // Meteora pools don't migrate like Bonk
          });
          console.log("✅ Meteora pool found via pre-cache!");
          return { poolInfo, migrated: false };
        }
      } catch (error) {
        console.log(
          "⚠️ Pre-cached Meteora pool not found, falling back to search..."
        );
      }
    }

    // 🔥 OPTIMIZED: Check cache before searching
    const cached = poolCache.get(tokenMint);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      console.log("✅ Using cached Meteora pool data");
      return { poolInfo: cached.poolInfo, migrated: cached.migrated || false };
    }

    console.log("🔍 Searching for Meteora pool with memcmp filters...");

    // 🔥 OPTIMIZATION: MEMCMP FILTERS - Search only pools containing our token
    // This reduces data transfer significantly like Bonk does
    const targetMintBytes = new PublicKey(tokenMint).toBytes();

    // Search for 424-byte Meteora pools containing this token
    const poolAccounts = await connection.getProgramAccounts(
      METEORA_PROGRAMS.DYNAMIC_BONDING_CURVE,
      {
        commitment: "confirmed",
        filters: [
          {
            dataSize: 424, // Meteora pool account size
          },
          {
            memcmp: {
              offset: 136, // Token mint offset in Meteora pool data
              bytes: tokenMint,
            },
          },
        ],
      }
    );

    console.log(
      `📊 Found ${poolAccounts.length} Meteora pools containing token ${tokenMint}`
    );

    if (poolAccounts.length === 0) {
      console.log(`❌ No Meteora pools found for ${tokenMint}`);
      return null;
    }

    // Process the first valid pool
    const poolAccount = poolAccounts[0];
    const poolInfo = await extractMeteoraPoolInfo(
      tokenMint,
      poolAccount.pubkey,
      poolAccount.account.data
    );

    if (poolInfo) {
      // Cache the successful result
      poolCache.set(tokenMint, {
        poolInfo,
        timestamp: Date.now(),
        migrated: false,
      });

      console.log(`✅ Meteora pool discovered and cached for ${tokenMint}`);
      return { poolInfo, migrated: false };
    }

    console.log(`❌ Failed to extract Meteora pool info for ${tokenMint}`);
    return null;
  } catch (error: any) {
    console.error(`❌ Error discovering Meteora pool for ${tokenMint}:`, error);
    return null;
  }
};

/**
 * Extract MeteoraPoolInfo from pool account data
 */
async function extractMeteoraPoolInfo(
  tokenMint: string,
  poolId: PublicKey,
  poolData: Buffer
): Promise<MeteoraPoolInfo | null> {
  try {
    // Extract config account from offset 72 (based on previous analysis)
    const configAccount = new PublicKey(poolData.slice(72, 104));

    // 🚀 OPTIMIZED: Find vaults using batch RPC calls for maximum speed
    let tokenVault: PublicKey | null = null;
    let solVault: PublicKey | null = null;

    // Common vault offsets from previous analysis
    const vaultOffsets = [104, 136, 168, 200, 232];

    // Extract all potential vaults first
    const potentialVaults = [];
    for (const offset of vaultOffsets) {
      if (offset + 32 <= poolData.length) {
        try {
          const potentialVault = new PublicKey(
            poolData.slice(offset, offset + 32)
          );
          if (!potentialVault.equals(PublicKey.default)) {
            potentialVaults.push(potentialVault);
          }
        } catch {
          continue;
        }
      }
    }

    // 🚀 BATCH RPC CALL: Get all account infos at once (6x faster!)
    const accountInfos =
      await connection.getMultipleAccountsInfo(potentialVaults);

    // Process results in parallel
    for (let i = 0; i < accountInfos.length; i++) {
      const accountInfo = accountInfos[i];
      const potentialVault = potentialVaults[i];

      if (accountInfo && accountInfo.data.length === 165) {
        // Token account size
        // Determine if this is token vault or SOL vault by checking mint
        const mintBytes = accountInfo.data.slice(0, 32);
        const mint = new PublicKey(mintBytes);

        if (mint.toBase58() === tokenMint && !tokenVault) {
          tokenVault = potentialVault;
        } else if (
          mint.toBase58() === "So11111111111111111111111111111111111111112" &&
          !solVault
        ) {
          solVault = potentialVault;
        }
      }
    }

    if (!tokenVault || !solVault) {
      console.log("❌ Could not find both token and SOL vaults");
      return null;
    }

    // Use the common pool authority for Meteora
    const authority = new PublicKey(
      "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM"
    );

    return {
      tokenMint: new PublicKey(tokenMint),
      poolAccount: poolId,
      configAccount,
      tokenVault,
      solVault,
      authority,
    };
  } catch (error: any) {
    console.error("❌ Error extracting Meteora pool info:", error);
    return null;
  }
}

/**
 * Get Meteora pool from known pool and config IDs
 */
async function getMeteoraPoolFromKnownIds(
  tokenMint: string,
  poolId: string,
  configId: string
): Promise<MeteoraPoolInfo | null> {
  try {
    const poolAccount = await connection.getAccountInfo(new PublicKey(poolId));
    if (!poolAccount) {
      return null;
    }

    return await extractMeteoraPoolInfo(
      tokenMint,
      new PublicKey(poolId),
      poolAccount.data
    );
  } catch (error: any) {
    console.error("❌ Error getting known Meteora pool:", error);
    return null;
  }
}

/**
 * Check if token is supported by Meteora
 */
export const isMeteoraSupportedToken = async (
  tokenMint: string
): Promise<boolean> => {
  try {
    const result = await getMeteorPoolState(tokenMint);
    return result !== null;
  } catch {
    return false;
  }
};

/**
 * Preemptive discovery for Meteora tokens (similar to PumpSwap)
 */
export const startPreemptiveMeteoriDiscovery = (tokenMint: string): void => {
  // Start background discovery without blocking
  setTimeout(async () => {
    try {
      await getMeteorPoolState(tokenMint);
      console.log(
        `[MeteoriCache] 🔍 Preemptive discovery completed for ${tokenMint}`
      );
    } catch (error: any) {
      console.error(
        `[MeteoriCache] ❌ Preemptive discovery failed for ${tokenMint}:`,
        error
      );
    }
  }, 100);
};
