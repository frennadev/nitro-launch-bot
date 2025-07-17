import mongoose from "mongoose";
import { connection } from "../blockchain/common/connection";
import {
  generateKeypairs,
  secretKeyToKeypair,
} from "../blockchain/common/utils";
import { env } from "../config";
import {
  TokenModel,
  UserModel,
  WalletModel,
  type User,
  PumpAddressModel,
  RetryDataModel,
  type RetryData,
} from "./models";
import {
  decryptPrivateKey,
  encryptPrivateKey,
  getTokenBalance,
  getTokenInfo,
  uploadFileToPinata,
  uploadJsonToPinata,
} from "./utils";
import { TokenState } from "./types";
import {
  devSellQueue,
  tokenLaunchQueue,
  walletSellQueue,
  prepareLaunchQueue,
  executeLaunchQueue,
} from "../jobs/queues";
import { logger } from "../blockchain/common/logger";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { sendAndConfirmTransaction } from "@solana/web3.js";
import { getExternalPumpAddressService } from "../service/external-pump-address-service";

export const getUser = async (telegramId: String) => {
  const user = await UserModel.findOne({
    telegramId,
  }).exec();
  return user;
};

export const getDevWallet = async (userId: String) => {
  const wallet = await WalletModel.findOne({
    user: userId,
    isDev: true,
  });
  return {
    wallet: decryptPrivateKey(wallet?.privateKey!),
  };
};

export const getTokensForUser = async (userId: string) => {
  const result = await TokenModel.find({
    user: userId,
  }).lean();
  return result.map((token) => ({
    id: String(token._id),
    address: token.tokenAddress,
    name: token.name,
    symbol: token.symbol,
    description: token.description,
    state: token.state,
  }));
};

export const getUserToken = async (userId: string, tokenAddress: string) => {
  const token = await TokenModel.findOne({
    user: userId,
    tokenAddress,
  })
    .populate(["launchData.devWallet"])
    .lean();
  return token;
};

export const getUserTokenWithBuyWallets = async (
  userId: string,
  tokenAddress: string
) => {
  const token = await TokenModel.findOne({
    user: userId,
    tokenAddress,
  })
    .populate(["launchData.buyWallets", "launchData.devWallet"])
    .lean();
  return token;
};

export const createUser = async (
  firstName: string | undefined,
  lastName: string | undefined,
  userName: string,
  telegramId: string
) => {
  return await UserModel.create({
    firstName,
    lastName,
    userName,
    telegramId,
  });
};

export const getOrCreateDevWallet = async (userId: string) => {
  let wallet = await WalletModel.findOne({ user: userId, isDev: true }).exec();
  if (!wallet) {
    const [devWallet] = generateKeypairs(1);
    wallet = await WalletModel.create({
      user: userId,
      publicKey: devWallet.publicKey,
      privateKey: encryptPrivateKey(devWallet.secretKey),
      isDev: true,
      isDefault: true,
    });
  }
  return wallet.publicKey;
};

export const getAllDevWallets = async (userId: string) => {
  const wallets = await WalletModel.find({
    user: userId,
    isDev: true,
  })
    .sort({ createdAt: 1 })
    .lean();

  return wallets.map((wallet) => ({
    id: String(wallet._id),
    publicKey: wallet.publicKey,
    isDefault: wallet.isDefault || false,
    createdAt: wallet.createdAt,
  }));
};

export const getDefaultDevWallet = async (userId: string) => {
  const wallet = await WalletModel.findOne({
    user: userId,
    isDev: true,
    isDefault: true,
  }).exec();

  if (!wallet) {
    const firstWallet = await WalletModel.findOne({
      user: userId,
      isDev: true,
    }).exec();

    if (firstWallet) {
      await WalletModel.updateOne(
        { _id: firstWallet._id },
        { isDefault: true }
      );
      return firstWallet.publicKey;
    }

    return await getOrCreateDevWallet(userId);
  }

  return wallet.publicKey;
};

export const addDevWallet = async (userId: string, privateKey: string) => {
  const existingWallets = await WalletModel.countDocuments({
    user: userId,
    isDev: true,
  });

  if (existingWallets >= 5) {
    throw new Error("Maximum of 5 dev wallets allowed");
  }

  const keypair = secretKeyToKeypair(privateKey);
  const publicKey = keypair.publicKey.toBase58();

  const existingWallet = await WalletModel.findOne({
    user: userId,
    publicKey: publicKey,
    isDev: true,
  });

  if (existingWallet) {
    throw new Error("This wallet is already added");
  }

  const wallet = await WalletModel.create({
    user: userId,
    publicKey: publicKey,
    privateKey: encryptPrivateKey(privateKey),
    isDev: true,
    isDefault: false,
  });

  return {
    id: String(wallet._id),
    publicKey: wallet.publicKey,
    isDefault: false,
  };
};

export const setDefaultDevWallet = async (userId: string, walletId: string) => {
  await WalletModel.updateMany(
    {
      user: userId,
      isDev: true,
    },
    { isDefault: false }
  );

  const updatedWallet = await WalletModel.findOneAndUpdate(
    {
      _id: walletId,
      user: userId,
      isDev: true,
    },
    { isDefault: true },
    { new: true }
  );

  if (!updatedWallet) {
    throw new Error("Wallet not found");
  }

  return updatedWallet.publicKey;
};

export const deleteDevWallet = async (userId: string, walletId: string) => {
  const devWalletCount = await WalletModel.countDocuments({
    user: userId,
    isDev: true,
  });

  if (devWalletCount <= 1) {
    throw new Error("Cannot delete the last dev wallet");
  }

  const walletToDelete = await WalletModel.findOne({
    _id: walletId,
    user: userId,
    isDev: true,
  });

  if (!walletToDelete) {
    throw new Error("Wallet not found");
  }

  const wasDefault = walletToDelete.isDefault;

  await WalletModel.deleteOne({
    _id: walletId,
    user: userId,
    isDev: true,
  });

  if (wasDefault) {
    const firstRemainingWallet = await WalletModel.findOne({
      user: userId,
      isDev: true,
    });

    if (firstRemainingWallet) {
      await WalletModel.updateOne(
        { _id: firstRemainingWallet._id },
        { isDefault: true }
      );
    }
  }

  return true;
};

export const generateNewDevWallet = async (userId: string) => {
  const existingWallets = await WalletModel.countDocuments({
    user: userId,
    isDev: true,
  });

  if (existingWallets >= 5) {
    throw new Error("Maximum of 5 dev wallets allowed");
  }

  const [devWallet] = generateKeypairs(1);

  const wallet = await WalletModel.create({
    user: userId,
    publicKey: devWallet.publicKey,
    privateKey: encryptPrivateKey(devWallet.secretKey),
    isDev: true,
    isDefault: false,
  });

  return {
    id: String(wallet._id),
    publicKey: wallet.publicKey,
    privateKey: devWallet.secretKey,
    isDefault: false,
  };
};

export const addWallet = async (publickKey: string, secretKey: string) => {};

export const generateWallets = async () => {};

const createTokenMetadata = async (
  name: string,
  symbol: string,
  description: string,
  image: any
) => {
  try {
    const ipfsImage = await uploadFileToPinata(
      image,
      `token-${name}-${symbol}-${Date.now()}.png`
    ).then((hash) => `${env.PINATA_GATEWAY_URL}/ipfs/${hash}`);
    if (!ipfsImage) {
      return null;
    }
    const data = {
      name,
      symbol,
      description,
      image: ipfsImage,
    };
    const ipfsMetadataResult = await uploadJsonToPinata(
      data,
      `metadata-${name}-${symbol}-${Date.now()}.json`
    );
    if (!ipfsMetadataResult) {
      return null;
    }
    const ipfsUrl = `${env.PINATA_GATEWAY_URL}/ipfs/${ipfsMetadataResult}`;
    return ipfsUrl;
  } catch (error: any) {
    logger.error("Error Occurred While uploading metadata", error);
  }
  return null;
};

export const getAvailablePumpAddress = async (
  userId: string,
  excludeAddresses: string[] = []
) => {
  const externalService = getExternalPumpAddressService();

  try {
    // First try to get an address from the external database
    logger.info(
      `[getAvailablePumpAddress] Attempting to get pump address from external database for user ${userId}`
    );

    const externalAddress = await externalService.getUnusedPumpAddress(
      userId,
      excludeAddresses
    );

    if (externalAddress) {
      logger.info(
        `[getAvailablePumpAddress] Successfully allocated external pump address ${externalAddress.publicKey} to user ${userId}`
      );

      // Also mark it as used in our local database for consistency
      try {
        await markPumpAddressAsUsed(externalAddress.publicKey, userId);
      } catch (localError: any) {
        // If local database doesn't have this address, that's okay - external is the source of truth
        logger.warn(
          `[getAvailablePumpAddress] Local database doesn't have address ${externalAddress.publicKey}, continuing with external allocation`
        );
      }

      return {
        publicKey: externalAddress.publicKey,
        secretKey: externalAddress.secretKey,
      };
    } else {
      logger.warn(
        `[getAvailablePumpAddress] No external pump addresses available, falling back to local database`
      );
    }
  } catch (error: any) {
    logger.error(
      `[getAvailablePumpAddress] Error accessing external database: ${error.message}, falling back to local database`
    );
  }

  // Fallback to local database if external service fails or has no addresses
  const session = await mongoose.startSession();

  try {
    return await session.withTransaction(async () => {
      // Build query to find addresses that have NEVER been allocated to any user
      // Use the same logic as external database
      const query: any = {
        $or: [{ usedBy: { $exists: false } }, { usedBy: null }, { usedBy: "" }],
      };

      if (excludeAddresses.length > 0) {
        query.publicKey = { $nin: excludeAddresses };
      }

      // Find an unused pump address
      const pumpAddress = await PumpAddressModel.findOneAndUpdate(
        query,
        {
          $set: {
            isUsed: true,
            usedBy: userId,
            usedAt: new Date(),
          },
        },
        {
          new: true,
          session,
          sort: { createdAt: 1 }, // Use oldest first
        }
      );

      if (!pumpAddress) {
        throw new Error(
          "No available pump addresses found in either external or local database. Please contact support."
        );
      }

      logger.info(
        `[getAvailablePumpAddress] Using local pump address ${pumpAddress.publicKey} for user ${userId}`
      );

      return {
        publicKey: pumpAddress.publicKey,
        secretKey: pumpAddress.secretKey,
      };
    });
  } finally {
    await session.endSession();
  }
};

export const releasePumpAddress = async (publicKey: string) => {
  logger.warn(
    `[releasePumpAddress] Attempted to release pump address ${publicKey} - addresses are never released once allocated`
  );

  // Pump addresses are never released once allocated to prevent reuse
  // This ensures each address is only used once by one user

  // Only log the attempt for monitoring purposes
  logger.info(
    `[releasePumpAddress] Pump address ${publicKey} remains permanently allocated`
  );

  return false; // Never release addresses
};

export const markPumpAddressAsUsed = async (
  publicKey: string,
  userId?: string
) => {
  try {
    const result = await PumpAddressModel.findOneAndUpdate(
      { publicKey },
      {
        isUsed: true,
        usedBy: userId || null,
        usedAt: new Date(),
      },
      { new: true }
    );

    if (!result) {
      throw new Error(`Pump address ${publicKey} not found`);
    }

    logger.info(`Pump address ${publicKey} marked as used by user ${userId}`);
    return result;
  } catch (error) {
    logger.error(`Error marking pump address ${publicKey} as used:`, error);
    throw error;
  }
};

/**
 * Tag a token address as used with additional metadata
 * @param tokenAddress - The token address to tag
 * @param userId - The user ID who is using this address
 * @param metadata - Additional metadata about the usage
 */
export const tagTokenAddressAsUsed = async (
  tokenAddress: string,
  userId: string,
  metadata?: {
    tokenName?: string;
    tokenSymbol?: string;
    reason?: string;
    originalAddress?: string; // If this was a replacement for another address
  }
) => {
  try {
    // Check if this is a pump address and mark it as used
    const pumpAddress = await PumpAddressModel.findOne({
      publicKey: tokenAddress,
    });

    if (pumpAddress) {
      await markPumpAddressAsUsed(tokenAddress, userId);
      logger.info(
        `Tagged pump address ${tokenAddress} as used by user ${userId}`,
        metadata
      );
    }

    // Log the usage for tracking purposes
    logger.info(`Token address ${tokenAddress} tagged as used`, {
      userId,
      tokenAddress,
      isPumpAddress: !!pumpAddress,
      ...metadata,
    });

    return { success: true, isPumpAddress: !!pumpAddress };
  } catch (error) {
    logger.error(`Error tagging token address ${tokenAddress} as used:`, error);
    throw error;
  }
};

export const getPumpAddressStats = async () => {
  const total = await PumpAddressModel.countDocuments();
  const used = await PumpAddressModel.countDocuments({
    $or: [{ usedBy: { $exists: true, $ne: null } }, { usedBy: { $ne: "" } }],
  });
  const available = total - used;

  return {
    total,
    used,
    available,
    usagePercentage: total > 0 ? Math.round((used / total) * 100) : 0,
  };
};

export const getUserPumpAddresses = async (userId: string) => {
  return await PumpAddressModel.find({ usedBy: userId }).select(
    "publicKey usedAt"
  );
};

export const createToken = async (
  userId: string,
  name: string,
  symbol: string,
  description: string,
  image: any
) => {
  const devWallet = await WalletModel.findOne({
    user: userId,
    isDev: true,
    isDefault: true,
  });

  if (!devWallet) {
    throw new Error("No default dev wallet found");
  }

  const metadataUri = await createTokenMetadata(
    name,
    symbol,
    description,
    image
  );
  if (!metadataUri) {
    throw new Error("Token metadata uri not uploaded");
  }

  // Use pump address instead of generating random keypair
  let tokenKey: any;
  let isPumpAddress = false;
  let attempts = 0;
  const maxAttempts = 5; // Increased from 3 to 5 attempts

  while (attempts < maxAttempts) {
    attempts++;

    try {
      tokenKey = await getAvailablePumpAddress(userId);
      isPumpAddress = true;
      logger.info(
        `[createToken] Got pump address: ${tokenKey.publicKey} (attempt ${attempts})`
      );
    } catch (error: any) {
      // Fallback to random generation if no pump addresses available
      logger.warn(
        `No pump addresses available for user ${userId}, falling back to random generation: ${error.message}`
      );
      const [randomKey] = generateKeypairs(1);
      tokenKey = randomKey;
    }

    // Check if the allocated address is already launched/listed
    const {
      isTokenAlreadyLaunched,
      isTokenAlreadyListed,
      clearLaunchStatusCache,
    } = await import("../service/token-detection-service");

    // Clear cache for this address to ensure fresh detection
    clearLaunchStatusCache(tokenKey.publicKey);

    const isLaunched = await isTokenAlreadyLaunched(tokenKey.publicKey);
    const isListed = await isTokenAlreadyListed(tokenKey.publicKey);

    if (!isLaunched && !isListed) {
      // Address is not launched/listed, we can use it
      logger.info(
        `[createToken] Address ${tokenKey.publicKey} is not launched/listed - proceeding with token creation`
      );
      break;
    }

    // Address is already launched/listed, try again
    logger.warn(
      `[createToken] Address ${tokenKey.publicKey} is already ${isListed ? "listed" : "launched"} - trying again (attempt ${attempts}/${maxAttempts})`
    );

    if (attempts >= maxAttempts) {
      // If we've tried multiple times and all addresses seem to be launched,
      // this might be a false positive. Try one more time with a random address
      logger.warn(
        `[createToken] All pump addresses appear to be launched - this might be a false positive. Trying with random address.`
      );

      const [randomKey] = generateKeypairs(1);
      tokenKey = randomKey;

      // Clear cache and check the random address
      clearLaunchStatusCache(tokenKey.publicKey);
      const finalIsLaunched = await isTokenAlreadyLaunched(tokenKey.publicKey);
      const finalIsListed = await isTokenAlreadyListed(tokenKey.publicKey);

      if (!finalIsLaunched && !finalIsListed) {
        logger.info(
          `[createToken] Random address ${tokenKey.publicKey} is available - proceeding with token creation`
        );
        isPumpAddress = false; // Mark as random address
        break;
      } else {
        throw new Error(
          `Failed to find a non-launched address after ${maxAttempts} attempts. All addresses appear to be already active on trading platforms. This may indicate a system issue with token detection.`
        );
      }
    }

    // Small delay before retry
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  try {
    const token = await TokenModel.create({
      user: userId,
      name,
      symbol,
      description,
      launchData: {
        devWallet: devWallet?.id,
      },
      tokenAddress: tokenKey.publicKey,
      tokenPrivateKey: encryptPrivateKey(tokenKey.secretKey),
      tokenMetadataUrl: metadataUri,
    });

    logger.info(
      `[createToken] Successfully created token ${name} (${symbol}) with address ${tokenKey.publicKey} (${isPumpAddress ? "pump address" : "random address"})`
    );
    return token;
  } catch (error) {
    // Pump addresses are never released once allocated to prevent reuse
    // This ensures each address is only used once by one user, regardless of token creation success/failure
    if (isPumpAddress) {
      logger.info(
        `[createToken] Token creation failed for pump address ${tokenKey.publicKey} - address remains permanently allocated to user ${userId}`
      );
    }
    throw error;
  }
};

/**
 * Automatically replace a token address if it's already launched/listed
 * This function checks if the token is active and gets a new address if needed
 * @param userId - The user ID
 * @param tokenAddress - The current token address to check
 * @returns Object with new token address and whether it was replaced
 */
export const autoReplaceLaunchedTokenAddress = async (
  userId: string,
  tokenAddress: string
): Promise<{
  newTokenAddress: string;
  wasReplaced: boolean;
  reason?: string;
}> => {
  try {
    // Check if token is already launched/listed
    const { isTokenAlreadyLaunched, isTokenAlreadyListed } = await import(
      "../service/token-detection-service"
    );

    const isLaunched = await isTokenAlreadyLaunched(tokenAddress);
    const isListed = await isTokenAlreadyListed(tokenAddress);

    if (!isLaunched && !isListed) {
      // Token is not launched/listed, no replacement needed
      return {
        newTokenAddress: tokenAddress,
        wasReplaced: false,
      };
    }

    logger.info(
      `[autoReplaceLaunchedTokenAddress] Token ${tokenAddress} is already ${isListed ? "listed" : "launched"} - getting new address`
    );

    // Get a new pump address from the pool
    let newTokenKey;
    let isPumpAddress = false;

    try {
      newTokenKey = await getAvailablePumpAddress(userId);
      isPumpAddress = true;
      logger.info(
        `[autoReplaceLaunchedTokenAddress] Got new pump address: ${newTokenKey.publicKey}`
      );
    } catch (error: any) {
      // Fallback to random generation if no pump addresses available
      logger.warn(
        `[autoReplaceLaunchedTokenAddress] No pump addresses available, falling back to random generation: ${error.message}`
      );
      const [randomKey] = generateKeypairs(1);
      newTokenKey = randomKey;
    }

    // Update the token document with the new address
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        // Get the current token data
        const currentToken = await TokenModel.findOne({
          tokenAddress,
          user: userId,
        }).session(session);

        if (!currentToken) {
          throw new Error("Token not found");
        }

        // Create new token with the same metadata but new address
        const newToken = await TokenModel.create(
          [
            {
              user: userId,
              name: currentToken.name,
              symbol: currentToken.symbol,
              description: currentToken.description,
              launchData: {
                devWallet: currentToken.launchData?.devWallet,
                // Reset launch data since this is a new token
                launchAttempt: 0,
                launchStage: 1,
              },
              tokenAddress: newTokenKey.publicKey,
              tokenPrivateKey: encryptPrivateKey(newTokenKey.secretKey),
              tokenMetadataUrl: currentToken.tokenMetadataUrl,
              // State will default to undefined (not launched)
            },
          ],
          { session }
        );

        // Delete the old token
        await TokenModel.deleteOne({
          _id: currentToken._id,
        }).session(session);

        logger.info(
          `[autoReplaceLaunchedTokenAddress] Successfully replaced token address from ${tokenAddress} to ${newTokenKey.publicKey}`
        );
      });

      return {
        newTokenAddress: newTokenKey.publicKey,
        wasReplaced: true,
        reason: `Token was already ${isListed ? "listed" : "launched"} on a trading platform`,
      };
    } catch (error: any) {
      // If token replacement fails, release the new pump address (if it was a pump address)
      if (isPumpAddress) {
        logger.warn(
          `[autoReplaceLaunchedTokenAddress] Token replacement failed, but pump address ${newTokenKey.publicKey} remains allocated to user ${userId} (never released)`
        );
      }
      throw error;
    } finally {
      await session.endSession();
    }
  } catch (error: any) {
    logger.error(
      `[autoReplaceLaunchedTokenAddress] Error replacing token address: ${error.message}`
    );
    throw error;
  }
};

