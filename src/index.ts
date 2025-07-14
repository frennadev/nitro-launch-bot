import { config } from "dotenv";
import { bot } from "./bot";

// Load environment variables
config();

console.log("🔧 Loading environment variables...");

// Validate required environment variables
if (!process.env['TELEGRAM_BOT_TOKEN']) {
  console.error("❌ Missing TELEGRAM_BOT_TOKEN environment variable");
  throw new Error("Missing TELEGRAM_BOT_TOKEN environment variable");
}

console.log("✅ TELEGRAM_BOT_TOKEN found");

// Start the bot
console.log("🚀 Starting Nitro Bot with full sophisticated frontend...");
console.log("📱 Bot will respond to /start command");
console.log("🔧 Environment loaded successfully");

bot.start({
  onStart: () => {
    console.log("✅ Nitro Bot started successfully!");
    console.log("🤖 Bot username:", bot.botInfo?.username);
    console.log("🆔 Bot ID:", bot.botInfo?.id);
    console.log("🎯 Using sophisticated frontend with conversations");
  }
}); 