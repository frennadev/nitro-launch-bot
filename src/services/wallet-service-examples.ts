/**
 * Updated Wallet Service Usage Examples
 *
 * This file demonstrates how to use the wallet service with the existing
 * encryption/decryption utilities from backend/utils.ts
 */

import {
  // Wallet Service Functions
  generateNewBuyerWallet,
  importWallet,
  getWalletKeypair,
  validateWallet,
  getWalletPrivateKey,
  getAllBuyerWallets,
  getOrCreateFundingWallet,
} from "./wallets-service";

import {
  // Existing Encryption Utilities
  encryptPrivateKey,
  decryptPrivateKey,
  decryptKeypairBot,
} from "../backend/utils";

import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

// ==================== BASIC WALLET OPERATIONS ====================

/**
 * Example 1: Create a new buyer wallet for a user
 */
export async function createBuyerWalletExample(userId: string) {
  try {
    console.log("🔐 Creating new buyer wallet for user:", userId);

    // Generate new buyer wallet (automatically encrypted)
    const wallet = await generateNewBuyerWallet(userId);

    console.log("✅ Buyer wallet created:");
    console.log("Public Key:", wallet.publicKey);
    console.log("Wallet stored with encrypted private key");

    return wallet;
  } catch (error) {
    console.error("❌ Error creating buyer wallet:", error);
    throw error;
  }
}

/**
 * Example 2: Import existing private key as wallet
 */
export async function importPrivateKeyExample(
  userId: string,
  privateKeyBase58: string
) {
  try {
    console.log("📥 Importing private key as buyer wallet...");

    // Import wallet (validates and encrypts automatically)
    const wallet = await importWallet(
      userId,
      privateKeyBase58,
      { isBuyer: true },
      "base58"
    );

    console.log("✅ Wallet imported:");
    console.log("Public Key:", wallet.publicKey);
    console.log("Wallet ID:", (wallet as any).id);

    return wallet;
  } catch (error) {
    console.error("❌ Error importing wallet:", error);
    throw error;
  }
}

/**
 * Example 3: Get wallet keypair for transactions
 */
export async function getWalletForTransactionExample(
  walletId: string,
  userId: string
) {
  try {
    console.log("🔑 Getting wallet keypair for transaction...");

    // Get decrypted keypair ready for use
    const keypair = await getWalletKeypair(walletId, userId);

    if (!keypair) {
      throw new Error("Wallet not found or decryption failed");
    }

    console.log("✅ Keypair ready for transaction:");
    console.log("Public Key:", keypair.publicKey.toBase58());

    // Example: Use in transaction (placeholder)
    // const transaction = new Transaction();
    // transaction.add(/* your instructions */);
    // const signature = await sendAndConfirmTransaction(connection, transaction, [keypair]);

    return keypair;
  } catch (error) {
    console.error("❌ Error getting wallet keypair:", error);
    throw error;
  }
}

/**
 * Example 4: Validate wallet integrity
 */
export async function checkWalletIntegrityExample(
  walletId: string,
  userId: string
) {
  try {
    console.log("🔍 Validating wallet integrity...");

    const validation = await validateWallet(walletId, userId);

    console.log("📋 Validation Results:");
    console.log("- Is Valid:", validation.isValid);
    console.log("- Can Decrypt:", validation.canDecrypt);
    console.log("- Public Key Matches:", validation.publicKeyMatches);

    if (!validation.isValid && validation.errorMessage) {
      console.log("❌ Error:", validation.errorMessage);
    }

    return validation;
  } catch (error) {
    console.error("❌ Error validating wallet:", error);
    throw error;
  }
}

// ==================== DIRECT ENCRYPTION EXAMPLES ====================

/**
 * Example 5: Manual encryption/decryption using existing utils
 */
export async function manualEncryptionExample() {
  try {
    console.log("🔒 Testing manual encryption/decryption...");

    // Generate a test keypair
    const testKeypair = Keypair.generate();
    const privateKeyBase58 = bs58.encode(testKeypair.secretKey);

    console.log("Original Private Key:", privateKeyBase58);
    console.log("Original Public Key:", testKeypair.publicKey.toBase58());

    // Encrypt the private key
    const encrypted = encryptPrivateKey(privateKeyBase58);
    console.log("🔐 Encrypted:", encrypted);

    // Decrypt the private key
    const decrypted = decryptPrivateKey(encrypted);
    console.log("🔓 Decrypted:", decrypted);

    // Verify they match
    const matches = privateKeyBase58 === decrypted;
    console.log("✅ Keys match:", matches);

    // Test keypair decryption
    const decryptedKeypair = decryptKeypairBot(encrypted);
    const publicKeysMatch =
      decryptedKeypair.publicKey.toBase58() ===
      testKeypair.publicKey.toBase58();
    console.log("✅ Keypair reconstruction successful:", publicKeysMatch);

    return { encrypted, decrypted, matches, publicKeysMatch };
  } catch (error) {
    console.error("❌ Error in manual encryption test:", error);
    throw error;
  }
}