export const preLaunchChecks = async (
  funderWallet: string,
  devWallet: string,
  buyAmount: number,
  devBuy: number,
  walletCount: number
) => {
  let success = true;
  const funderKeypair = secretKeyToKeypair(funderWallet);
  const devKeypair = secretKeyToKeypair(decryptPrivateKey(devWallet));

  // expectations - Updated to match actual fee requirements
  // Each wallet needs: buy amount portion + 0.005 SOL for fees (increased from 0.003 to 0.005 for safety buffer)
  // Total needed: buy amount + (wallet count × fee per wallet)
  const expectedFunderBalance =
    (buyAmount + walletCount * 0.005) * LAMPORTS_PER_SOL;
  const expectedDevBalance = (0.01 + devBuy + 0.05) * LAMPORTS_PER_SOL;

  // balances
  const funderBalance = await connection.getBalance(funderKeypair.publicKey);
  const devBalance = await connection.getBalance(devKeypair.publicKey);

  let message = "PreLaunch Checks:";
  if (funderBalance < expectedFunderBalance) {
    message += `\n❌ <b>Funder wallet balance too low</b>
💰 <b>Required:</b> ${(expectedFunderBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL
💳 <b>Available:</b> ${(funderBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL
<b>Fund this wallet:</b> <code>${funderKeypair.publicKey.toBase58()}</code>`;
    success = false;
  }
  if (devBalance < expectedDevBalance) {
    message += `\n❌ <b>Dev wallet balance too low</b>
💰 <b>Required:</b> ${(expectedDevBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL
💳 <b>Available:</b> ${(devBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL
<b>Fund this wallet:</b> <code>${devKeypair.publicKey.toBase58()}</code>`;
    success = false;
  }
  return { success, message };
};

export const enqueueTokenLaunch = async (
  userId: string,
  chatId: number,
  tokenAddress: string,
  funderWallet: string,
  devWallet: string,
  buyWallets: string[],
  devBuy: number,
  buyAmount: number
) => {
  const session = await mongoose.startSession();

  console.log("enqueueTokenLaunch called with params:", {
    userId,
    chatId,
    tokenAddress,
    funderWallet,
    devWallet,
    buyWallets,
    devBuy,
    buyAmount,
  });
  console.log("Starting mongoose session...");
  try {
    await session.withTransaction(async () => {
      // Check buyer wallet limit before creating new wallets
      const existingBuyerWallets = await WalletModel.countDocuments({
        user: userId,
        isBuyer: true,
      });

      // Count how many new wallets will be created
      let newWalletsToCreate = 0;
      for (const key of buyWallets) {
        const keypair = secretKeyToKeypair(key);
        const existingWallet = await WalletModel.findOne({
          publicKey: keypair.publicKey.toBase58(),
          user: userId,
        });
        if (!existingWallet) {
          newWalletsToCreate++;
        }
      }

      if (existingBuyerWallets + newWalletsToCreate > 20) {
        throw new Error(
          `Adding ${newWalletsToCreate} new wallets would exceed the maximum of 20 buyer wallets allowed`
        );
      }

      const walletIds = [];
      for (const key of buyWallets) {
        const keypair = secretKeyToKeypair(key);
        let wallet = await WalletModel.findOne({
          publicKey: keypair.publicKey.toBase58(),
          user: userId,
        });
        if (wallet) {
          walletIds.push(String(wallet.id));
        } else {
          wallet = await WalletModel.create({
            user: userId,
            isDev: false,
            isBuyer: true, // Add missing isBuyer flag
            isFunding: false, // Add missing isFunding flag
            publicKey: keypair.publicKey.toBase58(),
            privateKey: encryptPrivateKey(key),
          });
          walletIds.push(String(wallet.id));
        }
      }
      const encryptedFunder = encryptPrivateKey(funderWallet);
      const updatedToken = await TokenModel.findOneAndUpdate(
        {
          tokenAddress,
          user: userId,
        },
        {
          $set: {
            state: TokenState.LAUNCHING,
            "launchData.funderPrivateKey": encryptedFunder,
            "launchData.buyWallets": walletIds,
            "launchData.buyAmount": buyAmount,
            "launchData.devBuy": devBuy,
            "launchData.launchStage": 1,
          },
          $inc: {
            "launchData.launchAttempt": 1,
          },
        },
        { new: true }
      ).lean();
      if (!updatedToken) {
        throw new Error("Failed to update token");
      }
      await tokenLaunchQueue.add(
        `launch-${tokenAddress}-${updatedToken.launchData?.launchAttempt}`,
        {
          userId,
          tokenAddress,
          tokenPrivateKey: decryptPrivateKey(updatedToken.tokenPrivateKey),
          userChatId: chatId,
          tokenName: updatedToken.name,
          tokenMetadataUri: updatedToken.tokenMetadataUrl,
          tokenSymbol: updatedToken.symbol,
          buyAmount,
          buyerWallets: buyWallets,
          devBuy,
          devWallet: decryptPrivateKey(devWallet),
          funderWallet: funderWallet,
          buyDistribution: generateBuyDistribution(
            buyAmount,
            buyWallets.length
          ),
          launchStage: 1,
        }
      );
    });
    return { success: true, message: "" };
  } catch (error: any) {
    logger.error("An error occurred during launch enque", error);
    return {
      success: false,
      message: `An error occurred during launch enque: ${error.message}`,
    };
  } finally {
    await session.endSession();
  }
};

export const enqueueTokenLaunchRetry = async (
  userId: string,
  chatId: number,
  tokenAddress: string
) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const updatedToken = await TokenModel.findOneAndUpdate(
        {
          tokenAddress,
          user: userId,
        },
        {
          $set: {
            state: TokenState.LAUNCHING,
          },
          $inc: {
            "launchData.launchAttempt": 1,
          },
        },
        { new: true }
      )
        .populate(["launchData.buyWallets", "launchData.devWallet"])
        .lean();
      if (!updatedToken) {
        throw new Error("Failed to update token");
      }
      const data = {
        userId,
        tokenAddress,
        tokenPrivateKey: decryptPrivateKey(updatedToken.tokenPrivateKey),
        userChatId: chatId,
        tokenName: updatedToken.name,
        tokenMetadataUri: updatedToken.tokenMetadataUrl,
        tokenSymbol: updatedToken.symbol,
        buyAmount: updatedToken.launchData!.buyAmount,
        buyerWallets:
          updatedToken.launchData!.buyWalletsOrder ||
          updatedToken.launchData!.buyWallets.map((w) =>
            decryptPrivateKey(
              (w as unknown as { privateKey: string }).privateKey
            )
          ), // CRITICAL FIX: Use stored wallet order if available, fallback to database order
        devWallet: decryptPrivateKey(
          (
            updatedToken.launchData!.devWallet as unknown as {
              privateKey: string;
            }
          ).privateKey
        ),
        funderWallet: decryptPrivateKey(
          updatedToken.launchData!.funderPrivateKey
        ),
        devBuy: updatedToken.launchData!.devBuy,
        buyDistribution:
          updatedToken.launchData!.buyDistribution ||
          generateBuyDistribution(
            updatedToken.launchData!.buyAmount,
            updatedToken.launchData!.buyWallets.length
          ),
        launchStage: updatedToken.launchData!.launchStage || 1,
      };
      await tokenLaunchQueue.add(
        `launch-${tokenAddress}-${updatedToken.launchData?.launchAttempt}`,
        data
      );
    });
    return { success: true, message: "" };
  } catch (error: any) {
    logger.error("An error occurred during launch retry enque", error);
    return {
      success: false,
      message: `An error occurred during launch retry enque: ${error.message}`,
    };
  } finally {
    await session.endSession();
  }
};

export const enqueueDevSell = async (
  userId: string,
  chatId: number,
  tokenAddress: string,
  devWallet: string,
  sellPercent: number
) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const updatedToken = await TokenModel.findOneAndUpdate(
        {
          tokenAddress,
          user: userId,
        },
        {
          $set: {
            "launchData.lockDevSell": true,
          },
          $inc: {
            "launchData.devSellAttempt": 1,
          },
        },
        { new: true }
      ).lean();
      if (!updatedToken) {
        throw new Error("Failed to update token");
      }
      await devSellQueue.add(
        `dev-sell-${tokenAddress}-${updatedToken.launchData?.devSellAttempt}`,
        {
          userId,
          tokenAddress,
          userChatId: chatId,
          devWallet,
          sellPercent,
        }
      );
    });
    return { success: true, message: "" };
  } catch (error: any) {
    logger.error("An error occurred during dev sell enque", error);
    return {
      success: false,
      message: `An error occurred during dev sell enque: ${error.message}`,
    };
  } finally {
    await session.endSession();
  }
};

export const enqueueWalletSell = async (
  userId: string,
  chatId: number,
  tokenAddress: string,
  devWallet: string,
  buyerWallets: string[],
  sellPercent: number
) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const updatedToken = await TokenModel.findOneAndUpdate(
        {
          tokenAddress,
          user: userId,
        },
        {
          $set: {
            "launchData.lockWalletSell": true,
          },
          $inc: {
            "launchData.walletSellAttempt": 1,
          },
        },
        { new: true }
      ).lean();
      if (!updatedToken) {
        throw new Error("Failed to update token");
      }
      await walletSellQueue.add(
        `wallet-sell-${tokenAddress}-${updatedToken.launchData?.walletSellAttempt}`,
        {
          userId,
          tokenAddress,
          userChatId: chatId,
          devWallet,
          buyerWallets,
          sellPercent,
        }
      );
    });
    return { success: true, message: "" };
  } catch (error: any) {
    logger.error("An error occurred during wallet sell enque", error);
    return {
      success: false,
      message: `An error occurred during wallet sell enque: ${error.message}`,
    };
  } finally {
    await session.endSession();
  }
};

export const updateTokenState = async (
  tokenAddress: string,
  state: TokenState,
  userId?: string
) => {
  const filter: any = { tokenAddress };

  // If userId is provided, filter by user as well to avoid cross-user state updates
  if (userId) {
    filter.user = userId;
  }

  await TokenModel.findOneAndUpdate(filter, {
    $set: {
      state,
    },
  });
};

export const updateLaunchStage = async (
  tokenAddress: string,
  stage: Number
) => {
  await TokenModel.findOneAndUpdate(
    {
      tokenAddress,
    },
    {
      $set: {
        "launchData.launchStage": stage,
      },
    }
  );
};

export const updateBuyDistribution = async (
  tokenAddress: string,
  dist: Number[]
) => {
  await TokenModel.findOneAndUpdate(
    {
      tokenAddress,
    },
    {
      $set: {
        "launchData.buyDistribution": dist,
      },
    }
  );
};

export const acquireDevSellLock = async (tokenAddress: string) => {
  await TokenModel.findOneAndUpdate(
    {
      tokenAddress,
    },
    {
      $set: {
        "launchData.lockDevSell": true,
      },
    }
  );
};

export const releaseDevSellLock = async (tokenAddress: string) => {
  await TokenModel.findOneAndUpdate(
    {
      tokenAddress,
    },
    {
      $set: {
        "launchData.lockDevSell": false,
      },
    }
  );
};

export const acquireWalletSellLock = async (tokenAddress: string) => {
  await TokenModel.findOneAndUpdate(
    {
      tokenAddress,
    },
    {
      $set: {
        "launchData.lockWalletSell": true,
      },
    }
  );
};

export const releaseWalletSellLock = async (tokenAddress: string) => {
  await TokenModel.findOneAndUpdate(
    {
      tokenAddress,
    },
    {
      $set: {
        "launchData.lockWalletSell": false,
      },
    }
  );
};

// ========== FUNDING WALLET FUNCTIONS ==========

export const getOrCreateFundingWallet = async (userId: string) => {
  let user = await UserModel.findById(userId).populate("fundingWallet").exec();
  if (!user) {
    throw new Error("User not found");
  }

  if (!user.fundingWallet) {
    const [fundingWallet] = generateKeypairs(1);
    const wallet = await WalletModel.create({
      user: userId,
      publicKey: fundingWallet.publicKey,
      privateKey: encryptPrivateKey(fundingWallet.secretKey),
      isDev: false,
      isBuyer: false,
      isFunding: true,
    });

    await UserModel.updateOne({ _id: userId }, { fundingWallet: wallet._id });

    return wallet.publicKey;
  }

  return (user.fundingWallet as any).publicKey;
};

export const checkSellAmountWithoutDecimals = async (
  mint: string,
  publicKey: string
) => {
  // Check cache firs
  try {
    // Get all token accounts by owner
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      new PublicKey(publicKey),
      {
        mint: new PublicKey(mint),
      }
    );

    // Iterate through token accounts to find the balance
    let balance = 0;
    tokenAccounts.value.forEach((tokenAccountInfo) => {
      const tokenAccountData = tokenAccountInfo.account.data.parsed.info;
      balance += tokenAccountData.tokenAmount.uiAmount;
    });

    // const mintInfo = await getMint(connection, new PublicKey(mint));
    // const decimals = 10 ** mintInfo.decimals;

    // console.log("Decimals: " + mintInfo.decimals);

    return balance;
  } catch (error) {
    logger.error("Error getting SPL token balance:", error);
    return 0;
  }
};

export const getFundingWallet = async (userId: string) => {
  const user = await UserModel.findById(userId)
    .populate("fundingWallet")
    .exec();
  if (!user || !user.fundingWallet) {
    return null;
  }

  return {
    id: String((user.fundingWallet as any)._id),
    publicKey: (user.fundingWallet as any).publicKey,
    privateKey: decryptPrivateKey((user.fundingWallet as any).privateKey),
  };
};

