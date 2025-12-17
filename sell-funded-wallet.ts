#!/usr/bin/env bun

/**
 * Script to sell tokens using the provided funded wallet
 * Wallet PK: 4ERTpLTjjJ9vP2MES7hs1HZw3VB9z5kvzP28sodwaPk4uY4Hr6g1Qqo48tM9FaZiq8Y8wcUKrYEECNA4euqD5J7Q
 * Mint: 9UQygEC7uoEwWCVy1Yo8RMHa3uLYc5MEZXqR7YWDn2Hu
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
import bs58 from "bs58";

const heliusRpcUrl = process.env.HELIUS_RPC_URL || process.env.UTILS_HELIUS_RPC;
if (!heliusRpcUrl) {
  throw new Error(
    "HELIUS_RPC_URL or UTILS_HELIUS_RPC environment variable is required"
  );
}
const connection = new Connection(heliusRpcUrl, "confirmed");

// Provided wallet and mint
const walletPrivateKey =
  "4ERTpLTjjJ9vP2MES7hs1HZw3VB9z5kvzP28sodwaPk4uY4Hr6g1Qqo48tM9FaZiq8Y8wcUKrYEECNA4euqD5J7Q";
const mintAddress = "9UQygEC7uoEwWCVy1Yo8RMHa3uLYc5MEZXqR7YWDn2Hu";

async function sellWithFundedWallet() {
  try {
    console.log("🚀 SELLING WITH FUNDED WALLET\n");

    // Create keypair from the provided private key
    const sellerKeypair = Keypair.fromSecretKey(bs58.decode(walletPrivateKey));
    console.log(`👤 Seller Wallet: ${sellerKeypair.publicKey.toString()}`);

    const mintPk = new PublicKey(mintAddress);
    console.log(`🪙 Token Mint: ${mintAddress}`);

    // Get token info
    console.log("\n🔍 Fetching token information...");
    const { bondingCurve } = getBondingCurve(mintPk);
    const bondingCurveData = await getBondingCurveData(bondingCurve);

    if (!bondingCurveData) {
      throw new Error("Token not found - not a valid PumpFun token");
    }

    console.log("✅ Valid PumpFun token!");
    console.log(`👨‍💼 Creator: ${bondingCurveData.creator}`);
    console.log(
      `💰 Virtual Token Reserves: ${bondingCurveData.virtualTokenReserves.toString()}`
    );
    console.log(
      `💎 Virtual SOL Reserves: ${bondingCurveData.virtualSolReserves.toString()}`
    );

    // Check SOL balance
    const solBalance = await connection.getBalance(sellerKeypair.publicKey);
    console.log(
      `\n💰 SOL Balance: ${(solBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`
    );

    if (solBalance < 0.005 * LAMPORTS_PER_SOL) {
      console.log("⚠️  WARNING: Low SOL balance for transaction fees");
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

      if (balance.value.decimals) {
        const readableBalance =
          Number(tokenBalance) / Math.pow(10, balance.value.decimals);
        console.log(
          `📊 Readable Balance: ${readableBalance.toLocaleString()} tokens`
        );
      }
    } catch (error) {
      console.log("❌ No token account found - wallet has no tokens");
      return;
    }

    if (tokenBalance === BigInt(0)) {
      console.log("❌ No tokens to sell");
      return;
    }

    // Sell a small amount for testing (1% of balance or minimum 1000 tokens)
    const tokensToSell =
      tokenBalance > BigInt(100000)
        ? tokenBalance / BigInt(100) // Sell 1% if you have more than 100k
        : tokenBalance / BigInt(10); // Sell 10% if less

    const minSolOutput = BigInt(1); // Very low slippage tolerance

    console.log(`\n🔧 Preparing sell transaction...`);
    console.log(`📤 Selling: ${tokensToSell.toString()} tokens`);
    console.log(
      `📊 Percentage: ${((Number(tokensToSell) / Number(tokenBalance)) * 100).toFixed(2)}% of balance`
    );
    console.log(`💎 Min SOL Output: ${minSolOutput.toString()} lamports`);

    // Create sell instruction using our corrected implementation
    const sellIx = sellInstruction(
      mintPk,
      new PublicKey(bondingCurveData.creator),
      sellerKeypair.publicKey,
      tokensToSell,
      minSolOutput
    );

    console.log("\n✅ Sell instruction created!");
    console.log(`📊 Accounts: ${sellIx.keys.length} (should be 14)`);

    // Show instruction details
    console.log("\n📋 Instruction Details:");
    const accountNames = [
      "global",
      "fee_recipient",
      "mint",
      "bonding_curve",
      "associated_bonding_curve",
      "associated_user",
      "user",
      "system_program",
      "creator_vault",
      "token_program",
      "event_authority",
      "program",
      "fee_config",
      "fee_program",
    ];

    sellIx.keys.forEach((key, index) => {
      const name = accountNames[index] || "unknown";
      console.log(
        `  ${index.toString().padStart(2)}: ${name.padEnd(20)} - ${key.pubkey.toString().substring(0, 8)}...`
      );
    });

    // Create and send transaction
    const transaction = new Transaction().add(sellIx);
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = sellerKeypair.publicKey;

    console.log("\n🚀 Sending ACTUAL sell transaction...");
    console.log("⏳ Please wait for confirmation...");

    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [sellerKeypair],
      {
        commitment: "confirmed",
        skipPreflight: false,
        maxRetries: 3,
      }
    );

    console.log(`\n🎉 SUCCESS! SELL TRANSACTION CONFIRMED!`);
    console.log(`📊 Transaction Signature: ${signature}`);
    console.log(`🔗 Solscan: https://solscan.io/tx/${signature}`);
    console.log(`🔗 SolanaFM: https://solana.fm/tx/${signature}`);

    // Wait a moment then check new balances
    console.log("\n⏳ Checking updated balances...");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const newSolBalance = await connection.getBalance(sellerKeypair.publicKey);
    const newTokenBalance = await connection.getTokenAccountBalance(sellerAta);

    const solDiff = newSolBalance - solBalance;
    const tokenDiff = tokenBalance - BigInt(newTokenBalance.value.amount);

    console.log(`\n📊 TRANSACTION RESULTS:`);
    console.log(
      `💰 SOL Balance: ${(newSolBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL (${solDiff > 0 ? "+" : ""}${(solDiff / LAMPORTS_PER_SOL).toFixed(6)})`
    );
    console.log(
      `🪙 Token Balance: ${newTokenBalance.value.amount} (-${tokenDiff.toString()})`
    );
    console.log(
      `💵 SOL Received: ${((solDiff + 5000) / LAMPORTS_PER_SOL).toFixed(6)} SOL (after fees)`
    );

    if (solDiff > 0) {
      console.log("\n🎉 SELL SUCCESSFUL! You received SOL for your tokens!");
    }
  } catch (error: any) {
    console.error("\n❌ SELL FAILED:", error.message);

    // Analyze the specific error
    if (error.message?.includes("0xbbd") || error.message?.includes("3005")) {
      console.log(
        "🚨 AccountNotEnoughKeys error - instruction structure issue!"
      );
    } else if (error.message?.includes("insufficient funds")) {
      console.log("💸 Insufficient funds for transaction fees");
    } else if (error.message?.includes("TokenAccountNotFoundError")) {
      console.log("🪙 Token account not found");
    } else if (error.message?.includes("InvalidAccountData")) {
      console.log("📊 Invalid account data");
    } else if (error.message?.includes("custom program error")) {
      console.log("🔧 Custom program error - check PumpFun program logic");
    }

    // Show transaction logs if available
    if (error.logs) {
      console.log("\n📜 Transaction Logs:");
      error.logs.forEach((log: string, i: number) => {
        console.log(`  ${i}: ${log}`);
      });
    }
  }
}

console.log("🔥 ACTUAL SELL TRANSACTION TEST");
console.log("💰 Using funded wallet with tokens");
console.log("🎯 Testing our corrected sell instruction\n");

sellWithFundedWallet();
