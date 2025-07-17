import { PublicKey } from "@solana/web3.js";
import { pumpswap_amm_program_id } from "../service/pumpswap-service.ts";

// TEMPORARY: Use hardcoded creator vault authority to test if this works
// The dynamic derivation isn't matching what the Pumpswap program expects
export const getCreatorVaultAuthority = (creator: PublicKey) => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from([99, 114, 101, 97, 116, 111, 114, 95, 118, 97, 117, 108, 116]),
     creator.toBuffer()],
    pumpswap_amm_program_id
  )[0];
};
