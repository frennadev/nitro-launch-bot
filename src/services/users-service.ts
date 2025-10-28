/**
 * Users Service - Extracted from Bot Folder
 *
 * This service contains all user-related functions that were scattered across the bot folder.
 * It provides a centralized service for user management operations.
 */

import { UserModel, TokenModel } from "../backend/models";
import { Types } from "mongoose";
import type { User, Token } from "../backend/models";

// ==================== USER MANAGEMENT ====================

/**
 * Get user by chat ID (from mainMenu.ts, devSell.ts, viewTokenConversation.ts, etc.)
 */
export async function getUser(chatId: string): Promise<User | null> {
  try {
    return await UserModel.findOne({ telegramId: chatId }).exec();
  } catch (error) {
    console.error("Error getting user:", error);
    return null;
  }
}

/**
 * Get user by user ID (from monitor-module.ts)
 */
export async function getUserById(userId: string): Promise<User | null> {
  try {
    return await UserModel.findById(userId).exec();
  } catch (error) {
    console.error("Error getting user by ID:", error);
    return null;
  }
}

/**
 * Create new user (from mainMenu.ts)
 */
export async function createUser(
  firstName: string | undefined,
  lastName: string | undefined,
  username: string,
  chatId: string
): Promise<User> {
  const newUser = new UserModel({
    firstName,
    lastName,
    userName: username,
    chatId,
    createdAt: new Date(),
  });

  return await newUser.save();
}

/**
 * Create user with referral (from mainMenu.ts)
 */
export async function createUserWithReferral(
  firstName: string | undefined,
  lastName: string | undefined,
  username: string,
  chatId: string,
  referralCode: string
): Promise<User> {
  // Find the referrer by referral code
  const referrer = await UserModel.findOne({
    $or: [{ affiliateCode: referralCode }, { "referral.code": referralCode }],
  }).exec();

  const newUser = new UserModel({
    firstName,
    lastName,
    userName: username,
    chatId,
    createdAt: new Date(),
    referredBy: referrer?._id,
    referral: {
      code: referralCode,
      referredBy: referrer?._id,
    },
  });

  const savedUser = await newUser.save();

  // Update referrer's referral count if found
  if (referrer) {
    await UserModel.updateOne(
      { _id: referrer._id },
      { $inc: { "referral.count": 1 } }
    );
  }

  return savedUser;
}

// ==================== TOKEN MANAGEMENT ====================

/**
 * Get user's token (from devSell.ts)
 */
export async function getUserToken(
  userId: string,
  tokenAddress: string
): Promise<Token | null> {
  try {
    return await TokenModel.findOne({
      user: new Types.ObjectId(userId),
      tokenAddress,
    }).exec();
  } catch (error) {
    console.error("Error getting user token:", error);
    return null;
  }
}

/**
 * Get user's token with buy wallets populated (from walletSell.ts)
 */
export async function getUserTokenWithBuyWallets(
  userId: string,
  tokenAddress: string
): Promise<Token | null> {
  try {
    return await TokenModel.findOne({
      user: new Types.ObjectId(userId),
      tokenAddress,
    })
      .populate("launchData.buyWallets")
      .exec();
  } catch (error) {
    console.error("Error getting user token with buy wallets:", error);
    return null;
  }
}

/**
 * Get all user's tokens (from viewTokenConversation.ts)
 */
export async function getUserTokens(userId: string): Promise<Token[]> {
  try {
    return await TokenModel.find({ user: new Types.ObjectId(userId) })
      .populate("launchData.devWallet")
      .populate("launchData.buyWallets")
      .sort({ createdAt: -1 })
      .exec();
  } catch (error) {
    console.error("Error getting user tokens:", error);
    return [];
  }
}

/**
 * Delete user's token (from viewTokenConversation.ts)
 */
export async function deleteToken(
  tokenId: string,
  userId: string
): Promise<boolean> {
  try {
    const result = await TokenModel.deleteOne({
      _id: new Types.ObjectId(tokenId),
      user: new Types.ObjectId(userId),
    });
    return result.deletedCount > 0;
  } catch (error) {
    console.error("Error deleting token:", error);
    return false;
  }
}

// Note: Wallet management functions have been moved to wallets-service.ts

// ==================== REFERRAL SYSTEM ====================

/**
 * Get user referral stats (from mainMenu.ts, referrals.ts)
 */
export async function getUserReferralStats(userId: string): Promise<{
  referralCount: number;
  affiliateCode: string | null;
  totalEarnings?: number;
}> {
  try {
    const user = await UserModel.findById(userId).exec();
    if (!user) {
      return { referralCount: 0, affiliateCode: null };
    }

    // Count users referred by this user
    const referralCount = await UserModel.countDocuments({
      referredBy: new Types.ObjectId(userId),
    });

    return {
      referralCount,
      affiliateCode: user.affiliateCode || null,
      totalEarnings:
        (user as User & { referral?: { earnings: number } }).referral
          ?.earnings || 0,
    };
  } catch (error) {
    console.error("Error getting referral stats:", error);
    return { referralCount: 0, affiliateCode: null };
  }
}

