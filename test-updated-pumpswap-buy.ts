import { PublicKey, Keypair } from "@solana/web3.js";
import PumpswapService from "./src/service/pumpswap-service.js";
import base58 from "bs58";

const TOKEN_ADDRESS = "Dk1vj8wDKpsSabiVD7nMCrZsankGV215pZ3G3JWNpuMP";
const PRIVATE_KEY = "4ERTpLTjjJ9vP2MES7hs1HZw3VB9z5kvzP28sodwaPk4uY4Hr6g1Qqo48tM9FaZiq8Y8wcUKrYEECNA4euqD5J7Q";

async function testUpdatedPumpswapBuy() {
  console.log(`🚀 Testing UPDATED pumpswap buy with volume tracking for: ${TOKEN_ADDRESS}`);
  console.log("=" .repeat(75));

  try {
    // Verify the keypair
    const keypair = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY));
    console.log(`Wallet address: ${keypair.publicKey.toBase58()}`);

    console.log("\n🎯 Testing updated pumpswap buy with 23 accounts...");
    
    const pumpswapService = new PumpswapService();
    
    // Create buy data - small amount for testing
    const buyData = {
      mint: new PublicKey(TOKEN_ADDRESS),
      privateKey: PRIVATE_KEY,
      amount: BigInt(1000000) // 0.001 SOL
    };

    console.log(`Token: ${buyData.mint.toBase58()}`);
    console.log(`Wallet: ${keypair.publicKey.toBase58()}`);
    console.log(`Buy Amount: ${Number(buyData.amount) / 1e9} SOL`);

    try {
      console.log("\n🚀 Creating buy transaction with updated accounts...");
      
      // Test transaction creation (not sending)
      const buyTx = await pumpswapService.buyTx(buyData);
      
      console.log(`\n✅ BUY TRANSACTION CREATED SUCCESSFULLY!`);
      console.log(`📊 Transaction details:`);
      console.log(`   - Signatures: ${buyTx.signatures.length}`);
      console.log(`   - Instructions: ${buyTx.message.compiledInstructions.length}`);
      console.log(`   - Transaction size: ${buyTx.serialize().length} bytes`);
      
      console.log(`\n🎉 PUMPSWAP BUY WORKING WITH UPDATED ACCOUNTS!`);
      console.log(`💡 Transaction ready to send (not sending in test)`);
      
    } catch (buyError: any) {
      console.log(`\n❌ Buy transaction failed:`);
      console.log(`Error: ${buyError.message}`);
      
      if (buyError.message.includes("AccountNotEnoughKeys")) {
        console.log(`\n🔍 Still missing accounts - need to check account order or derivation`);
      } else if (buyError.message.includes("Provided seeds do not result in a valid address")) {
        console.log(`\n🔍 ATA derivation error - this should be fixed`);
      } else if (buyError.message.includes("Insufficient balance")) {
        console.log(`\n🔍 Wallet balance issue - expected for test`);
      } else if (buyError.message.includes("custom program error")) {
        console.log(`\n🔍 Program error - checking logs for details`);
      } else {
        console.log(`\n🔍 Different error - investigating...`);
      }
      
      // Show key parts of error for debugging
      if (buyError.message.includes("Logs:")) {
        const logs = buyError.message.split("Logs:")[1];
        console.log(`\nTransaction logs:${logs}`);
      }
    }

  } catch (error) {
    console.error("❌ Error during updated pumpswap buy test:", error);
  }

  console.log("\n" + "=".repeat(75));
  console.log("🏁 Updated pumpswap buy test completed!");
}

testUpdatedPumpswapBuy().catch(console.error);
