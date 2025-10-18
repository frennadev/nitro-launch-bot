import {
  tokenLaunchQueue,
  devSellQueue,
  walletSellQueue,
  prepareLaunchQueue,
  executeLaunchQueue,
  createTokenMetadataQueue,
  launchDappTokenQueue,
  ctoQueue,
} from "./queues";
import {
  launchTokenWorker,
  sellDevWorker,
  sellWalletWorker,
  prepareLaunchWorker,
  createTokenMetadataWorker,
  launchTokenFromDappWorker,
  executeLaunchWorker,
  ctoWorker,
} from "./workers";
import { connectDB, gracefulShutdown } from "./db";
import { logger } from "./logger";

connectDB()
  .then(() => {
    logger.info("🚀  Jobs service online — all 8 workers registered:");
    logger.info("   ✅ launchTokenWorker");
    logger.info("   ✅ sellDevWorker");
    logger.info("   ✅ sellWalletWorker");
    logger.info("   ✅ prepareLaunchWorker");
    logger.info("   ✅ createTokenMetadataWorker");
    logger.info("   ✅ launchTokenFromDappWorker");
    logger.info("   ✅ executeLaunchWorker");
    logger.info("   ✅ ctoWorker");
  })
  .catch(async (e) => {
    await onCloseSignal();
    logger.error("Error connecting to db: ", e);
  });

const onCloseSignal = async () => {
  logger.info("Initiating graceful shutdown...");

  try {
    logger.info("Closing workers...");
    await Promise.all([
      launchTokenWorker.close(),
      sellDevWorker.close(),
      sellWalletWorker.close(),
      prepareLaunchWorker.close(),
      createTokenMetadataWorker.close(),
      launchTokenFromDappWorker.close(),
      executeLaunchWorker.close(),
      ctoWorker.close(),
    ]);

    logger.info("Closing queues...");
    await Promise.all([
      tokenLaunchQueue.close(),
      devSellQueue.close(),
      walletSellQueue.close(),
      prepareLaunchQueue.close(),
      executeLaunchQueue.close(),
      createTokenMetadataQueue.close(),
      launchDappTokenQueue.close(),
      ctoQueue.close(),
    ]);

    // Use the graceful shutdown for DB and Redis connections
    await gracefulShutdown();

    logger.info("Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    logger.error("Error during shutdown:", error);
    process.exit(1);
  }
};

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down gracefully");
  await onCloseSignal();
});

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully");
  await onCloseSignal();
});
