import {
  tokenLaunchQueue,
  devSellQueue,
  walletSellQueue,
  prepareLaunchQueue,
  executeLaunchQueue,
  createTokenMetadataQueue,
  launchDappTokenQueue,
} from "./queues";
import {
  launchTokenWorker,
  sellDevWorker,
  sellWalletWorker,
  prepareLaunchWorker,
  createTokenMetadataWorker,
  launchTokenFromDappWorker,
  executeLaunchWorker,
} from "./workers";
import { closeRedis, connectDB, disconnectDB } from "./db";
import { logger } from "./logger";

connectDB()
  .then(() => {
    logger.info("🚀  Jobs service online — all 7 workers registered:");
    logger.info("   ✅ launchTokenWorker");
    logger.info("   ✅ sellDevWorker");
    logger.info("   ✅ sellWalletWorker");
    logger.info("   ✅ prepareLaunchWorker");
    logger.info("   ✅ createTokenMetadataWorker");
    logger.info("   ✅ launchTokenFromDappWorker");
    logger.info("   ✅ executeLaunchWorker");
  })
  .catch(async (e) => {
    await onCloseSignal();
    logger.error("Error connecting to db: ", e);
  });

const onCloseSignal = async () => {
  logger.info("Closing mongo db connection...");
  await disconnectDB();

  logger.info("Closing workers...");
  await launchTokenWorker.close();
  await sellDevWorker.close();
  await sellWalletWorker.close();
  await prepareLaunchWorker.close();
  await createTokenMetadataWorker.close();
  await launchTokenFromDappWorker.close();
  await executeLaunchWorker.close();

  logger.info("Closing redis connection");
  await closeRedis();

  logger.info("Closing queues...");
  await tokenLaunchQueue.close();
  await devSellQueue.close();
  await walletSellQueue.close();
  await prepareLaunchQueue.close();
  await executeLaunchQueue.close();
  await createTokenMetadataQueue.close();
  await launchDappTokenQueue.close();
};

process.on("SIGINT", onCloseSignal);
process.on("SIGTERM", onCloseSignal);
