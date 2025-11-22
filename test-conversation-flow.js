/**
 * Test the exact conversation flow with your URL
 */

console.log("🧪 Testing Conversation Flow");
console.log("============================");

const testUrl = "https://x.com/Web3Nigeria/status/1986098130287243660";

// Test the validation function from our conversation
function isValidTwitterUrl(url) {
  const twitterUrlRegex =
    /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/;
  return twitterUrlRegex.test(url);
}

console.log("📝 Testing your specific URL:");
console.log(`URL: ${testUrl}`);
console.log(`Valid: ${isValidTwitterUrl(testUrl) ? "✅ YES" : "❌ NO"}`);

// Test various scenarios
const testScenarios = [
  "https://x.com/Web3Nigeria/status/1986098130287243660", // Your URL
  "https://twitter.com/Web3Nigeria/status/1986098130287243660", // Twitter format
  "https://x.com/elonmusk/status/1234567890123456789", // Different user
  "invalid-url", // Invalid
];

console.log("\n📋 Testing Multiple Scenarios:");
testScenarios.forEach((url, index) => {
  const isValid = isValidTwitterUrl(url);
  console.log(`${index + 1}. ${isValid ? "✅" : "❌"} ${url}`);
});

console.log("\n🔄 Expected Bot Conversation Flow:");
console.log("1. User sends: /meme");
console.log("2. Bot replies: 'Please send a Twitter/X post URL:'");
console.log(
  "3. User sends: https://x.com/Web3Nigeria/status/1986098130287243660"
);
console.log("4. Bot validates URL ✅");
console.log("5. Bot starts processing tweet...");

console.log("\n🚨 If bot doesn't respond, check:");
console.log("• Did you start with /meme command first?");
console.log("• Is bot running and connected?");
console.log("• Are environment variables set?");
console.log("• Check bot logs for error messages");

console.log("\n💡 Your URL is VALID - the issue is likely:");
console.log("1. Bot not running");
console.log("2. Missing environment variables");
console.log("3. Not starting with /meme command");
console.log("4. Bot process crashed or stuck");
