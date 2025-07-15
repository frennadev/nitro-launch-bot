import { Connection } from "@solana/web3.js";
import { env } from "../../config.ts";

export const connection = new Connection(env.UTILS_HELIUS_RPC);
