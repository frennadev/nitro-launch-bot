import { tokenLaunchQueue, devSellQueue, walletSellQueue } from "./queues"
import { launchTokenWorker, sellDevWorker, sellWalletWorker } from "./workers";
import { connectDB, disconnectDB } from "../backend/db";
import { logger } from "./logger";

connectDB().then(() => {
  logger.info("[jobs]: 🚀  Jobs service online — workers registered");
});

const onCloseSignal = async () => {
  logger.info("Closing mongo db connection...");
  await disconnectDB()

  logger.info("Closing workers...")
  await launchTokenWorker.close()
  await sellDevWorker.close()
  await sellWalletWorker.close()
  
  logger.info("Closing queues...")
  await tokenLaunchQueue.close()
  await devSellQueue.close()
  await walletSellQueue.close()
}

process.on("SIGINT", onCloseSignal);
process.on("SIGTERM", onCloseSignal);

export const workers = [
  launchTokenWorker,
  sellDevWorker,
  sellWalletWorker
]

export default [
  tokenLaunchQueue,
  devSellQueue,
  walletSellQueue
]
