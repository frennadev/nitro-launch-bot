import { connectDB, disconnectDB } from "./backend/db";
import { logger } from "./blockchain/common/logger";
import bot from "./bot";

const viperLaunchRunner = async () => {
  logger.info("Establishing db connection...");
  await connectDB();
  logger.info("Starting Telegram bot...");
  bot
    .start()
    .catch((e) => logger.error("Error occurred while starting bot", e));
};

viperLaunchRunner().catch((err) => {
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
