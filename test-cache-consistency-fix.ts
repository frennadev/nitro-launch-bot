import { PublicKey, Keypair } from "@solana/web3.js";
import PumpswapService from "./src/service/pumpswap-service.js";
import base58 from "bs58";

const TOKEN_ADDRESS = "Dk1vj8wDKpsSabiVD7nMCrZsankGV215pZ3G3JWNpuMP";
const PRIVATE_KEY = "4ERTpLTjjJ9vP2MES7hs1HZw3VB9z5kvzP28sodwaPk4uY4Hr6g1Qqo48tM9FaZiq8Y8wcUKrYEECNA4euqD5J7Q";

async function testCacheConsistencyFix() {
  console.log(`🔧 Testing cache consistency fix for: ${TOKEN_ADDRESS}`);
  console.log("=" .repeat(75));

  try {
    // Verify the keypair
    const keypair = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY));
    console.log(`Wallet address: ${keypair.publicKey.toBase58()}`);

    console.log("\n🎯 Testing multiple pumpswap calls with different PublicKey objects...");
    
    const pumpswapService = new PumpswapService();

    // First call - this will populate the cache
    console.log("\n🚀 First call (will populate cache)...");
    const sellData1 = {
      mint: new PublicKey(TOKEN_ADDRESS), // First PublicKey object
      privateKey: PRIVATE_KEY,
    };

    try {
      await pumpswapService.sellTx(sellData1);
    } catch (error: any) {
      console.log(`First call result: ${error.message}`);
    }

    // Second call - this will use cached data but with a different PublicKey object
    console.log("\n🚀 Second call (will use cache with different PublicKey object)...");
    const sellData2 = {
      mint: new PublicKey(TOKEN_ADDRESS), // Different PublicKey object (same address)
      privateKey: PRIVATE_KEY,
    };

    console.log(`PublicKey objects are different: ${sellData1.mint !== sellData2.mint}`);
    console.log(`But addresses are same: ${sellData1.mint.toBase58() === sellData2.mint.toBase58()}`);

    try {
      await pumpswapService.sellTx(sellData2);
      console.log(`\n✅ CACHE CONSISTENCY FIX WORKING!`);
      console.log(`💡 Second call succeeded despite using different PublicKey object`);
    } catch (error: any) {
      console.log(`Second call result: ${error.message}`);
      
      if (error.message.includes("Provided seeds do not result in a valid address")) {
        console.log(`\n❌ Cache consistency issue still present`);
        console.log(`💡 The cached mintPublicKey doesn't match the current PublicKey object`);
      } else if (error.message.includes("No tokens to sell")) {
        console.log(`\n✅ Cache consistency fix working!`);
        console.log(`💡 ATA derivation error resolved, now getting expected 'No tokens' error`);
      }
    }

    // Third call - test that the fix works consistently
    console.log("\n🚀 Third call (another different PublicKey object)...");
    const sellData3 = {
      mint: new PublicKey(TOKEN_ADDRESS), // Yet another PublicKey object
      privateKey: PRIVATE_KEY,
    };

    try {
      await pumpswapService.sellTx(sellData3);
      console.log(`\n✅ CONSISTENT BEHAVIOR CONFIRMED!`);
    } catch (error: any) {
      console.log(`Third call result: ${error.message}`);
      
      if (error.message.includes("No tokens to sell")) {
        console.log(`\n✅ Cache consistency fix working consistently!`);
      }
    }

  } catch (error) {
    console.error("❌ Error during cache consistency test:", error);
  }

  console.log("\n" + "=".repeat(75));
  console.log("🏁 Cache consistency test completed!");
}

testCacheConsistencyFix().catch(console.error);
