import { MongoClient, Db, Collection } from "mongodb";
import { Keypair, PublicKey } from "@solana/web3.js";
import * as crypto from "crypto";
import bs58 from "bs58";

export interface StoredWallet {
  _id?: string;
  publicKey: string;
  privateKey: string; // Encrypted
  balance?: number;
  isActive: boolean;
  createdAt: Date;
  lastUsed?: Date;
  usageCount: number;
  status: "available" | "in_use" | "depleted" | "error";
  transactionHistory: {
    signature: string;
    type: "receive" | "send" | "fee_funding";
    amount: number;
    timestamp: Date;
    fromAddress?: string;
    toAddress?: string;
  }[];
}

export interface WalletFilter {
  status?: "available" | "in_use" | "depleted" | "error";
  isActive?: boolean;
  minBalance?: number;
  maxUsageCount?: number;
}

export class MongoWalletManager {
  private client: MongoClient;
  private db: Db;
  private walletsCollection: Collection<StoredWallet>;
  private encryptionKey: string;

  constructor(mongoUri: string, databaseName: string, encryptionKey?: string) {
    this.client = new MongoClient(mongoUri);
    this.db = this.client.db(databaseName);
    this.walletsCollection = this.db.collection("mixer_wallets");
    this.encryptionKey = encryptionKey || this.generateEncryptionKey();
  }

  /**
   * Connect to MongoDB
   */
  async connect(): Promise<void> {
    try {
      await this.client.connect();
      console.log("✅ Connected to MongoDB");

      // Create indexes for better performance
      await this.createIndexes();
    } catch (error) {
      console.error("❌ MongoDB connection failed:", error);
      throw error;
    }
  }

  /**
   * Disconnect from MongoDB
   */
  async disconnect(): Promise<void> {
    await this.client.close();
    console.log("🔌 Disconnected from MongoDB");
  }

  /**
   * Create database indexes for optimal performance
   */
  private async createIndexes(): Promise<void> {
    await this.walletsCollection.createIndex({ publicKey: 1 }, { unique: true });
    await this.walletsCollection.createIndex({ status: 1 });
    await this.walletsCollection.createIndex({ isActive: 1 });
    await this.walletsCollection.createIndex({ balance: 1 });
    await this.walletsCollection.createIndex({ usageCount: 1 });
    await this.walletsCollection.createIndex({ createdAt: 1 });
    console.log("📊 Database indexes created");
  }