export const generateNewFundingWallet = async (userId: string) => {
  const user = await UserModel.findById(userId)
    .populate("fundingWallet")
    .exec();
  if (!user) {
    throw new Error("User not found");
  }

  // Delete old funding wallet if exists
  if (user.fundingWallet) {
    await WalletModel.deleteOne({ _id: (user.fundingWallet as any)._id });
  }

  // Create new funding wallet
  const [fundingWallet] = generateKeypairs(1);
  const wallet = await WalletModel.create({
    user: userId,
    publicKey: fundingWallet.publicKey,
    privateKey: encryptPrivateKey(fundingWallet.secretKey),
    isDev: false,
    isBuyer: false,
    isFunding: true,
  });

  await UserModel.updateOne({ _id: userId }, { fundingWallet: wallet._id });

  return {
    id: String(wallet._id),
    publicKey: wallet.publicKey,
    privateKey: fundingWallet.secretKey,
  };
};

// ========== BUYER WALLET FUNCTIONS ==========

export const getAllBuyerWallets = async (userId: string) => {
  const wallets = await WalletModel.find({
    user: userId,
    isBuyer: true,
  })
    .sort({ createdAt: 1 })
    .lean();

  return wallets.map((wallet) => ({
    id: String(wallet._id),
    publicKey: wallet.publicKey,
    createdAt: wallet.createdAt,
  }));
};

export const addBuyerWallet = async (userId: string, privateKey: string) => {
  const existingWallets = await WalletModel.countDocuments({
    user: userId,
    isBuyer: true,
  });

  if (existingWallets >= 20) {
    throw new Error("Maximum of 20 buyer wallets allowed");
  }

  const keypair = secretKeyToKeypair(privateKey);
  const publicKey = keypair.publicKey.toBase58();

  const existingWallet = await WalletModel.findOne({
    user: userId,
    publicKey: publicKey,
    isBuyer: true,
  });

  if (existingWallet) {
    throw new Error("This wallet is already added");
  }

  const wallet = await WalletModel.create({
    user: userId,
    publicKey: publicKey,
    privateKey: encryptPrivateKey(privateKey),
    isDev: false,
    isBuyer: true,
    isFunding: false,
  });

  return {
    id: String(wallet._id),
    publicKey: wallet.publicKey,
  };
};

export const generateNewBuyerWallet = async (userId: string) => {
  const existingWallets = await WalletModel.countDocuments({
    user: userId,
    isBuyer: true,
  });

  if (existingWallets >= 20) {
    throw new Error("Maximum of 20 buyer wallets allowed");
  }

  const [buyerWallet] = generateKeypairs(1);

  const wallet = await WalletModel.create({
    user: userId,
    publicKey: buyerWallet.publicKey,
    privateKey: encryptPrivateKey(buyerWallet.secretKey),
    isDev: false,
    isBuyer: true,
    isFunding: false,
  });

  return {
    id: String(wallet._id),
    publicKey: wallet.publicKey,
    privateKey: buyerWallet.secretKey,
  };
};

export const deleteBuyerWallet = async (userId: string, walletId: string) => {
  const deletedWallet = await WalletModel.findOneAndDelete({
    _id: walletId,
    user: userId,
    isBuyer: true,
  });

  if (!deletedWallet) {
    throw new Error("Buyer wallet not found");
  }

  return true;
};

export const getBuyerWalletPrivateKey = async (
  userId: string,
  walletId: string
) => {
  const wallet = await WalletModel.findOne({
    _id: walletId,
    user: userId,
    isBuyer: true,
  });

  if (!wallet) {
    throw new Error("Buyer wallet not found");
  }

  return decryptPrivateKey(wallet.privateKey);
};

// ========== BALANCE CHECKING FUNCTIONS ==========

export const getWalletBalance = async (publicKey: string) => {
  try {
    const balance = await connection.getBalance(
      new (await import("@solana/web3.js")).PublicKey(publicKey)
    );
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    logger.error("Error fetching wallet balance", error);
    return 0;
  }
};

export const deleteToken = async (userId: string, tokenAddress: string) => {
  try {
    // 1. Find the token for this user
    const token = await TokenModel.findOne({ user: userId, tokenAddress });
    if (!token) {
      throw new Error("Token not found");
    }

    // 2. If this is a pump address, mark it as permanently used (never release)
    const pumpAddress = await PumpAddressModel.findOne({
      publicKey: tokenAddress,
    });
    if (pumpAddress) {
      logger.info(
        `[deleteToken] Token ${tokenAddress} is a pump address - keeping it permanently allocated to user ${pumpAddress.usedBy}`
      );
      // Pump addresses are never released once allocated to prevent reuse
    }

    // 3. Delete the token document
    await TokenModel.deleteOne({ _id: token._id });

    return { success: true, message: "Token deleted successfully" };
  } catch (error: any) {
    logger.error("Error deleting token:", error);
    return { success: false, message: error.message };
  }
};

export const handleTokenLaunchFailure = async (
  tokenAddress: string,
  error?: any
) => {
  // Pump addresses are never released once allocated to prevent reuse
  // This ensures each address is only used once by one user, regardless of launch success/failure

  const pumpAddress = await PumpAddressModel.findOne({
    publicKey: tokenAddress,
    isUsed: true,
  });

  if (pumpAddress) {
    const token = await TokenModel.findOne({ tokenAddress }).populate([
      "launchData.devWallet",
    ]);
    const launchAttempt = token?.launchData?.launchAttempt || 0;

    // Check if token was actually created (either successfully or already exists)
    const devWalletPublicKey = (token?.launchData?.devWallet as any)?.publicKey;
    const tokenCreationSuccessful = devWalletPublicKey
      ? await isTransactionAlreadySuccessful(
          tokenAddress,
          devWalletPublicKey,
          "token_creation"
        )
      : false;

    // Log the failure but never release the pump address
    logger.info(
      `[handleTokenLaunchFailure] Token launch failed for ${tokenAddress} (attempt ${launchAttempt})`
    );
    logger.info(
      `[handleTokenLaunchFailure] Token creation successful: ${tokenCreationSuccessful}`
    );
    logger.info(
      `[handleTokenLaunchFailure] Pump address ${tokenAddress} remains permanently allocated to user ${pumpAddress.usedBy}`
    );

    if (error) {
      logger.error(
        `[handleTokenLaunchFailure] Error details: ${error.message}`
      );
    }

    // Pump address remains permanently allocated - no release
    logger.info(
      `[handleTokenLaunchFailure] Pump address ${tokenAddress} will never be released - permanently allocated to user ${pumpAddress.usedBy}`
    );
  }
};

// ========== RETRY DATA FUNCTIONS ==========

export const saveRetryData = async (
  userId: string,
  telegramId: string,
  conversationType: "launch_token" | "quick_launch",
  data: {
    // Launch Token data
    tokenAddress?: string;
    buyAmount?: number;
    devBuy?: number;
    // Quick Launch data
    name?: string;
    symbol?: string;
    description?: string;
    imageData?: Buffer;
    totalBuyAmount?: number;
    walletsNeeded?: number;
  }
) => {
  // Remove any existing retry data for this user and conversation type
  await RetryDataModel.deleteMany({
    user: userId,
    conversationType,
  });

  // Create new retry data
  const retryData = await RetryDataModel.create({
    user: userId,
    telegramId,
    conversationType,
    ...data,
  });

  return retryData;
};

export const getRetryData = async (
  userId: string,
  conversationType: "launch_token" | "quick_launch"
): Promise<any> => {
  const retryData = await RetryDataModel.findOne({
    user: userId,
    conversationType,
  }).lean();

  return retryData;
};

export const clearRetryData = async (
  userId: string,
  conversationType: "launch_token" | "quick_launch"
) => {
  await RetryDataModel.deleteMany({
    user: userId,
    conversationType,
  });
};

export const clearAllRetryData = async (userId: string) => {
  await RetryDataModel.deleteMany({
    user: userId,
  });
};

// ========== FEE COLLECTION FUNCTIONS ==========

export const collectPlatformFee = async (
  devWalletPrivateKey: string,
  feeAmountSol: number = 0.05
): Promise<{ success: boolean; signature?: string; error?: string }> => {
  try {
    const { env } = await import("../config");

    const devKeypair = secretKeyToKeypair(devWalletPrivateKey);
    const platformFeeWallet = new PublicKey(env.PLATFORM_FEE_WALLET);
    const feeAmountLamports = Math.floor(feeAmountSol * LAMPORTS_PER_SOL);

    // Check if dev wallet has sufficient balance for the fee
    const devBalance = await connection.getBalance(devKeypair.publicKey);
    const estimatedTxFee = 5000; // ~5000 lamports for transaction fee
    const totalRequired = feeAmountLamports + estimatedTxFee;

    if (devBalance < totalRequired) {
      return {
        success: false,
        error: `Insufficient balance for platform fee. Required: ${(totalRequired / LAMPORTS_PER_SOL).toFixed(6)} SOL, Available: ${(devBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`,
      };
    }

    // Create fee transfer transaction
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: devKeypair.publicKey,
        toPubkey: platformFeeWallet,
        lamports: feeAmountLamports,
      })
    );

    // Send transaction
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [devKeypair],
      {
        commitment: "confirmed",
      }
    );

    logger.info(
      `Platform fee collected: ${feeAmountSol} SOL from ${devKeypair.publicKey.toBase58()} to ${platformFeeWallet.toBase58()}`
    );

    return { success: true, signature };
  } catch (error: any) {
    logger.error("Error collecting platform fee:", error);
    return { success: false, error: error.message };
  }
};

export const calculateTotalLaunchCost = (
  buyAmount: number,
  devBuy: number,
  walletCount: number,
  showPlatformFee: boolean = false
): {
  totalCost: number;
  breakdown: {
    buyAmount: number;
    devBuy: number;
    walletFees: number;
    buffer: number;
    platformFee?: number;
  };
} => {
  const walletFees = walletCount * 0.005; // ~0.005 SOL per wallet for transaction fees (updated to match actual requirements)
  const buffer = 0.2; // Safety buffer
  const platformFee = env.LAUNCH_FEE_SOL;

  const breakdown: any = {
    buyAmount,
    devBuy,
    walletFees,
    buffer,
  };

  let totalCost = buyAmount + devBuy + walletFees + buffer;

  // Only include platform fee in breakdown and total if requested (for internal calculations)
  if (showPlatformFee) {
    breakdown.platformFee = platformFee;
    totalCost += platformFee;
  }

  return {
    totalCost,
    breakdown,
  };
};

export const enqueuePrepareTokenLaunch = async (
  userId: string,
  chatId: number,
  tokenAddress: string,
  funderWallet: string,
  devWallet: string,
  buyWallets: string[],
  devBuy: number,
  buyAmount: number
) => {
  const session = await mongoose.startSession();

  try {
    // Validate that the token address is not already used by another user
    const availability = await validateTokenAddressAvailability(
      tokenAddress,
      userId
    );
    if (!availability.isAvailable) {
      logger.warn(
        `Token address ${tokenAddress} conflict detected for user ${userId}. Checking if this is the user's own token...`
      );

      // Check if this is the user's own token that they're trying to launch
      const usage = await checkTokenAddressUsage(tokenAddress);
      if (usage.isUsed && usage.usedBy === userId) {
        logger.info(
          `User ${userId} is launching their own token ${tokenAddress}. Proceeding with launch...`
        );
        // This is their own token, proceed with launch
      } else {
        // This is genuinely a conflict with another user's token
        return {
          success: false,
          message: `Cannot launch token: ${availability.message}`,
        };
      }
    }

    await session.withTransaction(async () => {
      // Check buyer wallet limit before creating new wallets
      const existingBuyerWallets = await WalletModel.countDocuments({
        user: userId,
        isBuyer: true,
      });

      // Count how many new wallets will be created
      let newWalletsToCreate = 0;
      for (const key of buyWallets) {
        const keypair = secretKeyToKeypair(key);
        const existingWallet = await WalletModel.findOne({
          publicKey: keypair.publicKey.toBase58(),
          user: userId,
        });
        if (!existingWallet) {
          newWalletsToCreate++;
        }
      }

      if (existingBuyerWallets + newWalletsToCreate > 20) {
        throw new Error(
          `Adding ${newWalletsToCreate} new wallets would exceed the maximum of 20 buyer wallets allowed`
        );
      }

      const walletIds = [];
      for (const key of buyWallets) {
        const keypair = secretKeyToKeypair(key);
        let wallet = await WalletModel.findOne({
          publicKey: keypair.publicKey.toBase58(),
          user: userId,
        });
        if (wallet) {
          walletIds.push(String(wallet.id));
        } else {
          wallet = await WalletModel.create({
            user: userId,
            isDev: false,
            isBuyer: true, // Add missing isBuyer flag
            isFunding: false, // Add missing isFunding flag
            publicKey: keypair.publicKey.toBase58(),
            privateKey: encryptPrivateKey(key),
          });
          walletIds.push(String(wallet.id));
        }
      }
      const encryptedFunder = encryptPrivateKey(funderWallet);
      const updatedToken = await TokenModel.findOneAndUpdate(
        {
          tokenAddress,
          user: userId,
        },
        {
          $set: {
            state: TokenState.LAUNCHING, // Will be changed to PREPARING in future
            "launchData.funderPrivateKey": encryptedFunder,
            "launchData.buyWallets": walletIds,
            "launchData.buyWalletsOrder": buyWallets, // CRITICAL FIX: Store original wallet order
            "launchData.buyAmount": buyAmount,
            "launchData.devBuy": devBuy,
            "launchData.launchStage": 1,
          },
          $inc: {
            "launchData.launchAttempt": 1,
          },
        },
        { new: true }
      ).lean();
      if (!updatedToken) {
        throw new Error("Failed to update token");
      }
      await prepareLaunchQueue.add(
        `prepare-${tokenAddress}-${updatedToken.launchData?.launchAttempt}`,
        {
          userId,
          tokenAddress,
          tokenPrivateKey: decryptPrivateKey(updatedToken.tokenPrivateKey),
          userChatId: chatId,
          tokenName: updatedToken.name,
          tokenMetadataUri: updatedToken.tokenMetadataUrl,
          tokenSymbol: updatedToken.symbol,
          buyAmount,
          buyerWallets: buyWallets,
          devBuy,
          devWallet: decryptPrivateKey(devWallet),
          funderWallet: funderWallet,
        }
      );
    });
    return { success: true, message: "" };
  } catch (error: any) {
    logger.error("An error occurred during prepare launch enqueue", error);
    return {
      success: false,
      message: `An error occurred during prepare launch enqueue: ${error.message}`,
    };
  } finally {
    await session.endSession();
  }
};

export const enqueueExecuteTokenLaunch = async (
  userId: string,
  chatId: number,
  tokenAddress: string
) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const updatedToken = await TokenModel.findOneAndUpdate(
        {
          tokenAddress,
          user: userId,
        },
        {
          $set: {
            state: TokenState.LAUNCHING,
          },
          $inc: {
            "launchData.launchAttempt": 1,
          },
        },
        { new: true }
      )
        .populate(["launchData.buyWallets", "launchData.devWallet"])
        .lean();
      if (!updatedToken) {
        throw new Error("Failed to update token");
      }
      const data = {
        userId,
        tokenAddress,
        tokenPrivateKey: decryptPrivateKey(updatedToken.tokenPrivateKey),
        userChatId: chatId,
        tokenName: updatedToken.name,
        tokenMetadataUri: updatedToken.tokenMetadataUrl,
        tokenSymbol: updatedToken.symbol,
        buyAmount: updatedToken.launchData!.buyAmount,
        buyerWallets:
          updatedToken.launchData!.buyWalletsOrder ||
          updatedToken.launchData!.buyWallets.map((w) =>
            decryptPrivateKey(
              (w as unknown as { privateKey: string }).privateKey
            )
          ), // CRITICAL FIX: Use stored wallet order if available, fallback to database order
        devWallet: decryptPrivateKey(
          (
            updatedToken.launchData!.devWallet as unknown as {
              privateKey: string;
            }
          ).privateKey
        ),
        devBuy: updatedToken.launchData!.devBuy,
        launchStage: updatedToken.launchData!.launchStage || 3, // Start from LAUNCH stage
      };
      await executeLaunchQueue.add(
        `execute-${tokenAddress}-${updatedToken.launchData?.launchAttempt}`,
        data
      );
    });
    return { success: true, message: "" };
  } catch (error: any) {
    logger.error("An error occurred during execute launch enqueue", error);
    return {
      success: false,
      message: `An error occurred during execute launch enqueue: ${error.message}`,
    };
  } finally {
    await session.endSession();
  }
};

export const removeFailedToken = async (tokenAddress: string) => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      // Find and remove the token
      const deletedToken = await TokenModel.findOneAndDelete({
        tokenAddress: tokenAddress,
      }).session(session);

      if (!deletedToken) {
        throw new Error(`Token with address ${tokenAddress} not found`);
      }

      // Mark the pump address as used to prevent reuse
      await PumpAddressModel.findOneAndUpdate(
        { publicKey: tokenAddress },
        {
          isUsed: true,
          usedAt: new Date(),
          // Don't set usedBy since we're removing the token
        },
        { session }
      );

      logger.info("Successfully removed failed token:", {
        tokenAddress,
        tokenName: deletedToken.name,
        tokenSymbol: deletedToken.symbol,
        userId: deletedToken.user,
      });
    });

    return {
      success: true,
      message: "Token removed and address marked as used",
    };
  } catch (error: any) {
    logger.error("Error removing failed token:", error);
    throw error;
  } finally {
    await session.endSession();
  }
};

