import { getExternalPumpAddressService, initializeExternalPumpAddressService } from "./src/service/external-pump-address-service.js";

async function testExternalPumpAddressIntegration() {
  console.log("🧪 Testing External Pump Address Integration...\n");
  
  try {
    // Initialize the service
    console.log("1. Initializing external pump address service...");
    await initializeExternalPumpAddressService();
    
    const service = getExternalPumpAddressService();
    
    // Get usage statistics
    console.log("\n2. Getting usage statistics...");
    const stats = await service.getUsageStats();
    console.log("📊 Usage Statistics:", {
      total: stats.total,
      used: stats.used,
      available: stats.available,
      usagePercentage: `${stats.usagePercentage}%`
    });
    
    if (stats.available === 0) {
      console.log("⚠️  No addresses available for testing");
      return;
    }
    
    // Test getting an unused address
    console.log("\n3. Testing address allocation...");
    const testUserId = "test-user-" + Date.now();
    
    const address = await service.getUnusedPumpAddress(testUserId);
    if (address) {
      console.log("✅ Successfully allocated address:", {
        publicKey: address.publicKey,
        suffix: address.suffix,
        workerId: address.workerId,
        usedBy: address.usedBy
      });
      
      // Test validation
      console.log("\n4. Testing address validation...");
      const validation = await service.validatePumpAddress(address.publicKey);
      console.log("🔍 Validation result:", validation);
      
      // Test release
      console.log("\n5. Testing address release...");
      const released = await service.releasePumpAddress(address.publicKey);
      console.log("🔄 Release result:", released);
      
      // Verify release
      const validationAfterRelease = await service.validatePumpAddress(address.publicKey);
      console.log("🔍 Validation after release:", validationAfterRelease);
      
    } else {
      console.log("❌ Failed to allocate address");
    }
    
    // Get updated statistics
    console.log("\n6. Getting updated statistics...");
    const updatedStats = await service.getUsageStats();
    console.log("📊 Updated Statistics:", {
      total: updatedStats.total,
      used: updatedStats.used,
      available: updatedStats.available,
      usagePercentage: `${updatedStats.usagePercentage}%`
    });
    
    console.log("\n✅ External pump address integration test completed successfully!");
    
  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    // Cleanup
    const { cleanupExternalPumpAddressService } = await import("./src/service/external-pump-address-service.js");
    await cleanupExternalPumpAddressService();
    console.log("🧹 Cleanup completed");
  }
}

// Run the test
testExternalPumpAddressIntegration(); 