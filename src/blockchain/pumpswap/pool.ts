import { PublicKey } from "@solana/web3.js";
import { connection } from "../common/connection";
import { PUMPSWAP_AMM_PROGRAM_ID, PUMP_SWAP_POOL_DISCRIMINATOR } from "./constants";
import { struct, u16, u8 } from "@solana/buffer-layout";
import { publicKey, u64 } from "@solana/buffer-layout-utils";

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

// Pool data layout for decoding
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

// Simple cache for pool data
const poolCache = new Map<string, PoolInfo>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const cacheTimestamps = new Map<string, number>();

export const getTokenPoolInfo = async (tokenMint: string): Promise<PoolInfo | null> => {
  console.log(`[getTokenPoolInfo] Looking for pool with token ${tokenMint}`);
  
  // Check cache first
  const cached = poolCache.get(tokenMint);
  const timestamp = cacheTimestamps.get(tokenMint);
  if (cached && timestamp && Date.now() - timestamp < CACHE_TTL) {
    console.log(`[getTokenPoolInfo] Found cached pool for ${tokenMint}`);
    return cached;
  }

  try {
    // Do a full scan using memcmp filters for both baseMint and quoteMint positions
    console.log(`[getTokenPoolInfo] Scanning with memcmp filters for token ${tokenMint}...`);
    
    // Search for pools where baseMint matches our token
    const baseMintAccounts = await connection.getProgramAccounts(PUMPSWAP_AMM_PROGRAM_ID, {
      commitment: "confirmed",
      filters: [
        {
          memcmp: {
            offset: 8 + 1 + 2 + 32, // Skip discriminator, poolBump, index, creator
            bytes: tokenMint,
          },
        },
      ],
    });

    // Search for pools where quoteMint matches our token
    const quoteMintAccounts = await connection.getProgramAccounts(PUMPSWAP_AMM_PROGRAM_ID, {
      commitment: "confirmed",
      filters: [
        {
          memcmp: {
            offset: 8 + 1 + 2 + 32 + 32, // Skip discriminator, poolBump, index, creator, baseMint
            bytes: tokenMint,
          },
        },
      ],
    });

    console.log(`[getTokenPoolInfo] Found ${baseMintAccounts.length} pools with matching baseMint`);
    console.log(`[getTokenPoolInfo] Found ${quoteMintAccounts.length} pools with matching quoteMint`);

    // Combine and deduplicate results
    const allMatchingAccounts = [...baseMintAccounts, ...quoteMintAccounts];
    const uniqueAccounts = new Map();

    for (const account of allMatchingAccounts) {
      uniqueAccounts.set(account.pubkey.toBase58(), account);
    }

    const matchingAccounts = Array.from(uniqueAccounts.values());
    console.log(`[getTokenPoolInfo] Total unique matching pools: ${matchingAccounts.length}`);

    // Process all matching accounts
    for (const { pubkey, account } of matchingAccounts) {
      try {
        const poolInfo = POOL_LAYOUT.decode(account.data as Buffer);
        
        // Double-check that this pool actually contains our token
        if (poolInfo.baseMint.toBase58() === tokenMint || poolInfo.quoteMint.toBase58() === tokenMint) {
          console.log(`[getTokenPoolInfo] Found matching pool!`);
          console.log(`[getTokenPoolInfo]   Pool ID: ${pubkey.toBase58()}`);
          console.log(`[getTokenPoolInfo]   Base Mint: ${poolInfo.baseMint.toBase58()}`);
          console.log(`[getTokenPoolInfo]   Quote Mint: ${poolInfo.quoteMint.toBase58()}`);
          console.log(`[getTokenPoolInfo]   Pool Base Token Account: ${poolInfo.poolBaseTokenAccount.toBase58()}`);
          console.log(`[getTokenPoolInfo]   Pool Quote Token Account: ${poolInfo.poolQuoteTokenAccount.toBase58()}`);
          console.log(`[getTokenPoolInfo]   Coin Creator: ${poolInfo.coinCreator.toBase58()}`);

          const result: PoolInfo = {
            ...poolInfo,
            poolId: pubkey,
          };

          // Cache the result
          poolCache.set(tokenMint, result);
          cacheTimestamps.set(tokenMint, Date.now());
          
          console.log(`[getTokenPoolInfo] Pool cached successfully`);
          return result;
        }
      } catch (error) {
        console.warn(`[getTokenPoolInfo] Failed to decode pool ${pubkey.toBase58()}:`, error);
        continue;
      }
    }

    console.log(`[getTokenPoolInfo] No pool found for token ${tokenMint} after scanning ${matchingAccounts.length} matching pools`);
    return null;
  } catch (error) {
    console.error(`[getTokenPoolInfo] Error fetching pool data:`, error);
    return null;
  }
};

export const getBuyAmountOut = async (poolInfo: PoolInfo, amountIn: bigint, slippage: number) => {
  // Use real pool balances and constant product formula
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

export const getSellAmountOut = async (poolInfo: PoolInfo, amountIn: bigint, slippage: number) => {
  // Use real pool balances and constant product formula
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