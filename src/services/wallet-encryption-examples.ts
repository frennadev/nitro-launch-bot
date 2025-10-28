/**
 * Wallet Encryption Usage Examples
 *
 * This file demonstrates how to use the wallet encryption/decryption service
 * in various scenarios within the Nitro Launch Bot.
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

import {
  // Wallet Service Functions
  generateNewBuyerWallet,
  importWallet,
  getWalletKeypair,
  validateWallet,
  reencryptWallet,
  getWalletPrivateKey,
} from "./wallets-service";

import {
  // Encryption Service Functions
  createEncryptedWallet,
  encryptPrivateKey,
  decryptPrivateKey,
  encryptKeypair,
  decryptKeypair,
  importAndEncryptWallet,
  validatePrivateKey,
  detectEncryptionFormat,
} from "./wallet-encryption-service";

import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

// ==================== BASIC ENCRYPTION/DECRYPTION EXAMPLES ====================

/**
 * Example 1: Create a new encrypted wallet
 */
export async function createNewWalletExample() {
  try {
    console.log("🔐 Creating new encrypted wallet...");

    // Generate new encrypted wallet
    const walletData = createEncryptedWallet("bot");

    console.log("✅ Wallet created:");
    console.log("Public Key:", walletData.publicKey);
    console.log("Encrypted Private Key:", walletData.encryptedPrivateKey);

    // Verify we can decrypt it
    const decryptedKeypair = decryptKeypair(walletData.encryptedPrivateKey);
    console.log(
      "✅ Decryption verified - Public key matches:",
      decryptedKeypair.publicKey.toBase58() === walletData.publicKey
    );

    return walletData;
  } catch (error) {
    console.error("❌ Error creating wallet:", error);
    throw error;
  }
}

/**
 * Example 2: Import existing private key and encrypt it
 */
export async function importExistingWalletExample(privateKeyBase58: string) {
  try {
    console.log("📥 Importing existing wallet...");

    // Validate the private key first
    const isValid = validatePrivateKey(privateKeyBase58, "base58");
    if (!isValid) {
      throw new Error("Invalid private key format");
    }

    // Import and encrypt
    const importedWallet = importAndEncryptWallet(
      privateKeyBase58,
      "base58",
      "bot"
    );

    console.log("✅ Wallet imported:");
    console.log("Public Key:", importedWallet.publicKey);
    console.log("Encrypted Private Key:", importedWallet.encryptedPrivateKey);

    return importedWallet;
  } catch (error) {
    console.error("❌ Error importing wallet:", error);
    throw error;
  }
}

/**
 * Example 3: Encrypt/decrypt private key directly
 */
export async function encryptDecryptExample(privateKey: string) {
  try {
    console.log("🔄 Testing encryption/decryption...");

    // Encrypt private key
    const encrypted = encryptPrivateKey(privateKey);
    console.log("🔒 Encrypted:", encrypted);

    // Decrypt private key
    const decrypted = decryptPrivateKey(encrypted);
    console.log("🔓 Decrypted:", decrypted);

    // Verify they match
    const matches = privateKey === decrypted;
    console.log("✅ Keys match:", matches);

    return { encrypted, decrypted, matches };
  } catch (error) {
    console.error("❌ Error in encryption/decryption:", error);
    throw error;
  }
}

// ==================== WALLET SERVICE INTEGRATION EXAMPLES ====================

/**
 * Example 4: Create wallet for user using the wallet service
 */
export async function createUserWalletExample(userId: string) {
  try {
    console.log("👤 Creating wallet for user:", userId);

    // Generate new buyer wallet (automatically encrypted)
    const wallet = await generateNewBuyerWallet(userId);

    console.log("✅ User wallet created:");
    console.log("Wallet ID:", (wallet as any).id);
    console.log("Public Key:", wallet.publicKey);
    console.log("Encrypted Private Key stored in DB");

    return wallet;
  } catch (error) {
    console.error("❌ Error creating user wallet:", error);
    throw error;
  }
}

/**
 * Example 5: Import wallet for user
 */
export async function importUserWalletExample(
  userId: string,
  privateKey: string
) {
  try {
    console.log("📥 Importing wallet for user:", userId);

    // Import wallet as buyer wallet
    const wallet = await importWallet(
      userId,
      privateKey,
      { isBuyer: true },
      "base58"
    );

    console.log("✅ User wallet imported:");
    console.log("Wallet ID:", (wallet as any).id);
    console.log("Public Key:", wallet.publicKey);

    return wallet;
  } catch (error) {
    console.error("❌ Error importing user wallet:", error);
    throw error;
  }
}

/**
 * Example 6: Get and use wallet keypair
 */
export async function useWalletExample(walletId: string, userId: string) {
  try {
    console.log("🔑 Getting wallet keypair for use...");

    // Get decrypted keypair for use
    const keypair = await getWalletKeypair(walletId, userId);

    if (!keypair) {
      throw new Error("Wallet not found or decryption failed");
    }

    console.log("✅ Keypair retrieved:");
    console.log("Public Key:", keypair.publicKey.toBase58());
    console.log("Ready for transactions");

    // Example: Sign a message (placeholder)
    // const message = Buffer.from("Hello Solana");
    // const signature = keypair.sign(message);

    return keypair;
  } catch (error) {
    console.error("❌ Error getting wallet keypair:", error);
    throw error;
  }
}

/**
 * Example 7: Validate wallet integrity
 */
