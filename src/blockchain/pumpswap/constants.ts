import { PublicKey } from "@solana/web3.js";

// PumpSwap Program IDs - Updated to match reference implementation
export const PUMPSWAP_AMM_PROGRAM_ID = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

// Fee Accounts - Updated to match reference implementation
export const GLOBAL_CONFIG = new PublicKey("ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw");
export const PUMPFUN_AMM_PROTOCOL_FEE = new PublicKey("FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz");
export const PROTOCOL_FEE_ATA = new PublicKey("7xQYoUjUJF1Kg6WVczoTAkaNhn5syQYcbvjmFrhjWpx");
export const EVENT_AUTHORITY = new PublicKey("GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR");
export const COIN_CREATOR_VAULT_AUTHORITY = new PublicKey("Ciid5pckEwdLw5juAtNiQSpmhHzsdcfCQs7h989SPR4T");

// Legacy fee accounts (keeping for compatibility)
export const MAESTRO_FEE_ACCOUNT = new PublicKey("5L2QKqDn5ukJSWGyqR4RPvFvwnBabKWqAqMzH4heaQNB");
export const MAESTRO_FEE_AMOUNT = BigInt(1000000); // 0.001 SOL
export const PLATFORM_FEE_WALLET = new PublicKey("C1QL4i1Dbt69eNfMRoxc1VZLsu4MgtmVKucrBDPg4Pop");
export const DEFAULT_PLATFORM_FEE_PERCENTAGE = 1.0; // 1% default platform fee

// Discriminators
export const BUY_DISCRIMINATOR = [102, 6, 61, 18, 1, 218, 235, 234];
export const SELL_DISCRIMINATOR = [51, 230, 133, 164, 1, 127, 131, 173];

// Pool discriminator for validation
export const PUMP_SWAP_POOL_DISCRIMINATOR = [241, 154, 109, 4, 17, 177, 109, 188]; 