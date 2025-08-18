import { PublicKey } from "@solana/web3.js";

/**
 * Meteora Program IDs
 */
export const METEORA_PROGRAMS = {
  DYNAMIC_BONDING_CURVE: new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"),
  DAMM_V2: new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"),
  POOLS: new PublicKey("Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB"),
} as const;

/**
 * Universal Meteora constants extracted from successful transactions
 */
export const METEORA_CONSTANTS = {
  // Swap instruction discriminator (consistent across all Meteora swaps)
  SWAP_DISCRIMINATOR: "f8c69e91e17587c8",
  
  // Universal accounts that appear in all Meteora transactions
  REFERRAL_TOKEN_ACCOUNT: new PublicKey("JNK45gwenyqjk85JN44XekEYytZFGRubTabSNSXgT9u"),
  EVENT_AUTHORITY: new PublicKey("8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF"),
  
  // WSOL account seed for deterministic derivation
  WSOL_SEED: "wsol-account",
  
  // Pool discovery data sizes to try
  POOL_DATA_SIZES: [200, 400, 424, 429, 600, 800, 1000, 1048, 1200],
  
  // Common offsets where token mints are stored in pool data
  TOKEN_MINT_OFFSETS: [8, 40, 43, 72, 75, 104, 136, 168],
} as const;

/**
 * Pool structure interface for discovered Meteora pools
 */
export interface MeteoraPoolInfo {
  // Pool identification
  poolId: PublicKey;
  configAccount: PublicKey;
  authority: PublicKey;
  
  // Token information
  baseMint: PublicKey;    // The token being traded
  quoteMint: PublicKey;   // Usually WSOL
  
  // Vault accounts
  baseVault: PublicKey;   // Token vault
  quoteVault: PublicKey;  // SOL/WSOL vault
  
  // Metadata
  dataSize: number;
  programId: PublicKey;
  
  // Raw data for debugging
  rawData?: Buffer;
}

/**
 * Swap instruction parameters
 */
export interface SwapParams {
  user: PublicKey;
  userTokenAccount: PublicKey;
  userWsolAccount: PublicKey;
  amountIn: bigint;
  minimumAmountOut: bigint;
  poolInfo: MeteoraPoolInfo;
}

/**
 * Known pool cache structure
 */
export interface CachedPoolInfo {
  poolInfo: MeteoraPoolInfo;
  timestamp: number;
  verified: boolean;
}

/**
 * Cache duration for pool information (5 minutes)
 */
export const POOL_CACHE_DURATION = 5 * 60 * 1000;