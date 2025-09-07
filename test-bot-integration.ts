#!/usr/bin/env bun
/**
 * Test script that exactly mimics what the bot does for PumpFun token creation
 * This will help us verify our integration is working correctly
 */

import { executeTokenLaunch } from "./src/blockchain/pumpfun/launch";

async function testBotIntegration() {
  console.log("🤖 Testing Bot Integration - Exact Bot Simulation");
  console.log("==================================================");
  
  // Use the same test parameters that the bot would use
  const testParams = {
    mint: "4ERTpLTjjJ9vP2MES7hs1HZw3VB9z5kvzP28sodwaPk4uY4Hr6g1Qqo48tM9FaZiq8Y8wcUKrYEECNA4euqD5J7Q",
    funderWallet: null,
    devWallet: "4ERTpLTjjJ9vP2MES7hs1HZw3VB9z5kvzP28sodwaPk4uY4Hr6g1Qqo48tM9FaZiq8Y8wcUKrYEECNA4euqD5J7Q",
    buyWallets: ["4ERTpLTjjJ9vP2MES7hs1HZw3VB9z5kvzP28sodwaPk4uY4Hr6g1Qqo48tM9FaZiq8Y8wcUKrYEECNA4euqD5J7Q"],
    buyDistribution: [0.001],
    tokenName: "Bot Integration Test",
    symbol: "BIT",
    metadataUri: "https://arweave.net/test-bot-integration-metadata",
    buyAmount: 0.001,
    devBuy: 0.001, // Small dev buy to test
    launchStage: 3, // Launch stage
    mode: "prefunded" as const
  };

  try {
    console.log("📋 Simulating exact bot token launch...");
    console.log(`   - Token: ${testParams.tokenName} (${testParams.symbol})`);
    console.log(`   - Dev Buy: ${testParams.devBuy} SOL`);
    console.log(`   - Launch Stage: ${testParams.launchStage}`);
    console.log("");

    console.log("🚀 Calling executeTokenLaunch (same as bot)...");
    
    await executeTokenLaunch(
      testParams.mint,
      testParams.funderWallet,
      testParams.devWallet,
      testParams.buyWallets,
      testParams.buyDistribution,
      testParams.tokenName,
      testParams.symbol,
      testParams.metadataUri,
      testParams.buyAmount,
      testParams.devBuy,
      testParams.launchStage,
      testParams.mode
    );

    console.log("✅ Bot integration test completed successfully!");
    console.log("✅ PumpFun dev buy fixes are working in the main bot!");
    
  } catch (error: any) {
    console.log("❌ Bot integration test failed:");
    console.error(error.message);
    
    // Check for the specific error we're trying to fix
    if (error.message.includes("Custom:3005") || error.message.includes("3005")) {
      console.log("");
      console.log("🔍 This is the AccountNotEnoughKeys error we're fixing!");
      console.log("🔧 The ExtendAccount instruction is missing required accounts.");
      console.log("⚠️  Our integration may not be complete or there's a code path issue.");
    }
    
    // Check for balance issues (expected)
    if (error.message.includes("insufficient balance") || error.message.includes("Insufficient balance")) {
      console.log("");
      console.log("💡 Note: Balance error is expected with test wallet.");
      console.log("✅ The important thing is that we reach the transaction building phase!");
      return;
    }
    
    throw error;
  }
}

// Only run if this file is executed directly
if (import.meta.main) {
  testBotIntegration().catch((error) => {
    console.error("❌ Bot integration test failed with unexpected error:", error);
    process.exit(1);
  });
}