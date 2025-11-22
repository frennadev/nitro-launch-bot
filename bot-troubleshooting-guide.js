/**
 * Bot Status Check and Troubleshooting Guide
 */

console.log("🤖 Bot Troubleshooting Guide");
console.log("============================");

console.log("\n🔍 Step 1: Check Bot Status");
console.log("----------------------------");
console.log("Is the bot running? Check:");
console.log("• Bot process is active");
console.log("• No fatal errors in startup logs");
console.log("• Bot responds to basic commands like /start");

console.log("\n🔍 Step 2: Test Basic Bot Response");
console.log("----------------------------------");
console.log("Try these commands in order:");
console.log("1. /start - Should get welcome message");
console.log("2. /help - Should show available commands");
console.log("3. /meme - Should start meme token conversation");

console.log("\n🔍 Step 3: Environment Variables");
console.log("--------------------------------");
console.log("Required environment variables:");
console.log("• TELEGRAM_BOT_TOKEN - For bot to connect to Telegram");
console.log("• TWITTER_API_KEY - For fetching tweet content");
console.log("• OPENAI_API_KEY - For AI analysis and image generation");

console.log("\n🔍 Step 4: Check /meme Command Flow");
console.log("-----------------------------------");
console.log("Expected flow:");
console.log("1. Send: /meme");
console.log("2. Bot should respond: 'Please send a Twitter/X post URL...'");
console.log("3. Send: Your Twitter URL");
console.log("4. Bot should start processing");

console.log("\n🔧 Common Issues & Solutions");
console.log("----------------------------");

console.log("\n❌ Bot doesn't respond to any commands:");
console.log("• Check TELEGRAM_BOT_TOKEN is correct");
console.log("• Verify bot is running (check logs)");
console.log("• Ensure bot has permissions in the chat");

console.log("\n❌ /meme command not found:");
console.log("• Check bot command registration in index.ts");
console.log("• Verify conversation middleware is loaded");
console.log("• Check for TypeScript compilation errors");

console.log("\n❌ Bot responds to /meme but not to URL:");
console.log("• Check if conversation state is properly managed");
console.log("• Verify TwitterService is configured");
console.log("• Check for rate limiting issues");

console.log("\n❌ 'Twitter API key not configured' error:");
console.log("• Set TWITTER_API_KEY environment variable");
console.log("• Restart bot after setting environment variable");

console.log("\n❌ 'OpenAI API key not configured' error:");
console.log("• Set OPENAI_API_KEY environment variable");
console.log("• Check OpenAI API key is valid and has credits");

console.log("\n🎯 Quick Debug Steps");
console.log("--------------------");
console.log("1. Check bot logs for error messages");
console.log("2. Try /start command first");
console.log("3. Try /meme command");
console.log("4. Check environment variables are set");
console.log("5. Try with a different Twitter URL");

console.log("\n🚀 Test URLs (try these if yours doesn't work):");
console.log("• https://twitter.com/elonmusk/status/1234567890123456789");
console.log("• https://x.com/dogecoin/status/9876543210987654321");

console.log("\n💡 Pro Tips:");
console.log("• Check bot logs in real-time while testing");
console.log("• Start with /meme command, don't send URL directly");
console.log("• Make sure Twitter URL is public (not private account)");
console.log("• Try URLs from verified/popular accounts first");
