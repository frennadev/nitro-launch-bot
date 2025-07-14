import { PublicKey } from "@solana/web3.js";

// CPMM Program ID
export const CPMM_ID = new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");

// Raydium Authority
export const RAYDIUM_AUTHORITY = new PublicKey("GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL");

// Platform fee wallet
export const PLATFORM_FEE_WALLET = new PublicKey("C1QL4i1Dbt69eNfMRoxc1VZLsu4MgtmVKucrBDPg4Pop");

// Maestro Bot constants
export const MAESTRO_BOT_PROGRAM = new PublicKey("5L2QKqDn5ukJSWGyqR4RPvFvwnBabKWqAqMzH4heaQNB");
export const MAESTRO_FEE_ACCOUNT = new PublicKey("5L2QKqDn5ukJSWGyqR4RPvFvwnBabKWqAqMzH4heaQNB");

// Instruction discriminators
export const SWAP_BASE_INPUT_DISCRIMINATOR = Buffer.from([143, 190, 90, 218, 196, 30, 51, 222]);

// Default configuration
export const DEFAULT_CONFIG = {
  baseSlippage: 35,
  maxSlippage: 70,
  maxRetries: 3,
  lowLiquidityThreshold: 5,
  mediumLiquidityThreshold: 20,
  feeRateBasisPoints: 25,
  retryDelayMs: 1000,
  retrySlippageBonus: 10,
  platformFeePercentage: 1.0, // 1% platform fee
  maestroFeePercentage: 0.25, // 0.25% Maestro fee
}; 