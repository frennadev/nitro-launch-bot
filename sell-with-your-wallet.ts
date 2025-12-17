#!/usr/bin/env bun

/**
 * Script to sell tokens using YOUR wallet
 *
 * INSTRUCTIONS:
 * 1. Replace the PRIVATE_KEY array below with your wallet's private key
 * 2. Make sure your wallet has:
 *    - Some SOL for transaction fees (at least 0.01 SOL)
 *    - Tokens of the mint you want to sell
 * 3. Run: bun run sell-with-your-wallet.ts
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { sellInstruction } from "./src/blockchain/pumpfun/instructions";
import {
  getBondingCurveData,
  getBondingCurve,
} from "./src/blockchain/pumpfun/utils";

// 🔑 REPLACE THIS WITH YOUR PRIVATE KEY
const PRIVATE_KEY = [
  // Put your private key array here
  // Example: [123, 45, 67, 89, ...] (64 numbers)
  // You can get this from your wallet export
];

const heliusRpcUrl = process.env.HELIUS_RPC_URL || process.env.UTILS_HELIUS_RPC;
if (!heliusRpcUrl) {
  throw new Error(
    "HELIUS_RPC_URL or UTILS_HELIUS_RPC environment variable is required"
  );
}
const connection = new Connection(heliusRpcUrl, "confirmed");
const mintAddress = "9UQygEC7uoEwWCVy1Yo8RMHa3uLYc5MEZXqR7YWDn2Hu";

async function sellWithYourWallet() {
  try {
    console.log("🚀 SELLING WITH YOUR WALLET\n");

    // Check if private key is provided
    if (PRIVATE_KEY.length !== 64) {
      console.log(
        "❌ Please provide your private key in the PRIVATE_KEY array"
      );
      console.log(
        "💡 Export your private key from your wallet as a byte array"
      );
      console.log("📝 It should be 64 numbers like: [123, 45, 67, ...]");
      return;
    }

    // Create keypair from your private key
    const sellerKeypair = Keypair.fromSecretKey(new Uint8Array(PRIVATE_KEY));
    console.log(`👤 Your Wallet: ${sellerKeypair.publicKey.toString()}`);

    const mintPk = new PublicKey(mintAddress);
    console.log(`🪙 Token to Sell: ${mintAddress}`);

    // Get token info
    console.log("\n🔍 Fetching token information...");
    const { bondingCurve } = getBondingCurve(mintPk);
    const bondingCurveData = await getBondingCurveData(bondingCurve);

    if (!bondingCurveData) {
      throw new Error("Token not found - not a valid PumpFun token");
    }

    console.log("✅ Valid PumpFun token!");
    console.log(`👨‍💼 Creator: ${bondingCurveData.creator}`);

    // Check SOL balance
    const solBalance = await connection.getBalance(sellerKeypair.publicKey);
    console.log(
      `\n💰 SOL Balance: ${(solBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`
    );

    if (solBalance < 0.005 * LAMPORTS_PER_SOL) {
      console.log(
        "⚠️  WARNING: Low SOL balance. You need at least 0.005 SOL for transaction fees"
      );
      return;
    }

    // Check token balance
    const sellerAta = getAssociatedTokenAddressSync(
      mintPk,
      sellerKeypair.publicKey
    );
    console.log(`💳 Token Account: ${sellerAta.toString()}`);

    let tokenBalance = BigInt(0);
    try {
      const balance = await connection.getTokenAccountBalance(sellerAta);
      tokenBalance = BigInt(balance.value.amount);
      console.log(`🪙 Token Balance: ${tokenBalance.toString()} tokens`);
    } catch (error) {
      console.log(
        "❌ No token account found - you have no tokens of this mint"
      );
      return;
    }

    if (tokenBalance === BigInt(0)) {
      console.log("❌ No tokens to sell");
      return;
    }

    // Ask user how much to sell (for now, sell 10% or minimum 1000 tokens)
    const tokensToSell =
      tokenBalance > BigInt(10000)
        ? tokenBalance / BigInt(10) // Sell 10% if you have more than 10k
        : BigInt(1000); // Sell 1000 if you have less

    const minSolOutput = BigInt(1); // Minimum 1 lamport (very low slippage tolerance)

    console.log(`\n🔧 Preparing sell transaction...`);
    console.log(
      `📤 Selling: ${tokensToSell.toString()} tokens (${((Number(tokensToSell) / Number(tokenBalance)) * 100).toFixed(2)}% of balance)`
    );
    console.log(`💎 Min SOL Output: ${minSolOutput.toString()} lamports`);

    // Create sell instruction
    const sellIx = sellInstruction(
      mintPk,
      new PublicKey(bondingCurveData.creator),
      sellerKeypair.publicKey,
      tokensToSell,
      minSolOutput
    );

    console.log("✅ Sell instruction created!");
    console.log(`📊 Accounts: ${sellIx.keys.length} (should be 14)`);

    // Create and send transaction
    const transaction = new Transaction().add(sellIx);
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = sellerKeypair.publicKey;

    console.log("\n🚀 Sending sell transaction...");
    console.log("⏳ Please wait...");

    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [sellerKeypair],
      {
        commitment: "confirmed",
        skipPreflight: false,
      }
    );

    console.log(`\n🎉 SUCCESS! Sell transaction confirmed!`);
    console.log(`📊 Signature: ${signature}`);
    console.log(`🔗 Solscan: https://solscan.io/tx/${signature}`);
    console.log(`🔗 SolanaFM: https://solana.fm/tx/${signature}`);

    // Check new balances
    const newSolBalance = await connection.getBalance(sellerKeypair.publicKey);
    const newTokenBalance = await connection.getTokenAccountBalance(sellerAta);

    console.log(`\n📊 Updated Balances:`);
    console.log(
      `💰 SOL: ${(newSolBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL (${newSolBalance > solBalance ? "+" : ""}${((newSolBalance - solBalance) / LAMPORTS_PER_SOL).toFixed(4)})`
    );
    console.log(
      `🪙 Tokens: ${newTokenBalance.value.amount} (${BigInt(newTokenBalance.value.amount) < tokenBalance ? "-" : "+"}${(tokenBalance - BigInt(newTokenBalance.value.amount)).toString()})`
    );
  } catch (error: any) {
    console.error("❌ Error:", error.message);

    if (error.logs) {
      console.log("\n📜 Transaction Logs:");
      error.logs.forEach((log: string, i: number) => {
        console.log(`  ${i}: ${log}`);
      });
    }
  }
}

sellWithYourWallet();
