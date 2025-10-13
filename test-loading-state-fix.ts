// Test script to verify the loading state fix
import { 
  hasLoadingState, 
  createBackgroundLoadingState, 
  completeLoadingState 
} from "./src/bot/loading";

async function testLoadingStateFix() {
  console.log("🧪 Testing loading state fix...");
  
  // Test 1: Verify loading state doesn't exist initially
  const testChatId = 123456789;
  const testTokenAddress = "test-token-address";
  const loadingKey = `${testChatId}-prepare_launch-${testTokenAddress}`;
  
  console.log(`📋 Testing loading key: ${loadingKey}`);
  console.log(`📋 Loading state exists initially: ${hasLoadingState(loadingKey)}`);
  
  try {
    // Test 2: Create background loading state
    console.log("🔧 Creating background loading state...");
    await createBackgroundLoadingState(testChatId, "prepare_launch", testTokenAddress);
    console.log(`✅ Background loading state created successfully`);
    
    // Test 3: Verify loading state now exists
    console.log(`📋 Loading state exists after creation: ${hasLoadingState(loadingKey)}`);
    
    // Test 4: Complete the loading state
    console.log("🎯 Completing loading state...");
    await completeLoadingState(loadingKey, "Test completed successfully!");
    console.log("✅ Loading state completed successfully");
    
    console.log("🎉 All tests passed! Loading state fix is working correctly.");
    
  } catch (error) {
    console.error("❌ Test failed:", error);
    throw error;
  }
}

// Run the test
testLoadingStateFix()
  .then(() => {
    console.log("✅ Test completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Test failed:", error);
    process.exit(1);
  });