import { PublicKey } from "@solana/web3.js";
import { struct, u8, blob } from "@solana/buffer-layout";
import { publicKey, u64 } from "@solana/buffer-layout-utils";
import { connection } from "../common/connection";
import { CpmmPool, CpmmPoolState } from "./types";

export const CPMM_ID = new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");

// Layout matching the IDL's CpmmPoolState (packed, no padding beyond the final array)
export const POOL_STATE_LAYOUT = struct<CpmmPoolState>([
  u64("discriminator"),
  publicKey("amm_config"),
  publicKey("pool_creator"),
  publicKey("token_0_vault"),
  publicKey("token_1_vault"),
  publicKey("lp_mint"),
  publicKey("token_0_mint"),
  publicKey("token_1_mint"),
  publicKey("token_0_program"),
  publicKey("token_1_program"),
  publicKey("observation_key"),
  u8("auth_bump"),
  u8("status"),
  u8("lp_mint_decimals"),
  u8("mint_0_decimals"),
  u8("mint_1_decimals"),
  u64("lp_supply"),
  u64("protocol_fees_token_0"),
  u64("protocol_fees_token_1"),
  u64("fund_fees_token_0"),
  u64("fund_fees_token_1"),
  u64("open_time"),
  u64("recent_epoch"),
  blob(31 * 8, "padding"),
]);

const TOKEN0_MINT_OFFSET = 8 + 32 * 5; // = 168
const TOKEN1_MINT_OFFSET = TOKEN0_MINT_OFFSET + 32; // = 200

export const getCpmmPoolState = async (tokenMint: string): Promise<CpmmPool | null> => {
  const mintBase58 = new PublicKey(tokenMint).toBase58();

  // First try filtering on token0Mint:
  let accts = await connection.getProgramAccounts(CPMM_ID, {
    filters: [{ memcmp: { offset: TOKEN0_MINT_OFFSET, bytes: mintBase58 } }],
  });

  // If none, try token1Mint:
  if (accts.length === 0) {
    accts = await connection.getProgramAccounts(CPMM_ID, {
      filters: [{ memcmp: { offset: TOKEN1_MINT_OFFSET, bytes: mintBase58 } }],
    });
  }

  if (accts.length === 0) {
    return null;
  }

  // Decode just the first matching account:
  const firstAccount = accts[0];
  if (!firstAccount) {
    return null;
  }

  const { pubkey, account } = firstAccount;
  const decoded = POOL_STATE_LAYOUT.decode(account.data as Buffer) as CpmmPoolState;

  return {
    ...decoded,
    poolId: pubkey,
  };
};

export const getCpmmPoolInfo = async (tokenMint: string): Promise<CpmmPoolInfo | null> => {
  try {
    const pool = await getCpmmPoolState(tokenMint);
    
    if (!pool) {
      console.log(`No CPMM pool found for token: ${tokenMint}`);
      return null;
    }

    // Get token account balances
    const [token0Balance, token1Balance] = await Promise.all([
      connection.getTokenAccountBalance(pool.token_0_vault),
      connection.getTokenAccountBalance(pool.token_1_vault)
    ]);

    const token0Amount = token0Balance.value.uiAmount || 0;
    const token1Amount = token1Balance.value.uiAmount || 0;

    // Calculate price (assuming token1 is SOL/WSOL)
    const price = token0Amount > 0 ? token1Amount / token0Amount : 0;

    // Check if pool is active for trading (using liquidity and activity instead of just status)
    const hasLiquidity = pool.lp_supply > 0n;
    const isOpen = pool.open_time > 0n;
    const isActive = pool.recent_epoch > 0n;
    const hasGraduated = hasLiquidity && isOpen && isActive;

    return {
      poolId: pool.poolId.toBase58(),
      token0Mint: pool.token_0_mint.toBase58(),
      token1Mint: pool.token_1_mint.toBase58(),
      token0Vault: pool.token_0_vault.toBase58(),
      token1Vault: pool.token_1_vault.toBase58(),
      lpMint: pool.lp_mint.toBase58(),
      token0Decimals: pool.mint_0_decimals,
      token1Decimals: pool.mint_1_decimals,
      token0Balance,
      token1Balance,
      token0Amount,
      token1Amount,
      price,
      lpSupply: Number(pool.lp_supply),
      protocolFeesToken0: Number(pool.protocol_fees_token_0),
      protocolFeesToken1: Number(pool.protocol_fees_token_1),
      fundFeesToken0: Number(pool.fund_fees_token_0),
      fundFeesToken1: Number(pool.fund_fees_token_1),
      status: pool.status,
      openTime: Number(pool.open_time),
      recentEpoch: Number(pool.recent_epoch),
      hasGraduated,
      pool
    };
  } catch (error) {
    console.error("Error getting CPMM pool info:", error);
    return null;
  }
};

export interface CpmmPoolInfo {
  poolId: string;
  token0Mint: string;
  token1Mint: string;
  token0Vault: string;
  token1Vault: string;
  lpMint: string;
  token0Decimals: number;
  token1Decimals: number;
  token0Balance: any;
  token1Balance: any;
  token0Amount: number;
  token1Amount: number;
  price: number;
  lpSupply: number;
  protocolFeesToken0: number;
  protocolFeesToken1: number;
  fundFeesToken0: number;
  fundFeesToken1: number;
  status: number;
  openTime: number;
  recentEpoch: number;
  hasGraduated: boolean;
  pool: CpmmPool;
} 