/**
 * Generate referral link (from referrals.ts, ctoMonitor.ts, monitor-module.ts)
 */
export async function generateReferralLink(
  userId: string,
  botUsername: string
): Promise<string> {
  try {
    const user = await UserModel.findById(userId).exec();
    if (!user) {
      throw new Error("User not found");
    }

    // Generate affiliate code if doesn't exist
    let affiliateCode = user.affiliateCode;
    if (!affiliateCode) {
      affiliateCode = `REF_${userId.slice(-8).toUpperCase()}`;
      await UserModel.updateOne(
        { _id: new Types.ObjectId(userId) },
        { affiliateCode }
      );
    }

    return `https://t.me/${botUsername}?start=REF_${affiliateCode.replace("REF_", "")}`;
  } catch (error) {
    console.error("Error generating referral link:", error);
    throw error;
  }
}

// ==================== USER ACTIVITY & STATS ====================

/**
 * Get user trades (from monitor-module.ts)
 * Note: This depends on a Trade model that may need to be imported
 */
export async function getUserTrades(userId: string): Promise<unknown[]> {
  try {
    // Implementation depends on Trade model structure
    // This is a placeholder that needs to be implemented based on actual Trade model
    console.log("getUserTrades called for userId:", userId);
    throw new Error(
      "getUserTrades: Implementation needed based on Trade model"
    );
  } catch (error) {
    console.error("Error getting user trades:", error);
    return [];
  }
}

/**
 * Get accurate spending stats (from viewTokenConversation.ts, message.ts)
 * Note: This may involve complex calculations across multiple collections
 */
export async function getAccurateSpendingStats(userId: string): Promise<{
  totalSpent: number;
  totalEarned: number;
  netProfit: number;
}> {
  try {
    // Implementation depends on transaction/trade tracking system
    // This is a placeholder that needs to be implemented based on actual requirements
    console.log("getAccurateSpendingStats called for userId:", userId);
    throw new Error("getAccurateSpendingStats: Implementation needed");
  } catch (error) {
    console.error("Error getting spending stats:", error);
    return { totalSpent: 0, totalEarned: 0, netProfit: 0 };
  }
}

// ==================== UTILITY FUNCTIONS ====================

/**
 * Check if user exists (utility function)
 */
export async function userExists(chatId: string): Promise<boolean> {
  try {
    const count = await UserModel.countDocuments({ chatId });
    return count > 0;
  } catch (error) {
    console.error("Error checking if user exists:", error);
    return false;
  }
}

/**
 * Update user info (utility function)
 */
export async function updateUser(
  userId: string,
  updates: Partial<{
    firstName: string;
    lastName: string;
    userName: string;
    affiliateCode: string;
  }>
): Promise<boolean> {
  try {
    const result = await UserModel.updateOne(
      { _id: new Types.ObjectId(userId) },
      { $set: updates }
    );
    return result.modifiedCount > 0;
  } catch (error) {
    console.error("Error updating user:", error);
    return false;
  }
}

/**
 * Get user by username (utility function)
 */
export async function getUserByUsername(
  username: string
): Promise<User | null> {
  try {
    return await UserModel.findOne({ userName: username }).exec();
  } catch (error) {
    console.error("Error getting user by username:", error);
    return null;
  }
}

/**
 * Get user by affiliate code (utility function)
 */
export async function getUserByAffiliateCode(
  affiliateCode: string
): Promise<User | null> {
  try {
    return await UserModel.findOne({ affiliateCode }).exec();
  } catch (error) {
    console.error("Error getting user by affiliate code:", error);
    return null;
  }
}

// ==================== EXPORTED FUNCTIONS FROM BOT FILES ====================

/*
User functions extracted from bot folder files:

FROM mainMenu.ts:
- getUser(chatId: string)
- createUser(firstName, lastName, username, chatId)
- createUserWithReferral(firstName, lastName, username, chatId, referralCode)
- getUserReferralStats(userId)

FROM referrals.ts:
- getUser(userId) [via dynamic import]
- getUserReferralStats(userId)
- generateReferralLink(userId, botUsername)

FROM devSell.ts:
- getUser(chatId)
- getUserToken(userId, tokenAddress)

FROM walletSell.ts:
- getUser(chatId)
- getUserTokenWithBuyWallets(userId, tokenAddress)

FROM viewTokenConversation.ts:
- getUser(chatId)
- getUserTokens(userId)
- deleteToken(tokenId, userId)

FROM monitor-module.ts:
- getUser(userId)
- getUserById(userId)
- getUserTrades(userId)
- generateReferralLink(userId, botUsername)

FROM buyerWallets.ts:
- getUser(chatId)

// Import wallet functions from wallets-service.ts when needed

WALLET FUNCTIONS MOVED TO: src/services/wallets-service.ts
- All wallet-related functions have been extracted to a separate service
- Import wallet functions from wallets-service.ts when needed
- Uses existing encryption/decryption utilities from backend/utils.ts

Note: Some functions like getUserTrades and getAccurateSpendingStats require 
implementation based on the existing backend logic as they involve complex 
operations not fully visible in the bot folder code.
*/
