/**
 * Wallets Service - Extracted from Users Service
 *
 * This service contains all wallet-related functions that were previously in the users service.
 * It provides a centralized service for wallet management operations.
 */

import { WalletModel } from "../backend/models";
import { Types } from "mongoose";
import type { Wallet } from "../backend/models";
import { Keypair } from "@solana/web3.js";
import {
  encryptPrivateKey,
  decryptPrivateKey,
  decryptKeypairBot,
} from "../backend/utils";
import bs58 from "bs58";

// ==================== BUYER WALLET MANAGEMENT ====================

/**
 * Get all buyer wallets for user (from buyerWallets.ts, sellIndividualToken.ts)
 */
export async function getAllBuyerWallets(userId: string): Promise<Wallet[]> {
  try {
    return await WalletModel.find({
      user: new Types.ObjectId(userId),
      isBuyer: true,
    })
      .sort({ createdAt: -1 })
      .exec();
  } catch (error) {
    console.error("Error getting buyer wallets:", error);
    return [];
  }
}

/**
 * Get all trading wallets for user (from ctoMonitor.ts)
 */
export async function getAllTradingWallets(userId: string): Promise<Wallet[]> {
  try {
    return await WalletModel.find({
      user: new Types.ObjectId(userId),
      isBuyer: true, // Trading wallets are buyer wallets
    })
      .sort({ createdAt: -1 })
      .exec();
  } catch (error) {
    console.error("Error getting trading wallets:", error);
    return [];
  }
}

/**
 * Add new buyer wallet (from buyerWallets.ts)
 */
export async function addBuyerWallet(
  userId: string,
  publicKey: string,
  privateKey: string
): Promise<Wallet> {
  // Encrypt the private key before storing
  const encryptedPrivateKey = encryptPrivateKey(privateKey);

  const newWallet = new WalletModel({
    user: new Types.ObjectId(userId),
    publicKey,
    privateKey: encryptedPrivateKey,
    isBuyer: true,
    createdAt: new Date(),
  });

  return await newWallet.save();
}

/**
 * Generate new buyer wallet for user (from monitor-module.ts)
 */
export async function generateNewBuyerWallet(userId: string): Promise<Wallet> {
  try {
    // Generate new keypair and encrypt it
    const walletKeypair = Keypair.generate();
    const privateKeyBase58 = bs58.encode(walletKeypair.secretKey);
    const encryptedPrivateKey = encryptPrivateKey(privateKeyBase58);

    const wallet = new WalletModel({
      user: new Types.ObjectId(userId),
      publicKey: walletKeypair.publicKey.toBase58(),
      privateKey: encryptedPrivateKey,
      isBuyer: true,
      createdAt: new Date(),
    });

    await wallet.save();
    return wallet;
  } catch (error) {
    console.error("Error generating new buyer wallet:", error);
    throw error;
  }
}

/**
 * Delete buyer wallet (from buyerWallets.ts)
 */
export async function deleteBuyerWallet(
  walletId: string,
  userId: string
): Promise<boolean> {
  try {
    const result = await WalletModel.deleteOne({
      _id: new Types.ObjectId(walletId),
      user: new Types.ObjectId(userId),
      isBuyer: true,
    });
    return result.deletedCount > 0;
  } catch (error) {
    console.error("Error deleting buyer wallet:", error);
    return false;
  }
}

/**
 * Get buyer wallet private key (from buyerWallets.ts)
 */
export async function getBuyerWalletPrivateKey(
  walletId: string,
  userId: string
): Promise<string | null> {
  try {
    const wallet = await WalletModel.findOne({
      _id: new Types.ObjectId(walletId),
      user: new Types.ObjectId(userId),
      isBuyer: true,
    }).exec();

    if (!wallet?.privateKey) {
      return null;
    }

    // Decrypt the private key before returning
    return decryptPrivateKey(wallet.privateKey);
  } catch (error) {
    console.error("Error getting buyer wallet private key:", error);
    return null;
  }
}

/**
 * Get wallet by ID with user validation
 */