// ========== TRANSACTION RECORDING FUNCTIONS ==========

export const recordTransaction = async (
  tokenAddress: string,
  walletPublicKey: string,
  transactionType:
    | "token_creation"
    | "dev_buy"
    | "snipe_buy"
    | "dev_sell"
    | "wallet_sell"
    | "external_sell"
    | "external_buy",
  signature: string,
  success: boolean,
  launchAttempt: number,
  options: {
    sellAttempt?: number;
    slippageUsed?: number;
    amountSol?: number;
    amountTokens?: string;
    sellPercent?: number;
    errorMessage?: string;
    retryAttempt?: number;
  } = {}
) => {
  const { TransactionRecordModel } = await import("./models");

  await TransactionRecordModel.create({
    tokenAddress,
    walletPublicKey,
    transactionType,
    signature,
    success,
    launchAttempt,
    sellAttempt: options.sellAttempt,
    slippageUsed: options.slippageUsed,
    amountSol: options.amountSol,
    amountTokens: options.amountTokens,
    sellPercent: options.sellPercent,
    errorMessage: options.errorMessage,
    retryAttempt: options.retryAttempt || 0,
  });
};

export const recordSellTransaction = async (
  tokenAddress: string,
  walletPublicKey: string,
  transactionType: "dev_sell" | "wallet_sell" | "external_sell",
  signature: string,
  success: boolean,
  sellAttempt: number,
  options: {
    solReceived?: number;
    tokensSold?: string;
    sellPercent?: number;
    errorMessage?: string;
    retryAttempt?: number;
  } = {}
) => {
  const { TransactionRecordModel } = await import("./models");

  await TransactionRecordModel.create({
    tokenAddress,
    walletPublicKey,
    transactionType,
    signature,
    success,
    launchAttempt: 0, // Sells don't have launch attempts, use 0 as default
    sellAttempt,
    amountSol: options.solReceived, // For sells, this is SOL received
    amountTokens: options.tokensSold,
    sellPercent: options.sellPercent,
    errorMessage: options.errorMessage,
    retryAttempt: options.retryAttempt || 0,
  });
};

export const getSuccessfulTransactions = async (
  tokenAddress: string,
  transactionType:
    | "token_creation"
    | "dev_buy"
    | "snipe_buy"
    | "dev_sell"
    | "wallet_sell"
    | "external_sell"
    | "external_buy",
  launchAttempt?: number
) => {
  const { TransactionRecordModel } = await import("./models");

  const query: any = {
    tokenAddress,
    transactionType,
    success: true,
  };

  if (launchAttempt !== undefined) {
    query.launchAttempt = launchAttempt;
  }

  const records = await TransactionRecordModel.find(query).lean();
  return records.map((record) => record.walletPublicKey);
};

export const getFailedTransactions = async (
  tokenAddress: string,
  transactionType:
    | "token_creation"
    | "dev_buy"
    | "snipe_buy"
    | "dev_sell"
    | "wallet_sell"
    | "external_sell"
    | "external_buy",
  launchAttempt?: number
) => {
  const { TransactionRecordModel } = await import("./models");

  const query: any = {
    tokenAddress,
    transactionType,
    success: false,
  };

  if (launchAttempt !== undefined) {
    query.launchAttempt = launchAttempt;
  }

  const records = await TransactionRecordModel.find(query).lean();
  return records;
};

export const isTransactionAlreadySuccessful = async (
  tokenAddress: string,
  walletPublicKey: string,
  transactionType:
    | "token_creation"
    | "dev_buy"
    | "snipe_buy"
    | "dev_sell"
    | "wallet_sell"
    | "external_sell"
    | "external_buy"
) => {
  const { TransactionRecordModel } = await import("./models");

  const record = await TransactionRecordModel.findOne({
    tokenAddress,
    walletPublicKey,
    transactionType,
    success: true,
  }).lean();

  return record !== null;
};

export const getTransactionStats = async (
  tokenAddress: string,
  launchAttempt?: number
) => {
  const { TransactionRecordModel } = await import("./models");

  const query: any = { tokenAddress };
  if (launchAttempt !== undefined) {
    query.launchAttempt = launchAttempt;
  }

  const records = await TransactionRecordModel.find(query).lean();

  const stats = {
    total: records.length,
    successful: records.filter((r) => r.success).length,
    failed: records.filter((r) => !r.success).length,
    byType: {
      token_creation: records.filter(
        (r) => r.transactionType === "token_creation"
      ),
      dev_buy: records.filter((r) => r.transactionType === "dev_buy"),
      snipe_buy: records.filter((r) => r.transactionType === "snipe_buy"),
      dev_sell: records.filter((r) => r.transactionType === "dev_sell"),
      wallet_sell: records.filter((r) => r.transactionType === "wallet_sell"),
      external_sell: records.filter(
        (r) => r.transactionType === "external_sell"
      ),
      external_buy: records.filter((r) => r.transactionType === "external_buy"),
    },
  };

  return stats;
};

// ========== TRANSACTION FINANCIAL STATS FUNCTIONS ==========

export const getTransactionFinancialStats = async (
  tokenAddress: string,
  launchAttempt?: number
) => {
  const { TransactionRecordModel } = await import("./models");

  const query: any = {
    tokenAddress,
    success: true, // Only count successful transactions
  };
  if (launchAttempt !== undefined) {
    query.launchAttempt = launchAttempt;
  }

  const records = await TransactionRecordModel.find(query).lean();

  // Calculate totals by transaction type
  const devBuyRecords = records.filter((r) => r.transactionType === "dev_buy");
  const snipeBuyRecords = records.filter(
    (r) => r.transactionType === "snipe_buy"
  );
  const externalBuyRecords = records.filter(
    (r) => r.transactionType === "external_buy"
  );
  const devSellRecords = records.filter(
    (r) => r.transactionType === "dev_sell"
  );
  const walletSellRecords = records.filter(
    (r) => r.transactionType === "wallet_sell"
  );
  const externalSellRecords = records.filter(
    (r) => r.transactionType === "external_sell"
  );

  // Calculate spending (buys)
  const totalDevSpent = devBuyRecords.reduce((sum, record) => {
    return sum + (record.amountSol || 0);
  }, 0);

  const totalSnipeSpent = snipeBuyRecords.reduce((sum, record) => {
    return sum + (record.amountSol || 0);
  }, 0);

  const totalExternalSpent = externalBuyRecords.reduce((sum, record) => {
    return sum + (record.amountSol || 0);
  }, 0);

  const totalSpent = totalDevSpent + totalSnipeSpent + totalExternalSpent;

  // Calculate earnings (sells)
  const totalDevEarned = devSellRecords.reduce((sum, record) => {
    return sum + (record.amountSol || 0);
  }, 0);

  const totalWalletEarned = walletSellRecords.reduce((sum, record) => {
    return sum + (record.amountSol || 0);
  }, 0);

  const totalExternalEarned = externalSellRecords.reduce((sum, record) => {
    return sum + (record.amountSol || 0);
  }, 0);

  const totalEarned = totalDevEarned + totalWalletEarned + totalExternalEarned;

  // Calculate P&L
  const netProfitLoss = totalEarned - totalSpent;
  const profitLossPercentage =
    totalSpent > 0 ? (netProfitLoss / totalSpent) * 100 : 0;

  // Calculate total tokens acquired (buys)
  const totalDevTokens = devBuyRecords.reduce((sum, record) => {
    return sum + BigInt(record.amountTokens || "0");
  }, BigInt(0));

  const totalSnipeTokens = snipeBuyRecords.reduce((sum, record) => {
    return sum + BigInt(record.amountTokens || "0");
  }, BigInt(0));

  const totalExternalTokens = externalBuyRecords.reduce((sum, record) => {
    return sum + BigInt(record.amountTokens || "0");
  }, BigInt(0));

  const totalTokens = totalDevTokens + totalSnipeTokens + totalExternalTokens;

  // Calculate total tokens sold
  const totalDevTokensSold = devSellRecords.reduce((sum, record) => {
    return sum + BigInt(record.amountTokens || "0");
  }, BigInt(0));

  const totalWalletTokensSold = walletSellRecords.reduce((sum, record) => {
    return sum + BigInt(record.amountTokens || "0");
  }, BigInt(0));

  const totalExternalTokensSold = externalSellRecords.reduce((sum, record) => {
    return sum + BigInt(record.amountTokens || "0");
  }, BigInt(0));

  const totalTokensSold =
    totalDevTokensSold + totalWalletTokensSold + totalExternalTokensSold;
  const remainingTokens = totalTokens - totalTokensSold;

  return {
    // Buy data
    totalSpent: Number(totalSpent.toFixed(6)),
    totalDevSpent: Number(totalDevSpent.toFixed(6)),
    totalSnipeSpent: Number(totalSnipeSpent.toFixed(6)),
    totalExternalSpent: Number(totalExternalSpent.toFixed(6)),
    totalTokens: totalTokens.toString(),
    totalDevTokens: totalDevTokens.toString(),
    totalSnipeTokens: totalSnipeTokens.toString(),
    totalExternalTokens: totalExternalTokens.toString(),
    successfulBuys: snipeBuyRecords.length,
    successfulExternalBuys: externalBuyRecords.length,
    averageSpentPerWallet:
      snipeBuyRecords.length > 0
        ? Number((totalSnipeSpent / snipeBuyRecords.length).toFixed(6))
        : 0,

    // Sell data
    totalEarned: Number(totalEarned.toFixed(6)),
    totalDevEarned: Number(totalDevEarned.toFixed(6)),
    totalWalletEarned: Number(totalWalletEarned.toFixed(6)),
    totalExternalEarned: Number(totalExternalEarned.toFixed(6)),
    totalTokensSold: totalTokensSold.toString(),
    totalDevTokensSold: totalDevTokensSold.toString(),
    totalWalletTokensSold: totalWalletTokensSold.toString(),
    totalExternalTokensSold: totalExternalTokensSold.toString(),
    remainingTokens: remainingTokens.toString(),
    successfulSells:
      devSellRecords.length +
      walletSellRecords.length +
      externalSellRecords.length,

    // P&L data
    netProfitLoss: Number(netProfitLoss.toFixed(6)),
    profitLossPercentage: Number(profitLossPercentage.toFixed(2)),
    isProfit: netProfitLoss > 0,
  };
};

// ========== DETAILED SELL HISTORY FUNCTIONS ==========

export const getSellTransactionHistory = async (
  tokenAddress: string,
  transactionType?: "dev_sell" | "wallet_sell" | "external_sell"
) => {
  const { TransactionRecordModel } = await import("./models");

  const query: any = {
    tokenAddress,
    transactionType: transactionType || {
      $in: ["dev_sell", "wallet_sell", "external_sell"],
    },
  };

  const records = await TransactionRecordModel.find(query)
    .sort({ createdAt: -1 }) // Most recent first
    .lean();

  return records.map((record) => ({
    walletAddress: record.walletPublicKey,
    transactionType: record.transactionType,
    signature: record.signature,
    success: record.success,
    solReceived: record.amountSol || 0,
    tokensSold: record.amountTokens || "0",
    sellPercent: record.sellPercent || 0,
    sellAttempt: record.sellAttempt || 1,
    errorMessage: record.errorMessage,
    timestamp: record.createdAt,
  }));
};

export const getDetailedSellSummary = async (tokenAddress: string) => {
  const { TransactionRecordModel } = await import("./models");

  // Get all sell transactions
  const sellRecords = await TransactionRecordModel.find({
    tokenAddress,
    transactionType: { $in: ["dev_sell", "wallet_sell", "external_sell"] },
  })
    .sort({ createdAt: -1 })
    .lean();

  if (sellRecords.length === 0) {
    return {
      hasSells: false,
      totalSells: 0,
      successfulSells: 0,
      failedSells: 0,
      totalSolEarned: 0,
      totalTokensSold: "0",
      sellHistory: [],
    };
  }

  const successful = sellRecords.filter((r) => r.success);
  const failed = sellRecords.filter((r) => !r.success);

  const totalSolEarned = successful.reduce((sum, record) => {
    return sum + (record.amountSol || 0);
  }, 0);

  const totalTokensSold = successful.reduce((sum, record) => {
    return sum + BigInt(record.amountTokens || "0");
  }, BigInt(0));

  // Group sells by attempt/batch
  const sellBatches = sellRecords.reduce((batches: any[], record) => {
    const batchKey = `${record.transactionType}-${record.sellAttempt}-${record.createdAt?.toISOString().split("T")[0]}`;
    const existingBatch = batches.find((b) => b.batchKey === batchKey);

    if (existingBatch) {
      existingBatch.transactions.push(record);
      existingBatch.totalSol += record.amountSol || 0;
      existingBatch.totalTokens =
        existingBatch.totalTokens + BigInt(record.amountTokens || "0");
      if (record.success) existingBatch.successCount++;
      else existingBatch.failCount++;
    } else {
      batches.push({
        batchKey,
        type: record.transactionType,
        sellAttempt: record.sellAttempt,
        timestamp: record.createdAt,
        transactions: [record],
        totalSol: record.amountSol || 0,
        totalTokens: BigInt(record.amountTokens || "0"),
        successCount: record.success ? 1 : 0,
        failCount: record.success ? 0 : 1,
        sellPercent: record.sellPercent || 0,
      });
    }

    return batches;
  }, []);

  return {
    hasSells: true,
    totalSells: sellRecords.length,
    successfulSells: successful.length,
    failedSells: failed.length,
    totalSolEarned: Number(totalSolEarned.toFixed(6)),
    totalTokensSold: totalTokensSold.toString(),
    sellHistory: sellBatches.map((batch) => ({
      type: batch.type,
      timestamp: batch.timestamp,
      totalWallets: batch.transactions.length,
      successfulWallets: batch.successCount,
      failedWallets: batch.failCount,
      successRate: Math.round(
        (batch.successCount / batch.transactions.length) * 100
      ),
      solReceived: Number(batch.totalSol.toFixed(6)),
      tokensSold: batch.totalTokens.toString(),
      tokensDisplayed: (Number(batch.totalTokens) / 1e6).toLocaleString(
        undefined,
        { maximumFractionDigits: 2 }
      ),
      sellPercent: batch.sellPercent,
      signatures: batch.transactions
        .filter((t: any) => t.success)
        .map((t: any) => t.signature),
    })),
  };
};

/**
 * Calculate the required number of wallets for incremental distribution system with 20 wallet maximum
 * First 15 wallets: 0.5, 0.7, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1 SOL (total 21.5 SOL)
 * Last 5 wallets (16-20): 4.0-5.0 SOL each (for larger amounts)
 * Maximum buy amount supported: 46.5 SOL with 20 wallets
 */
export const calculateRequiredWallets = (buyAmount: number): number => {
  // Enforce maximum buy amount
  const MAX_BUY_AMOUNT = calculateMaxBuyAmount();
  if (buyAmount > MAX_BUY_AMOUNT) {
    throw new Error(`Buy amount exceeds maximum of ${MAX_BUY_AMOUNT} SOL`);
  }

  // First 15 wallets sequence
  const firstFifteenSequence = [
    0.5, 0.7, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1,
  ];
  const firstFifteenTotal = firstFifteenSequence.reduce(
    (sum, amount) => sum + amount,
    0
  ); // Calculate exact total

  if (buyAmount <= firstFifteenTotal) {
    // Count how many sequence wallets are needed from first 15
    let total = 0;
    let walletsNeeded = 0;

    for (const amount of firstFifteenSequence) {
      if (total + amount <= buyAmount) {
        total += amount;
        walletsNeeded++;
      } else {
        // Need one more wallet for remaining amount
        if (total < buyAmount) {
          walletsNeeded++;
        }
        break;
      }
    }

    // CRITICAL FIX: Ensure we use at least 2 wallets for amounts > 0.5 SOL
    // This ensures proper distribution and privacy
    if (buyAmount > 0.5 && walletsNeeded < 2) {
      walletsNeeded = 2;
    }

    return Math.max(1, walletsNeeded); // At least 1 wallet
  } else {
    // Need all 15 sequence wallets + additional wallets from last 5 (4-5 SOL each)
    const remainingAmount = buyAmount - firstFifteenTotal;
    const additionalWallets = Math.min(5, Math.ceil(remainingAmount / 4.0)); // Max 5 additional wallets, min 4 SOL each
    return Math.min(20, 15 + additionalWallets); // Cap at 20 wallets total
  }
};

/**
 * Calculate the maximum buy amount supported by the 20 wallet system
 * First 15 wallets total: 21.5 SOL
 * Last 5 wallets at 5.0 SOL each: 25.0 SOL
 * Maximum total: 46.5 SOL
 */
export const calculateMaxBuyAmount = (): number => {
  const firstFifteenSequence = [
    0.5, 0.7, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1,
  ];
  const firstFifteenTotal = firstFifteenSequence.reduce(
    (sum, amount) => sum + amount,
    0
  );
  const lastFiveTotal = 5 * 5.0; // 5 wallets × 5.0 SOL each
  return firstFifteenTotal + lastFiveTotal; // 21.5 + 25.0 = 46.5 SOL
};

