import { PublicKey } from "@solana/web3.js";

export interface CpmmPoolState {
  discriminator: bigint;
  amm_config: PublicKey;
  pool_creator: PublicKey;
  token_0_vault: PublicKey;
  token_1_vault: PublicKey;
  lp_mint: PublicKey;
  token_0_mint: PublicKey;
  token_1_mint: PublicKey;
  token_0_program: PublicKey;
  token_1_program: PublicKey;
  observation_key: PublicKey;
  auth_bump: number;
  status: number;
  lp_mint_decimals: number;
  mint_0_decimals: number;
  mint_1_decimals: number;
  lp_supply: bigint;
  protocol_fees_token_0: bigint;
  protocol_fees_token_1: bigint;
  fund_fees_token_0: bigint;
  fund_fees_token_1: bigint;
  open_time: bigint;
  recent_epoch: bigint;
  padding: Uint8Array;
}

export interface CpmmPool extends CpmmPoolState {
  poolId: PublicKey;
}

// Legacy interface for backward compatibility
export interface LegacyCpmmPool {
  poolId: PublicKey;
  amm_config: PublicKey;
  token_0_mint: PublicKey;
  token_1_mint: PublicKey;
  token_0_vault: PublicKey;
  token_1_vault: PublicKey;
  observation_key: PublicKey;
  lp_mint: PublicKey;
  lp_vault: PublicKey;
  base_decimals: number;
  quote_decimals: number;
  lp_decimals: number;
  version: number;
  program_id: PublicKey;
  authority: PublicKey;
  open_orders: PublicKey;
  target_orders: PublicKey;
  base_vault: PublicKey;
  quote_vault: PublicKey;
  withdraw_queue: PublicKey;
  lp_vault_authority: PublicKey;
  market_version: number;
  market_program_id: PublicKey;
  market_id: PublicKey;
  market_authority: PublicKey;
  market_base_vault: PublicKey;
  market_quote_vault: PublicKey;
  market_bids: PublicKey;
  market_asks: PublicKey;
  market_event_queue: PublicKey;
}

export interface LegacyCpmmPoolState {
  base_reserve: bigint;
  quote_reserve: bigint;
  base_mint: PublicKey;
  quote_mint: PublicKey;
  pool: LegacyCpmmPool;
}

export interface CreateSwapBaseInputIX {
  pool: CpmmPool;
  payer: PublicKey;
  userInputTokenAccount: PublicKey;
  userOutputTokenAccount: PublicKey;
  amount_in: bigint;
  minimum_amount_out: bigint;
}

export interface CpmmBuyConfig {
  baseSlippage?: number;
  maxSlippage?: number;
  maxRetries?: number;
  lowLiquidityThreshold?: number;
  mediumLiquidityThreshold?: number;
  feeRateBasisPoints?: number;
  retryDelayMs?: number;
  retrySlippageBonus?: number;
  platformFeePercentage?: number;
  maestroFeePercentage?: number;
}

export interface CpmmBuyResult {
  success: boolean;
  signature?: string;
  tokensReceived?: string;
  solSpent?: string;
  error?: string;
}

export interface CpmmSellConfig {
  baseSlippage?: number;
  maxSlippage?: number;
  maxRetries?: number;
  lowLiquidityThreshold?: number;
  mediumLiquidityThreshold?: number;
  feeRateBasisPoints?: number;
  retryDelayMs?: number;
  retrySlippageBonus?: number;
  platformFeePercentage?: number;
  maestroFeePercentage?: number;
}

export interface CpmmSellResult {
  success: boolean;
  signature?: string;
  solReceived?: string;
  tokensSold?: string;
  error?: string;
} 