export async function validateWalletExample(walletId: string, userId: string) {
  try {
    console.log("🔍 Validating wallet integrity...");

    const validation = await validateWallet(walletId, userId);

    console.log("✅ Validation results:");
    console.log("Is Valid:", validation.isValid);
    console.log("Can Decrypt:", validation.canDecrypt);
    console.log("Public Key Matches:", validation.publicKeyMatches);

    if (!validation.isValid) {
      console.log("❌ Error:", validation.errorMessage);
    }

    return validation;
  } catch (error) {
    console.error("❌ Error validating wallet:", error);
    throw error;
  }
}

// ==================== FORMAT DETECTION AND MIGRATION EXAMPLES ====================

/**
 * Example 8: Detect and handle different encryption formats
 */
export async function formatDetectionExample(encryptedData: string) {
  try {
    console.log("🔍 Detecting encryption format...");

    const format = detectEncryptionFormat(encryptedData);
    console.log("📋 Detected format:", format);

    // Decrypt based on format
    let decryptedPrivateKey: string;

    switch (format) {
      case "bot":
        decryptedPrivateKey = decryptPrivateKey(encryptedData);
        console.log("✅ Decrypted using bot format");
        break;
      case "cryptojs":
        decryptedPrivateKey = decryptPrivateKey(encryptedData); // Auto-handles CryptoJS
        console.log("✅ Decrypted using CryptoJS format");
        break;
      default:
        decryptedPrivateKey = decryptPrivateKey(encryptedData); // Try auto-detection
        console.log("✅ Decrypted using auto-detection");
        break;
    }

    return { format, decryptedPrivateKey };
  } catch (error) {
    console.error("❌ Error in format detection:", error);
    throw error;
  }
}

/**
 * Example 9: Migrate wallet encryption format
 */
export async function migrateWalletFormatExample(
  walletId: string,
  userId: string
) {
  try {
    console.log("🔄 Migrating wallet encryption format...");

    // Re-encrypt wallet from bot format to CryptoJS format
    const success = await reencryptWallet(walletId, userId, "cryptojs");

    if (success) {
      console.log("✅ Wallet encryption format migrated successfully");

      // Validate after migration
      const validation = await validateWallet(walletId, userId);
      console.log("✅ Post-migration validation:", validation.isValid);
    } else {
      console.log("❌ Migration failed");
    }

    return success;
  } catch (error) {
    console.error("❌ Error migrating wallet format:", error);
    throw error;
  }
}

// ==================== BATCH OPERATIONS EXAMPLES ====================

/**
 * Example 10: Batch create multiple wallets
 */
export async function batchCreateWalletsExample(userId: string, count: number) {
  try {
    console.log(`📦 Creating ${count} wallets for user:`, userId);

    const wallets = [];

    for (let i = 0; i < count; i++) {
      const wallet = await generateNewBuyerWallet(userId);
      wallets.push(wallet);
      console.log(`✅ Created wallet ${i + 1}/${count}: ${wallet.publicKey}`);
    }

    console.log(`🎉 Successfully created ${wallets.length} wallets`);
    return wallets;
  } catch (error) {
    console.error("❌ Error in batch wallet creation:", error);
    throw error;
  }
}

/**
 * Example 11: Validate multiple wallets
 */
export async function batchValidateWalletsExample(
  walletIds: string[],
  userId: string
) {
  try {
    console.log(`🔍 Validating ${walletIds.length} wallets...`);

    const results = [];

    for (const walletId of walletIds) {
      const validation = await validateWallet(walletId, userId);
      results.push({ walletId, validation });

      if (validation.isValid) {
        console.log(`✅ Wallet ${walletId}: Valid`);
      } else {
        console.log(
          `❌ Wallet ${walletId}: Invalid - ${validation.errorMessage}`
        );
      }
    }

    const validCount = results.filter((r) => r.validation.isValid).length;
    console.log(
      `📊 Validation complete: ${validCount}/${results.length} valid`
    );

    return results;
  } catch (error) {
    console.error("❌ Error in batch validation:", error);
    throw error;
  }
}

// ==================== USAGE GUIDE ====================

/*
Usage Guide:

1. **Creating New Wallets:**
   ```typescript
   // For direct use (not stored in DB)
   const wallet = createEncryptedWallet('bot');
   
   // For users (stored in DB with encryption)
   const userWallet = await generateNewBuyerWallet(userId);
   ```

2. **Importing Existing Wallets:**
   ```typescript
   // Import and encrypt
   const imported = importAndEncryptWallet(privateKey, 'base58', 'bot');
   
   // Import for user (stored in DB)
   const userImported = await importWallet(userId, privateKey, { isBuyer: true });
   ```

3. **Using Wallets for Transactions:**
   ```typescript
   // Get keypair for use
   const keypair = await getWalletKeypair(walletId, userId);
   
   // Use in transactions
   const transaction = new Transaction();
   // ... add instructions
   const signature = await sendTransaction(transaction, [keypair]);
   ```

4. **Security Best Practices:**
   - Always validate private keys before importing
   - Use wallet validation to check integrity
   - Handle decryption errors gracefully
   - Never store unencrypted private keys
   - Use proper error handling and logging

5. **Format Migration:**
   - Detect format with detectEncryptionFormat()
   - Migrate with reencryptWallet()
   - Validate after migration
   
6. **Error Handling:**
   - All functions include comprehensive error handling
   - Check validation results before using wallets
   - Log errors for debugging and monitoring
*/
