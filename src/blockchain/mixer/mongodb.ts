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
    this.walletsCollection = this.db.collection("intermediate_wallets");
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

    const decipher = crypto.createDecipheriv(algorithm, key, iv);

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return bs58.decode(decrypted);
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
   * Get available wallets for mixing
   */
  async getAvailableWallets(count: number, filter?: WalletFilter): Promise<StoredWallet[]> {
    const query: any = {
      isActive: true,
      status: "available",
      ...filter,
    };

    const wallets = await this.walletsCollection
      .find(query)
      .sort({ usageCount: 1, lastUsed: 1 }) // Prefer least used wallets
      .limit(count)
      .toArray();

    return wallets;
  }

  /**
   * Convert stored wallet to Keypair for transactions
   */
  getKeypairFromStoredWallet(storedWallet: StoredWallet): Keypair {
    const decryptedPrivateKey = this.decryptPrivateKey(storedWallet.privateKey);
    return Keypair.fromSecretKey(decryptedPrivateKey);
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
   * Reserve wallets for a mixing operation (atomic operation)
   */
  async reserveWalletsForMixing(count: number): Promise<StoredWallet[]> {
    const session = this.client.startSession();

    try {
      const wallets: StoredWallet[] = [];

      await session.withTransaction(async () => {
        // Find available wallets
        const availableWallets = await this.walletsCollection
          .find(
            {
              isActive: true,
              status: "available",
            },
            { session }
          )
          .sort({ usageCount: 1, lastUsed: 1 })
          .limit(count)
          .toArray();

        if (availableWallets.length < count) {
          throw new Error(`Not enough available wallets. Need ${count}, found ${availableWallets.length}`);
        }

        // Mark them as in use
        const walletIds = availableWallets.map((w) => w._id);
        await this.walletsCollection.updateMany(
          { _id: { $in: walletIds } },
          {
            $set: {
              status: "in_use",
              lastUsed: new Date(),
            },
            $inc: { usageCount: 1 },
          },
          { session }
        );

        wallets.push(...availableWallets);
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
   * Release reserved wallets back to available pool
   */
  async releaseWallets(publicKeys: string[]): Promise<void> {
    await this.walletsCollection.updateMany({ publicKey: { $in: publicKeys } }, { $set: { status: "available" } });
  }

  /**
   * Get collection instance for advanced operations
   */
  getCollection(): Collection<StoredWallet> {
    return this.walletsCollection;
  }
}
