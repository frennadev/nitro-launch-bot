import { PublicKey } from "@solana/web3.js";

// Use the PumpFun program ID for creator vault derivation
// Creator vaults are always created under PumpFun program, even for graduated tokens
const PUMPFUN_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

export const getCreatorVaultAuthority = (creator: PublicKey): PublicKey => {
  // Use the same seed as PumpFun creator vault: "creator-vault"
  // This matches the PumpFun IDL and ensures compatibility with graduated tokens
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creator.toBuffer()],
    PUMPFUN_PROGRAM_ID  // Use PumpFun program ID, not Pumpswap program ID
  );
  return vaultAuthority;
};
