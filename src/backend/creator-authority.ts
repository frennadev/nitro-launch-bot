import { PublicKey } from "@solana/web3.js";

// Define the program ID directly to avoid circular imports
const PUMPSWAP_AMM_PROGRAM_ID = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");

export const getCreatorVaultAuthority = (creator: PublicKey): PublicKey => {
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-authority"), creator.toBuffer()],
    PUMPSWAP_AMM_PROGRAM_ID
  );
  return vaultAuthority;
};
