import { MongoClient, Db, Collection } from "mongodb";
import { logger } from "../blockchain/common/logger";
import { PublicKey } from "@solana/web3.js";

// External pump address interface (from the external database)
export interface ExternalPumpAddress {
  _id?: any;
  publicKey: string;
  secretKey: string;
  rawSecretKey?: number[];
  suffix?: string;
  workerId?: number;
  attempts?: number;
  isUsed?: boolean;
  usedBy?: string;
  usedAt?: Date;
  permanentlyAllocated?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export class ExternalPumpAddressService {
  private client: MongoClient;
  private db: Db;
  private collection: Collection<ExternalPumpAddress>;
  private isConnected: boolean = false;

  constructor(mongoUri: string) {
    if (!mongoUri || typeof mongoUri !== "string") {
      throw new Error(
        "Invalid MongoDB URI provided to ExternalPumpAddressService"
      );
    }
    this.client = new MongoClient(mongoUri);
    this.db = this.client.db(); // Use default database from URI
    this.collection = this.db.collection("pump_addresses");
  }

  /**
   * Connect to the external MongoDB database
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    try {
      await this.client.connect();
      this.isConnected = true;
      logger.info(
        "[ExternalPumpAddressService] Connected to external MongoDB database"
      );

      // Create indexes for better performance
      await this.createIndexes();
    } catch (error: any) {
      logger.error(
        "[ExternalPumpAddressService] Failed to connect to external MongoDB:",
        error
      );
      throw error;
    }
  }

  /**
   * Disconnect from the external database
   */
  async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.client.close();
      this.isConnected = false;
      logger.info(
        "[ExternalPumpAddressService] Disconnected from external MongoDB database"
      );
    }
  }

  /**
   * Create necessary indexes for optimal performance
   */
  private async createIndexes(): Promise<void> {
    try {
      await this.collection.createIndex({ publicKey: 1 }, { unique: true });
      await this.collection.createIndex({ isUsed: 1 });
      await this.collection.createIndex({ usedBy: 1 });
      await this.collection.createIndex({ createdAt: 1 });
      logger.info("[ExternalPumpAddressService] Database indexes created");
    } catch (error: any) {
      // Indexes might already exist, don't throw error
      logger.warn(
        "[ExternalPumpAddressService] Index creation warning:",
        error.message
      );
    }
  }

  /**
   * Get an unused pump address from the external database
   * NOTE: Once allocated, addresses are permanently marked as used and never released
   */
  async getUnusedPumpAddress(
    userId: string,
    excludeAddresses: string[] = []
  ): Promise<ExternalPumpAddress | null> {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      // First, let's get some debugging info about the database
      const totalCount = await this.collection.countDocuments({});
      const usedCount = await this.collection.countDocuments({ isUsed: true });
      const unusedCount = await this.collection.countDocuments({
        $and: [
          {
            $or: [{ isUsed: { $exists: false } }, { isUsed: false }],
          },
          {
            $or: [
              { usedAt: { $exists: false } },
              { usedAt: { $eq: null as any } },
            ],
          },
          {
            $or: [
              { usedBy: { $exists: false } },
              { usedBy: { $eq: null as any } },
              { usedBy: "" },
            ],
          },
          {
            $or: [
              { updatedAt: { $exists: false } },
              { updatedAt: { $eq: null as any } },
            ],
          },
        ],
      });

      logger.info(
        `[ExternalPumpAddressService] Database stats: Total=${totalCount}, Used=${usedCount}, Unused=${unusedCount}`
      );

      // Get a few sample used records to understand data structure
      const sampleUsedRecords = await this.collection
        .find({ isUsed: true })
        .limit(3)
        .toArray();
      logger.info(
        `[ExternalPumpAddressService] Sample used records:`,
        sampleUsedRecords.map((r) => ({
          publicKey: r.publicKey?.slice(0, 8) + "...",
          isUsed: r.isUsed,
          usedBy: r.usedBy,
          usedAt: r.usedAt,
          updatedAt: r.updatedAt,
        }))
      );

      // Get a few sample unused records to verify our query
      const sampleUnusedRecords = await this.collection
        .find({
          $and: [
            {
              $or: [{ isUsed: { $exists: false } }, { isUsed: false }],
            },
            {
              $or: [
                { usedAt: { $exists: false } },
                { usedAt: { $eq: null as any } },
              ],
            },
            {
              $or: [
                { usedBy: { $exists: false } },
                { usedBy: { $eq: null as any } },
                { usedBy: "" },
              ],
            },
            {
              $or: [
                { updatedAt: { $exists: false } },
                { updatedAt: { $eq: null as any } },
              ],
            },
          ],
        })
        .limit(3)
        .toArray();
      logger.info(
        `[ExternalPumpAddressService] Sample unused records:`,
        sampleUnusedRecords.map((r) => ({
          publicKey: r.publicKey?.slice(0, 8) + "...",
          isUsed: r.isUsed,
          usedBy: r.usedBy,
          usedAt: r.usedAt,
          updatedAt: r.updatedAt,
        }))
      );

      // Build query to find addresses that have NEVER been used
      // Ensure ALL FOUR fields indicate the address is unused:
      // 1. isUsed must be false or not exist
      // 2. usedAt must be null or not exist
      // 3. usedBy must be null/empty or not exist
      // 4. updatedAt must be null or not exist
      const query: Record<string, unknown> = {
        $and: [
          {
            $or: [{ isUsed: { $exists: false } }, { isUsed: false }],
          },
          {
            $or: [
              { usedAt: { $exists: false } },
              { usedAt: { $eq: null as any } },
            ],
          },
          {
            $or: [
              { usedBy: { $exists: false } },
              { usedBy: { $eq: null as any } },
              { usedBy: "" },
            ],
          },
          {
            $or: [
              { updatedAt: { $exists: false } },
              { updatedAt: { $eq: null as any } },
            ],
          },
        ],
      };

      if (excludeAddresses.length > 0) {
        query.publicKey = { $nin: excludeAddresses };
      }

      logger.info(
        `[ExternalPumpAddressService] Query: ${JSON.stringify(query)}`
      );

      // Check how many documents match our query before updating
      const matchingCount = await this.collection.countDocuments(query);
      logger.info(
        `[ExternalPumpAddressService] Documents matching query: ${matchingCount}`
      );

      // Find and mark an address as permanently used in a single atomic operation
      const result = await this.collection.findOneAndUpdate(
        query,
        {
          $set: {
            isUsed: true,
            usedBy: userId || "system", // Track for analytics but not user-specific
            usedAt: new Date(),
          },
        },
        {
          sort: { createdAt: 1 }, // Use oldest first (FIFO)
          returnDocument: "after",
        }
      );

      if (result) {
        logger.info(
          `[ExternalPumpAddressService] Allocated pump address ${result.publicKey}`
        );
        return result;
      } else {
        logger.warn(
          "[ExternalPumpAddressService] No unused pump addresses available"
        );
        return null;
      }
    } catch (error: unknown) {
      logger.error(
        "[ExternalPumpAddressService] Error getting unused pump address:",
        error
      );
      throw error;
    }
  }

  /**
   * DEPRECATED: Pump addresses are never released once allocated
   * This method is kept for compatibility but does nothing
   */
  async releasePumpAddress(publicKey: string): Promise<boolean> {
    logger.warn(
      `[ExternalPumpAddressService] Attempted to release pump address ${publicKey} - addresses are never released once allocated`
    );
    return false; // Never release addresses
  }

  /**
   * Check if a pump address is used
   */
  async isPumpAddressUsed(publicKey: string): Promise<boolean> {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      const address = await this.collection.findOne({ publicKey });
      // Check if address has been allocated to any user (usedBy field exists and is not null/empty)
      return address ? !!(address.usedBy && address.usedBy !== "") : false;
    } catch (error: any) {
      logger.error(
        `[ExternalPumpAddressService] Error checking pump address ${publicKey}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Validate that a pump address exists in the external database and is unused
   */
  async validatePumpAddress(publicKey: string): Promise<{
    exists: boolean;
    isUsed: boolean;
    usedBy?: string;
    usedAt?: Date;
  }> {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      // Validate that it's a valid Solana public key
      try {
        new PublicKey(publicKey);
      } catch (error) {
        return { exists: false, isUsed: false };
      }

      const address = await this.collection.findOne({ publicKey });

      if (!address) {
        return { exists: false, isUsed: false };
      }

      // Check if address has been allocated to any user
      const isUsed = !!(address.usedBy && address.usedBy !== "");

      return {
        exists: true,
        isUsed,
        usedBy: address.usedBy,
        usedAt: address.usedAt,
      };
    } catch (error: any) {
      logger.error(
        `[ExternalPumpAddressService] Error validating pump address ${publicKey}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get statistics about pump address usage
   */
  async getUsageStats(): Promise<{
    total: number;
    used: number;
    available: number;
    usagePercentage: number;
  }> {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      const [total, used] = await Promise.all([
        this.collection.countDocuments({}),
        this.collection.countDocuments({
          $or: [
            { usedBy: { $exists: true, $ne: null } },
            { usedBy: { $ne: "" } },
          ],
        }),
      ]);

      const available = total - used;
      const usagePercentage = total > 0 ? (used / total) * 100 : 0;

      return {
        total,
        used,
        available,
        usagePercentage: Math.round(usagePercentage * 100) / 100,
      };
    } catch (error: any) {
      logger.error(
        "[ExternalPumpAddressService] Error getting usage stats:",
        error
      );
      throw error;
    }
  }

  /**
   * Mark multiple addresses as used (bulk operation)
   */
  async markAddressesAsUsed(
    publicKeys: string[],
    userId: string
  ): Promise<number> {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      const result = await this.collection.updateMany(
        {
          publicKey: { $in: publicKeys },
          $or: [
            { usedBy: { $exists: false } },
            { usedBy: null },
            { usedBy: "" },
          ],
        },
        {
          $set: {
            isUsed: true,
            usedBy: userId,
            usedAt: new Date(),
            permanentlyAllocated: true,
          },
        }
      );

      logger.info(
        `[ExternalPumpAddressService] Marked ${result.modifiedCount} addresses as permanently used for user ${userId}`
      );
      return result.modifiedCount;
    } catch (error: any) {
      logger.error(
        "[ExternalPumpAddressService] Error marking addresses as used:",
        error
      );
      throw error;
    }
  }

  /**
   * Get addresses used by a specific user
   */
  async getUserAddresses(userId: string): Promise<ExternalPumpAddress[]> {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      const addresses = await this.collection
        .find({ usedBy: userId, isUsed: true })
        .sort({ usedAt: -1 })
        .toArray();

      return addresses;
    } catch (error: any) {
      logger.error(
        `[ExternalPumpAddressService] Error getting user addresses for ${userId}:`,
        error
      );
      throw error;
    }
  }
}

// Singleton instance
let externalPumpAddressService: ExternalPumpAddressService | null = null;

/**
 * Get the singleton instance of ExternalPumpAddressService
 */
export function getExternalPumpAddressService(): ExternalPumpAddressService {
  if (!externalPumpAddressService) {
    // Use the same MongoDB URI as the main application
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error("MONGO_URI environment variable is not set");
    }
    externalPumpAddressService = new ExternalPumpAddressService(mongoUri);
  }
  return externalPumpAddressService;
}

/**
 * Initialize the external pump address service
 */
export async function initializeExternalPumpAddressService(): Promise<void> {
  const service = getExternalPumpAddressService();
  await service.connect();

  // Log initial statistics
  const stats = await service.getUsageStats();
  logger.info("[ExternalPumpAddressService] Service initialized", {
    totalAddresses: stats.total,
    usedAddresses: stats.used,
    availableAddresses: stats.available,
    usagePercentage: `${stats.usagePercentage}%`,
  });
}

/**
 * Cleanup the external pump address service
 */
export async function cleanupExternalPumpAddressService(): Promise<void> {
  if (externalPumpAddressService) {
    await externalPumpAddressService.disconnect();
    externalPumpAddressService = null;
  }
}
