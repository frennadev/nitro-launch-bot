import { PublicKey } from "@solana/web3.js";

export const CREATE_DISCRIMINATOR = [24, 30, 200, 40, 5, 28, 7, 119];
export const BUY_DISCRIMINATOR = [102, 6, 61, 18, 1, 218, 235, 234];
export const SELL_DISCRIMINATOR = [51, 230, 133, 164, 1, 127, 131, 173];
export const PUMPFUN_PROGRAM = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
);
export const TOKEN_METADATA_PROGRAM = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);
export const PUMPFUN_FEE_ACCOUNT = new PublicKey(
  "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM",
);
export const [PUMPFUN_MINT_AUTHORITY, _] = PublicKey.findProgramAddressSync(
  [
    Buffer.from([
      109, 105, 110, 116, 45, 97, 117, 116, 104, 111, 114, 105, 116, 121,
    ]),
  ],
  PUMPFUN_PROGRAM,
);
export const [PUMPFUN_GLOBAL_SETTINGS, __] = PublicKey.findProgramAddressSync(
  [Buffer.from([103, 108, 111, 98, 97, 108])],
  PUMPFUN_PROGRAM,
);
export const [PUMPFUN_EVENT_AUTHORITY, ___] = PublicKey.findProgramAddressSync(
  [
    Buffer.from([
      95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105,
      116, 121,
    ]),
  ],
  PUMPFUN_PROGRAM,
);
