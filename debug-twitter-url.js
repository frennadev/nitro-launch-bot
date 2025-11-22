/**
 * Debug specific Twitter URL issue
 */

const testUrl = "https://x.com/Web3Nigeria/status/1986098130287243660";

console.log("🔍 Debugging Twitter URL Issue");
console.log("==============================");
console.log(`Testing URL: ${testUrl}`);

// Test URL validation
const twitterUrlRegex =
  /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/;
const isValid = twitterUrlRegex.test(testUrl);
console.log(`\n✅ URL Validation: ${isValid ? "PASSED" : "FAILED"}`);

// Test tweet ID extraction
const match = testUrl.match(/\/status\/(\d+)/);
const tweetId = match ? match[1] : null;
console.log(`📝 Tweet ID: ${tweetId}`);

// Test username extraction
const usernameMatch = testUrl.match(
  /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)\/status/
);
const username = usernameMatch ? usernameMatch[1] : null;
console.log(`👤 Username: ${username}`);

console.log("\n🔧 Potential Issues:");
console.log("1. Bot might not be running");
console.log(
  "2. Environment variables not set (TWITTER_API_KEY, OPENAI_API_KEY)"
);
console.log("3. Bot conversation middleware not properly registered");
console.log("4. Rate limiting or permissions issue");
console.log("5. Tweet might be private, deleted, or restricted");

console.log("\n📋 Bot Command Flow:");
console.log("1. User types /meme");
console.log("2. Bot should respond asking for Twitter URL");
console.log("3. User sends Twitter URL");
console.log("4. Bot validates URL and processes");

console.log("\n💡 Debugging Steps:");
console.log("1. Check if bot responds to /meme command");
console.log("2. Check bot logs for any error messages");
console.log("3. Verify environment variables are set");
console.log("4. Test with a different public tweet URL");
