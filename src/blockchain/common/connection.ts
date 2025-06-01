import { Connection } from "@solana/web3.js";
import { env } from "../../config";

export const connection = new Connection(env.HELIUS_RPC_URL)
