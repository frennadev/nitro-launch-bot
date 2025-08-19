// Heaven Pool Discovery - Following Meteora/Bonk patterns
// Implements robust pool discovery using getProgramAccounts with memcmp filters

import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  NATIVE_MINT,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { logger } from "../../utils/logger";
import { connection } from "../config";

const HEAVEN_PROGRAM_ID = new PublicKey(
  "HEAVENoP2qxoeuF8Dj2oT1GHEnu49U5mJYkdeC8BAX2o"
);
const HEAVEN_EVENT_AUTHORITY = new PublicKey(
  "HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny"
);

// Shared Heaven accounts (discovered from transaction analysis - same across all tokens)
const HEAVEN_SHARED_WSOL_VAULT = new PublicKey(
  "B3GPPWAh2SJk74H6vnn1U83HfTPHtCK69jzponadrT21"
);
const HEAVEN_SHARED_EXTRA_CONFIG = new PublicKey(
  "42mepa9xLCtuerAEnnDY43KLRN5dgkrkKvoCT6nDZsyj"
);

export interface HeavenPoolInfo {
  poolConfig: PublicKey;
  tokenVault: PublicKey;
  wsolVault: PublicKey;
  extraConfig: PublicKey;
  tokenRecipient?: PublicKey;
  programDerived: PublicKey;
}

// Cache for discovered pools to avoid repeated RPC calls
const poolCache = new Map<
  string,
  { poolInfo: HeavenPoolInfo; timestamp: number }
>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Discover Heaven DEX pool for a token using optimized memcmp search
 * Following the same pattern as Meteora and Bonk discovery
 */
export async function discoverHeavenPool(
  tokenMint: string
): Promise<HeavenPoolInfo | null> {
  const logId = `heaven-discovery-${tokenMint.substring(0, 8)}`;
  logger.info(`[${logId}] Starting Heaven pool discovery`);

  try {
    // Check cache first
    const cached = poolCache.get(tokenMint);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      logger.info(`[${logId}] Using cached pool data`);
      return cached.poolInfo;
    }

    // Use memcmp filters to search for Heaven pools containing this token
    logger.info(`[${logId}] Searching for Heaven pools with memcmp filters...`);

    const poolMatches = await searchHeavenPools(tokenMint, logId);

    if (poolMatches.length === 0) {
      logger.info(`[${logId}] No Heaven pools found`);
      return null;
    }

    // Process the first pool match
    const poolAccount = poolMatches[0];
    const poolInfo = await extractHeavenPoolInfo(tokenMint, poolAccount, logId);

    if (poolInfo) {
      // Cache the successful result
      poolCache.set(tokenMint, {
        poolInfo,
        timestamp: Date.now(),
      });

      logger.info(`[${logId}] ✅ Heaven pool discovered and cached`);
      return poolInfo;
    }

    logger.warn(`[${logId}] Failed to extract pool info from discovered pools`);
    return null;
  } catch (error: any) {
    logger.error(`[${logId}] Pool discovery failed: ${error.message}`);
    return null;
  }
}

/**
 * Search for Heaven pools using memcmp filters (following Meteora/Bonk pattern)
 */
async function searchHeavenPools(
  tokenMint: string,
  logId: string
): Promise<
  Array<{ pubkey: PublicKey; account: any; dataSize: number; offset: number }>
> {
  const allMatches = [];

  // All Heaven pools are 2304 bytes based on analysis
  const dataSizes = [2304];

  // Token mints are stored at offset 792 in Heaven pool data (discovered from pool analysis)
  const offsets = [792];

  logger.info(
    `[${logId}] Searching across ${dataSizes.length} data sizes and ${offsets.length} offsets`
  );

  for (const dataSize of dataSizes) {
    for (const offset of offsets) {
      try {
        const accounts = await connection.getProgramAccounts(
          HEAVEN_PROGRAM_ID,
          {
            commitment: "confirmed",
            filters: [
              { dataSize },
              {
                memcmp: {
                  offset,
                  bytes: tokenMint,
                },
              },
            ],
          }
        );

        if (accounts.length > 0) {
          logger.info(
            `[${logId}] Found ${accounts.length} pools at offset ${offset}, size ${dataSize}`
          );
          allMatches.push(
            ...accounts.map((acc) => ({ ...acc, dataSize, offset }))
          );
        }
      } catch (error) {
        // Silent fail for invalid combinations
        logger.debug(
          `[${logId}] Search failed at offset ${offset}, size ${dataSize}:`,
          error
        );
      }
    }
  }

  logger.info(`[${logId}] Total pool matches found: ${allMatches.length}`);
  return allMatches;
}

/**
 * Extract Heaven pool information from discovered pool account
 * Following the same pattern as Meteora's extractMeteoraPoolInfo
 */
