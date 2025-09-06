import { tokenLaunchQueue, devSellQueue, walletSellQueue } from "./queues";
import { launchTokenWorker, sellDevWorker, sellWalletWorker } from "./workers";
import { closeRedis, connectDB, disconnectDB } from "./db";
import { logger } from "./logger";

connectDB()
  .then(() => {
    logger.info("🚀  Jobs service online — workers registered");
  }).catch(async (e) => {
    await onCloseSignal()
    logger.error("Error connecting to db: ", e)
  })

const onCloseSignal = async () => {
  logger.info("Closing mongo db connection...");
  await disconnectDB();

  logger.info("Closing workers...");
  await launchTokenWorker.close();
  await sellDevWorker.close();
  await sellWalletWorker.close();

  logger.info("Closing redis connection");
  await closeRedis();

  logger.info("Closing queues...");
  await tokenLaunchQueue.close();
  await devSellQueue.close();
  await walletSellQueue.close();
};

process.on("SIGINT", onCloseSignal);
process.on("SIGTERM", onCloseSignal);
