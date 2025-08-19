import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, NATIVE_MINT } from "@solana/spl-token";

const user = new PublicKey("8w8rukvJHXXDwP7YRsyigtTSM64FYnjz1GusUvViKoXK");
const mint = new PublicKey("8KebtdAbHA5kA96VsJTZssAYNA1CHoWYonwB9hn1p777");

const userTokenAta = getAssociatedTokenAddressSync(mint, user);
const userWsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, user);

console.log("User token ATA:", userTokenAta.toBase58());
console.log("User WSOL ATA:", userWsolAta.toBase58());

