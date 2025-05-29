import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export const generateKeypairs = (count: number) => {
  const keys = [];
  for (let i = 0; i < count; i++) {
    const key = Keypair.generate();
    keys.push({
      publicKey: key.publicKey.toBase58(),
      secretKey: bs58.encode(key.secretKey),
    });
  }
  return keys;
};
