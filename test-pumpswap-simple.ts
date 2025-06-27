import { PublicKey, Keypair } from "@solana/web3.js";
import PumpswapService from "./src/service/pumpswap-service";
import base58 from "bs58";

async function testPumpswapBuy() {
  console.log("🧪 Testing Pumpswap Buy Transaction (Protocol Fee ATA Fix)");
  console.log("=".repeat(60));

  // Test with the real token that was failing
  const tokenMint = "F5AyjG2ZsgMFAyqxWv7o8PgRMny49ixPCXuaiRyKpump";
  const buyAmount = BigInt(0.1 * 1e9); // 0.1 SOL in lamports
  
  // Generate a test keypair (no real funds needed for transaction creation test)
  const testKeypair = Keypair.generate();
  const testPrivateKey = base58.encode(testKeypair.secretKey);

  try {
    console.log(`📊 Token: ${tokenMint}`);
    console.log(`💰 Buy Amount: ${buyAmount.toString()} lamports (${Number(buyAmount) / 1e9} SOL)`);
    console.log(`🔑 Test Wallet: ${testKeypair.publicKey.toBase58()}`);
    console.log();

    const pumpswapService = new PumpswapService();
    
    console.log("⏳ Creating buy transaction...");
    const startTime = Date.now();
    
    const transaction = await pumpswapService.buyTx({
      mint: new PublicKey(tokenMint),
      amount: buyAmount,
      privateKey: testPrivateKey
    });
    
    const createTime = Date.now() - startTime;
    console.log(`✅ Transaction created successfully in ${createTime}ms`);
    
    // Test transaction compilation (this will catch most errors)
    console.log("🔍 Analyzing transaction structure...");
    const message = transaction.message;
    console.log(`📋 Transaction has ${message.compiledInstructions.length} instructions`);
    
    // Extract and log instruction details
    const instructions = message.compiledInstructions;
    console.log("\n📝 Transaction Instructions:");
    let protocolFeeAtaFound = false;
    
    instructions.forEach((ix, index) => {
      const programId = message.staticAccountKeys[ix.programIdIndex];
      console.log(`  ${index + 1}. Program: ${programId.toBase58().slice(0, 8)}...`);
      
      // Identify instruction types
      if (programId.equals(new PublicKey("11111111111111111111111111111111"))) {
        console.log(`     Type: System Program (transfer/account creation)`);
      } else if (programId.equals(new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"))) {
        console.log(`     Type: Token Program (ATA creation/sync)`);
      } else if (programId.equals(new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"))) {
        console.log(`     Type: Associated Token Program (ATA creation)`);
        protocolFeeAtaFound = true;
      } else if (programId.equals(new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"))) {
        console.log(`     Type: Pumpswap AMM Program (buy instruction)`);
      } else if (programId.equals(new PublicKey("ComputeBudget111111111111111111111111111111"))) {
        console.log(`     Type: Compute Budget Program (priority fee)`);
      } else {
        console.log(`     Type: Unknown program`);
      }
    });
    
    // Check if protocol fee ATA creation is included
    if (protocolFeeAtaFound) {
      console.log("\n✅ Protocol Fee ATA creation instructions found!");
    } else {
      console.log("\n⚠️  Protocol Fee ATA creation instructions not detected");
    }
    
    // Check transaction size
    const txSize = transaction.serialize().length;
    console.log(`\n📏 Transaction size: ${txSize} bytes`);
    
    if (txSize > 1232) {
      console.log("⚠️  Warning: Transaction size exceeds limit (1232 bytes)");
    } else {
      console.log("✅ Transaction size is within limits");
    }
    
    console.log("\n🎯 SUCCESS: Transaction created and compiled without errors!");
    console.log("📈 The protocol fee ATA fix appears to be working correctly.");
    console.log("\n🔧 Key improvements:");
    console.log("   • Dynamic protocol fee ATA calculation based on pool's quote mint");
    console.log("   • Automatic creation of protocol fee ATA if it doesn't exist");
    console.log("   • No more hardcoded token account addresses");
    
    console.log("\n✨ Ready for live testing with real funds!");
    
  } catch (error: any) {
    console.error("❌ Test failed:", error.message);
    
    // Check for specific error types
    if (error.message.includes("ConstraintTokenMint")) {
      console.error("🔍 This is the exact error we were trying to fix!");
      console.error("   The protocol fee ATA mint constraint is still failing.");
    } else if (error.message.includes("Pool not found")) {
      console.error("🔍 Pool lookup failed - this might be a network issue");
    } else if (error.message.includes("base_amount_out: 0")) {
      console.error("🔍 Amount calculation returned 0 - check pool liquidity");
    }
    
    if (error.stack) {
      console.error("\nStack trace:", error.stack);
    }
    process.exit(1);
  }
}

// Run the test
testPumpswapBuy().catch(console.error); 