  /**
   * Generate a secure encryption key
   */
  private generateEncryptionKey(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  /**
   * Encrypt private key for secure storage
   */
  private encryptPrivateKey(privateKey: Uint8Array): string {
    const algorithm = "aes-256-cbc";
    const key = crypto.scryptSync(this.encryptionKey, "salt", 32);
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv(algorithm, key, iv);
    const privateKeyBase58 = bs58.encode(privateKey);

    let encrypted = cipher.update(privateKeyBase58, "utf8", "hex");
    encrypted += cipher.final("hex");

    // Combine iv and encrypted data
    return iv.toString("hex") + ":" + encrypted;
  }

  /**
   * Decrypt private key for use
   */
  private decryptPrivateKey(encryptedPrivateKey: string): Uint8Array {
    const algorithm = "aes-256-cbc";
    const key = crypto.scryptSync(this.encryptionKey, "salt", 32);

    const parts = encryptedPrivateKey.split(":");
    if (parts.length !== 2) {
      throw new Error("Invalid encrypted private key format");
    }

    const iv = Buffer.from(parts[0], "hex");
    const encrypted = parts[1];

    try {
      const decipher = crypto.createDecipheriv(algorithm, key, iv);

      let decrypted = decipher.update(encrypted, "hex", "utf8");
      decrypted += decipher.final("utf8");

      return bs58.decode(decrypted);
    } catch (error: any) {
      if (error.code === "ERR_OSSL_BAD_DECRYPT") {
        throw new Error(`Failed to decrypt wallet private key: Invalid encryption key or corrupted data`);
      }
      throw new Error(`Decryption error: ${error.message}`);
    }
  }

  /**
   * Validate that a wallet can be successfully decrypted
   */
  public validateWalletDecryption(storedWallet: StoredWallet): boolean {
    try {
      this.decryptPrivateKey(storedWallet.privateKey);
      return true;
    } catch (error) {
      console.error(`❌ Wallet ${storedWallet.publicKey} failed decryption validation:`, error);
      return false;
    }
  }

  /**
   * Convert stored wallet to Keypair for transactions with validation
   */
  getKeypairFromStoredWallet(storedWallet: StoredWallet): Keypair {
    try {
      const decryptedPrivateKey = this.decryptPrivateKey(storedWallet.privateKey);
      return Keypair.fromSecretKey(decryptedPrivateKey);
    } catch (error: any) {
      // Mark wallet as error status if decryption fails
      this.markWalletAsError(storedWallet.publicKey, error.message).catch(console.error);
      throw new Error(`Failed to decrypt wallet ${storedWallet.publicKey}: ${error.message}`);
    }
  }

  /**
   * Mark a wallet as having an error status
   */
  private async markWalletAsError(publicKey: string, errorMessage: string): Promise<void> {
    await this.walletsCollection.updateOne(
      { publicKey },
      {
        $set: {
          status: "error",
          isActive: false,
          errorMessage: errorMessage,
          errorTimestamp: new Date(),
        },
      }
    );
  }

  /**
   * Get available wallets with decryption validation
   */
  async getAvailableWallets(count: number, filter?: WalletFilter): Promise<StoredWallet[]> {
    const query: any = {
      isActive: true,
      status: "available",
      ...filter,
    };

    // Get more wallets than needed in case some fail validation
    const bufferMultiplier = 1.5;
    const requestCount = Math.ceil(count * bufferMultiplier);

    const candidates = await this.walletsCollection
      .find(query)
      .sort({ usageCount: 1, lastUsed: 1 })
      .limit(requestCount)
      .toArray();

    const validWallets: StoredWallet[] = [];
    const errorWallets: StoredWallet[] = [];

    // Validate each wallet can be decrypted
    for (const wallet of candidates) {
      if (this.validateWalletDecryption(wallet)) {
        validWallets.push(wallet);
      } else {
        errorWallets.push(wallet);
      }

      // Stop when we have enough valid wallets
      if (validWallets.length >= count) {
        break;
      }
    }

    // Mark error wallets as such in the database
    if (errorWallets.length > 0) {
      console.warn(`⚠️ Found ${errorWallets.length} corrupted wallet(s), marking as error status`);
      for (const errorWallet of errorWallets) {
        await this.markWalletAsError(errorWallet.publicKey, "Decryption validation failed");
      }
    }

    return validWallets.slice(0, count);
  }

  /**
   * Generate and store multiple wallets
   */
  async generateWallets(count: number): Promise<StoredWallet[]> {
    console.log(`🔄 Generating ${count} wallets...`);
    const wallets: StoredWallet[] = [];

    for (let i = 0; i < count; i++) {
      const keypair = Keypair.generate();
      const encryptedPrivateKey = this.encryptPrivateKey(keypair.secretKey);

      const wallet: StoredWallet = {
        publicKey: keypair.publicKey.toString(),
        privateKey: encryptedPrivateKey,
        balance: 0,
        isActive: true,
        createdAt: new Date(),
        usageCount: 0,
        status: "available",
        transactionHistory: [],
      };

      wallets.push(wallet);

      // Progress indicator
      if ((i + 1) % 10 === 0) {
        console.log(`📝 Generated ${i + 1}/${count} wallets`);
      }
    }

    // Bulk insert for better performance
    try {
      const result = await this.walletsCollection.insertMany(wallets);
      console.log(`✅ Successfully stored ${result.insertedCount} wallets in database`);
      return wallets;
    } catch (error) {
      console.error("❌ Failed to store wallets:", error);
      throw error;
    }
  }

  /**
   * Mark wallets as in use
   */
  async markWalletsInUse(walletIds: string[]): Promise<void> {
    await this.walletsCollection.updateMany(
      { _id: { $in: walletIds } },
      {
        $set: {
          status: "in_use",
          lastUsed: new Date(),
        },
        $inc: { usageCount: 1 },
      }
    );
  }

  /**
   * Mark wallets as available after use
   */
  async markWalletsAvailable(walletIds: string[]): Promise<void> {
    await this.walletsCollection.updateMany({ _id: { $in: walletIds } }, { $set: { status: "available" } });
  }

  /**
   * Update wallet balance
   */
  async updateWalletBalance(publicKey: string, balance: number): Promise<void> {
    await this.walletsCollection.updateOne(
      { publicKey },
      {
        $set: {
          balance,
          status: balance > 0 ? "available" : "depleted",
        },
      }
    );
  }

  /**
   * Record transaction in wallet history
   */
  async recordTransaction(
    publicKey: string,
    transaction: {
      signature: string;
      type: "receive" | "send" | "fee_funding";
      amount: number;
      fromAddress?: string;
      toAddress?: string;
    }
  ): Promise<void> {
    await this.walletsCollection.updateOne(
      { publicKey },
      {
        $push: {
          transactionHistory: {
            ...transaction,
            timestamp: new Date(),
          },
        },
      }
    );
  }

  /**
   * Get wallet statistics
   */
  async getWalletStats(): Promise<{
    total: number;
    available: number;
    inUse: number;
    depleted: number;
    error: number;
    totalBalance: number;
  }> {
    const pipeline = [
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalBalance: { $sum: "$balance" },
        },
      },
    ];

    const results = await this.walletsCollection.aggregate(pipeline).toArray();
    const total = await this.walletsCollection.countDocuments();

    const stats = {
      total,
      available: 0,
      inUse: 0,
      depleted: 0,
      error: 0,
      totalBalance: 0,
    };

