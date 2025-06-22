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
  u64("coinCreator"),
]);

export const getTokenPoolInfo = async (tokenMint: string): Promise<PoolInfo | null> => {
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

  if (!decoded || !poolPubkey) return null;

  return {
    ...decoded,
    poolId: poolPubkey,
  };
};

export const getBuyAmountOut = async (poolInfo: PoolInfo, amountIn: bigint, slippage: number) => {
  const base_info = await connection.getTokenAccountBalance(poolInfo.poolBaseTokenAccount);
  const quote_info = await connection.getTokenAccountBalance(poolInfo.poolQuoteTokenAccount);
  const poolTokenBalance = BigInt(base_info.value?.amount || 0);
  const poolQuoteBalance = BigInt(quote_info.value?.amount || 0);

  const k = poolTokenBalance * poolQuoteBalance;
  const newPoolQuoteBalance = poolQuoteBalance + amountIn;
  const newPoolTokenBalance = k / newPoolQuoteBalance;
  const tokensOut = poolTokenBalance - newPoolTokenBalance;
  const tokensOutWithSlippage = (tokensOut * BigInt(100 - slippage)) / BigInt(100);
  return tokensOutWithSlippage;
};

export const getSellAmountOut = async (poolInfo: PoolInfo, amountIn: bigint, slippage: number) => {
  const base_info = await connection.getTokenAccountBalance(poolInfo.poolBaseTokenAccount);
  const quote_info = await connection.getTokenAccountBalance(poolInfo.poolQuoteTokenAccount);
  const poolTokenBalance = BigInt(base_info.value?.amount || 0);
  const poolQuoteBalance = BigInt(quote_info.value?.amount || 0);

  const k = poolTokenBalance * poolQuoteBalance;
  const newPoolTokenBalance = poolTokenBalance + amountIn;
  const newPoolQuoteBalance = k / newPoolTokenBalance;
  const tokensOut = poolQuoteBalance - newPoolQuoteBalance;
  const tokensOutWithSlippage = (tokensOut * BigInt(100 - slippage)) / BigInt(100);
  return tokensOutWithSlippage;
};