/**
 * Calculate the maximum buy amount supported by a specific number of wallets
 * @param walletCount - Number of wallets available
 * @returns Maximum buy amount in SOL
 */
export const calculateMaxBuyAmountWithWallets = (
  walletCount: number
): number => {
  if (walletCount <= 0) return 0;

  const firstFifteenSequence = [
    0.5, 0.7, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1,
  ];
  const firstFifteenTotal = firstFifteenSequence.reduce(
    (sum, amount) => sum + amount,
    0
  );

  if (walletCount <= 15) {
    // Use only the first N wallets from the sequence
    let total = 0;
    for (
      let i = 0;
      i < Math.min(walletCount, firstFifteenSequence.length);
      i++
    ) {
      total += firstFifteenSequence[i];
    }
    return total;
  } else {
    // Use all 15 sequence wallets + additional wallets from last 5 (4-5 SOL each)
    const additionalWallets = Math.min(walletCount - 15, 5);
    const additionalTotal = additionalWallets * 5.0; // 5.0 SOL per additional wallet
    return firstFifteenTotal + additionalTotal;
  }
};

/**
 * Generate buy distribution for sequential wallet buying with new 20 wallet system
 * First 15 wallets: incremental amounts 0.5-2.1 SOL
 * Last 5 wallets: 4.0-5.0 SOL each for larger purchases
 */
export const generateBuyDistribution = (
  buyAmount: number,
  availableWallets: number
): number[] => {
  const maxWallets = Math.min(availableWallets, 20);
  const firstFifteenSequence = [
    0.5, 0.7, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1,
  ];
  const firstFifteenTotal = firstFifteenSequence.reduce(
    (sum, amount) => sum + amount,
    0
  ); // Calculate exact total

  if (buyAmount <= firstFifteenTotal) {
    // Use only the first sequence wallets needed
    const distribution: number[] = [];
    let remaining = buyAmount;

    for (
      let i = 0;
      i < Math.min(maxWallets, firstFifteenSequence.length);
      i++
    ) {
      if (remaining <= 0) break;

      if (remaining >= firstFifteenSequence[i]) {
        distribution.push(firstFifteenSequence[i]);
        remaining -= firstFifteenSequence[i];
      } else {
        // Last wallet gets remaining amount
        distribution.push(remaining);
        remaining = 0;
      }
    }

    // CRITICAL FIX: Ensure proper distribution for amounts that need 2+ wallets
    // For 0.9 SOL, we want [0.5, 0.4] instead of [0.9]
    if (distribution.length === 1 && buyAmount > 0.5 && maxWallets >= 2) {
      const firstAmount = Math.min(0.5, buyAmount * 0.6); // Use 60% for first wallet, max 0.5
      const secondAmount = buyAmount - firstAmount;
      return [firstAmount, secondAmount];
    }

    return distribution;
  } else {
    // Use all 15 sequence wallets + distribute remaining across last 5 wallets (4-5 SOL each)
    const distribution = [...firstFifteenSequence];
    let remaining = buyAmount - firstFifteenTotal;

    // Calculate how many additional wallets we need (max 5)
    const additionalWalletsNeeded = Math.min(
      5,
      Math.min(maxWallets - 15, Math.ceil(remaining / 4.0))
    );

    if (additionalWalletsNeeded > 0) {
      // Distribute remaining amount across additional wallets (4-5 SOL each)
      for (let i = 0; i < additionalWalletsNeeded; i++) {
        if (remaining <= 0) break;

        if (i === additionalWalletsNeeded - 1) {
          // Last additional wallet gets all remaining
          distribution.push(remaining);
        } else {
          // Other additional wallets get 4-5 SOL, prefer closer to 4.5 SOL
          const walletAmount = Math.min(
            5.0,
            Math.max(4.0, remaining / (additionalWalletsNeeded - i))
          );
          distribution.push(walletAmount);
          remaining -= walletAmount;
        }
      }
    }

    return distribution;
  }
};

// ========== WALLET POOL FUNCTIONS ==========

export const initializeWalletPool = async (count: number = 2000) => {
  const { WalletPoolModel } = await import("./models");
  const { encryptPrivateKey } = await import("./utils");
  const { Keypair } = await import("@solana/web3.js");
  const bs58 = await import("bs58");

  console.log(`🔄 Initializing wallet pool with ${count} wallets...`);

  // Check if pool already exists
  const existingCount = await WalletPoolModel.countDocuments();
  if (existingCount >= count) {
    console.log(
      `✅ Wallet pool already initialized with ${existingCount} wallets`
    );
    return;
  }

  const walletsToGenerate = count - existingCount;
  console.log(`📝 Generating ${walletsToGenerate} new wallets...`);

  const batchSize = 100;
  const batches = Math.ceil(walletsToGenerate / batchSize);

  for (let i = 0; i < batches; i++) {
    const currentBatchSize = Math.min(
      batchSize,
      walletsToGenerate - i * batchSize
    );

    const walletDocs = [];
    for (let j = 0; j < currentBatchSize; j++) {
      const keypair = Keypair.generate();
      walletDocs.push({
        publicKey: keypair.publicKey.toBase58(),
        privateKey: encryptPrivateKey(bs58.default.encode(keypair.secretKey)),
        isAllocated: false,
        allocatedTo: null,
        allocatedAt: null,
      });
    }

    await WalletPoolModel.insertMany(walletDocs);
    console.log(
      `📝 Generated batch ${i + 1}/${batches} (${currentBatchSize} wallets)`
    );
  }

  console.log(`✅ Wallet pool initialized with ${count} wallets`);
};

export const allocateWalletsFromPool = async (
  userId: string,
  count: number
) => {
  const { WalletPoolModel, WalletModel } = await import("./models");
  const { decryptPrivateKey } = await import("./utils");

  console.log(`🔄 Allocating ${count} wallets from pool to user ${userId}...`);

  // Find available wallets in pool
  const availableWallets = await WalletPoolModel.find({
    isAllocated: false,
  }).limit(count);

  if (availableWallets.length < count) {
    throw new Error(
      `Insufficient wallets in pool. Need ${count}, available ${availableWallets.length}`
    );
  }

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      // Mark wallets as allocated in pool
      const walletIds = availableWallets.map((w) => w._id);
      await WalletPoolModel.updateMany(
        { _id: { $in: walletIds } },
        {
          $set: {
            isAllocated: true,
            allocatedTo: userId,
            allocatedAt: new Date(),
          },
        },
        { session }
      );

      // Create buyer wallet records for user
      const buyerWalletDocs = availableWallets.map((poolWallet) => ({
        user: userId,
        publicKey: poolWallet.publicKey,
        privateKey: poolWallet.privateKey, // Already encrypted
        isDev: false,
        isBuyer: true,
        isFunding: false,
      }));

      await WalletModel.insertMany(buyerWalletDocs, { session });
    });

    console.log(`✅ Successfully allocated ${count} wallets to user ${userId}`);

    // Return the allocated wallets
    return availableWallets.map((w) => ({
      id: w._id.toString(),
      publicKey: w.publicKey,
      privateKey: decryptPrivateKey(w.privateKey),
    }));
  } catch (error: any) {
    console.error(`❌ Failed to allocate wallets: ${error.message}`);
    throw error;
  } finally {
    await session.endSession();
  }
};

export const getWalletPoolStats = async () => {
  const { WalletPoolModel } = await import("./models");

  const stats = await WalletPoolModel.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        allocated: { $sum: { $cond: ["$isAllocated", 1, 0] } },
        available: { $sum: { $cond: ["$isAllocated", 0, 1] } },
      },
    },
  ]);

  return stats.length > 0 ? stats[0] : { total: 0, allocated: 0, available: 0 };
};

export const ensureWalletPoolHealth = async () => {
  const stats = await getWalletPoolStats();
  const minThreshold = 500; // Minimum available wallets

  if (stats.available < minThreshold) {
    console.log(
      `⚠️ Wallet pool low: ${stats.available} available, ${minThreshold} minimum required`
    );
    const walletsToAdd = 2000 - stats.total;
    if (walletsToAdd > 0) {
      await initializeWalletPool(stats.total + walletsToAdd);
    }
  }

  return stats;
};

// ====== AFFILIATE SYSTEM FUNCTIONS ======

/**
 * Generate a unique random affiliate code
 */
const generateAffiliateCode = (length: number = 8): string => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

/**
 * Get or create affiliate code for a user
 */
export const getOrCreateAffiliateCode = async (
  userId: string
): Promise<string> => {
  try {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Return existing code if available
    if (user.affiliateCode) {
      return user.affiliateCode;
    }

    // Generate new unique code
    let affiliateCode: string;
    let attempts = 0;
    const maxAttempts = 10;

    do {
      affiliateCode = generateAffiliateCode();
      attempts++;

      if (attempts >= maxAttempts) {
        throw new Error("Failed to generate unique affiliate code");
      }

      // Check if code already exists
      const existingUser = await UserModel.findOne({ affiliateCode });
      if (!existingUser) {
        break;
      }
    } while (true);

    // Save the new code
    await UserModel.findByIdAndUpdate(userId, { affiliateCode });

    return affiliateCode;
  } catch (error) {
    logger.error("Error generating affiliate code:", error);
    throw error;
  }
};

/**
 * Get user's referral statistics
 */
export const getUserReferralStats = async (userId: string) => {
  try {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    return {
      affiliateCode: user.affiliateCode,
      referralCount: user.referralCount || 0,
      referredBy: user.referredBy,
    };
  } catch (error) {
    logger.error("Error getting referral stats:", error);
    throw error;
  }
};

/**
 * Process referral when a new user signs up
 */
export const processReferral = async (
  newUserId: string,
  referralCode: string
): Promise<boolean> => {
  try {
    // Find the referring user by affiliate code
    const referringUser = await UserModel.findOne({
      affiliateCode: referralCode,
    });
    if (!referringUser) {
      logger.warn(`Invalid referral code used: ${referralCode}`);
      return false;
    }

    // Prevent self-referral
    if (referringUser._id.toString() === newUserId) {
      logger.warn(`Self-referral attempt detected for user: ${newUserId}`);
      return false;
    }

    // Update the new user with referral info
    await UserModel.findByIdAndUpdate(newUserId, {
      referredBy: referringUser._id,
    });

    // Increment the referring user's referral count
    await UserModel.findByIdAndUpdate(referringUser._id, {
      $inc: { referralCount: 1 },
    });

    logger.info(
      `Referral processed: User ${newUserId} referred by ${referringUser._id} (code: ${referralCode})`
    );
    return true;
  } catch (error) {
    logger.error("Error processing referral:", error);
    return false;
  }
};

/**
 * Generate referral link for a user
 */
export const generateReferralLink = async (
  userId: string,
  botUsername: string
): Promise<string> => {
  try {
    const affiliateCode = await getOrCreateAffiliateCode(userId);
    return `https://t.me/${botUsername}?start=REF_${affiliateCode}`;
  } catch (error) {
    logger.error("Error generating referral link:", error);
    throw error;
  }
};

/**
 * Update createUser function to handle referral codes
 */
export const createUserWithReferral = async (
  firstName: string | undefined,
  lastName: string | undefined,
  userName: string,
  telegramId: string,
  referralCode?: string
): Promise<any> => {
  try {
    // Create the user first
    const newUser = await UserModel.create({
      firstName,
      lastName,
      userName,
      telegramId,
    });

    // Process referral if code provided
    if (referralCode) {
      await processReferral(newUser._id.toString(), referralCode);
    }

    return newUser;
  } catch (error) {
    logger.error("Error creating user with referral:", error);
    throw error;
  }
};

interface WalletBalance {
  pubkey: string;
  balance: number;
  tokenPrice: number;
}

export async function getNonEmptyBalances(
  userId: string,
  tokenAddress: string
): Promise<WalletBalance[]> {
  const tokenInfo = await getTokenInfo(tokenAddress);
  const price = tokenInfo?.priceUsd ?? 0;
  console.log(tokenInfo);
  const buyerWallets = await getAllBuyerWallets(userId);
  const balances = await Promise.all(
    buyerWallets.map(async ({ publicKey }) => {
      const tokenBal = await getTokenBalance(tokenAddress, publicKey);
      return {
        pubkey: publicKey,
        balance: tokenBal,
        tokenPrice: tokenBal * price,
      };
    })
  );
  return balances.filter(({ balance }) => balance > 0);
}

export function abbreviateNumber(num: number): string {
  const abs = Math.abs(num);
  const sign = num < 0 ? "-" : "";
  let value: number;
  let suffix = "";

  if (abs >= 1e9) {
    value = abs / 1e9;
    suffix = "b";
  } else if (abs >= 1e6) {
    value = abs / 1e6;
    suffix = "m";
  } else if (abs >= 1e3) {
    value = abs / 1e3;
    suffix = "k";
  } else {
    return `${sign}${abs}`;
  }

  const str = value.toFixed(2).replace(/\.?0+$/, "");
  return `${sign}${str}${suffix}`;
}

// ========== TRADING WALLET FUNCTIONS ==========

/**
 * Get the best trading wallet for a user
 * For selling: Returns the buyer wallet with the highest token balance for the given token
 * For general trading: Returns the first buyer wallet with the highest SOL balance
 * Falls back to first buyer wallet if none found
 */
export const getWalletForTrading = async (
  userId: string,
  tokenAddress?: string
) => {
  const buyerWallets = await WalletModel.find({
    user: userId,
    isBuyer: true,
  })
    .sort({ createdAt: 1 })
    .lean();

  if (buyerWallets.length === 0) {
    throw new Error(
      "No buyer wallets found. Please create a buyer wallet first."
    );
  }

  // If tokenAddress provided, find wallet with highest token balance
  if (tokenAddress) {
    let bestWallet = buyerWallets[0];
    let highestBalance = 0;

    try {
      const { getTokenBalance } = await import("./utils");

      for (const wallet of buyerWallets) {
        try {
          const balance = await getTokenBalance(tokenAddress, wallet.publicKey);
          if (balance > highestBalance) {
            highestBalance = balance;
            bestWallet = wallet;
          }
        } catch (error) {
          // Continue to next wallet if balance check fails
          continue;
        }
      }
    } catch (error) {
      // If token balance checking fails, fall back to first wallet
      console.warn(
        `Error checking token balances for trading wallet selection:`,
        error
      );
    }

    return {
      id: String(bestWallet._id),
      walletId: String(bestWallet._id),
      publicKey: bestWallet.publicKey,
      privateKey: decryptPrivateKey(bestWallet.privateKey),
    };
  }

  // For general trading, return first buyer wallet (could be enhanced to check SOL balance)
  const firstWallet = buyerWallets[0];
  return {
    id: String(firstWallet._id),
    walletId: String(firstWallet._id),
    publicKey: firstWallet.publicKey,
    privateKey: decryptPrivateKey(firstWallet.privateKey),
  };
};

/**
 * Get all buyer wallets with their private keys for trading operations
 */
export const getAllTradingWallets = async (userId: string) => {
  const buyerWallets = await WalletModel.find({
    user: userId,
    isBuyer: true,
  })
    .sort({ createdAt: 1 })
    .lean();

  return buyerWallets.map((wallet) => ({
    id: String(wallet._id),
    publicKey: wallet.publicKey,
    privateKey: decryptPrivateKey(wallet.privateKey),
    createdAt: wallet.createdAt,
  }));
};

// ========== ACCURATE SPENDING CALCULATION FUNCTIONS ==========

/**
 * Calculate accurate spending amounts by grouping transactions by wallet
 * This prevents double-counting when wallets make multiple transactions
 */