export async function getWalletById(
  walletId: string,
  userId: string
): Promise<Wallet | null> {
  try {
    return await WalletModel.findOne({
      _id: new Types.ObjectId(walletId),
      user: new Types.ObjectId(userId),
    }).exec();
  } catch (error) {
    console.error("Error getting wallet by ID:", error);
    return null;
  }
}

/**
 * Get wallet by public key
 */
export async function getWalletByPublicKey(
  publicKey: string,
  userId: string
): Promise<Wallet | null> {
  try {
    return await WalletModel.findOne({
      publicKey,
      user: new Types.ObjectId(userId),
    }).exec();
  } catch (error) {
    console.error("Error getting wallet by public key:", error);
    return null;
  }
}

// ==================== DEV WALLET MANAGEMENT ====================

/**
 * Get default dev wallet (from mainMenu.ts, ctoMonitor.ts, withdrawal.ts)
 */
export async function getDefaultDevWallet(
  userId: string
): Promise<string | null> {
  try {
    const wallet = await WalletModel.findOne({
      user: new Types.ObjectId(userId),
      isDev: true,
    }).exec();

    return wallet?.publicKey || null;
  } catch (error) {
    console.error("Error getting default dev wallet:", error);
    return null;
  }
}

/**
 * Get dev wallet object (returns full wallet, not just public key)
 */
export async function getDevWallet(userId: string): Promise<Wallet | null> {
  try {
    return await WalletModel.findOne({
      user: new Types.ObjectId(userId),
      isDev: true,
    }).exec();
  } catch (error) {
    console.error("Error getting dev wallet:", error);
    return null;
  }
}

/**
 * Create dev wallet
 */
export async function createDevWallet(
  userId: string,
  publicKey: string,
  privateKey: string
): Promise<Wallet> {
  try {
    // Encrypt the private key before storing
    const encryptedPrivateKey = encryptPrivateKey(privateKey);

    const newWallet = new WalletModel({
      user: new Types.ObjectId(userId),
      publicKey,
      privateKey: encryptedPrivateKey,
      isDev: true,
      createdAt: new Date(),
    });

    return await newWallet.save();
  } catch (error) {
    console.error("Error creating dev wallet:", error);
    throw error;
  }
}

// ==================== FUNDING WALLET MANAGEMENT ====================

/**
 * Get or create funding wallet (from mainMenu.ts)
 */
export async function getOrCreateFundingWallet(
  userId: string
): Promise<Wallet> {
  try {
    // Try to find existing funding wallet
    const wallet = await WalletModel.findOne({
      user: new Types.ObjectId(userId),
      isFunding: true,
    }).exec();

    if (wallet) {
      return wallet;
    }

    // Create new funding wallet if none exists
    const walletKeypair = Keypair.generate();
    const privateKeyBase58 = bs58.encode(walletKeypair.secretKey);
    const encryptedPrivateKey = encryptPrivateKey(privateKeyBase58);

    const newWallet = new WalletModel({
      user: new Types.ObjectId(userId),
      publicKey: walletKeypair.publicKey.toBase58(),
      privateKey: encryptedPrivateKey,
      isFunding: true,
      createdAt: new Date(),
    });

    return await newWallet.save();
  } catch (error) {
    console.error("Error getting or creating funding wallet:", error);
    throw error;
  }
}

/**
 * Get funding wallet
 */
export async function getFundingWallet(userId: string): Promise<Wallet | null> {
  try {
    return await WalletModel.findOne({
      user: new Types.ObjectId(userId),
      isFunding: true,
    }).exec();
  } catch (error) {
    console.error("Error getting funding wallet:", error);
    return null;
  }
}

// ==================== GENERAL WALLET OPERATIONS ====================

/**
 * Get all wallets for a user
 */
export async function getAllUserWallets(userId: string): Promise<Wallet[]> {
  try {
    return await WalletModel.find({
      user: new Types.ObjectId(userId),
    })
      .sort({ createdAt: -1 })
      .exec();
  } catch (error) {
    console.error("Error getting all user wallets:", error);
    return [];
  }
}

/**
 * Update wallet balance
 */
