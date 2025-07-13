import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { 
  executePumpFunBuy, 
  executePumpFunSell,
  getBondingCurve,
  getBondingCurveData
} from "./src/blockchain/pumpfun";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { connection } from "./src/blockchain/common/connection";

// Test configuration with real data
const PRIVATE_KEY = "43WgY2ekSNR8hxAAS62qq5MC4UWCakiFxaDVBir9qsHVJvGH9HnpnwNi9fNmxRUL4nxjVQwsGFfNnaHKXBKn3CgU";
const TOKEN_ADDRESS = "5keYAvXbEZguebHu5qdVwsopzXL1frx9Ex9yKV9epump";
const BUY_AMOUNT = 0.01; // 0.01 SOL

// Create keypair from private key
const keypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));

console.log("🚀 Testing Real PumpFun Buy/Sell Operations");
console.log("============================================\n");

console.log("Configuration:");
console.log(`- Token Address: ${TOKEN_ADDRESS}`);
console.log(`- Wallet Address: ${keypair.publicKey.toBase58()}`);
console.log(`- Buy Amount: ${BUY_AMOUNT} SOL`);
console.log("");

async function testBondingCurveData() {
  console.log("1️⃣ Fetching Bonding Curve Data...");
  try {
    const { bondingCurve } = getBondingCurve(new PublicKey(TOKEN_ADDRESS));
    console.log(`✅ Bonding curve PDA: ${bondingCurve.toBase58()}`);
    
    const bondingCurveData = await getBondingCurveData(bondingCurve);
    if (bondingCurveData) {
      console.log("✅ Bonding curve data fetched successfully");
      console.log(`   - Virtual Token Reserves: ${bondingCurveData.virtualTokenReserves.toString()}`);
      console.log(`   - Virtual SOL Reserves: ${bondingCurveData.virtualSolReserves.toString()}`);
      console.log(`   - Real Token Reserves: ${bondingCurveData.realTokenReserves.toString()}`);
      console.log(`   - Creator: ${bondingCurveData.creator}`);
    } else {
      console.log("❌ Bonding curve data not found - token may not be on PumpFun");
      return false;
    }
    return true;
  } catch (error) {
    console.error("❌ Error fetching bonding curve data:", error);
    return false;
  }
}

async function testBuyOperation() {
  console.log("\n2️⃣ Testing Buy Operation...");
  console.log(`💰 Buying ${BUY_AMOUNT} SOL worth of tokens...`);
  
  try {
    const result = await executePumpFunBuy(TOKEN_ADDRESS, keypair, BUY_AMOUNT);
    
    if (result.success) {
      console.log("✅ Buy operation successful!");
      console.log(`   - Transaction signature: ${result.signature}`);
      console.log(`   - Tokens received: ${result.tokensReceived}`);
      console.log(`   - SOL spent: ${result.solSpent}`);
      return true;
    } else {
      console.log("❌ Buy operation failed:");
      console.log(`   - Error: ${result.error}`);
      return false;
    }
  } catch (error) {
    console.error("❌ Error in buy operation:", error);
    return false;
  }
}

async function testSellOperation() {
  console.log("\n3️⃣ Testing Sell Operation...");
  
  try {
    // Fetch the actual token balance from the wallet
    const mintPk = new PublicKey(TOKEN_ADDRESS);
    const ata = getAssociatedTokenAddressSync(mintPk, keypair.publicKey);
    const tokenBalance = await connection.getTokenAccountBalance(ata);
    const actualTokenBalance = Number(tokenBalance.value.amount);
    console.log(`💸 Selling actual wallet balance: ${actualTokenBalance} tokens...`);
    
    if (actualTokenBalance <= 0) {
      console.log("❌ No tokens to sell.");
      return false;
    }
    
    const result = await executePumpFunSell(TOKEN_ADDRESS, keypair, actualTokenBalance);
    
    if (result.success) {
      console.log("✅ Sell operation successful!");
      console.log(`   - Transaction signature: ${result.signature}`);
      console.log(`   - SOL received: ${result.solReceived}`);
      console.log(`   - Tokens sold: ${result.tokensSold}`);
      return true;
    } else {
      console.log("❌ Sell operation failed:");
      console.log(`   - Error: ${result.error}`);
      return false;
    }
  } catch (error) {
    console.error("❌ Error in sell operation:", error);
    return false;
  }
}

async function runRealTest() {
  try {
    console.log("🔍 Starting real PumpFun test...\n");
    
    // Step 1: Check bonding curve data
    const hasBondingCurve = await testBondingCurveData();
    if (!hasBondingCurve) {
      console.log("❌ Cannot proceed - token not found on PumpFun");
      return;
    }
    
    // Step 2: Buy tokens
    const buySuccess = await testBuyOperation();
    if (!buySuccess) {
      console.log("❌ Cannot proceed - buy operation failed");
      return;
    }
    
    // Wait a bit for transaction to confirm
    console.log("\n⏳ Waiting 5 seconds for transaction confirmation...");
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Step 3: Sell tokens (use actual wallet balance)
    const sellSuccess = await testSellOperation();
    if (!sellSuccess) {
      console.log("❌ Sell operation failed");
      return;
    }
    
    // Summary
    console.log("\n🎉 Test Summary:");
    console.log("=================");
    console.log(`✅ Buy: ${BUY_AMOUNT} SOL → (see wallet for tokens)`);
    console.log(`✅ Sell: (see wallet for tokens) → (see wallet for SOL)`);
    
  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

// Run the test
runRealTest().catch(console.error); 