export const getAccurateSpendingStats = async (
  tokenAddress: string,
  launchAttempt?: number
) => {
  const { TransactionRecordModel } = await import("./models");

  const query: any = {
    tokenAddress,
    success: true, // Only count successful transactions
  };
  if (launchAttempt !== undefined) {
    query.launchAttempt = launchAttempt;
  }

  const records = await TransactionRecordModel.find(query).lean();

  // Group buy transactions by wallet to avoid double-counting
  const walletBuyGroups = new Map<string, any[]>();
  const walletSellGroups = new Map<string, any[]>();

  // Group transactions by wallet
  records.forEach((record) => {
    if (
      record.transactionType === "dev_buy" ||
      record.transactionType === "snipe_buy" ||
      record.transactionType === "external_buy"
    ) {
      const walletKey = record.walletPublicKey;
      if (!walletBuyGroups.has(walletKey)) {
        walletBuyGroups.set(walletKey, []);
      }
      walletBuyGroups.get(walletKey)!.push(record);
    } else if (
      record.transactionType === "dev_sell" ||
      record.transactionType === "wallet_sell" ||
      record.transactionType === "external_sell"
    ) {
      const walletKey = record.walletPublicKey;
      if (!walletSellGroups.has(walletKey)) {
        walletSellGroups.set(walletKey, []);
      }
      walletSellGroups.get(walletKey)!.push(record);
    }
  });

  // Calculate accurate spending per wallet (use the highest amount or sum if multiple transactions)
  let totalDevSpent = 0;
  let totalSnipeSpent = 0;
  let totalDevTokens = BigInt(0);
  let totalSnipeTokens = BigInt(0);
  let successfulBuyWallets = 0;

  for (const [walletKey, transactions] of walletBuyGroups) {
    const devBuys = transactions.filter((t) => t.transactionType === "dev_buy");
    const snipeBuys = transactions.filter(
      (t) => t.transactionType === "snipe_buy"
    );
    const externalBuys = transactions.filter(
      (t) => t.transactionType === "external_buy"
    );

    // For dev buys, sum all transactions (usually only one)
    const walletDevSpent = devBuys.reduce(
      (sum, t) => sum + (t.amountSol || 0),
      0
    );
    const walletDevTokens = devBuys.reduce(
      (sum, t) => sum + BigInt(t.amountTokens || "0"),
      BigInt(0)
    );

    // For snipe buys, use the highest amount (most accurate) or sum if multiple transactions
    let walletSnipeSpent = 0;
    let walletSnipeTokens = BigInt(0);

    if (snipeBuys.length === 1) {
      // Single transaction - use the recorded amount
      walletSnipeSpent = snipeBuys[0].amountSol || 0;
      walletSnipeTokens = BigInt(snipeBuys[0].amountTokens || "0");
    } else if (snipeBuys.length > 1) {
      // Multiple transactions - sum them up (continuous buying loop)
      walletSnipeSpent = snipeBuys.reduce(
        (sum, t) => sum + (t.amountSol || 0),
        0
      );
      walletSnipeTokens = snipeBuys.reduce(
        (sum, t) => sum + BigInt(t.amountTokens || "0"),
        BigInt(0)
      );
    }

    // For external buys (CTO), sum all transactions
    let walletExternalSpent = 0;
    let walletExternalTokens = BigInt(0);

    if (externalBuys.length > 0) {
      walletExternalSpent = externalBuys.reduce(
        (sum, t) => sum + (t.amountSol || 0),
        0
      );
      walletExternalTokens = externalBuys.reduce(
        (sum, t) => sum + BigInt(t.amountTokens || "0"),
        BigInt(0)
      );
    }

    totalDevSpent += walletDevSpent;
    totalSnipeSpent += walletSnipeSpent;
    totalDevTokens += walletDevTokens;
    totalSnipeTokens += walletSnipeTokens;

    // Add external buy totals
    const totalExternalSpent = externalBuys.reduce(
      (sum, t) => sum + (t.amountSol || 0),
      0
    );
    const totalExternalTokens = externalBuys.reduce(
      (sum, t) => sum + BigInt(t.amountTokens || "0"),
      BigInt(0)
    );

    if (snipeBuys.length > 0 || externalBuys.length > 0) {
      successfulBuyWallets++;
    }
  }

  const totalSpent = totalDevSpent + totalSnipeSpent;
  const totalTokens = totalDevTokens + totalSnipeTokens;

  // Calculate accurate earnings (sum all sell transactions)
  let totalDevEarned = 0;
  let totalWalletEarned = 0;
  let totalExternalEarned = 0;
  let totalDevTokensSold = BigInt(0);
  let totalWalletTokensSold = BigInt(0);
  let totalExternalTokensSold = BigInt(0);

  for (const [walletKey, transactions] of walletSellGroups) {
    const devSells = transactions.filter(
      (t) => t.transactionType === "dev_sell"
    );
    const walletSells = transactions.filter(
      (t) => t.transactionType === "wallet_sell"
    );
    const externalSells = transactions.filter(
      (t) => t.transactionType === "external_sell"
    );

    totalDevEarned += devSells.reduce((sum, t) => sum + (t.amountSol || 0), 0);
    totalWalletEarned += walletSells.reduce(
      (sum, t) => sum + (t.amountSol || 0),
      0
    );
    totalExternalEarned += externalSells.reduce(
      (sum, t) => sum + (t.amountSol || 0),
      0
    );

    totalDevTokensSold += devSells.reduce(
      (sum, t) => sum + BigInt(t.amountTokens || "0"),
      BigInt(0)
    );
    totalWalletTokensSold += walletSells.reduce(
      (sum, t) => sum + BigInt(t.amountTokens || "0"),
      BigInt(0)
    );
    totalExternalTokensSold += externalSells.reduce(
      (sum, t) => sum + BigInt(t.amountTokens || "0"),
      BigInt(0)
    );
  }

  const totalEarned = totalDevEarned + totalWalletEarned + totalExternalEarned;
  const totalTokensSold =
    totalDevTokensSold + totalWalletTokensSold + totalExternalTokensSold;
  const remainingTokens = totalTokens - totalTokensSold;

  // Calculate P&L
  const netProfitLoss = totalEarned - totalSpent;
  const profitLossPercentage =
    totalSpent > 0 ? (netProfitLoss / totalSpent) * 100 : 0;

  return {
    // Buy data (accurate)
    totalSpent: Number(totalSpent.toFixed(6)),
    totalDevSpent: Number(totalDevSpent.toFixed(6)),
    totalSnipeSpent: Number(totalSnipeSpent.toFixed(6)),
    totalTokens: totalTokens.toString(),
    totalDevTokens: totalDevTokens.toString(),
    totalSnipeTokens: totalSnipeTokens.toString(),
    successfulBuyWallets, // Number of unique wallets that made successful buys
    averageSpentPerWallet:
      successfulBuyWallets > 0
        ? Number((totalSnipeSpent / successfulBuyWallets).toFixed(6))
        : 0,

    // Sell data
    totalEarned: Number(totalEarned.toFixed(6)),
    totalDevEarned: Number(totalDevEarned.toFixed(6)),
    totalWalletEarned: Number(totalWalletEarned.toFixed(6)),
    totalExternalEarned: Number(totalExternalEarned.toFixed(6)),
    totalTokensSold: totalTokensSold.toString(),
    totalDevTokensSold: totalDevTokensSold.toString(),
    totalWalletTokensSold: totalWalletTokensSold.toString(),
    totalExternalTokensSold: totalExternalTokensSold.toString(),
    remainingTokens: remainingTokens.toString(),
    successfulSells: walletSellGroups.size, // Number of unique wallets that sold

    // P&L data
    netProfitLoss: Number(netProfitLoss.toFixed(6)),
    profitLossPercentage: Number(profitLossPercentage.toFixed(2)),
    isProfit: netProfitLoss > 0,

    // Additional metadata
    totalBuyTransactions: records.filter(
      (r) =>
        r.transactionType === "dev_buy" || r.transactionType === "snipe_buy"
    ).length,
    totalSellTransactions: records.filter(
      (r) =>
        r.transactionType === "dev_sell" ||
        r.transactionType === "wallet_sell" ||
        r.transactionType === "external_sell"
    ).length,
    uniqueBuyWallets: walletBuyGroups.size,
    uniqueSellWallets: walletSellGroups.size,
  };
};

/**
 * Get detailed spending breakdown by wallet for debugging
 */
export const getDetailedSpendingBreakdown = async (
  tokenAddress: string,
  launchAttempt?: number
) => {
  const { TransactionRecordModel } = await import("./models");

  const query: any = {
    tokenAddress,
    success: true,
  };
  if (launchAttempt !== undefined) {
    query.launchAttempt = launchAttempt;
  }

  const records = await TransactionRecordModel.find(query).lean();

  // Group by wallet
  const walletBreakdown = new Map<
    string,
    {
      walletAddress: string;
      devBuys: any[];
      snipeBuys: any[];
      externalBuys: any[];
      devSells: any[];
      walletSells: any[];
      externalSells: any[];
      totalDevSpent: number;
      totalSnipeSpent: number;
      totalExternalSpent: number;
      totalDevTokens: bigint;
      totalSnipeTokens: bigint;
      totalExternalTokens: bigint;
      totalDevEarned: number;
      totalWalletEarned: number;
      totalExternalEarned: number;
      totalDevTokensSold: bigint;
      totalWalletTokensSold: bigint;
      totalExternalTokensSold: bigint;
    }
  >();

  // Group transactions by wallet
  records.forEach((record) => {
    const walletKey = record.walletPublicKey;

    if (!walletBreakdown.has(walletKey)) {
      walletBreakdown.set(walletKey, {
        walletAddress: walletKey,
        devBuys: [],
        snipeBuys: [],
        externalBuys: [],
        devSells: [],
        walletSells: [],
        externalSells: [],
        totalDevSpent: 0,
        totalSnipeSpent: 0,
        totalExternalSpent: 0,
        totalDevTokens: BigInt(0),
        totalSnipeTokens: BigInt(0),
        totalExternalTokens: BigInt(0),
        totalDevEarned: 0,
        totalWalletEarned: 0,
        totalExternalEarned: 0,
        totalDevTokensSold: BigInt(0),
        totalWalletTokensSold: BigInt(0),
        totalExternalTokensSold: BigInt(0),
      });
    }

    const wallet = walletBreakdown.get(walletKey)!;

    switch (record.transactionType) {
      case "dev_buy":
        wallet.devBuys.push(record);
        wallet.totalDevSpent += record.amountSol || 0;
        wallet.totalDevTokens += BigInt(record.amountTokens || "0");
        break;
      case "snipe_buy":
        wallet.snipeBuys.push(record);
        wallet.totalSnipeSpent += record.amountSol || 0;
        wallet.totalSnipeTokens += BigInt(record.amountTokens || "0");
        break;
      case "external_buy":
        wallet.externalBuys.push(record);
        wallet.totalExternalSpent += record.amountSol || 0;
        wallet.totalExternalTokens += BigInt(record.amountTokens || "0");
        break;
      case "dev_sell":
        wallet.devSells.push(record);
        wallet.totalDevEarned += record.amountSol || 0;
        wallet.totalDevTokensSold += BigInt(record.amountTokens || "0");
        break;
      case "wallet_sell":
        wallet.walletSells.push(record);
        wallet.totalWalletEarned += record.amountSol || 0;
        wallet.totalWalletTokensSold += BigInt(record.amountTokens || "0");
        break;
      case "external_sell":
        wallet.externalSells.push(record);
        wallet.totalExternalEarned += record.amountSol || 0;
        wallet.totalExternalTokensSold += BigInt(record.amountTokens || "0");
        break;
    }
  });

  // Convert to array and add summary stats
  const breakdown = Array.from(walletBreakdown.values()).map((wallet) => ({
    ...wallet,
    totalSpent:
      wallet.totalDevSpent +
      wallet.totalSnipeSpent +
      (wallet.totalExternalSpent || 0),
    totalEarned:
      wallet.totalDevEarned +
      wallet.totalWalletEarned +
      wallet.totalExternalEarned,
    netProfitLoss:
      wallet.totalDevEarned +
      wallet.totalWalletEarned +
      wallet.totalExternalEarned -
      (wallet.totalDevSpent +
        wallet.totalSnipeSpent +
        (wallet.totalExternalSpent || 0)),
    totalTokens:
      wallet.totalDevTokens +
      wallet.totalSnipeTokens +
      (wallet.totalExternalTokens || BigInt(0)),
    totalTokensSold:
      wallet.totalDevTokensSold +
      wallet.totalWalletTokensSold +
      wallet.totalExternalTokensSold,
    remainingTokens:
      wallet.totalDevTokens +
      wallet.totalSnipeTokens +
      (wallet.totalExternalTokens || BigInt(0)) -
      (wallet.totalDevTokensSold +
        wallet.totalWalletTokensSold +
        wallet.totalExternalTokensSold),
    buyTransactionCount:
      wallet.devBuys.length +
      wallet.snipeBuys.length +
      (wallet.externalBuys?.length || 0),
    sellTransactionCount:
      wallet.devSells.length +
      wallet.walletSells.length +
      wallet.externalSells.length,
  }));

  // Sort by total spent (highest first)
  breakdown.sort((a, b) => b.totalSpent - a.totalSpent);

  return {
    walletBreakdown: breakdown,
    summary: {
      totalWallets: breakdown.length,
      walletsWithBuys: breakdown.filter((w) => w.totalSpent > 0).length,
      walletsWithSells: breakdown.filter((w) => w.totalEarned > 0).length,
      totalSpent: breakdown.reduce((sum, w) => sum + w.totalSpent, 0),
      totalEarned: breakdown.reduce((sum, w) => sum + w.totalEarned, 0),
      totalNetProfitLoss: breakdown.reduce(
        (sum, w) => sum + w.netProfitLoss,
        0
      ),
      totalBuyTransactions: breakdown.reduce(
        (sum, w) => sum + w.buyTransactionCount,
        0
      ),
      totalSellTransactions: breakdown.reduce(
        (sum, w) => sum + w.sellTransactionCount,
        0
      ),
    },
  };
};

/**
 * Compare old vs new spending calculation methods
 */
export const compareSpendingCalculations = async (
  tokenAddress: string,
  launchAttempt?: number
) => {
  // Get both calculation methods
  const oldStats = await getTransactionFinancialStats(
    tokenAddress,
    launchAttempt
  );
  const newStats = await getAccurateSpendingStats(tokenAddress, launchAttempt);
  const detailedBreakdown = await getDetailedSpendingBreakdown(
    tokenAddress,
    launchAttempt
  );

  return {
    comparison: {
      oldMethod: {
        totalSpent: oldStats.totalSpent,
        totalDevSpent: oldStats.totalDevSpent,
        totalSnipeSpent: oldStats.totalSnipeSpent,
        successfulBuys: oldStats.successfulBuys,
        averageSpentPerWallet: oldStats.averageSpentPerWallet,
      },
      newMethod: {
        totalSpent: newStats.totalSpent,
        totalDevSpent: newStats.totalDevSpent,
        totalSnipeSpent: newStats.totalSnipeSpent,
        successfulBuyWallets: newStats.successfulBuyWallets,
        averageSpentPerWallet: newStats.averageSpentPerWallet,
      },
      differences: {
        totalSpentDifference: oldStats.totalSpent - newStats.totalSpent,
        totalSpentDifferencePercentage:
          oldStats.totalSpent > 0
            ? ((oldStats.totalSpent - newStats.totalSpent) /
                oldStats.totalSpent) *
              100
            : 0,
        transactionCountDifference:
          oldStats.successfulBuys - newStats.totalBuyTransactions,
        walletCountDifference:
          oldStats.successfulBuys - newStats.uniqueBuyWallets,
      },
    },
    detailedBreakdown: detailedBreakdown.summary,
    explanation: {
      oldMethodIssues: [
        "Counts each transaction separately, leading to inflated totals when wallets make multiple buys",
        "Doesn't account for continuous buying loops where wallets make multiple transactions",
        "May include failed transaction amounts or estimates",
        "Simple sum of all amountSol values in database",
      ],
      newMethodImprovements: [
        "Groups transactions by wallet to avoid double-counting",
        "Handles multiple transactions per wallet correctly",
        "Provides both transaction count and unique wallet count",
        "More accurate for continuous buying scenarios",
      ],
    },
  };
};

/**
 * Check if a token contract address has already been used
 * @param tokenAddress - The token contract address to check
 * @returns Object with isUsed boolean and details if used
 */
export const checkTokenAddressUsage = async (
  tokenAddress: string
): Promise<{
  isUsed: boolean;
  usedBy?: string;
  tokenName?: string;
  createdAt?: Date;
  state?: string;
}> => {
  try {
    // Check if token exists in our database
    const existingToken = await TokenModel.findOne({ tokenAddress }).lean();

    if (existingToken) {
      return {
        isUsed: true,
        usedBy: existingToken.user.toString(),
        tokenName: existingToken.name,
        createdAt: existingToken.createdAt,
        state: existingToken.state,
      };
    }

    // Check external pump address database first
    const externalService = getExternalPumpAddressService();
    try {
      const externalValidation =
        await externalService.validatePumpAddress(tokenAddress);

      if (externalValidation.exists && externalValidation.isUsed) {
        return {
          isUsed: true,
          usedBy: externalValidation.usedBy,
          createdAt: externalValidation.usedAt,
        };
      }
    } catch (error: any) {
      logger.warn(
        `[checkTokenAddressUsage] Error checking external database: ${error.message}`
      );
    }

    // Check if this is a pump address that's already been used in local database
    const pumpAddress = await PumpAddressModel.findOne({
      publicKey: tokenAddress,
    }).lean();

    if (pumpAddress && pumpAddress.isUsed) {
      return {
        isUsed: true,
        usedBy: pumpAddress.usedBy?.toString(),
        createdAt: pumpAddress.usedAt || undefined,
      };
    }

    return { isUsed: false };
  } catch (error) {
    logger.error(
      `Error checking token address usage for ${tokenAddress}:`,
      error
    );
    throw error;
  }
};

/**
 * Enhanced validation that checks if a token address is available for use
 * @param tokenAddress - The token address to validate
 * @param userId - The user ID requesting the address
 * @returns Object with availability status and message
 */
