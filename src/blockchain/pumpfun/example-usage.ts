import { Keypair } from "@solana/web3.js";
import { 
  executePumpFunBuy, 
  executePumpFunSell, 
  executePumpFunSellAll,
  quoteBuy,
  quoteSell 
} from "./index";

/**
 * Example usage of PumpFun operations
 * This demonstrates how to use the simplified PumpFun integration
 */

// Example: Buy tokens on PumpFun
export async function exampleBuyTokens() {
  try {
    // Example token address (replace with actual token)
    const tokenAddress = "YOUR_TOKEN_ADDRESS_HERE";
    
    // Example buyer keypair (replace with actual keypair)
    const buyerKeypair = Keypair.generate(); // In real usage, load from private key
    
    // Amount of SOL to spend
    const solAmount = 0.1; // 0.1 SOL
    
    console.log(`Buying ${solAmount} SOL worth of tokens...`);
    
    const result = await executePumpFunBuy(tokenAddress, buyerKeypair, solAmount);
    
    if (result.success) {
      console.log("✅ Buy successful!");
      console.log(`Transaction signature: ${result.signature}`);
      console.log(`Tokens received: ${result.tokensReceived}`);
      console.log(`SOL spent: ${result.solSpent}`);
    } else {
      console.error("❌ Buy failed:", result.error);
    }
    
    return result;
  } catch (error) {
    console.error("Error in buy example:", error);
    throw error;
  }
}

// Example: Sell tokens on PumpFun
export async function exampleSellTokens() {
  try {
    // Example token address (replace with actual token)
    const tokenAddress = "YOUR_TOKEN_ADDRESS_HERE";
    
    // Example seller keypair (replace with actual keypair)
    const sellerKeypair = Keypair.generate(); // In real usage, load from private key
    
    // Amount of tokens to sell
    const tokenAmount = 1000000; // 1 million tokens (adjust based on token decimals)
    
    console.log(`Selling ${tokenAmount} tokens...`);
    
    const result = await executePumpFunSell(tokenAddress, sellerKeypair, tokenAmount);
    
    if (result.success) {
      console.log("✅ Sell successful!");
      console.log(`Transaction signature: ${result.signature}`);
      console.log(`SOL received: ${result.solReceived}`);
      console.log(`Tokens sold: ${result.tokensSold}`);
    } else {
      console.error("❌ Sell failed:", result.error);
    }
    
    return result;
  } catch (error) {
    console.error("Error in sell example:", error);
    throw error;
  }
}

// Example: Sell all tokens on PumpFun
export async function exampleSellAllTokens() {
  try {
    // Example token address (replace with actual token)
    const tokenAddress = "YOUR_TOKEN_ADDRESS_HERE";
    
    // Example seller keypair (replace with actual keypair)
    const sellerKeypair = Keypair.generate(); // In real usage, load from private key
    
    console.log("Selling all tokens...");
    
    const result = await executePumpFunSellAll(tokenAddress, sellerKeypair);
    
    if (result.success) {
      console.log("✅ Sell all successful!");
      console.log(`Transaction signature: ${result.signature}`);
      console.log(`SOL received: ${result.solReceived}`);
      console.log(`Tokens sold: ${result.tokensSold}`);
    } else {
      console.error("❌ Sell all failed:", result.error);
    }
    
    return result;
  } catch (error) {
    console.error("Error in sell all example:", error);
    throw error;
  }
}

// Example: Get buy quote
export async function exampleGetBuyQuote() {
  try {
    // Example bonding curve data (in real usage, fetch from blockchain)
    const virtualTokenReserve = BigInt(1000000000); // 1 billion tokens
    const virtualSolReserve = BigInt(1000000000);   // 1 SOL in lamports
    const realTokenReserve = BigInt(500000000);     // 500 million tokens
    
    // Amount of SOL to spend
    const solAmount = BigInt(100000000); // 0.1 SOL in lamports
    
    console.log(`Getting quote for ${solAmount} lamports...`);
    
    const quote = quoteBuy(solAmount, virtualTokenReserve, virtualSolReserve, realTokenReserve);
    
    console.log("📊 Buy Quote:");
    console.log(`Tokens to receive: ${quote.tokenOut.toString()}`);
    console.log(`New virtual token reserve: ${quote.newVirtualTokenReserve.toString()}`);
    console.log(`New virtual SOL reserve: ${quote.newVirtualSOLReserve.toString()}`);
    console.log(`New real token reserve: ${quote.newRealTokenReserve.toString()}`);
    
    return quote;
  } catch (error) {
    console.error("Error in buy quote example:", error);
    throw error;
  }
}

// Example: Get sell quote
export async function exampleGetSellQuote() {
  try {
    // Example bonding curve data (in real usage, fetch from blockchain)
    const virtualTokenReserves = BigInt(1000000000); // 1 billion tokens
    const virtualSolReserves = BigInt(1000000000);   // 1 SOL in lamports
    const realTokenReserves = BigInt(500000000);     // 500 million tokens
    
    // Amount of tokens to sell
    const tokenAmount = BigInt(1000000); // 1 million tokens
    
    console.log(`Getting sell quote for ${tokenAmount} tokens...`);
    
    const quote = quoteSell(tokenAmount, virtualTokenReserves, virtualSolReserves, realTokenReserves);
    
    console.log("📊 Sell Quote:");
    console.log(`SOL to receive: ${quote.solOut.toString()}`);
    console.log(`New virtual token reserves: ${quote.newVirtualTokenReserves.toString()}`);
    console.log(`New virtual SOL reserves: ${quote.newVirtualSolReserves.toString()}`);
    console.log(`New real token reserves: ${quote.newRealTokenReserves.toString()}`);
    
    return quote;
  } catch (error) {
    console.error("Error in sell quote example:", error);
    throw error;
  }
}

// Main example function
export async function runPumpFunExamples() {
  console.log("🚀 Running PumpFun Examples...\n");
  
  try {
    // Get quotes first (these don't require real keypairs)
    console.log("=== Getting Quotes ===");
    await exampleGetBuyQuote();
    console.log();
    await exampleGetSellQuote();
    console.log();
    
    // Note: The buy/sell examples require real keypairs and token addresses
    // Uncomment and modify these when you have real data
    /*
    console.log("=== Executing Transactions ===");
    await exampleBuyTokens();
    console.log();
    await exampleSellTokens();
    console.log();
    await exampleSellAllTokens();
    */
    
    console.log("✅ All examples completed!");
  } catch (error) {
    console.error("❌ Error running examples:", error);
  }
} 