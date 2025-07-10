import { executeBonkBuy } from "./src/service/bonk-transaction-handler.js";

const PRIVATE_KEY = "3hPxZVjwr5wHmDGWgeYn1mX7S4SCXevw9u63mLanwuxTjJm5qcdSfHMG3bwVkHM418fejVV8Umu2m7KwyyPdWbgS";
const TOKEN_MINT = "24YQMHardsYbBgRJi5RDgNUi6VdVhMcfmmXWHEanbonk";
const BUY_AMOUNT_SOL = 0.005;

async function testBonkBuy() {
  console.log("🚀 Testing Bonk Buy Transaction...\n");
  console.log("📋 Transaction Details:");
  console.log(`   Token Mint: ${TOKEN_MINT}`);
  console.log(`   Buy Amount: ${BUY_AMOUNT_SOL} SOL`);
  console.log(`   Wallet: ${PRIVATE_KEY.substring(0, 8)}...${PRIVATE_KEY.substring(PRIVATE_KEY.length - 8)}`);
  console.log("   Config Mode: aggressive (for better success rate)");
  console.log("");

  try {
    console.log("🔄 Executing Bonk buy transaction...");
    const startTime = Date.now();
    
    const result = await executeBonkBuy(
      PRIVATE_KEY,
      TOKEN_MINT,
      BUY_AMOUNT_SOL,
      "aggressive" // Use aggressive config for better success rate
    );
    
    const executionTime = Date.now() - startTime;
    
    if (result.success) {
      console.log("✅ Bonk Buy Transaction Successful!");
      console.log(`   Execution Time: ${executionTime}ms`);
      console.log(`   Signature: ${result.signature}`);
      console.log(`   Explorer: ${result.explorerUrl}`);
      console.log(`   Message: ${result.message}`);
    } else {
      console.log("❌ Bonk Buy Transaction Failed:");
      console.log(`   Error: ${result.error}`);
      console.log(`   Message: ${result.message}`);
      console.log(`   Execution Time: ${executionTime}ms`);
    }
    
  } catch (error) {
    console.error("💥 Unexpected error during Bonk buy:", error);
  }
}

// Run the test
testBonkBuy().catch(console.error); 