export const validateTokenAddressAvailability = async (
  tokenAddress: string,
  userId: string
): Promise<{
  isAvailable: boolean;
  message: string;
}> => {
  try {
    // First check if it's a valid Solana address
    try {
      new PublicKey(tokenAddress);
    } catch (error) {
      return {
        isAvailable: false,
        message: "Invalid Solana address format",
      };
    }

    const usage = await checkTokenAddressUsage(tokenAddress);

    if (!usage.isUsed) {
      // Check if token is already launched/listed on any platform
      const { isTokenAlreadyLaunched, isTokenAlreadyListed } = await import(
        "../service/token-detection-service"
      );

      const isLaunched = await isTokenAlreadyLaunched(tokenAddress);
      const isListed = await isTokenAlreadyListed(tokenAddress);

      if (isLaunched || isListed) {
        return {
          isAvailable: false,
          message: `Token is already ${isListed ? "listed" : "launched"} on a trading platform and cannot be used for new launches`,
        };
      }

      return {
        isAvailable: true,
        message: "Address is available for use",
      };
    }

    // Check if the user is trying to use their own token address
    if (usage.usedBy === userId) {
      // If there's already a token created with this address, it's not available
      if (usage.tokenName) {
        return {
          isAvailable: false,
          message: `You already have a token with this address: ${usage.tokenName}`,
        };
      }

      // REMOVED VALIDATION - Allow addresses allocated to current user
      // This bypasses the problematic validation that was causing false positives
      return {
        isAvailable: true,
        message: "Address is allocated to you and ready for token creation",
      };
    }

    // Address is used by someone else
    return {
      isAvailable: false,
      message: usage.tokenName
        ? `Address already in use for token: ${usage.tokenName}`
        : "Address is already in use by another user",
    };
  } catch (error: any) {
    logger.error(
      `Error validating token address availability for ${tokenAddress}:`,
      error
    );
    return {
      isAvailable: false,
      message: `Validation error: ${error.message}`,
    };
  }
};

/**
 * Get comprehensive pump address usage statistics
 * @returns Statistics from both external and local databases
 */
export const getPumpAddressUsageStatistics = async (): Promise<{
  external: {
    total: number;
    used: number;
    available: number;
    usagePercentage: number;
  };
  local: {
    total: number;
    used: number;
    available: number;
    usagePercentage: number;
  };
  combined: {
    total: number;
    used: number;
    available: number;
    usagePercentage: number;
  };
}> => {
  const externalService = getExternalPumpAddressService();

  // Get external database statistics
  let externalStats = {
    total: 0,
    used: 0,
    available: 0,
    usagePercentage: 0,
  };

  try {
    externalStats = await externalService.getUsageStats();
  } catch (error: any) {
    logger.error(
      "[getPumpAddressUsageStatistics] Error getting external stats:",
      error
    );
  }

  // Get local database statistics
  let localStats = {
    total: 0,
    used: 0,
    available: 0,
    usagePercentage: 0,
  };

  try {
    const localTotal = await PumpAddressModel.countDocuments({});
    const localUsed = await PumpAddressModel.countDocuments({
      $or: [{ usedBy: { $exists: true, $ne: null } }, { usedBy: { $ne: "" } }],
    });
    const localAvailable = localTotal - localUsed;

    localStats = {
      total: localTotal,
      used: localUsed,
      available: localAvailable,
      usagePercentage:
        localTotal > 0
          ? Math.round((localUsed / localTotal) * 100 * 100) / 100
          : 0,
    };
  } catch (error: any) {
    logger.error(
      "[getPumpAddressUsageStatistics] Error getting local stats:",
      error
    );
  }

  // Calculate combined statistics
  const combinedTotal = externalStats.total + localStats.total;
  const combinedUsed = externalStats.used + localStats.used;
  const combinedAvailable = combinedTotal - combinedUsed;
  const combinedUsagePercentage =
    combinedTotal > 0
      ? Math.round((combinedUsed / combinedTotal) * 100 * 100) / 100
      : 0;

  return {
    external: externalStats,
    local: localStats,
    combined: {
      total: combinedTotal,
      used: combinedUsed,
      available: combinedAvailable,
      usagePercentage: combinedUsagePercentage,
    },
  };
};

export const getCurrentDevWalletPrivateKey = async (userId: string) => {
  // TEMPORARY FIX: Force correct dev wallet for specific user
  if (userId === "6844d87bbc12916bc8cedc3a") {
    logger.info(
      `[getCurrentDevWalletPrivateKey] TEMPORARY FIX: Using hardcoded dev wallet for user ${userId}`
    );
    // Return the private key for the correct dev wallet
    const correctWallet = await WalletModel.findOne({
      publicKey: "H497XdK28Tn5gvL859qmvLtm4qU9GLtgtnzAXiypcTWF",
      user: userId,
      isDev: true,
    });
    if (correctWallet) {
      return decryptPrivateKey(correctWallet.privateKey);
    }
  }

  const wallet = await WalletModel.findOne({
    user: userId,
    isDev: true,
    isDefault: true,
  }).exec();

  if (!wallet) {
    const firstWallet = await WalletModel.findOne({
      user: userId,
      isDev: true,
    }).exec();

    if (firstWallet) {
      await WalletModel.updateOne(
        { _id: firstWallet._id },
        { isDefault: true }
      );
      return decryptPrivateKey(firstWallet.privateKey);
    }

    // Create new dev wallet if none exists
    const newWallet = await getOrCreateDevWallet(userId);
    const newWalletDoc = await WalletModel.findOne({
      publicKey: newWallet,
      user: userId,
      isDev: true,
    });
    return decryptPrivateKey(newWalletDoc!.privateKey);
  }

  return decryptPrivateKey(wallet.privateKey);
};

/**
 * Launch a Bonk token (now with proper two-phase launch like PumpFun)
 */
