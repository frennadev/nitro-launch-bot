#!/usr/bin/env bun

/**
 * Test SolanaTracker Integration
 * This script tests the SolanaTracker service to ensure it's working properly
 */

import { config } from "dotenv";
config(); // Load environment variables

import { SolanaTrackerService } from "./src/services/token/solana-tracker-service";

async function testSolanaTracker() {
  console.log("🧪 Testing SolanaTracker Integration...\n");

  const solanaTracker = new SolanaTrackerService();

  // Test tokens (popular Solana tokens)
  const testTokens = [
    {
      name: "Wrapped SOL",
      address: "So11111111111111111111111111111111111111112",
    },
    {
      name: "USDC",
      address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    },
    {
      name: "Bonk",
      address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    },
  ];

  console.log("📊 Environment Configuration:");
  console.log(`   API Key: ${process.env.SOLANA_TRACKER_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`   Base URL: ${process.env.SOLANA_TRACKER_BASE_URL || 'https://data.solanatracker.io'}`);
  console.log("");

  for (const token of testTokens) {
    try {
      console.log(`🔍 Testing ${token.name} (${token.address.slice(0, 8)}...):`);
      
      const startTime = Date.now();
      const tokenInfo = await solanaTracker.getTokenInfo(token.address);
      const endTime = Date.now();
      
      if (tokenInfo) {
        console.log(`   ✅ Success (${endTime - startTime}ms)`);
        console.log(`   📝 Name: ${tokenInfo.name}`);
        console.log(`   🏷️  Symbol: ${tokenInfo.symbol}`);
        console.log(`   💰 Price: $${tokenInfo.price ? Number(tokenInfo.price).toFixed(6) : 'N/A'}`);
        console.log(`   📈 Market Cap: $${tokenInfo.marketCap ? tokenInfo.marketCap.toLocaleString() : 'N/A'}`);
        console.log(`   💧 Liquidity: $${tokenInfo.liquidity ? tokenInfo.liquidity.toLocaleString() : 'N/A'}`);
        console.log(`   📊 24h Volume: $${tokenInfo.volume24h ? tokenInfo.volume24h.toLocaleString() : 'N/A'}`);
        console.log(`   🔢 Decimals: ${tokenInfo.decimals}`);
        if (tokenInfo.holders) {
          console.log(`   👥 Holders: ${tokenInfo.holders.toLocaleString()}`);
        }
      } else {
        console.log(`   ❌ Failed: No data returned`);
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log("");
  }

  // Test cache functionality
  console.log("🗄️  Testing Cache Functionality:");
  try {
    const startTime = Date.now();
    await solanaTracker.getTokenInfo(testTokens[0].address); // Should hit cache
    const endTime = Date.now();
    console.log(`   ✅ Cache test completed (${endTime - startTime}ms - should be faster)`);
  } catch (error) {
    console.log(`   ❌ Cache test failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log("\n🎉 SolanaTracker integration test completed!");
  console.log("\n📋 Next Steps:");
  console.log("   1. If all tests passed, SolanaTracker is ready to use");
  console.log("   2. Start the bot with: bun run dev");
  console.log("   3. Start the job processor with: bun run job");
  console.log("   4. Monitor logs for any issues");
}

// Run the test
testSolanaTracker().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});