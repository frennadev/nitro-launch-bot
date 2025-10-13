import { logger } from "./logger";
import {
  launchTokenWorker,
  prepareLaunchWorker,
  executeLaunchWorker,
  launchTokenFromDappWorker,
  createTokenMetadataWorker,
  sellDevWorker,
  sellWalletWorker,
} from "./workers";

export const startLaunchWorker = () => {
  logger.info("🚀 Starting Launch Workers...");

  // All workers are automatically started when imported
  // This function exists for compatibility with test scripts

  logger.info("✅ Launch workers initialized:");
  logger.info("   • launchTokenWorker (PumpFun staging)");
  logger.info("   • prepareLaunchWorker (Launch preparation)");
  logger.info("   • executeLaunchWorker (Launch execution)");
  logger.info("   • launchTokenFromDappWorker (DApp launches)");
  logger.info("   • createTokenMetadataWorker (Token metadata)");
  logger.info("   • sellDevWorker (Dev sells)");
  logger.info("   • sellWalletWorker (Wallet sells)");

  return {
    workers: {
      launchTokenWorker,
      prepareLaunchWorker,
      executeLaunchWorker,
      launchTokenFromDappWorker,
      createTokenMetadataWorker,
      sellDevWorker,
      sellWalletWorker,
    },
    close: async () => {
      logger.info("🔄 Closing all launch workers...");
      await Promise.all([
        launchTokenWorker.close(),
        prepareLaunchWorker.close(),
        executeLaunchWorker.close(),
        launchTokenFromDappWorker.close(),
        createTokenMetadataWorker.close(),
        sellDevWorker.close(),
        sellWalletWorker.close(),
      ]);
      logger.info("✅ All launch workers closed");
    },
  };
};

export default startLaunchWorker;