export const launchBonkToken = async (
  userId: string,
  tokenAddress: string,
  buyAmount: number = 0,
  devBuy: number = 0
): Promise<{
  success: boolean;
  signature?: string;
  error?: string;
  tokenName?: string;
  tokenSymbol?: string;
}> => {
  const logId = `bonk-launch-${tokenAddress.substring(0, 8)}`;
  logger.info(`[${logId}]: Starting Bonk token launch for user ${userId}`, {
    buyAmount,
    devBuy,
  });

  try {
    // Get token from database
    const token = await TokenModel.findOne({
      tokenAddress,
      user: userId,
    });

    if (!token) {
      logger.error(`[${logId}]: Token not found in database`);
      return {
        success: false,
        error: "Token not found in database",
      };
    }

    // Check if token is already launched
    if (token.state === TokenState.LAUNCHED) {
      logger.warn(`[${logId}]: Token is already launched`);
      return {
        success: false,
        error: "Token is already launched",
      };
    }

    // Get funding wallet and buyer wallets (same as PumpFun)
    const fundingWallet = await getFundingWallet(userId);
    if (!fundingWallet) {
      logger.error(`[${logId}]: No funding wallet found`);
      return {
        success: false,
        error:
          "No funding wallet found. Please configure your funding wallet first.",
      };
    }

    const buyerWallets = await getAllBuyerWallets(userId);
    if (buyerWallets.length === 0) {
      logger.error(`[${logId}]: No buyer wallets found`);
      return {
        success: false,
        error: "No buyer wallets found. Please add buyer wallets first.",
      };
    }

    // Get dev wallet
    const devWallet = await getCurrentDevWalletPrivateKey(userId);

    // Calculate required wallets and prioritize existing user wallets
    const walletCount = calculateRequiredWallets(buyAmount);
    const existingBuyerWallets = await getAllBuyerWallets(userId);
    
    let buyWallets: string[];
    let allocatedWallets: any[] = [];
    
    if (existingBuyerWallets.length >= walletCount) {
      // Use existing wallets - no need to allocate from pool
      logger.info(`[${logId}]: Using ${walletCount} existing buyer wallets (${existingBuyerWallets.length} available)`);
      
      // Get private keys for existing wallets
      const existingWalletKeys = await Promise.all(
        existingBuyerWallets.slice(0, walletCount).map(async (w) => {
          const privateKey = await getBuyerWalletPrivateKey(userId, w.id);
          return {
            id: w.id,
            publicKey: w.publicKey,
            privateKey: privateKey
          };
        })
      );
      
      buyWallets = existingWalletKeys.map(w => w.privateKey);
      allocatedWallets = existingWalletKeys;
    } else {
      // Need additional wallets from pool
      const additionalWalletsNeeded = walletCount - existingBuyerWallets.length;
      logger.info(`[${logId}]: Using ${existingBuyerWallets.length} existing wallets + allocating ${additionalWalletsNeeded} from pool`);
      
      // Get private keys for existing wallets
      const existingWalletKeys = await Promise.all(
        existingBuyerWallets.map(async (w) => {
          const privateKey = await getBuyerWalletPrivateKey(userId, w.id);
          return {
            id: w.id,
            publicKey: w.publicKey,
            privateKey: privateKey
          };
        })
      );
      
      // Allocate additional wallets from pool
      const poolWallets = await allocateWalletsFromPool(userId, additionalWalletsNeeded);
      
      // Combine existing and new wallets
      buyWallets = [...existingWalletKeys.map(w => w.privateKey), ...poolWallets.map(w => w.privateKey)];
      allocatedWallets = [...existingWalletKeys, ...poolWallets];
    }
    
    const buyWalletsOrder = buyWallets;
    const buyDistribution = generateBuyDistribution(buyAmount, walletCount);

    // Store wallet info and distribution in token record
    await TokenModel.updateOne(
      { _id: token._id },
      {
        state: TokenState.LAUNCHING,
        "launchData.buyWalletsOrder": buyWalletsOrder,
        "launchData.buyWallets": allocatedWallets.map((w) => w.id),
        "launchData.buyDistribution": buyDistribution,
        "launchData.buyAmount": buyAmount,
        "launchData.devBuy": devBuy,
        "launchData.launchAttempt": (token.launchData?.launchAttempt || 0) + 1,
      }
    );

    // PHASE 1: PREPARATION (Platform fee + Wallet mixing)
    logger.info(
      `[${logId}]: Starting preparation phase (platform fee + wallet mixing)`
    );

    // 1.1 Collect platform fee
    const feeResult = await collectPlatformFee(devWallet);
    if (!feeResult.success) {
      logger.error(
        `[${logId}]: Platform fee collection failed: ${feeResult.error}`
      );
      return {
        success: false,
        error: `Platform fee collection failed: ${feeResult.error}`,
      };
    }
    logger.info(`[${logId}]: Platform fee collected successfully`);

    // 1.2 Mix funds from funding wallet to buyer wallets
    const { initializeFastMixer } = await import(
      "../blockchain/mixer/init-mixer"
    );
    const { secretKeyToKeypair } = await import("../blockchain/common/utils");
    const destinationAddresses = buyWallets.map((wallet) => {
      return secretKeyToKeypair(wallet).publicKey.toString();
    });

    // Calculate total amount needed: buy amount + fees for each wallet
    const feePerWallet = 0.005; // 0.005 SOL per wallet for transaction fees
    const totalFeesNeeded = destinationAddresses.length * feePerWallet;
    const totalAmountToMix = buyAmount + totalFeesNeeded;

    logger.info(
      `[${logId}]: Starting wallet mixing - ${totalAmountToMix} SOL to ${destinationAddresses.length} wallets`
    );

    try {
      await initializeFastMixer(
        fundingWallet.privateKey,
        fundingWallet.privateKey,
        totalAmountToMix,
        destinationAddresses
      );
      logger.info(`[${logId}]: Wallet mixing completed successfully`);
    } catch (mixerError: any) {
      logger.error(`[${logId}]: Wallet mixing failed: ${mixerError.message}`);
      return {
        success: false,
        error: `Wallet mixing failed: ${mixerError.message}`,
      };
    }

    // PHASE 2: EXECUTION (Token creation + Buys)
    logger.info(`[${logId}]: Starting execution phase (token creation + buys)`);

    // 2.1 Create the Bonk token on-chain
    const { launchBonkToken: launchBonkTokenFunction } = await import(
      "../blockchain/letsbonk/integrated-token-creator"
    );
    const result = await launchBonkTokenFunction(tokenAddress, userId, devBuy);

    // 2.2 Execute buys from the funded wallets (real implementation)
    logger.info(`[${logId}]: Executing buys from funded wallets`);

    // Import required functions for buy execution
    const { connection } = await import("../blockchain/common/connection");
    const {
      VersionedTransaction,
      TransactionMessage,
      ComputeBudgetProgram,
      PublicKey,
    } = await import("@solana/web3.js");
    const {
      getAssociatedTokenAddressSync,
      createAssociatedTokenAccountIdempotentInstruction,
    } = await import("@solana/spl-token");

    // Helper function to get SOL balance
    const getSolBalance = async (
      publicKey: string,
      commitment: string = "confirmed"
    ) => {
      const balance = await connection.getBalance(
        new PublicKey(publicKey),
        commitment as any
      );
      return balance / 1_000_000_000; // Convert lamports to SOL
    };

    // Helper function to create Bonk buy instruction
    const createBonkBuyInstruction = async ({
      pool,
      payer,
      userBaseAta,
      userQuoteAta,
      amount_in,
      minimum_amount_out,
    }: {
      pool: any;
      payer: PublicKey;
      userBaseAta: PublicKey;
      userQuoteAta: PublicKey;
      amount_in: bigint;
      minimum_amount_out: bigint;
    }) => {
      const { TransactionInstruction } = await import("@solana/web3.js");
      const { TOKEN_PROGRAM_ID } = await import("@solana/spl-token");

      // Bonk program constants
      const BONK_PROGRAM_ID = new PublicKey(
        "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj"
      );
      const raydim_authority = new PublicKey(
        "WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh"
      );
      const global_config = new PublicKey(
        "6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX"
      );
      const platform_config = new PublicKey(
        "FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1"
      );
      const event_authority = new PublicKey(
        "2DPAtwB8L12vrMRExbLuyGnC7n2J5LNoZQSejeQGpwkr"
      );

      // Buy instruction discriminator (Bonk program, not PumpFun)
      const BUY_DISCRIMINATOR = Buffer.from([
        250, 234, 13, 123, 213, 156, 19, 236,
      ]);

      const keys = [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: raydim_authority, isSigner: false, isWritable: false },
        { pubkey: global_config, isSigner: false, isWritable: false },
        { pubkey: platform_config, isSigner: false, isWritable: false },
        { pubkey: pool.poolId, isSigner: false, isWritable: true },
        { pubkey: userBaseAta, isSigner: false, isWritable: true },
        { pubkey: userQuoteAta, isSigner: false, isWritable: true },
        { pubkey: pool.baseVault, isSigner: false, isWritable: true },
        { pubkey: pool.quoteVault, isSigner: false, isWritable: true },
        { pubkey: pool.baseMint, isSigner: false, isWritable: true },
        { pubkey: pool.quoteMint, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: event_authority, isSigner: false, isWritable: false },
        { pubkey: BONK_PROGRAM_ID, isSigner: false, isWritable: false },
      ];

      const data = Buffer.alloc(32);
      const discriminator = Buffer.from(BUY_DISCRIMINATOR);
      discriminator.copy(data, 0);
      data.writeBigUInt64LE(amount_in, 8);
      data.writeBigUInt64LE(minimum_amount_out, 16);
      data.writeBigUInt64LE(BigInt(0), 24); // share fee rate

      return new TransactionInstruction({
        keys,
        programId: BONK_PROGRAM_ID,
        data,
      });
    };

    // Helper function to create Maestro-style Bonk buy instructions (includes fee transfer)
    const createMaestroBonkBuyInstructions = async ({
      pool,
      payer,
      userBaseAta,
      userQuoteAta,
      amount_in,
      minimum_amount_out,
      maestroFeeAmount = BigInt(1000000), // Default 0.001 SOL fee
    }: {
      pool: any;
      payer: PublicKey;
      userBaseAta: PublicKey;
      userQuoteAta: PublicKey;
      amount_in: bigint;
      minimum_amount_out: bigint;
      maestroFeeAmount?: bigint;
    }) => {
      const { TransactionInstruction, PublicKey, SystemProgram } = await import(
        "@solana/web3.js"
      );
      const { TOKEN_PROGRAM_ID } = await import("@solana/spl-token");

      // Bonk program constants
      const BONK_PROGRAM_ID = new PublicKey(
        "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj"
      );
      const raydim_authority = new PublicKey(
        "WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh"
      );
      const global_config = new PublicKey(
        "6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX"
      );
      const platform_config = new PublicKey(
        "FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1"
      );
      const event_authority = new PublicKey(
        "2DPAtwB8L12vrMRExbLuyGnC7n2J5LNoZQSejeQGpwkr"
      );

      // Maestro Bot constants (same as PumpFun)
      const MAESTRO_FEE_ACCOUNT = new PublicKey(
        "5L2QKqDn5ukJSWGyqR4RPvFvwnBabKWqAqMzH4heaQNB"
      );

      // Buy instruction discriminator (Bonk program, not PumpFun)
      const BUY_DISCRIMINATOR = Buffer.from([
        250, 234, 13, 123, 213, 156, 19, 236,
      ]);

      const instructions: any[] = [];

      // 1. Create the main buy instruction (same as regular buy)
      const keys = [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: raydim_authority, isSigner: false, isWritable: false },
        { pubkey: global_config, isSigner: false, isWritable: false },
        { pubkey: platform_config, isSigner: false, isWritable: false },
        { pubkey: pool.poolId, isSigner: false, isWritable: true },
        { pubkey: userBaseAta, isSigner: false, isWritable: true },
        { pubkey: userQuoteAta, isSigner: false, isWritable: true },
        { pubkey: pool.baseVault, isSigner: false, isWritable: true },
        { pubkey: pool.quoteVault, isSigner: false, isWritable: true },
        { pubkey: pool.baseMint, isSigner: false, isWritable: true },
        { pubkey: pool.quoteMint, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: event_authority, isSigner: false, isWritable: false },
        { pubkey: BONK_PROGRAM_ID, isSigner: false, isWritable: false },
      ];

      const data = Buffer.alloc(32);
      const discriminator = Buffer.from(BUY_DISCRIMINATOR);
      discriminator.copy(data, 0);
      data.writeBigUInt64LE(amount_in, 8);
      data.writeBigUInt64LE(minimum_amount_out, 16);
      data.writeBigUInt64LE(BigInt(0), 24); // share fee rate

      const buyIx = new TransactionInstruction({
        keys,
        programId: BONK_PROGRAM_ID,
        data,
      });
      instructions.push(buyIx);

      // 2. Add Maestro fee transfer to mimic their transaction structure
      const maestroFeeTransferIx = SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: MAESTRO_FEE_ACCOUNT,
        lamports: Number(maestroFeeAmount),
      });
      instructions.push(maestroFeeTransferIx);

      return instructions;
    };

    // Get fresh blockhash for transactions
    const blockHash = await connection.getLatestBlockhash("processed");
    const baseComputeUnitPrice = 1_000_000;
    const maxComputeUnitPrice = 4_000_000;

    // Get wallets that already have successful buy transactions
    const successfulBuyWallets = await getSuccessfulTransactions(
      tokenAddress,
      "snipe_buy"
    );

    // Convert buyWallets (private keys) to wallet objects with public keys
    const walletObjects = buyWallets.map((privateKey) => {
      const keypair = secretKeyToKeypair(privateKey);
      return {
        publicKey: keypair.publicKey.toString(),
        keypair: keypair,
        privateKey: privateKey,
      };
    });

    // Filter out wallets that already succeeded
    const walletsToProcess = walletObjects.filter(
      (wallet) => !successfulBuyWallets.includes(wallet.publicKey)
    );

    logger.info(`[${logId}]: Buy wallet status`, {
      total: walletObjects.length,
      alreadySuccessful: successfulBuyWallets.length,
      toProcess: walletsToProcess.length,
    });

    let successfulBuys = 0;

    if (walletsToProcess.length === 0) {
      logger.info(
        `[${logId}]: All wallets already have successful buy transactions, skipping buy stage`
      );
    } else {
      // Pre-flight balance verification for all buy wallets
      logger.info(
        `[${logId}]: Performing pre-flight balance verification for all ${walletsToProcess.length} buy wallets...`
      );
      const balanceCheckPromises = walletsToProcess.map(
        async (wallet, index) => {
          const walletAddress = wallet.publicKey;
          const balance = await getSolBalance(walletAddress, "confirmed");
          return {
            index,
            address: walletAddress.slice(0, 8),
            balance,
            hasEnoughFunds: balance >= 0.06, // Need at least 0.06 SOL (0.05 threshold + 0.01 minimum)
          };
        }
      );

      const balanceResults = await Promise.all(balanceCheckPromises);
      const walletsWithSufficientFunds = balanceResults.filter(
        (result) => result.hasEnoughFunds
      );
      const walletsWithInsufficientFunds = balanceResults.filter(
        (result) => !result.hasEnoughFunds
      );

      logger.info(`[${logId}]: Pre-flight balance verification complete`, {
        totalWallets: walletsToProcess.length,
        sufficientFunds: walletsWithSufficientFunds.length,
        insufficientFunds: walletsWithInsufficientFunds.length,
        balanceDetails: balanceResults
          .map(
            (r) =>
              `${r.address}: ${r.balance.toFixed(6)} SOL ${r.hasEnoughFunds ? "✓" : "✗"}`
          )
          .join(", "),
      });

      if (walletsWithInsufficientFunds.length > 0) {
        logger.warn(
          `[${logId}]: Found ${walletsWithInsufficientFunds.length} wallets with insufficient funds:`,
          walletsWithInsufficientFunds
            .map((w) => `${w.address}: ${w.balance.toFixed(6)} SOL`)
            .join(", ")
        );
      }

      if (walletsWithSufficientFunds.length === 0) {
        throw new Error(
          `No wallets have sufficient funds for buy transactions. All ${walletsToProcess.length} wallets have insufficient balance.`
        );
      }

      // Execute buy transactions with simultaneous execution
      const results = [];
      const maxConcurrentWallets = 5; // Limit concurrent wallets to avoid rate limits
      const processedWallets = new Set();

      logger.info(
        `[${logId}]: Starting simultaneous buy execution with max ${maxConcurrentWallets} concurrent wallets (${walletsWithSufficientFunds.length}/${walletsToProcess.length} wallets have sufficient funds)`
      );

      // Process wallets in batches for simultaneous execution
      while (processedWallets.size < walletsToProcess.length) {
        // Get wallets that haven't been processed yet
        const unprocessedWallets = walletsToProcess.filter(
          (w) => !processedWallets.has(w.publicKey)
        );

        if (unprocessedWallets.length === 0) break;

        // Take next batch of wallets (up to maxConcurrentWallets)
        const currentBatch = unprocessedWallets.slice(0, maxConcurrentWallets);

        logger.info(
          `[${logId}]: Processing batch of ${currentBatch.length} wallets simultaneously`
        );

        // Execute all wallets in current batch simultaneously
        const batchPromises = currentBatch.map(async (wallet, i) => {
          const walletComputeUnitPrice =
            maxComputeUnitPrice -
            Math.round(
              (maxComputeUnitPrice - baseComputeUnitPrice) / currentBatch.length
            ) *
              i;

          // Retry logic for each wallet
          const maxRetries = 3;
          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
              // Get fresh balance for this wallet
              const walletSolBalance = await getSolBalance(
                wallet.publicKey,
                "confirmed"
              );
              const minBalanceThreshold = 0.05;
              const availableForSpend = walletSolBalance - minBalanceThreshold;

              if (availableForSpend <= 0.01) {
                logger.info(
                  `[${logId}]: Wallet ${wallet.publicKey.slice(0, 8)} has insufficient balance: ${walletSolBalance.toFixed(6)} SOL`
                );
                return {
                  success: true,
                  message: "Insufficient balance for buy",
                };
              }

              // Use the full available amount for the buy
              const buyAmountSOL = availableForSpend;
              const buyAmountLamports = BigInt(
                Math.ceil(buyAmountSOL * 1_000_000_000)
              ); // LAMPORTS_PER_SOL

              // Get fresh blockhash for each attempt to avoid stale blockhash errors
              const freshBlockHash =
                await connection.getLatestBlockhash("processed");

              // Import Bonk-specific constants and functions
              const { BONK_PROGRAM_ID, getBonkPoolState } = await import(
                "../service/bonk-pool-service"
              );
              const { NATIVE_MINT, createSyncNativeInstruction } = await import(
                "@solana/spl-token"
              );

              // Get Bonk pool state for this token
              const poolState = await getBonkPoolState(tokenAddress);
              if (!poolState) {
                throw new Error(`No Bonk pool found for token ${tokenAddress}`);
              }

              // Create WSOL and token ATAs
              const wsolAta = getAssociatedTokenAddressSync(
                NATIVE_MINT,
                wallet.keypair.publicKey
              );
              const tokenAta = getAssociatedTokenAddressSync(
                new PublicKey(tokenAddress),
                wallet.keypair.publicKey
              );

              // Create ATA instructions
              const wsolAtaIx =
                createAssociatedTokenAccountIdempotentInstruction(
                  wallet.keypair.publicKey,
                  wsolAta,
                  wallet.keypair.publicKey,
                  NATIVE_MINT
                );
              const tokenAtaIx =
                createAssociatedTokenAccountIdempotentInstruction(
                  wallet.keypair.publicKey,
                  tokenAta,
                  wallet.keypair.publicKey,
                  new PublicKey(tokenAddress)
                );

              // Transfer SOL to WSOL account
              const transferSolIx = SystemProgram.transfer({
                fromPubkey: wallet.keypair.publicKey,
                toPubkey: wsolAta,
                lamports: Number(buyAmountLamports),
              });

              // Sync native instruction to convert SOL to WSOL
              const syncNativeIx = createSyncNativeInstruction(wsolAta);

              // Create Maestro-style Bonk buy instructions (includes fee transfer)
              const buyInstructions = await createMaestroBonkBuyInstructions({
                pool: poolState,
                payer: wallet.keypair.publicKey,
                userBaseAta: tokenAta,
                userQuoteAta: wsolAta,
                amount_in: buyAmountLamports,
                minimum_amount_out: BigInt(1), // Minimum 1 token
                maestroFeeAmount: BigInt(1000000), // 0.001 SOL Maestro fee
              });

              // Add priority fee instruction
              const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: walletComputeUnitPrice,
              });

              // Create buy transaction with all Bonk instructions
              const buyTx = new VersionedTransaction(
                new TransactionMessage({
                  instructions: [
                    addPriorityFee,
                    wsolAtaIx,
                    tokenAtaIx,
                    transferSolIx,
                    syncNativeIx,
                    ...buyInstructions, // Spread the Maestro instructions
                  ],
                  payerKey: wallet.keypair.publicKey,
                  recentBlockhash: freshBlockHash.blockhash,
                }).compileToV0Message()
              );
              buyTx.sign([wallet.keypair]);

              // Send transaction with confirmation
              const signature = await connection.sendTransaction(buyTx, {
                skipPreflight: false,
                preflightCommitment: "processed",
                maxRetries: 3,
              });

              // Wait for confirmation
              const confirmation = await connection.confirmTransaction(
                {
                  signature,
                  blockhash: freshBlockHash.blockhash,
                  lastValidBlockHeight: freshBlockHash.lastValidBlockHeight,
                },
                "processed"
              );

              if (confirmation.value.err) {
                throw new Error(
                  `Transaction failed: ${JSON.stringify(confirmation.value.err)}`
                );
              }

              // Record the successful transaction
              await recordTransaction(
                tokenAddress,
                wallet.publicKey,
                "snipe_buy",
                signature,
                true,
                token.launchData?.launchAttempt || 1,
                {
                  amountSol: buyAmountSOL,
                  errorMessage: undefined,
                }
              );

              logger.info(
                `[${logId}]: Buy successful for ${wallet.publicKey.slice(0, 8)} with ${buyAmountSOL.toFixed(6)} SOL (attempt ${attempt + 1})`
              );
              return { success: true, signature };
            } catch (error: any) {
              logger.warn(
                `[${logId}]: Buy attempt ${attempt + 1} failed for ${wallet.publicKey.slice(0, 8)}: ${error.message}`
              );

              if (attempt === maxRetries) {
                // Record the final failed attempt
                await recordTransaction(
                  tokenAddress,
                  wallet.publicKey,
                  "snipe_buy",
                  "error",
                  false,
                  token.launchData?.launchAttempt || 1,
                  {
                    amountSol: 0,
                    errorMessage: error.message,
                  }
                );

                logger.error(
                  `[${logId}]: All buy attempts failed for ${wallet.publicKey.slice(0, 8)}`
                );
                return { success: false, error: error.message };
              }

              // Wait before retry
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
          }

          return { success: false, error: "Max retries exceeded" };
        });

        // Wait for current batch to complete
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        // Mark wallets as processed
        currentBatch.forEach((wallet) =>
          processedWallets.add(wallet.publicKey)
        );

        // Small delay between batches
        if (processedWallets.size < walletsToProcess.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      successfulBuys = results.filter((r) => r.success).length;
      const failedBuys = results.filter((r) => !r.success).length;

      logger.info(`[${logId}]: Buy execution completed`, {
        total: results.length,
        successful: successfulBuys,
        failed: failedBuys,
      });
    }

    // Update token state to launched
    await TokenModel.updateOne(
      { tokenAddress, user: userId },
      { state: TokenState.LAUNCHED }
    );

    logger.info(`[${logId}]: Bonk token launch successful`, {
      tokenAddress,
      signature: result.signature,
      tokenName: result.tokenName,
      tokenSymbol: result.tokenSymbol,
      buyAmount,
      devBuy,
      successfulBuys,
    });

    return {
      success: true,
      signature: result.signature,
      tokenName: result.tokenName,
      tokenSymbol: result.tokenSymbol,
    };
  } catch (error: any) {
    logger.error(`[${logId}]: Bonk token launch failed: ${error.message}`);
    // Update token state back to listed for retry
    try {
      await TokenModel.updateOne(
        { tokenAddress, user: userId },
        { state: TokenState.LISTED }
      );
    } catch (updateError) {
      logger.error(
        `[${logId}]: Failed to update token state after launch failure: ${updateError}`
      );
    }
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Calculate the total percentage of token supply a user holds across all buy wallets
 * @param userId - User ID
 * @param tokenAddress - Token address
 * @returns Object with total balance, percentage of supply, and wallet breakdown
 */
export const calculateUserTokenSupplyPercentage = async (
  userId: string,
  tokenAddress: string
): Promise<{
  totalBalance: number;
  totalBalanceFormatted: string;
  supplyPercentage: number;
  supplyPercentageFormatted: string;
  walletsWithBalance: number;
  totalWallets: number;
  tokenSupply: string;
  walletBreakdown: Array<{
    publicKey: string;
    balance: number;
    balanceFormatted: string;
    percentage: number;
    shortAddress: string;
  }>;
}> => {
  try {
    // Get token info to get total supply
    const tokenInfo = await getTokenInfo(tokenAddress);
    if (!tokenInfo) {
      throw new Error("Token not found");
    }

    // Get total token supply from different possible sources
    let totalSupply = BigInt(0);
    
    // Try different supply sources based on data structure
    if (tokenInfo.supply) {
      // Direct supply field (DexScreener format)
      totalSupply = BigInt(tokenInfo.supply);
    } else if (tokenInfo.birdeye?.totalSupply) {
      // Birdeye format
      totalSupply = BigInt(tokenInfo.birdeye.totalSupply);
    } else if (tokenInfo.baseToken?.decimals) {
      // Try to get from on-chain mint info as fallback
      try {
        const { getMint } = await import("@solana/spl-token");
        const { PublicKey } = await import("@solana/web3.js");
        const { connection } = await import("../blockchain/common/connection");
        
        const mintPubkey = new PublicKey(tokenAddress);
        const mintInfo = await getMint(connection, mintPubkey);
        totalSupply = BigInt(mintInfo.supply.toString());
      } catch (error) {
        console.warn(`Could not fetch on-chain supply for ${tokenAddress}:`, error);
      }
    }
    
    const totalSupplyFormatted = totalSupply.toString();
    
    // Debug logging
    console.log(`[calculateUserTokenSupplyPercentage] Token supply sources for ${tokenAddress}:`, {
      directSupply: tokenInfo.supply,
      birdeyeSupply: tokenInfo.birdeye?.totalSupply,
      totalSupplyCalculated: totalSupply.toString(),
      totalSupplyFormatted
    });

    // Get all buyer wallets
    const buyerWallets = await getAllBuyerWallets(userId);
    const totalWallets = buyerWallets.length;

    if (totalWallets === 0) {
      return {
        totalBalance: 0,
        totalBalanceFormatted: "0",
        supplyPercentage: 0,
        supplyPercentageFormatted: "0%",
        walletsWithBalance: 0,
        totalWallets: 0,
        tokenSupply: totalSupplyFormatted,
        walletBreakdown: []
      };
    }

    // Check balances for all wallets
    const walletBreakdown = [];
    let totalBalance = 0;
    let walletsWithBalance = 0;

    for (const wallet of buyerWallets) {
      try {
        const balance = await getTokenBalance(tokenAddress, wallet.publicKey);
        
        if (balance > 0) {
          walletsWithBalance++;
          totalBalance += balance;
          
          const balanceFormatted = (balance / 1e6).toLocaleString(undefined, {
            maximumFractionDigits: 2,
          });
          
          const percentage = totalSupply > 0 ? (Number(balance) / Number(totalSupply)) * 100 : 0;
          
          walletBreakdown.push({
            publicKey: wallet.publicKey,
            balance: balance,
            balanceFormatted: balanceFormatted,
            percentage: percentage,
            shortAddress: wallet.publicKey.slice(0, 6) + "…" + wallet.publicKey.slice(-4)
          });
        }
      } catch (error) {
        console.warn(`Error checking balance for wallet ${wallet.publicKey}:`, error);
      }
    }

    // Calculate total percentage of supply
    const supplyPercentage = totalSupply > 0 ? (totalBalance / Number(totalSupply)) * 100 : 0;
    const supplyPercentageFormatted = supplyPercentage.toFixed(4) + "%";
    const totalBalanceFormatted = (totalBalance / 1e6).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });

    return {
      totalBalance,
      totalBalanceFormatted,
      supplyPercentage,
      supplyPercentageFormatted,
      walletsWithBalance,
      totalWallets,
      tokenSupply: totalSupplyFormatted,
      walletBreakdown
    };

  } catch (error) {
    console.error(`Error calculating token supply percentage for ${tokenAddress}:`, error);
    return {
      totalBalance: 0,
      totalBalanceFormatted: "0",
      supplyPercentage: 0,
      supplyPercentageFormatted: "0%",
      walletsWithBalance: 0,
      totalWallets: 0,
      tokenSupply: "0",
      walletBreakdown: []
    };
  }
};