// ==================== USER WALLET MANAGEMENT ====================

/**
 * Example 6: Get all user wallets and their status
 */
export async function getUserWalletStatusExample(userId: string) {
  try {
    console.log("👤 Getting all wallets for user:", userId);

    // Get all buyer wallets
    const buyerWallets = await getAllBuyerWallets(userId);

    console.log(`📦 Found ${buyerWallets.length} buyer wallets`);

    // Validate each wallet
    const walletStatuses = [];
    for (const wallet of buyerWallets) {
      const validation = await validateWallet((wallet as any).id, userId);
      walletStatuses.push({
        walletId: (wallet as any).id,
        publicKey: wallet.publicKey,
        isValid: validation.isValid,
        canDecrypt: validation.canDecrypt,
      });

      console.log(
        `📋 Wallet ${wallet.publicKey}: ${validation.isValid ? "✅ Valid" : "❌ Invalid"}`
      );
    }

    const validCount = walletStatuses.filter((w) => w.isValid).length;
    console.log(
      `📊 Summary: ${validCount}/${walletStatuses.length} wallets are valid`
    );

    return walletStatuses;
  } catch (error) {
    console.error("❌ Error getting user wallet status:", error);
    throw error;
  }
}

/**
 * Example 7: Setup funding wallet for user
 */
export async function setupFundingWalletExample(userId: string) {
  try {
    console.log("💰 Setting up funding wallet for user:", userId);

    // Get or create funding wallet
    const fundingWallet = await getOrCreateFundingWallet(userId);

    console.log("✅ Funding wallet ready:");
    console.log("Public Key:", fundingWallet.publicKey);
    console.log("Wallet ID:", (fundingWallet as any).id);

    // Validate the funding wallet
    const validation = await validateWallet((fundingWallet as any).id, userId);
    console.log(
      "🔍 Funding wallet validation:",
      validation.isValid ? "✅ Valid" : "❌ Invalid"
    );

    return fundingWallet;
  } catch (error) {
    console.error("❌ Error setting up funding wallet:", error);
    throw error;
  }
}

// ==================== MIGRATION AND MAINTENANCE ====================

/**
 * Example 8: Re-encrypt wallet (refresh encryption)
 */
export async function refreshWalletEncryptionExample(
  walletId: string,
  userId: string
) {
  try {
    console.log("🔄 Refreshing wallet encryption...");

    // Validate wallet before re-encryption
    const beforeValidation = await validateWallet(walletId, userId);
    console.log("Before re-encryption - Valid:", beforeValidation.isValid);

    if (!beforeValidation.canDecrypt) {
      throw new Error("Cannot decrypt wallet - unable to re-encrypt");
    }

    // Re-encrypt the wallet
    const { reencryptWallet } = await import("./wallets-service");
    const success = await reencryptWallet(walletId, userId);

    if (success) {
      console.log("✅ Wallet re-encryption successful");

      // Validate after re-encryption
      const afterValidation = await validateWallet(walletId, userId);
      console.log("After re-encryption - Valid:", afterValidation.isValid);
    } else {
      console.log("❌ Wallet re-encryption failed");
    }

    return success;
  } catch (error) {
    console.error("❌ Error refreshing wallet encryption:", error);
    throw error;
  }
}

// ==================== USAGE PATTERNS ====================

/*
Common Usage Patterns:

1. **Create New Wallet for User:**
   ```typescript
   const wallet = await generateNewBuyerWallet(userId);
   // Wallet is automatically encrypted and stored
   ```

2. **Import Existing Private Key:**
   ```typescript
   const wallet = await importWallet(userId, privateKey, { isBuyer: true }, 'base58');
   // Private key is validated, encrypted, and stored
   ```

3. **Use Wallet for Transaction:**
   ```typescript
   const keypair = await getWalletKeypair(walletId, userId);
   if (keypair) {
     // Use keypair in transaction
     const transaction = new Transaction();
     // ... add instructions
     await sendTransaction(transaction, [keypair]);
   }
   ```

4. **Validate Wallet Before Use:**
   ```typescript
   const validation = await validateWallet(walletId, userId);
   if (validation.isValid) {
     const keypair = await getWalletKeypair(walletId, userId);
     // Safe to use keypair
   }
   ```

5. **Get Private Key (if needed):**
   ```typescript
   const privateKey = await getWalletPrivateKey(walletId, userId);
   // Returns decrypted private key string
   ```

6. **Manual Encryption/Decryption:**
   ```typescript
   const encrypted = encryptPrivateKey(privateKeyString);
   const decrypted = decryptPrivateKey(encrypted);
   const keypair = decryptKeypairBot(encrypted);
   ```

Security Notes:
- All private keys are automatically encrypted before database storage
- Decryption only happens when explicitly requested
- User validation is enforced on all wallet operations
- Wallet integrity can be validated at any time
*/