    results.forEach((result) => {
      stats[result._id as keyof typeof stats] = result.count;
      stats.totalBalance += result.totalBalance || 0;
    });

    return stats;
  }

  /**
   * Clean up old or unused wallets
   */
  async cleanupWallets(
    options: {
      olderThanDays?: number;
      maxUsageCount?: number;
      zeroBalance?: boolean;
    } = {}
  ): Promise<number> {
    const query: any = {};

    if (options.olderThanDays) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - options.olderThanDays);
      query.createdAt = { $lt: cutoffDate };
    }

    if (options.maxUsageCount) {
      query.usageCount = { $gte: options.maxUsageCount };
    }

    if (options.zeroBalance) {
      query.balance = { $lte: 0 };
    }

    const result = await this.walletsCollection.deleteMany(query);
    console.log(`🧹 Cleaned up ${result.deletedCount} wallets`);
    return result.deletedCount;
  }

  /**
   * Get wallet by public key
   */
  async getWalletByPublicKey(publicKey: string): Promise<StoredWallet | null> {
    return await this.walletsCollection.findOne({ publicKey });
  }

  /**
   * Reserve wallets for a mixing operation with validation (atomic operation)
   */
  async reserveWalletsForMixing(count: number, excludeWalletIds: string[] = []): Promise<StoredWallet[]> {
    const session = this.client.startSession();

    try {
      const wallets: StoredWallet[] = [];

      await session.withTransaction(async () => {
        // Get more wallets than needed to account for potential validation failures
        const bufferMultiplier = 2.0;
        const requestCount = Math.ceil(count * bufferMultiplier);

        // Find available wallets - exclude already used in this operation
        const query: any = {
          isActive: true,
          status: "available",
        };
        
        // Exclude wallets already used in this mixing operation
        if (excludeWalletIds.length > 0) {
          query.publicKey = { $nin: excludeWalletIds };
        }
        
        const candidates = await this.walletsCollection
          .find(query, { session })
          .sort({ usageCount: 1, lastUsed: 1 })
          .limit(requestCount)
          .toArray();

        const validWallets: StoredWallet[] = [];
                 const errorWalletIds: string[] = [];

         // Validate each wallet can be decrypted
         for (const wallet of candidates) {
           if (this.validateWalletDecryption(wallet)) {
             validWallets.push(wallet);
           } else if (wallet._id) {
             errorWalletIds.push(wallet._id as string);
           }

          // Stop when we have enough valid wallets
          if (validWallets.length >= count) {
            break;
          }
        }

        if (validWallets.length < count) {
          throw new Error(
            `Not enough valid wallets available. Need ${count}, found ${validWallets.length} valid out of ${candidates.length} candidates. ${errorWalletIds.length} wallets failed decryption validation.`
          );
        }

        // Mark error wallets as such
        if (errorWalletIds.length > 0) {
          await this.walletsCollection.updateMany(
            { _id: { $in: errorWalletIds } },
            {
              $set: {
                status: "error",
                isActive: false,
                errorMessage: "Decryption validation failed during reservation",
                errorTimestamp: new Date(),
              },
            },
            { session }
          );
        }

                 // Mark valid wallets as in use
         const validWalletIds = validWallets.slice(0, count).map((w) => w._id).filter((id): id is string => id !== undefined);
         await this.walletsCollection.updateMany(
           { _id: { $in: validWalletIds } },
          {
            $set: {
              status: "in_use",
              lastUsed: new Date(),
            },
            $inc: { usageCount: 1 },
          },
          { session }
        );

        wallets.push(...validWallets.slice(0, count));
      });

      return wallets;
    } catch (error) {
      console.error("❌ Failed to reserve wallets:", error);
      throw error;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Release reserved wallets back to available pool after mixing operation completes
   */
  async releaseWallets(publicKeys: string[]): Promise<void> {
    await this.walletsCollection.updateMany(
      { publicKey: { $in: publicKeys } }, 
      { $set: { status: "available" } }
    );
    console.log(`🔄 Released ${publicKeys.length} wallets back to available pool`);
  }

  /**
   * Clean up corrupted/error wallets
   */
  async cleanupCorruptedWallets(): Promise<number> {
    const result = await this.walletsCollection.deleteMany({
      status: "error",
    });
    console.log(`🧹 Cleaned up ${result.deletedCount} corrupted wallets`);
    return result.deletedCount;
  }

  /**
   * Regenerate wallet pool with fresh wallets
   */
  async regenerateWalletPool(count: number = 1000): Promise<void> {
    console.log("🔄 Regenerating wallet pool...");
    
    // Clean up all existing wallets
    await this.walletsCollection.deleteMany({});
    console.log("🗑️ Cleared existing wallet pool");
    
    // Generate fresh wallets
    await this.generateWallets(count);
    console.log(`✅ Generated ${count} fresh wallets`);
  }

  /**
   * Get collection instance for advanced operations
   */
  getCollection(): Collection<StoredWallet> {
    return this.walletsCollection;
  }
}
