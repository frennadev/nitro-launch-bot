#!/usr/bin/env ts-node

import { PublicKey } from "@solana/web3.js";
import { getBonkPoolState } from "./src/service/bonk-pool-service";
import { getCpmmPoolState } from "./src/backend/get-cpmm-poolinfo";

interface TestConfig {
  bonkTokens: string[];
  cpmmTokens: string[];
  wallet: {
    privateKey: string;
    publicKey: string;
  };
}

async function validateTokenAddress(tokenAddress: string, type: 'bonk' | 'cpmm'): Promise<boolean> {
  try {
    // Validate the address format
    new PublicKey(tokenAddress);
    
    // Test pool detection
    if (type === 'bonk') {
      const pool = await getBonkPoolState(tokenAddress);
      return pool !== null;
    } else {
      const pool = await getCpmmPoolState(tokenAddress);
      return pool !== null;
    }
  } catch (error) {
    return false;
  }
}

async function setupTestEnvironment() {
  console.log("🔧 Setting up Test Environment...");
  console.log("=" .repeat(50));
  
  console.log("\n📋 Instructions:");
  console.log("1. Replace the placeholder values below with your actual token addresses and wallet info");
  console.log("2. Run this script to validate your configuration");
  console.log("3. Then run the test scripts");
  
  // Example configuration - replace with your actual values
  const config: TestConfig = {
    bonkTokens: [
      "YOUR_BONK_TOKEN_ADDRESS_1", // Replace with actual Bonk token address
      "YOUR_BONK_TOKEN_ADDRESS_2", // Replace with actual Bonk token address
    ],
    cpmmTokens: [
      "YOUR_GRADUATED_BONK_TOKEN_ADDRESS_1", // Replace with actual graduated Bonk token address
      "YOUR_GRADUATED_BONK_TOKEN_ADDRESS_2", // Replace with actual graduated Bonk token address
    ],
    wallet: {
      privateKey: "YOUR_PRIVATE_KEY_HERE", // Replace with actual private key
      publicKey: "YOUR_PUBLIC_KEY_HERE",   // Replace with actual public key
    }
  };
  
  console.log("\n🔍 Validating Configuration...");
  
  // Validate wallet
  try {
    new PublicKey(config.wallet.publicKey);
    console.log("✅ Wallet public key format is valid");
  } catch (error) {
    console.log("❌ Wallet public key format is invalid");
  }
  
  // Validate Bonk tokens
  console.log("\n🔥 Validating Bonk Tokens...");
  for (let i = 0; i < config.bonkTokens.length; i++) {
    const token = config.bonkTokens[i];
    if (token === "YOUR_BONK_TOKEN_ADDRESS_1") {
      console.log(`   Token ${i + 1}: ⚠️  Not configured (placeholder)`);
      continue;
    }
    
    const isValid = await validateTokenAddress(token, 'bonk');
    if (isValid) {
      console.log(`   Token ${i + 1}: ✅ Valid Bonk token with pool`);
    } else {
      console.log(`   Token ${i + 1}: ❌ Invalid or no pool found`);
    }
  }
  
  // Validate CPMM tokens
  console.log("\n📊 Validating CPMM Tokens...");
  for (let i = 0; i < config.cpmmTokens.length; i++) {
    const token = config.cpmmTokens[i];
    if (token === "YOUR_GRADUATED_BONK_TOKEN_ADDRESS_1") {
      console.log(`   Token ${i + 1}: ⚠️  Not configured (placeholder)`);
      continue;
    }
    
    const isValid = await validateTokenAddress(token, 'cpmm');
    if (isValid) {
      console.log(`   Token ${i + 1}: ✅ Valid CPMM token with pool`);
    } else {
      console.log(`   Token ${i + 1}: ❌ Invalid or no pool found`);
    }
  }
  
  console.log("\n📝 Next Steps:");
  console.log("1. Update the test files with your actual token addresses and wallet info");
  console.log("2. Run: npx ts-node test-bonk-service.ts");
  console.log("3. Run: npx ts-node test-cpmm-service.ts");
  console.log("4. Or run both: npx ts-node test-runner.ts");
  
  console.log("\n⚠️  Important Notes:");
  console.log("- Make sure you have sufficient SOL balance for testing");
  console.log("- Test with small amounts first");
  console.log("- Keep your private keys secure and never commit them to version control");
}

// Run setup if this file is executed directly
if (require.main === module) {
  setupTestEnvironment().catch(console.error);
}

export { setupTestEnvironment }; 