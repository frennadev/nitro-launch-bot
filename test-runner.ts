#!/usr/bin/env ts-node

import { runBonkTests } from "./test-bonk-service";
import { runCPMMTests } from "./test-cpmm-service";

async function runAllTests() {
  console.log("🚀 Starting All Service Tests...");
  console.log("=" .repeat(60));
  
  try {
    // Run Bonk tests
    console.log("\n🔥 Running Bonk Service Tests...");
    await runBonkTests();
    
    console.log("\n" + "=" .repeat(60));
    
    // Run CPMM tests
    console.log("\n📊 Running CPMM Service Tests...");
    await runCPMMTests();
    
    console.log("\n" + "=" .repeat(60));
    console.log("✅ All tests completed successfully!");
    
  } catch (error) {
    console.error("\n❌ Test suite failed:", error);
    process.exit(1);
  }
}

// Run all tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(console.error);
}

export { runAllTests }; 