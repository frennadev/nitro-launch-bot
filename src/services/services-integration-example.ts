/**
 * Services Integration Example
 *
 * This file demonstrates how to use the separated user and wallet services together.
 * Import this example when integrating the services into your bot files.
 *
 * Note: Type assertions using 'any' are used in this example for MongoDB document IDs.
 * In production code, use proper TypeScript interfaces or the Document type from Mongoose.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// Import both services
import {
  getUser,
  createUser,
  getUserTokens,
  getUserReferralStats,
} from "./users-service";
// Note: This is an example file - in real usage, proper typing should be used instead of 'any'

import {
  getAllBuyerWallets,
  getAllTradingWallets,
  generateNewBuyerWallet,
  getDefaultDevWallet,
  getOrCreateFundingWallet,
  deleteBuyerWallet,
  getBuyerWalletPrivateKey,
} from "./wallets-service";

// Example usage patterns:

/**
 * Example: Get user and their wallets
 */
export async function getUserWithWallets(chatId: string) {
  try {
    // Get user from users service
    const user = await getUser(chatId);
    if (!user) {
      return null;
    }

    // Get user's wallets from wallets service
    const userId = (user as any)._id.toString();
    const buyerWallets = await getAllBuyerWallets(userId);
    const tradingWallets = await getAllTradingWallets(userId);
    const devWallet = await getDefaultDevWallet(userId);

    return {
      user,
      wallets: {
        buyer: buyerWallets,
        trading: tradingWallets,
        devWalletAddress: devWallet,
      },
    };
  } catch (error) {
    console.error("Error getting user with wallets:", error);
    return null;
  }
}

/**
 * Example: Create user and setup initial wallet
 */
export async function createUserWithInitialWallet(
  firstName: string | undefined,
  lastName: string | undefined,
  username: string,
  chatId: string
) {
  try {
    // Create user using users service
    const user = await createUser(firstName, lastName, username, chatId);

    // Create initial funding wallet using wallets service
    const userId = (user as any)._id.toString();
    const fundingWallet = await getOrCreateFundingWallet(userId);

    // Generate initial buyer wallet
    const buyerWallet = await generateNewBuyerWallet(userId);

    return {
      user,
      fundingWallet,
      buyerWallet,
    };
  } catch (error) {
    console.error("Error creating user with wallet:", error);
    throw error;
  }
}

/**
 * Example: Get user's complete trading profile
 */
export async function getUserTradingProfile(chatId: string) {
  try {
    // Get user
    const user = await getUser(chatId);
    if (!user) {
      return null;
    }

    const userId = (user as any)._id.toString();

    // Get user's tokens and wallets in parallel
    const [tokens, buyerWallets, referralStats] = await Promise.all([
      getUserTokens(userId),
      getAllBuyerWallets(userId),
      getUserReferralStats(userId),
    ]);

    return {
      user,
      tokens,
      wallets: buyerWallets,
      referralStats,
    };
  } catch (error) {
    console.error("Error getting user trading profile:", error);
    return null;
  }
}

/**
 * Example: Clean up user wallet
 */
export async function removeUserWallet(chatId: string, walletId: string) {
  try {
    // Get user to validate ownership
    const user = await getUser(chatId);
    if (!user) {
      throw new Error("User not found");
    }

    // Delete wallet using wallets service
    const deleted = await deleteBuyerWallet(
      walletId,
      (user as any)._id.toString()
    );

    return deleted;
  } catch (error) {
    console.error("Error removing user wallet:", error);
    throw error;
  }
}

/**
 * Example: Get wallet private key with user validation
 */
export async function getWalletPrivateKeyForUser(
  chatId: string,
  walletId: string
) {
  try {
    // Validate user exists
    const user = await getUser(chatId);
    if (!user) {
      throw new Error("User not found");
    }

    // Get private key with user validation
    const privateKey = await getBuyerWalletPrivateKey(
      walletId,
      (user as any)._id.toString()
    );

    return privateKey;
  } catch (error) {
    console.error("Error getting wallet private key:", error);
    return null;
  }
}

// Usage in bot files:
/*
// Instead of calling scattered functions across bot files, use:

// OLD way (scattered across bot files):
// const user = await UserModel.findOne({ chatId }).exec();
// const wallets = await WalletModel.find({ user: user._id, isBuyer: true });

// NEW way (using services):
import { getUserWithWallets } from '../services/services-integration-example';
const userProfile = await getUserWithWallets(chatId);

// Or import specific functions:
import { getUser } from '../services/users-service';
import { getAllBuyerWallets } from '../services/wallets-service';

const user = await getUser(chatId);
const wallets = await getAllBuyerWallets(user._id.toString());
*/
