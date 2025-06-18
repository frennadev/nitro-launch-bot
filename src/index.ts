import { connectDB, disconnectDB } from "./backend/db";
import { logger } from "./blockchain/common/logger";
import bot from "./bot";

const nitroLaunchRunner = async () => {
  logger.info("Establishing db connection...");
  await connectDB();
  
  // Ensure wallet pool health
  logger.info("Checking wallet pool health...");
  try {
    const { ensureWalletPoolHealth } = await import("./backend/functions-main");
    const stats = await ensureWalletPoolHealth();
    logger.info(`Wallet pool status: ${stats.available} available, ${stats.allocated} allocated, ${stats.total} total`);
  } catch (error) {
    logger.error("Wallet pool health check failed:", error);
  }
  
  logger.info("Starting Telegram bot...");
  bot
    .start()
    .catch(async (e) => {
      logger.info("Closing mongo db connection...");
      await disconnectDB();
      logger.error("Error occurred while starting bot", e)
    });
};

nitroLaunchRunner().catch((err) => {
  logger.error("Start failed", err);
  throw err;
});

const onCloseSignal = async () => {
  logger.info("Closing mongo db connection...");
  await disconnectDB();
  logger.info("Stopping bot...");
  bot.stop().then(() => logger.info("🚦 Telegram Bot stopped"));
};
process.on("SIGINT", onCloseSignal);
process.on("SIGTERM", onCloseSignal);
