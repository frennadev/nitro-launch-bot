import { connectDB, disconnectDB } from "./backend/db";
import { logger } from "./blockchain/common/logger";
import { env } from "./config";

let bot: any = null; // Will be initialized only with valid token
let dbConnected = false;

const nitroLaunchRunner = async () => {
  // Try to establish DB connection
  logger.info("Establishing db connection...");
  try {
    await connectDB();
    dbConnected = true;
    logger.info("✅ Database connected successfully");
  } catch (error: any) {
    logger.warn("⚠️  Database connection failed:", error.message);
    
    // In test mode, we can continue without DB for basic functionality testing
    if (env.TELEGRAM_BOT_TOKEN === "dummy_token") {
      logger.warn("🧪 Continuing in TEST MODE without database");
      dbConnected = false;
    } else {
      logger.error("❌ Database connection required for production mode");
      throw error;
    }
  }
  
  // Only check wallet pool if DB is connected
  if (dbConnected) {
    logger.info("Checking wallet pool health...");
    try {
      const { ensureWalletPoolHealth } = await import("./backend/functions-main");
      const stats = await ensureWalletPoolHealth();
      logger.info(`Wallet pool status: ${stats.available} available, ${stats.allocated} allocated, ${stats.total} total`);
    } catch (error) {
      logger.error("Wallet pool health check failed:", error);
    }
  }
  
  // Check if we're in test mode (dummy token)
  if (env.TELEGRAM_BOT_TOKEN === "dummy_token") {
    logger.warn("🧪 Running in TEST MODE - Telegram bot disabled (dummy_token detected)");
    logger.info("✅ Backend services initialized successfully");
    logger.info("ℹ️  To enable Telegram bot:");
    logger.info("   1. Get a real bot token from @BotFather on Telegram");
    logger.info("   2. Update TELEGRAM_BOT_TOKEN in your .env file");
    logger.info("   3. Restart the application");
    
    if (!dbConnected) {
      logger.info("ℹ️  To enable database:");
      logger.info("   1. Install MongoDB: brew tap mongodb/brew && brew install mongodb-community");
      logger.info("   2. Start MongoDB: brew services start mongodb/brew/mongodb-community");
      logger.info("   3. Or update MONGODB_URI in .env to point to a remote database");
    }
    
    // Keep the process running for testing backend services
    process.on('SIGINT', async () => {
      logger.info("Shutting down test mode...");
      if (dbConnected) {
        await disconnectDB();
      }
      process.exit(0);
    });
    
    return; // Skip bot initialization
  }
  
  // Only import and initialize bot with valid token
  logger.info("Starting Telegram bot...");
  const botModule = await import("./bot");
  bot = botModule.default;
  
  bot
    .start()
    .catch(async (e: any) => {
      logger.info("Closing mongo db connection...");
      if (dbConnected) {
        await disconnectDB();
      }
      logger.error("Error occurred while starting bot", e)
    });
};

nitroLaunchRunner().catch((err) => {
  logger.error("Start failed", err);
  throw err;
});

const onCloseSignal = async () => {
  if (dbConnected) {
    logger.info("Closing mongo db connection...");
    await disconnectDB();
  }
  logger.info("Stopping bot...");
  
  // Only stop bot if it was initialized
  if (bot && env.TELEGRAM_BOT_TOKEN !== "dummy_token") {
    bot.stop().then(() => logger.info("🚦 Telegram Bot stopped"));
  } else {
    logger.info("🚦 Test mode shutdown complete");
  }
};
process.on("SIGINT", onCloseSignal);
process.on("SIGTERM", onCloseSignal);
