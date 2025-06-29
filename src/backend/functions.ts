import mongoose from "mongoose";
import { connection } from "../blockchain/common/connection";
import { generateKeypairs, secretKeyToKeypair } from "../blockchain/common/utils";
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

export const getUserTokenWithBuyWallets = async (userId: string, tokenAddress: string) => {
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
      await WalletModel.updateOne({ _id: firstWallet._id }, { isDefault: true });
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
      await WalletModel.updateOne({ _id: firstRemainingWallet._id }, { isDefault: true });
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

const createTokenMetadata = async (name: string, symbol: string, description: string, image: any) => {
  try {
    const ipfsImage = await uploadFileToPinata(image, `token-${name}-${symbol}-${Date.now()}.png`).then(
      (hash) => `${env.PINATA_GATEWAY_URL}/ipfs/${hash}`
    );
    if (!ipfsImage) {
      return null;
    }
    const data = {
      name,
      symbol,
      description,
      image: ipfsImage,
    };
    const ipfsMetadataResult = await uploadJsonToPinata(data, `metadata-${name}-${symbol}-${Date.now()}.json`);
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

export const getAvailablePumpAddress = async (userId: string) => {
  const session = await mongoose.startSession();

  try {
    return await session.withTransaction(async () => {
      // Find an unused pump address
      const pumpAddress = await PumpAddressModel.findOneAndUpdate(
        { isUsed: false },
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
        throw new Error("No available pump addresses found. Please contact support.");
      }

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
  await PumpAddressModel.findOneAndUpdate(
    { publicKey },
    {
      $set: {
        isUsed: false,
        usedBy: null,
        usedAt: null,
      },
    }
  );
};

export const markPumpAddressAsUsed = async (publicKey: string, userId?: string) => {
  const result = await PumpAddressModel.findOneAndUpdate(
    { publicKey },
    {
      $set: {
        isUsed: true,
        usedBy: userId || null,
        usedAt: new Date(),
      },
    },
    { new: true }
  );

  if (!result) {
    throw new Error(`Pump address ${publicKey} not found in database`);
  }

  logger.info(`Marked pump address ${publicKey} as used${userId ? ` by user ${userId}` : ""}`);
  return result;
};

export const getPumpAddressStats = async () => {
  const total = await PumpAddressModel.countDocuments();
  const used = await PumpAddressModel.countDocuments({ isUsed: true });
  const available = total - used;

  return {
    total,
    used,
    available,
    usagePercentage: total > 0 ? Math.round((used / total) * 100) : 0,
  };
};

export const getUserPumpAddresses = async (userId: string) => {
  return await PumpAddressModel.find({ usedBy: userId }).select("publicKey usedAt");
};

export const createToken = async (userId: string, name: string, symbol: string, description: string, image: any) => {
  const devWallet = await WalletModel.findOne({
    user: userId,
    isDev: true,
    isDefault: true,
  });

  if (!devWallet) {
    throw new Error("No default dev wallet found");
  }

  const metadataUri = await createTokenMetadata(name, symbol, description, image);
  if (!metadataUri) {
    throw new Error("Token metadata uri not uploaded");
  }

  // Use pump address instead of generating random keypair
  let tokenKey;
  let isPumpAddress = false;
  try {
    tokenKey = await getAvailablePumpAddress(userId);
    isPumpAddress = true;
  } catch (error: any) {
    // Fallback to random generation if no pump addresses available
    logger.warn(`No pump addresses available for user ${userId}, falling back to random generation: ${error.message}`);
    const [randomKey] = generateKeypairs(1);
    tokenKey = randomKey;
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
    return token;
  } catch (error) {
    // If token creation fails and we used a pump address, release it
    if (isPumpAddress) {
      await releasePumpAddress(tokenKey.publicKey);
    }
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
  const expectedFunderBalance = (buyAmount + walletCount * 0.005) * LAMPORTS_PER_SOL;
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
      await tokenLaunchQueue.add(`launch-${tokenAddress}-${updatedToken.launchData?.launchAttempt}`, {
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
        buyDistribution: generateBuyDistribution(buyAmount, buyWallets.length),
        launchStage: 1,
      });
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

export const enqueueTokenLaunchRetry = async (userId: string, chatId: number, tokenAddress: string) => {
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
        buyerWallets: updatedToken.launchData!.buyWalletsOrder || updatedToken.launchData!.buyWallets.map((w) =>
          decryptPrivateKey((w as unknown as { privateKey: string }).privateKey)
        ), // CRITICAL FIX: Use stored wallet order if available, fallback to database order
        devWallet: decryptPrivateKey(
          (
            updatedToken.launchData!.devWallet as unknown as {
              privateKey: string;
            }
          ).privateKey
        ),
        funderWallet: decryptPrivateKey(updatedToken.launchData!.funderPrivateKey),
        devBuy: updatedToken.launchData!.devBuy,
        buyDistribution:
          updatedToken.launchData!.buyDistribution ||
          generateBuyDistribution(updatedToken.launchData!.buyAmount, updatedToken.launchData!.buyWallets.length),
        launchStage: updatedToken.launchData!.launchStage || 1,
      };
      await tokenLaunchQueue.add(`launch-${tokenAddress}-${updatedToken.launchData?.launchAttempt}`, data);
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
      await devSellQueue.add(`dev-sell-${tokenAddress}-${updatedToken.launchData?.devSellAttempt}`, {
        userId,
        tokenAddress,
        userChatId: chatId,
        devWallet,
        sellPercent,
      });
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
      await walletSellQueue.add(`wallet-sell-${tokenAddress}-${updatedToken.launchData?.walletSellAttempt}`, {
        userId,
        tokenAddress,
        userChatId: chatId,
        devWallet,
        buyerWallets,
        sellPercent,
      });
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

export const updateTokenState = async (tokenAddress: string, state: TokenState, userId?: string) => {
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

export const updateLaunchStage = async (tokenAddress: string, stage: Number) => {
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

export const updateBuyDistribution = async (tokenAddress: string, dist: Number[]) => {
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

export const getFundingWallet = async (userId: string) => {
  const user = await UserModel.findById(userId).populate("fundingWallet").exec();
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
  const user = await UserModel.findById(userId).populate("fundingWallet").exec();
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

export const getBuyerWalletPrivateKey = async (userId: string, walletId: string) => {
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
    const balance = await connection.getBalance(new (await import("@solana/web3.js")).PublicKey(publicKey));
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

    // 2. If a pump address was reserved, release it
    const pumpAddress = await PumpAddressModel.findOne({
      publicKey: tokenAddress,
      usedBy: userId,
    });
    if (pumpAddress) {
      await PumpAddressModel.updateOne(
        { publicKey: tokenAddress },
        {
          $set: {
            isUsed: false,
            usedBy: null,
            usedAt: null,
          },
        }
      );
    }

    // 3. Delete the token document
    await TokenModel.deleteOne({ _id: token._id });

    return { success: true, message: "Token deleted successfully" };
  } catch (error: any) {
    logger.error("Error deleting token:", error);
    return { success: false, message: error.message };
  }
};

export const handleTokenLaunchFailure = async (tokenAddress: string, error?: any) => {
  // Release pump address if launch fails permanently
  const pumpAddress = await PumpAddressModel.findOne({
    publicKey: tokenAddress,
    isUsed: true,
  });

  if (pumpAddress) {
    const token = await TokenModel.findOne({ tokenAddress }).populate(["launchData.devWallet"]);
    const launchAttempt = token?.launchData?.launchAttempt || 0;

    // Check if token was actually created (either successfully or already exists)
    const devWalletPublicKey = (token?.launchData?.devWallet as any)?.publicKey;
    const tokenCreationSuccessful = devWalletPublicKey ? await isTransactionAlreadySuccessful(
      tokenAddress,
      devWalletPublicKey,
      "token_creation"
    ) : false;

    // Check for specific errors that indicate the address is permanently unusable
    const shouldReleaseImmediately =
      error &&
      // Pump.fun Custom:0 error (NotAuthorized/AlreadyInitialized)
      (error.message?.includes('{"InstructionError":[0,{"Custom":0}]}') ||
        error.message?.includes("Custom:0") ||
        // Token creation failed with bonding curve errors
        error.message?.includes("Token creation failed") ||
        // Unable to fetch curve data (indicates token might already exist)
        error.message?.includes("Unable to fetch curve data"));

    // Release pump address if:
    // 1. Token was successfully created (even if buy phase failed)
    // 2. Specific permanent errors occurred
    // 3. Too many launch attempts
    if (tokenCreationSuccessful) {
      logger.info(
        `Releasing pump address ${tokenAddress} because token was successfully created (buy phase may have failed)`
      );
      await releasePumpAddress(tokenAddress);
    } else if (shouldReleaseImmediately) {
      logger.info(
        `Releasing pump address ${tokenAddress} immediately due to permanent error: ${error?.message || "Unknown error"}`
      );
      await releasePumpAddress(tokenAddress);
    } else if (launchAttempt > 3) {
      logger.info(`Releasing pump address ${tokenAddress} after ${launchAttempt} failed launch attempts`);
      await releasePumpAddress(tokenAddress);
    } else {
      logger.info(`Keeping pump address ${tokenAddress} for retry (attempt ${launchAttempt}/3)`);
    }
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

export const getRetryData = async (userId: string, conversationType: "launch_token" | "quick_launch"): Promise<any> => {
  const retryData = await RetryDataModel.findOne({
    user: userId,
    conversationType,
  }).lean();

  return retryData;
};

export const clearRetryData = async (userId: string, conversationType: "launch_token" | "quick_launch") => {
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
    const signature = await sendAndConfirmTransaction(connection, transaction, [devKeypair], {
      commitment: "confirmed",
    });

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
    await session.withTransaction(async () => {
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
      await prepareLaunchQueue.add(`prepare-${tokenAddress}-${updatedToken.launchData?.launchAttempt}`, {
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
      });
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

export const enqueueExecuteTokenLaunch = async (userId: string, chatId: number, tokenAddress: string) => {
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
        buyerWallets: updatedToken.launchData!.buyWalletsOrder || updatedToken.launchData!.buyWallets.map((w) =>
          decryptPrivateKey((w as unknown as { privateKey: string }).privateKey)
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
      await executeLaunchQueue.add(`execute-${tokenAddress}-${updatedToken.launchData?.launchAttempt}`, data);
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

    return { success: true, message: "Token removed and address marked as used" };
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
  transactionType: "token_creation" | "dev_buy" | "snipe_buy" | "dev_sell" | "wallet_sell" | "external_sell",
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
  transactionType: "token_creation" | "dev_buy" | "snipe_buy" | "dev_sell" | "wallet_sell" | "external_sell",
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
  transactionType: "token_creation" | "dev_buy" | "snipe_buy" | "dev_sell" | "wallet_sell" | "external_sell",
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
  transactionType: "token_creation" | "dev_buy" | "snipe_buy" | "dev_sell" | "wallet_sell" | "external_sell"
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

export const getTransactionStats = async (tokenAddress: string, launchAttempt?: number) => {
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
      token_creation: records.filter((r) => r.transactionType === "token_creation"),
      dev_buy: records.filter((r) => r.transactionType === "dev_buy"),
      snipe_buy: records.filter((r) => r.transactionType === "snipe_buy"),
      dev_sell: records.filter((r) => r.transactionType === "dev_sell"),
      wallet_sell: records.filter((r) => r.transactionType === "wallet_sell"),
      external_sell: records.filter((r) => r.transactionType === "external_sell"),
    },
  };

  return stats;
};

// ========== TRANSACTION FINANCIAL STATS FUNCTIONS ==========

export const getTransactionFinancialStats = async (tokenAddress: string, launchAttempt?: number) => {
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
  const snipeBuyRecords = records.filter((r) => r.transactionType === "snipe_buy");
  const devSellRecords = records.filter((r) => r.transactionType === "dev_sell");
  const walletSellRecords = records.filter((r) => r.transactionType === "wallet_sell");
  const externalSellRecords = records.filter((r) => r.transactionType === "external_sell");

  // Calculate spending (buys)
  const totalDevSpent = devBuyRecords.reduce((sum, record) => {
    return sum + (record.amountSol || 0);
  }, 0);

  const totalSnipeSpent = snipeBuyRecords.reduce((sum, record) => {
    return sum + (record.amountSol || 0);
  }, 0);

  const totalSpent = totalDevSpent + totalSnipeSpent;

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
  const profitLossPercentage = totalSpent > 0 ? (netProfitLoss / totalSpent) * 100 : 0;

  // Calculate total tokens acquired (buys)
  const totalDevTokens = devBuyRecords.reduce((sum, record) => {
    return sum + BigInt(record.amountTokens || "0");
  }, BigInt(0));

  const totalSnipeTokens = snipeBuyRecords.reduce((sum, record) => {
    return sum + BigInt(record.amountTokens || "0");
  }, BigInt(0));

  const totalTokens = totalDevTokens + totalSnipeTokens;

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

  const totalTokensSold = totalDevTokensSold + totalWalletTokensSold + totalExternalTokensSold;
  const remainingTokens = totalTokens - totalTokensSold;

  return {
    // Buy data
    totalSpent: Number(totalSpent.toFixed(6)),
    totalDevSpent: Number(totalDevSpent.toFixed(6)),
    totalSnipeSpent: Number(totalSnipeSpent.toFixed(6)),
    totalTokens: totalTokens.toString(),
    totalDevTokens: totalDevTokens.toString(),
    totalSnipeTokens: totalSnipeTokens.toString(),
    successfulBuys: snipeBuyRecords.length,
    averageSpentPerWallet:
      snipeBuyRecords.length > 0 ? Number((totalSnipeSpent / snipeBuyRecords.length).toFixed(6)) : 0,

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
    successfulSells: devSellRecords.length + walletSellRecords.length + externalSellRecords.length,

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
    transactionType: transactionType || { $in: ["dev_sell", "wallet_sell", "external_sell"] },
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
      existingBatch.totalTokens = existingBatch.totalTokens + BigInt(record.amountTokens || "0");
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
      successRate: Math.round((batch.successCount / batch.transactions.length) * 100),
      solReceived: Number(batch.totalSol.toFixed(6)),
      tokensSold: batch.totalTokens.toString(),
      tokensDisplayed: (Number(batch.totalTokens) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 }),
      sellPercent: batch.sellPercent,
      signatures: batch.transactions.filter((t: any) => t.success).map((t: any) => t.signature),
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
  const firstFifteenSequence = [0.5, 0.7, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1];
  const firstFifteenTotal = firstFifteenSequence.reduce((sum, amount) => sum + amount, 0); // Calculate exact total

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
  const firstFifteenSequence = [0.5, 0.7, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1];
  const firstFifteenTotal = firstFifteenSequence.reduce((sum, amount) => sum + amount, 0);
  const lastFiveTotal = 5 * 5.0; // 5 wallets × 5.0 SOL each
  return firstFifteenTotal + lastFiveTotal; // 21.5 + 25.0 = 46.5 SOL
};

/**
 * Generate buy distribution for sequential wallet buying with new 20 wallet system
 * First 15 wallets: incremental amounts 0.5-2.1 SOL
 * Last 5 wallets: 4.0-5.0 SOL each for larger purchases
 */
export const generateBuyDistribution = (buyAmount: number, availableWallets: number): number[] => {
  const maxWallets = Math.min(availableWallets, 20);
  const firstFifteenSequence = [0.5, 0.7, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1];
  const firstFifteenTotal = firstFifteenSequence.reduce((sum, amount) => sum + amount, 0); // Calculate exact total

  if (buyAmount <= firstFifteenTotal) {
    // Use only the first sequence wallets needed
    const distribution: number[] = [];
    let remaining = buyAmount;

    for (let i = 0; i < Math.min(maxWallets, firstFifteenSequence.length); i++) {
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

    return distribution;
  } else {
    // Use all 15 sequence wallets + distribute remaining across last 5 wallets (4-5 SOL each)
    const distribution = [...firstFifteenSequence];
    let remaining = buyAmount - firstFifteenTotal;

    // Calculate how many additional wallets we need (max 5)
    const additionalWalletsNeeded = Math.min(5, Math.min(maxWallets - 15, Math.ceil(remaining / 4.0)));

    if (additionalWalletsNeeded > 0) {
      // Distribute remaining amount across additional wallets (4-5 SOL each)
      for (let i = 0; i < additionalWalletsNeeded; i++) {
        if (remaining <= 0) break;

        if (i === additionalWalletsNeeded - 1) {
          // Last additional wallet gets all remaining
          distribution.push(remaining);
        } else {
          // Other additional wallets get 4-5 SOL, prefer closer to 4.5 SOL
          const walletAmount = Math.min(5.0, Math.max(4.0, remaining / (additionalWalletsNeeded - i)));
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
    console.log(`✅ Wallet pool already initialized with ${existingCount} wallets`);
    return;
  }

  const walletsToGenerate = count - existingCount;
  console.log(`📝 Generating ${walletsToGenerate} new wallets...`);

  const batchSize = 100;
  const batches = Math.ceil(walletsToGenerate / batchSize);

  for (let i = 0; i < batches; i++) {
    const currentBatchSize = Math.min(batchSize, walletsToGenerate - i * batchSize);

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
    console.log(`📝 Generated batch ${i + 1}/${batches} (${currentBatchSize} wallets)`);
  }

  console.log(`✅ Wallet pool initialized with ${count} wallets`);
};

export const allocateWalletsFromPool = async (userId: string, count: number) => {
  const { WalletPoolModel, WalletModel } = await import("./models");
  const { decryptPrivateKey } = await import("./utils");

  console.log(`🔄 Allocating ${count} wallets from pool to user ${userId}...`);

  // Find available wallets in pool
  const availableWallets = await WalletPoolModel.find({
    isAllocated: false,
  }).limit(count);

  if (availableWallets.length < count) {
    throw new Error(`Insufficient wallets in pool. Need ${count}, available ${availableWallets.length}`);
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
    console.log(`⚠️ Wallet pool low: ${stats.available} available, ${minThreshold} minimum required`);
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
export const getOrCreateAffiliateCode = async (userId: string): Promise<string> => {
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
export const processReferral = async (newUserId: string, referralCode: string): Promise<boolean> => {
  try {
    // Find the referring user by affiliate code
    const referringUser = await UserModel.findOne({ affiliateCode: referralCode });
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

    logger.info(`Referral processed: User ${newUserId} referred by ${referringUser._id} (code: ${referralCode})`);
    return true;
  } catch (error) {
    logger.error("Error processing referral:", error);
    return false;
  }
};

/**
 * Generate referral link for a user
 */
export const generateReferralLink = async (userId: string, botUsername: string): Promise<string> => {
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

export async function getNonEmptyBalances(userId: string, tokenAddress: string): Promise<WalletBalance[]> {
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
export const getWalletForTrading = async (userId: string, tokenAddress?: string) => {
  const buyerWallets = await WalletModel.find({
    user: userId,
    isBuyer: true,
  })
    .sort({ createdAt: 1 })
    .lean();

  if (buyerWallets.length === 0) {
    throw new Error("No buyer wallets found. Please create a buyer wallet first.");
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
      console.warn(`Error checking token balances for trading wallet selection:`, error);
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
