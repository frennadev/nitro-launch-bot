import { MongoWalletManager } from "./mongodb";
import { env } from "../../config";

/**
 * Utility script to fix corrupted wallet pools
 * Run this when getting BAD_DECRYPT errors
 */
export async function fixWalletPool() {
  console.log("🔧 Starting wallet pool recovery process...");

  const walletManager = new MongoWalletManager(
    env.MONGODB_URI,
    "nitro-launch", // database name
    env.ENCRYPTION_SECRET
  );

  try {
    await walletManager.connect();
    
    // Get current stats
    const statsBefore = await walletManager.getWalletStats();
    console.log("📊 Current wallet pool stats:", statsBefore);

    // Clean up corrupted wallets
    const cleanedCount = await walletManager.cleanupCorruptedWallets();
    console.log(`🧹 Cleaned up ${cleanedCount} corrupted wallets`);

    // Check if we need to regenerate
    const statsAfter = await walletManager.getWalletStats();
    const availableCount = statsAfter.available;
    const minRequired = 1000; // Minimum wallets needed

    if (availableCount < minRequired) {
      console.log(`⚠️ Low wallet count (${availableCount}). Regenerating wallet pool...`);
      
      // Regenerate wallet pool
      await walletManager.regenerateWalletPool(minRequired);
      
      const finalStats = await walletManager.getWalletStats();
      console.log("✅ Wallet pool regenerated successfully:", finalStats);
    } else {
      console.log(`✅ Wallet pool is healthy with ${availableCount} available wallets`);
    }

  } catch (error) {
    console.error("❌ Failed to fix wallet pool:", error);
    throw error;
  } finally {
    await walletManager.disconnect();
  }
}

// Auto-fix function that can be called from other modules
export async function autoFixWalletPoolOnError() {
  try {
    console.log("🔄 Auto-fixing wallet pool due to decryption errors...");
    await fixWalletPool();
    return true;
  } catch (error) {
    console.error("❌ Auto-fix failed:", error);
    return false;
  }
}

// CLI usage
if (require.main === module) {
  fixWalletPool()
    .then(() => {
      console.log("✅ Wallet pool fix completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Wallet pool fix failed:", error);
      process.exit(1);
    });
} 