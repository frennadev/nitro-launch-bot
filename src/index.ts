import { connectDB, disconnectDB } from "./backend/db";
import { botLogger, dbLogger, logSystemHealth } from "./utils/logger";
import { env } from "./config";

let bot: any = null; // Will be initialized only with valid token
let dbConnected = false;

const nitroLaunchRunner = async () => {
  // Initialize logging system
  logSystemHealth();
  
  // Try to establish DB connection
  dbLogger.info("Establishing db connection...");
  try {
    await connectDB();
    dbConnected = true;
    dbLogger.info("✅ Database connected successfully");
  } catch (error: any) {
    dbLogger.warn("⚠️  Database connection failed:", { error: error.message });
    
    // In test mode, we can continue without DB for basic functionality testing
    if (env.TELEGRAM_BOT_TOKEN === "dummy_token") {
      botLogger.warn("🧪 Continuing in TEST MODE without database");
      dbConnected = false;
    } else {
      dbLogger.error("❌ Database connection required for production mode");
      throw error;
    }
  }
  
  // Only check wallet pool if DB is connected
  if (dbConnected) {
    botLogger.info("Checking wallet pool health...");
    try {
      const { ensureWalletPoolHealth } = await import("./backend/functions-main");
      const stats = await ensureWalletPoolHealth();
      botLogger.info("Wallet pool status", {
        available: stats.available,
        allocated: stats.allocated,
        total: stats.total
      });
    } catch (error) {
      botLogger.error("Wallet pool health check failed:", error);
    }
  }
  
  // Check if we're in test mode (dummy token)
  if (env.TELEGRAM_BOT_TOKEN === "dummy_token") {
    botLogger.warn("🧪 Running in TEST MODE - Telegram bot disabled (dummy_token detected)");
    botLogger.info("✅ Backend services initialized successfully");
    botLogger.info("ℹ️  To enable Telegram bot:");
    botLogger.info("   1. Get a real bot token from @BotFather on Telegram");
    botLogger.info("   2. Update TELEGRAM_BOT_TOKEN in your .env file");
    botLogger.info("   3. Restart the application");
    
    if (!dbConnected) {
      botLogger.info("ℹ️  To enable database:");
      botLogger.info("   1. Install MongoDB: brew tap mongodb/brew && brew install mongodb-community");
      botLogger.info("   2. Start MongoDB: brew services start mongodb/brew/mongodb-community");
      botLogger.info("   3. Or update MONGODB_URI in .env to point to a remote database");
    }
    
    // Keep the process running for testing backend services
    process.on('SIGINT', async () => {
      botLogger.info("Shutting down test mode...");
      if (dbConnected) {
        await disconnectDB();
      }
      process.exit(0);
    });
    
    return; // Skip bot initialization
  }
  
  // Only import and initialize bot with valid token
  botLogger.info("Starting Telegram bot...");
  const botModule = await import("./bot");
  bot = botModule.default;
  
  bot
    .start()
    .catch(async (e: any) => {
      dbLogger.info("Closing mongo db connection...");
      if (dbConnected) {
        await disconnectDB();
      }
      botLogger.error("Error occurred while starting bot", e)
    });
};

nitroLaunchRunner().catch((err) => {
  botLogger.error("Start failed", err);
  throw err;
});

const onCloseSignal = async () => {
  if (dbConnected) {
    dbLogger.info("Closing mongo db connection...");
    await disconnectDB();
  }
  botLogger.info("Stopping bot...");
  
  // Only stop bot if it was initialized
  if (bot && env.TELEGRAM_BOT_TOKEN !== "dummy_token") {
    bot.stop().then(() => botLogger.info("🚦 Telegram Bot stopped"));
  } else {
    botLogger.info("🚦 Test mode shutdown complete");
  }
};
process.on("SIGINT", onCloseSignal);
process.on("SIGTERM", onCloseSignal);
