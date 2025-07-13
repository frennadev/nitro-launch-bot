import { PublicKey } from "@solana/web3.js";

// PumpFun Program IDs and Discriminators
export const CREATE_DISCRIMINATOR = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);
export const BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
export const SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);

// Main Program IDs
export const PUMPFUN_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
export const TOKEN_METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

// Fee Accounts
export const PUMPFUN_FEE_ACCOUNT = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");

// PDAs (Program Derived Addresses)
export const [PUMPFUN_MINT_AUTHORITY, _] = PublicKey.findProgramAddressSync(
  [Buffer.from([109, 105, 110, 116, 45, 97, 117, 116, 104, 111, 114, 105, 116, 121])],
  PUMPFUN_PROGRAM
);

export const [PUMPFUN_GLOBAL_SETTINGS, __] = PublicKey.findProgramAddressSync(
  [Buffer.from([103, 108, 111, 98, 97, 108])],
  PUMPFUN_PROGRAM
);

export const [PUMPFUN_EVENT_AUTHORITY, ___] = PublicKey.findProgramAddressSync(
  [Buffer.from([95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121])],
  PUMPFUN_PROGRAM
);

// Maestro Bot Constants
export const MAESTRO_BOT_PROGRAM = new PublicKey("5L2QKqDn5ukJSWGyqR4RPvFvwnBabKWqAqMzH4heaQNB");
export const MAESTRO_FEE_ACCOUNT = new PublicKey("5L2QKqDn5ukJSWGyqR4RPvFvwnBabKWqAqMzH4heaQNB");
export const MAESTRO_FEE_AMOUNT = BigInt(1000000); // 0.001 SOL

// Platform Fee Constants
export const PLATFORM_FEE_WALLET = new PublicKey("C1QL4i1Dbt69eNfMRoxc1VZLsu4MgtmVKucrBDPg4Pop");
export const DEFAULT_PLATFORM_FEE_PERCENTAGE = 1.0; // 1% default platform fee 