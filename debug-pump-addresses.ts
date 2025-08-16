#!/usr/bin/env bun

import { getExternalPumpAddressService } from "./src/service/external-pump-address-service";
import { logger } from "./src/blockchain/common/logger";
import { config } from "dotenv";
config();

async function debugPumpAddresses() {
  try {
    logger.info("Starting pump address debug...");

    // Get the external service
    const service = getExternalPumpAddressService();

    logger.info("Got external service, attempting to connect...");

    // Try to connect
    await service.connect();

    logger.info("Connected successfully, getting usage stats...");

    // Get usage stats
    const stats = await service.getUsageStats();
    logger.info("Usage stats:", stats);

    logger.info("Attempting to get an unused pump address...");

    // Try to get an unused address
    const address = await service.getUnusedPumpAddress("debug-test", []);

    if (address) {
      logger.info("Successfully got address:", {
        publicKey: address.publicKey,
        hasSecretKey: !!address.secretKey,
      });
    } else {
      logger.error("No address returned from service");
    }
  } catch (error) {
    logger.error("Debug failed:", error);
  }

  process.exit(0);
}

debugPumpAddresses().catch(console.error);