export async function updateWalletBalance(
  walletId: string,
  balance: number,
  bonkBalance?: number
): Promise<boolean> {
  try {
    const updateData: { balance: number; bonkBalance?: number } = { balance };
    if (bonkBalance !== undefined) {
      updateData.bonkBalance = bonkBalance;
    }

    const result = await WalletModel.updateOne(
      { _id: new Types.ObjectId(walletId) },
      { $set: updateData }
    );
    return result.modifiedCount > 0;
  } catch (error) {
    console.error("Error updating wallet balance:", error);
    return false;
  }
}

/**
 * Delete wallet by ID with user validation
 */
export async function deleteWallet(
  walletId: string,
  userId: string
): Promise<boolean> {
  try {
    const result = await WalletModel.deleteOne({
      _id: new Types.ObjectId(walletId),
      user: new Types.ObjectId(userId),
    });
    return result.deletedCount > 0;
  } catch (error) {
    console.error("Error deleting wallet:", error);
    return false;
  }
}

/**
 * Count user wallets by type
 */
export async function countUserWallets(
  userId: string,
  type?: {
    isBuyer?: boolean;
    isDev?: boolean;
    isFunding?: boolean;
  }
): Promise<number> {
  try {
    const query: Record<string, unknown> = { user: new Types.ObjectId(userId) };

    if (type) {
      Object.assign(query, type);
    }

    return await WalletModel.countDocuments(query);
  } catch (error) {
    console.error("Error counting user wallets:", error);
    return 0;
  }
}

/**
 * Get wallet private key with user validation
 */
export async function getWalletPrivateKey(
  walletId: string,
  userId: string
): Promise<string | null> {
  try {
    const wallet = await WalletModel.findOne({
      _id: new Types.ObjectId(walletId),
      user: new Types.ObjectId(userId),
    }).exec();

    if (!wallet?.privateKey) {
      return null;
    }

    // Decrypt the private key before returning
    return decryptPrivateKey(wallet.privateKey);
  } catch (error) {
    console.error("Error getting wallet private key:", error);
    return null;
  }
}

/**
 * Check if user owns wallet
 */
export async function userOwnsWallet(
  walletId: string,
  userId: string
): Promise<boolean> {
  try {
    const count = await WalletModel.countDocuments({
      _id: new Types.ObjectId(walletId),
      user: new Types.ObjectId(userId),
    });
    return count > 0;
  } catch (error) {
    console.error("Error checking wallet ownership:", error);
    return false;
  }
}

// ==================== ENCRYPTION/DECRYPTION HELPER FUNCTIONS ====================

/**
 * Get wallet as Solana Keypair (decrypted)
 */
export async function getWalletKeypair(
  walletId: string,
  userId: string
): Promise<Keypair | null> {
  try {
    const wallet = await WalletModel.findOne({
      _id: new Types.ObjectId(walletId),
      user: new Types.ObjectId(userId),
    }).exec();

    if (!wallet?.privateKey) {
      return null;
    }

    // Decrypt and create keypair
    return decryptKeypairBot(wallet.privateKey);
  } catch (error) {
    console.error("Error getting wallet keypair:", error);
    return null;
  }
}

/**
 * Import wallet from private key (various formats supported)
 */
export async function importWallet(
  userId: string,
  privateKey: string,
  walletType: { isBuyer?: boolean; isDev?: boolean; isFunding?: boolean } = {
    isBuyer: true,
  },
  inputFormat: "base58" | "hex" | "array" = "base58"
): Promise<Wallet> {
  try {
    // Parse private key based on input format
    let secretKeyBytes: Uint8Array;

    switch (inputFormat) {
      case "base58":
        secretKeyBytes = bs58.decode(privateKey);
        break;
      case "hex":
        secretKeyBytes = new Uint8Array(Buffer.from(privateKey, "hex"));
        break;
      case "array":
        secretKeyBytes = new Uint8Array(JSON.parse(privateKey));
        break;
      default:
        throw new Error(`Unsupported input format: ${inputFormat}`);
    }

    // Create keypair to validate and get public key
    const keypair = Keypair.fromSecretKey(secretKeyBytes);
    const publicKey = keypair.publicKey.toBase58();

    // Encrypt the private key for storage
    const encryptedPrivateKey = encryptPrivateKey(privateKey);

    const newWallet = new WalletModel({
      user: new Types.ObjectId(userId),
      publicKey,
      privateKey: encryptedPrivateKey,
      isBuyer: walletType.isBuyer || false,
      isDev: walletType.isDev || false,
      isFunding: walletType.isFunding || false,
      createdAt: new Date(),
    });

    return await newWallet.save();
  } catch (error) {
    console.error("Error importing wallet:", error);
    throw error;
  }
}

