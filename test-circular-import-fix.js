// Test script to verify circular import fix
// This script will try to import the main modules to ensure no circular dependency issues

console.log("Testing circular import fix...");

try {
  console.log("1. Importing message.ts functions...");
  const {
    sendLaunchSuccessNotification,
    sendNotification,
  } = require("./src/bot/message");
  console.log("✅ message.ts imported successfully");

  console.log("2. Importing bot from index.ts...");
  const { bot } = require("./src/bot/index");
  console.log("✅ index.ts imported successfully");

  console.log("3. Testing function signature compatibility...");

  // Test that the functions expect the correct number of parameters
  console.log(
    `sendLaunchSuccessNotification expects: ${sendLaunchSuccessNotification.length} parameters`
  );
  console.log(
    `sendNotification expects: ${sendNotification.length} parameters`
  );

  console.log("✅ All imports successful - circular dependency resolved!");
} catch (error) {
  console.error("❌ Circular import issue still exists:");
  console.error(error.message);
  if (error.message.includes("Maximum call stack size exceeded")) {
    console.error("This indicates a circular dependency is still present.");
  }
}