async function extractHeavenPoolInfo(
  tokenMint: string,
  poolAccount: {
    pubkey: PublicKey;
    account: any;
    dataSize: number;
    offset: number;
  },
  logId: string
): Promise<HeavenPoolInfo | null> {
  try {
    const { pubkey: poolId, account } = poolAccount;
    const poolData = account.data as Buffer;
    const tokenMintPk = new PublicKey(tokenMint);

    logger.info(`[${logId}] Extracting pool info from ${poolId.toBase58()}`);

    // Extract all potential PublicKeys from the pool data
    // Check every byte offset, not just 32-byte aligned addresses
    const potentialPubkeys = [];
    for (let offset = 0; offset <= poolData.length - 32; offset++) {
      try {
        const pubkey = new PublicKey(poolData.slice(offset, offset + 32));
        if (!pubkey.equals(PublicKey.default)) {
          potentialPubkeys.push({ pubkey, offset });
        }
      } catch {
        // Invalid pubkey, skip
      }
    }

    logger.info(
      `[${logId}] Found ${potentialPubkeys.length} potential accounts in pool data`
    );

    // Get account info for all potential accounts to identify their types
    const pubkeys = potentialPubkeys.map((item) => item.pubkey);
    const accountInfos = await connection.getMultipleAccountsInfo(pubkeys);

    let tokenVault: PublicKey | null = null;
    let wsolVault: PublicKey | null = null;
    let extraConfig: PublicKey | null = null;
    let programDerived: PublicKey | null = null;

    // Use shared accounts discovered from transaction analysis
    wsolVault = HEAVEN_SHARED_WSOL_VAULT;
    extraConfig = HEAVEN_SHARED_EXTRA_CONFIG;
    programDerived = HEAVEN_EVENT_AUTHORITY;

    logger.info(`[${logId}] Using shared Heaven accounts:`);
    logger.info(`[${logId}]   WSOL Vault: ${wsolVault.toBase58()}`);
    logger.info(`[${logId}]   Extra Config: ${extraConfig.toBase58()}`);

    // Try direct approach: Find all Token-2022 accounts that hold our target token
    try {
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        HEAVEN_PROGRAM_ID,
        { mint: tokenMintPk },
        "confirmed"
      );

      if (tokenAccounts.value.length > 0) {
        // Use the first token account as our vault
        tokenVault = tokenAccounts.value[0].pubkey;
        logger.info(
          `[${logId}] ✅ Found Token-2022 vault directly: ${tokenVault.toBase58()}`
        );
      } else {
        logger.info(
          `[${logId}] No existing Token-2022 accounts found for this token`
        );
      }
    } catch (error) {
      logger.warn(
        `[${logId}] Failed to query token accounts: ${String(error)}`
      );
    }

    // Fallback: Find the token-specific vault by checking accounts in pool data
    if (!tokenVault) {
      for (let i = 0; i < accountInfos.length; i++) {
        const accountInfo = accountInfos[i];
        const { pubkey, offset } = potentialPubkeys[i];

        if (!accountInfo) continue;

        // Check if it's a Token-2022 account that holds our target token
        if (
          accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID) &&
          accountInfo.data.length >= 165
        ) {
          const vaultMintBytes = accountInfo.data.slice(0, 32);
          const vaultMint = new PublicKey(vaultMintBytes);

          if (vaultMint.equals(tokenMintPk) && !tokenVault) {
            tokenVault = pubkey;
            logger.info(
              `[${logId}] ✅ Found Token-2022 vault in pool data: ${pubkey.toBase58()} at pool offset ${offset}`
            );
            break; // Found our token vault, we're done
          }
        }
      }
    }

    // Handle missing token vault for untraded tokens
    if (!tokenVault) {
      logger.info(
        `[${logId}] Token vault not found - token likely hasn't been traded yet`
      );
      logger.info(
        `[${logId}] Creating derived vault address for first transaction`
      );

      // For untraded tokens, try various PDA derivation patterns
      // Since Heaven program address is off-curve, vaults are PDAs not ATAs
      const pdalReferencePatterns = [
        ["vault", new PublicKey(tokenMint).toBuffer()],
        ["token_vault", new PublicKey(tokenMint).toBuffer()],
        [new PublicKey(tokenMint).toBuffer(), Buffer.from("vault")],
        [poolId.toBuffer(), new PublicKey(tokenMint).toBuffer()],
        [
          Buffer.from("vault"),
          poolId.toBuffer(),
          new PublicKey(tokenMint).toBuffer(),
        ],
      ];

      for (const seeds of pdalReferencePatterns) {
        try {
          const [derivedVault] = PublicKey.findProgramAddressSync(
            seeds.map((seed) =>
              typeof seed === "string" ? Buffer.from(seed, "utf8") : seed
            ),
            HEAVEN_PROGRAM_ID
          );
          logger.info(
            `[${logId}] Testing PDA vault with seeds [${seeds.map((s) => (s instanceof Buffer ? (s.length === 32 ? "pubkey" : s.toString()) : s)).join(", ")}]: ${derivedVault.toBase58()}`
          );

          // For now, use the first derivation
          tokenVault = derivedVault;
          logger.info(
            `[${logId}] ✅ Using PDA token vault: ${tokenVault.toBase58()}`
          );
          break;
        } catch (error: any) {
          logger.debug(
            `[${logId}] PDA derivation failed with seeds: ${error.message}`
          );
          continue;
        }
      }

      if (!tokenVault) {
        logger.warn(`[${logId}] All PDA derivation patterns failed`);
        return null;
      }
    }

    // Validate we have all required components
    if (!tokenVault || !wsolVault) {
      logger.warn(
        `[${logId}] Missing required vaults (token: ${!!tokenVault}, wsol: ${!!wsolVault})`
      );
      return null;
    }

    // Build the pool info with fallbacks
    const poolInfo: HeavenPoolInfo = {
      poolConfig: poolId,
      tokenVault: tokenVault,
      wsolVault: wsolVault,
      extraConfig: extraConfig || poolId, // Fallback to pool config
      programDerived: programDerived || HEAVEN_EVENT_AUTHORITY, // Fallback to event authority
    };

    logger.info(`[${logId}] ✅ Successfully extracted Heaven pool info:`, {
      poolConfig: poolInfo.poolConfig.toBase58(),
      tokenVault: poolInfo.tokenVault.toBase58(),
      wsolVault: poolInfo.wsolVault.toBase58(),
      extraConfig: poolInfo.extraConfig.toBase58(),
      programDerived: poolInfo.programDerived.toBase58(),
    });

    return poolInfo;
  } catch (error: any) {
    logger.error(`[${logId}] Error extracting pool info:`, error);
    return null;
  }
}