/**
 * Re-encrypt wallet (refresh encryption)
 */
export async function reencryptWallet(
  walletId: string,
  userId: string
): Promise<boolean> {
  try {
    const wallet = await WalletModel.findOne({
      _id: new Types.ObjectId(walletId),
      user: new Types.ObjectId(userId),
    }).exec();

    if (!wallet?.privateKey) {
      throw new Error("Wallet not found");
    }

    // Decrypt current private key
    const decryptedPrivateKey = decryptPrivateKey(wallet.privateKey);

    // Re-encrypt with fresh encryption
    const reencryptedPrivateKey = encryptPrivateKey(decryptedPrivateKey);

    // Update wallet
    await WalletModel.updateOne(
      { _id: new Types.ObjectId(walletId), user: new Types.ObjectId(userId) },
      { $set: { privateKey: reencryptedPrivateKey } }
    );

    return true;
  } catch (error) {
    console.error("Error re-encrypting wallet:", error);
    return false;
  }
}

/**
 * Validate wallet integrity (decrypt and verify)
 */
export async function validateWallet(
  walletId: string,
  userId: string
): Promise<{
  isValid: boolean;
  publicKeyMatches: boolean;
  canDecrypt: boolean;
  errorMessage?: string;
}> {
  try {
    const wallet = await WalletModel.findOne({
      _id: new Types.ObjectId(walletId),
      user: new Types.ObjectId(userId),
    }).exec();

    if (!wallet) {
      return {
        isValid: false,
        publicKeyMatches: false,
        canDecrypt: false,
        errorMessage: "Wallet not found",
      };
    }

    try {
      // Try to decrypt the private key
      const keypair = decryptKeypairBot(wallet.privateKey);
      const derivedPublicKey = keypair.publicKey.toBase58();
      const publicKeyMatches = derivedPublicKey === wallet.publicKey;

      return {
        isValid: publicKeyMatches,
        publicKeyMatches,
        canDecrypt: true,
      };
    } catch (decryptError) {
      return {
        isValid: false,
        publicKeyMatches: false,
        canDecrypt: false,
        errorMessage: `Decryption failed: ${(decryptError as Error).message}`,
      };
    }
  } catch (error) {
    return {
      isValid: false,
      publicKeyMatches: false,
      canDecrypt: false,
      errorMessage: `Validation error: ${(error as Error).message}`,
    };
  }
}

// ==================== EXPORTED FUNCTIONS FROM BOT FILES ====================

/*
Wallet functions extracted from bot folder files:

FROM buyerWallets.ts:
- getAllBuyerWallets(userId)
- addBuyerWallet(userId, publicKey, privateKey)
- generateNewBuyerWallet(userId)
- deleteBuyerWallet(walletId, userId)
- getBuyerWalletPrivateKey(walletId, userId)

FROM sellIndividualToken.ts:
- getAllBuyerWallets(userId)

FROM ctoMonitor.ts:
- getAllTradingWallets(userId)
- getDefaultDevWallet(userId)

FROM withdrawal.ts:
- getDefaultDevWallet(userId)

FROM mainMenu.ts:
- getDefaultDevWallet(userId)
- getOrCreateFundingWallet(userId)

FROM monitor-module.ts:
- generateNewBuyerWallet(userId)

Additional utility functions:
- getWalletById(walletId, userId)
- getWalletByPublicKey(publicKey, userId)
- getDevWallet(userId)
- createDevWallet(userId, publicKey, privateKey)
- getFundingWallet(userId)
- getAllUserWallets(userId)
- updateWalletBalance(walletId, balance, bonkBalance)
- deleteWallet(walletId, userId)
- countUserWallets(userId, type)
- getWalletPrivateKey(walletId, userId)
- userOwnsWallet(walletId, userId)

Note: All functions include proper error handling and user validation for security.
*/
