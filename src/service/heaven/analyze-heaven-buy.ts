import {
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
} from "@solana/web3.js";
import { connection } from "../config";

// Usage: bun run src/services/heaven/analyze-heaven-buy.ts
// Goal: Decode a sample Heaven buy tx to extract program id(s), account list, and raw instruction data

const HEAVEN_PROGRAM = new PublicKey(
  "HEAVENoP2qxoeuF8Dj2oT1GHEnu49U5mJYkdeC8BAX2o"
);
const SAMPLE_TX =
  process.env.HEAVEN_TX ||
  "5nXsXJyft2avZeWTEMeRe4ZTqRCzgdhL33BXjKhvtrZ63fSU147JUzqFTXiAnEEm5K5xiqXZPb6Uf6WCMM7x13jE";

async function main() {
  const tx = await connection.getTransaction(SAMPLE_TX, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });
  if (!tx) {
    console.error("Transaction not found");
    return;
  }
  const vtx = tx.transaction as VersionedTransaction;
  const msg = vtx.message as TransactionMessage;
  const accountKeys = msg.getAccountKeys({
    accountKeysFromLookups: tx.meta?.loadedAddresses,
  });
  const allKeys: PublicKey[] = [
    ...accountKeys.staticAccountKeys,
    ...(accountKeys.accountKeysFromLookups?.writable || []),
    ...(accountKeys.accountKeysFromLookups?.readonly || []),
  ];

  const instructions = msg.compiledInstructions;
  console.log(`Instructions count: ${instructions.length}`);
  for (let idx = 0; idx < instructions.length; idx++) {
    const ix = instructions[idx];
    const programId = allKeys[ix.programIdIndex];
    const accounts = ix.accountKeyIndexes.map((i) => allKeys[i]);
    const isHeaven = programId?.equals(HEAVEN_PROGRAM);
    console.log(
      `\n#${idx} Program: ${programId?.toBase58()}${isHeaven ? " (HEAVEN)" : ""}`
    );
    console.log(
      `Accounts (${accounts.length}):`,
      accounts.map((a) => a?.toBase58())
    );
    console.log(
      `Data (hex ${ix.data.length} bytes):`,
      Buffer.from(ix.data).toString("hex")
    );
    if (isHeaven) {
      console.log("\nHeaven account owners & sizes:");
      for (let i = 0; i < accounts.length; i++) {
        const pk = accounts[i]!;
        const info = await connection.getAccountInfo(pk);
        console.log(
          `${i}: ${pk.toBase58()} owner=${info?.owner.toBase58()} size=${info?.data?.length}`
        );
      }
    }
  }
}

async function analyzeTokenAccounts() {
  console.log("\n=== Finding All Token Accounts for Our Mint ===");
  // Get all token accounts for our mint to understand the structure
  const tokenMint = new PublicKey(
    "8KebtdAbHA5kA96VsJTZssAYNA1CHoWYonwB9hn1p777"
  );
  try {
    const accounts = await connection.getTokenAccountsByMint(
      tokenMint,
      "confirmed"
    );
    console.log(
      `Found ${accounts.value.length} total token accounts for mint ${tokenMint.toBase58()}:`
    );

    for (const { pubkey, account } of accounts.value) {
      const data = account.data as Buffer;
      if (data.length >= 165) {
        const accOwner = new PublicKey(data.subarray(32, 64));
        const balanceNum = data.readBigUInt64LE(64);

        console.log(
          `  ${pubkey.toBase58()}: owner=${accOwner.toBase58()}, balance=${balanceNum.toString()}, program=${account.owner.toBase58()}`
        );
      }
    }
  } catch (e) {
    console.log("Failed to get token accounts by mint:", e);
  }
}

Promise.all([main(), analyzeTokenAccounts()]).catch((e) => console.error(e));
