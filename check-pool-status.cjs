const { PublicKey } = require("@solana/web3.js");

// Test token
const TEST_TOKEN = "BmjaULzZoEKnGpwGMfdCSEeTio3giS1qgbGBnU5Gbonk";

async function checkPoolStatus() {
  console.log("🔍 Checking Pool Status for token:", TEST_TOKEN);
  console.log("=" .repeat(60));
  
  try {
    // Import the token detection service
    const { detectTokenPlatform, isBonkTokenGraduated } = await import("./src/service/token-detection-service.ts");
    
    console.log("\n📊 Detecting platform...");
    const platform = await detectTokenPlatform(TEST_TOKEN);
    console.log(`✅ Detected Platform: ${platform}`);
    
    // Additional graduation check for Bonk tokens
    if (platform === 'bonk' || platform === 'cpmm') {
      console.log("\n🎯 Checking graduation status...");
      const graduationStatus = await isBonkTokenGraduated(TEST_TOKEN);
      
      if (graduationStatus === true) {
        console.log("✅ Token is GRADUATED - has both Bonk and CPMM pools");
        console.log("   Recommendation: Use CPMM (Raydium) for trading");
      } else if (graduationStatus === false) {
        console.log("✅ Token is NOT graduated - only has Bonk pool");
        console.log("   Recommendation: Use Bonk pool for trading");
      } else {
        console.log("❓ Graduation status unknown");
      }
    }
    
    // Platform-specific recommendations
    console.log("\n💡 Trading Recommendations:");
    switch (platform) {
      case 'pumpfun':
        console.log("   🎯 Use PumpFun bonding curve (active launch)");
        break;
      case 'pumpswap':
        console.log("   🔄 Use PumpSwap DEX (graduated/listed)");
        break;
      case 'bonk':
        console.log("   🐕 Use Bonk pool (Raydium Launch Lab)");
        break;
      case 'cpmm':
        console.log("   🏊 Use Raydium CPMM (graduated Bonk)");
        break;
      case 'unknown':
        console.log("   ❓ Platform unknown - will try multiple DEXs");
        break;
      default:
        console.log("   ❓ Unknown platform");
    }
    
  } catch (error) {
    console.error("❌ Error checking pool status:", error.message);
  }
  
  console.log("\n" + "=" .repeat(60));
}

// Run the check
checkPoolStatus().catch(console.error); 