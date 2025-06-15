import mongoose from "mongoose";
import { connection } from "../blockchain/common/connection";
import {
  generateKeypairs,
  secretKeyToKeypair,
} from "../blockchain/common/utils";
import { env } from "../config";
import { TokenModel, UserModel, WalletModel, type User, PumpAddressModel, RetryDataModel, type RetryData } from "./models";
import {
  decryptPrivateKey,
  encryptPrivateKey,
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
    isDev: true
  })
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
  tokenAddress: string,
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
  telegramId: string,
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
  }).sort({ createdAt: 1 }).lean();
  
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
  image: any,
) => {
  try {
    const ipfsImage = await uploadFileToPinata(
      image,
      `token-${name}-${symbol}-${Date.now()}.png`,
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
      `metadata-${name}-${symbol}-${Date.now()}.json`,
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
            usedAt: new Date() 
          } 
        },
        { 
          new: true, 
          session,
          sort: { createdAt: 1 } // Use oldest first
        }
      );
      
      if (!pumpAddress) {
        throw new Error("No available pump addresses found. Please contact support.");
      }
      
      return {
        publicKey: pumpAddress.publicKey,
        secretKey: pumpAddress.secretKey
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
        usedAt: null 
      } 
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
        usedAt: new Date() 
      } 
    },
    { new: true }
  );
  
  if (!result) {
    throw new Error(`Pump address ${publicKey} not found in database`);
  }
  
  logger.info(`Marked pump address ${publicKey} as used${userId ? ` by user ${userId}` : ''}`);
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
    usagePercentage: total > 0 ? Math.round((used / total) * 100) : 0
  };
};

export const getUserPumpAddresses = async (userId: string) => {
  return await PumpAddressModel.find({ usedBy: userId }).select('publicKey usedAt');
};

export const createToken = async (
  userId: string,
  name: string,
  symbol: string,
  description: string,
  image: any,
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
    image,
  );
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
  walletCount: number,
) => {
  let success = true;
  const funderKeypair = secretKeyToKeypair(funderWallet);
  const devKeypair = secretKeyToKeypair(decryptPrivateKey(devWallet));

  // expectations
  const expectedFunderBalance =
    (buyAmount + walletCount * 0.05) * LAMPORTS_PER_SOL;
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
  buyAmount: number,
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
        { new: true },
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
          buyDistribution: [],
          launchStage: 1,
        },
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
  tokenAddress: string,
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
        { new: true },
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
        buyerWallets: updatedToken.launchData!.buyWallets.map((w) =>
          decryptPrivateKey(
            (w as unknown as { privateKey: string }).privateKey,
          ),
        ),
        devWallet: decryptPrivateKey(
          (
            updatedToken.launchData!.devWallet as unknown as {
              privateKey: string;
            }
          ).privateKey,
        ),
        funderWallet: decryptPrivateKey(
          updatedToken.launchData!.funderPrivateKey,
        ),
        devBuy: updatedToken.launchData!.devBuy,
        buyDistribution: updatedToken.launchData!.buyDistribution || [],
        launchStage: updatedToken.launchData!.launchStage || 1,
      };
      await tokenLaunchQueue.add(
        `launch-${tokenAddress}-${updatedToken.launchData?.launchAttempt}`,
        data,
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
  sellPercent: number,
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
        { new: true },
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
        },
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
  sellPercent: number,
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
        { new: true },
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
        },
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
  userId?: string,
) => {
  const filter: any = { tokenAddress };
  
  // If userId is provided, filter by user as well to avoid cross-user state updates
  if (userId) {
    filter.user = userId;
  }
  
  await TokenModel.findOneAndUpdate(
    filter,
    {
      $set: {
        state,
      },
    },
  );
};

export const updateLaunchStage = async (
  tokenAddress: string,
  stage: Number,
) => {
  await TokenModel.findOneAndUpdate(
    {
      tokenAddress,
    },
    {
      $set: {
        "launchData.launchStage": stage,
      },
    },
  );
};

export const updateBuyDistribution = async (
  tokenAddress: string,
  dist: Number[],
) => {
  await TokenModel.findOneAndUpdate(
    {
      tokenAddress,
    },
    {
      $set: {
        "launchData.buyDistribution": dist,
      },
    },
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
    },
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
    },
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
    },
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
    },
  );
};

// ========== FUNDING WALLET FUNCTIONS ==========

export const getOrCreateFundingWallet = async (userId: string) => {
  let user = await UserModel.findById(userId).populate('fundingWallet').exec();
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
    
    await UserModel.updateOne(
      { _id: userId },
      { fundingWallet: wallet._id }
    );
    
    return wallet.publicKey;
  }
  
  return (user.fundingWallet as any).publicKey;
};

export const getFundingWallet = async (userId: string) => {
  const user = await UserModel.findById(userId).populate('fundingWallet').exec();
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
  const user = await UserModel.findById(userId).populate('fundingWallet').exec();
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
  
  await UserModel.updateOne(
    { _id: userId },
    { fundingWallet: wallet._id }
  );
  
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
  }).sort({ createdAt: 1 }).lean();
  
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
  
  if (existingWallets >= 10) {
    throw new Error("Maximum of 10 buyer wallets allowed");
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
  
  if (existingWallets >= 10) {
    throw new Error("Maximum of 10 buyer wallets allowed");
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
  const session = await mongoose.startSession();
  
  try {
    return await session.withTransaction(async () => {
      // Find the token
      const token = await TokenModel.findOne({
        user: userId,
        tokenAddress
      }).session(session);
      
      if (!token) {
        throw new Error("Token not found");
      }
      
      // Check if token is using a pump address and release it
      const pumpAddress = await PumpAddressModel.findOne({
        publicKey: tokenAddress,
        usedBy: userId
      }).session(session);
      
      if (pumpAddress) {
        await PumpAddressModel.findOneAndUpdate(
          { publicKey: tokenAddress },
          { 
            $set: { 
              isUsed: false, 
              usedBy: null, 
              usedAt: null 
            } 
          },
          { session }
        );
      }
      
      // Delete the token
      await TokenModel.deleteOne({ _id: token._id }).session(session);
      
      return { success: true, message: "Token deleted successfully" };
    });
  } catch (error: any) {
    logger.error("Error deleting token:", error);
    return { success: false, message: error.message };
  } finally {
    await session.endSession();
  }
};

export const handleTokenLaunchFailure = async (tokenAddress: string, error?: any) => {
  // Release pump address if launch fails permanently
  const pumpAddress = await PumpAddressModel.findOne({
    publicKey: tokenAddress,
    isUsed: true
  });
  
  if (pumpAddress) {
    const token = await TokenModel.findOne({ tokenAddress });
    const launchAttempt = token?.launchData?.launchAttempt || 0;
    
    // Check for specific errors that indicate the address is permanently unusable
    const shouldReleaseImmediately = error && (
      // Pump.fun Custom:0 error (NotAuthorized/AlreadyInitialized)
      error.message?.includes('{"InstructionError":[0,{"Custom":0}]}') ||
      error.message?.includes('Custom:0') ||
      // Token creation failed with bonding curve errors
      error.message?.includes('Token creation failed') ||
      // Unable to fetch curve data (indicates token might already exist)
      error.message?.includes('Unable to fetch curve data')
    );
    
    if (shouldReleaseImmediately) {
      logger.info(`Releasing pump address ${tokenAddress} immediately due to permanent error: ${error?.message || 'Unknown error'}`);
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
        error: `Insufficient balance for platform fee. Required: ${(totalRequired / LAMPORTS_PER_SOL).toFixed(6)} SOL, Available: ${(devBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`
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
      { commitment: "confirmed" }
    );

    logger.info(`Platform fee collected: ${feeAmountSol} SOL from ${devKeypair.publicKey.toBase58()} to ${platformFeeWallet.toBase58()}`);
    
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
  const walletFees = walletCount * 0.05; // ~0.05 SOL per wallet for transaction fees
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
  buyAmount: number,
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
            "launchData.buyAmount": buyAmount,
            "launchData.devBuy": devBuy,
            "launchData.launchStage": 1,
          },
          $inc: {
            "launchData.launchAttempt": 1,
          },
        },
        { new: true },
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
        },
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
  tokenAddress: string,
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
        { new: true },
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
        buyerWallets: updatedToken.launchData!.buyWallets.map((w) =>
          decryptPrivateKey(
            (w as unknown as { privateKey: string }).privateKey,
          ),
        ),
        devWallet: decryptPrivateKey(
          (
            updatedToken.launchData!.devWallet as unknown as {
              privateKey: string;
            }
          ).privateKey,
        ),
        devBuy: updatedToken.launchData!.devBuy,
        launchStage: updatedToken.launchData!.launchStage || 3, // Start from LAUNCH stage
      };
      await executeLaunchQueue.add(
        `execute-${tokenAddress}-${updatedToken.launchData?.launchAttempt}`,
        data,
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
        tokenAddress: tokenAddress
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
        userId: deletedToken.user
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
  transactionType: "token_creation" | "dev_buy" | "snipe_buy",
  signature: string,
  success: boolean,
  launchAttempt: number,
  options: {
    slippageUsed?: number;
    amountSol?: number;
    amountTokens?: string;
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
    slippageUsed: options.slippageUsed,
    amountSol: options.amountSol,
    amountTokens: options.amountTokens,
    errorMessage: options.errorMessage,
    retryAttempt: options.retryAttempt || 0,
  });
};

export const getSuccessfulTransactions = async (
  tokenAddress: string,
  transactionType: "token_creation" | "dev_buy" | "snipe_buy",
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
  return records.map(record => record.walletPublicKey);
};

export const getFailedTransactions = async (
  tokenAddress: string,
  transactionType: "token_creation" | "dev_buy" | "snipe_buy",
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
  transactionType: "token_creation" | "dev_buy" | "snipe_buy"
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
    successful: records.filter(r => r.success).length,
    failed: records.filter(r => !r.success).length,
    byType: {
      token_creation: records.filter(r => r.transactionType === "token_creation"),
      dev_buy: records.filter(r => r.transactionType === "dev_buy"),
      snipe_buy: records.filter(r => r.transactionType === "snipe_buy"),
    }
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
    success: true // Only count successful transactions
  };
  if (launchAttempt !== undefined) {
    query.launchAttempt = launchAttempt;
  }
  
  const records = await TransactionRecordModel.find(query).lean();
  
  // Calculate totals by transaction type
  const devBuyRecords = records.filter(r => r.transactionType === "dev_buy");
  const snipeBuyRecords = records.filter(r => r.transactionType === "snipe_buy");
  
  const totalDevSpent = devBuyRecords.reduce((sum, record) => {
    return sum + (record.amountSol || 0);
  }, 0);
  
  const totalSnipeSpent = snipeBuyRecords.reduce((sum, record) => {
    return sum + (record.amountSol || 0);
  }, 0);
  
  const totalSpent = totalDevSpent + totalSnipeSpent;
  
  // Calculate total tokens acquired
  const totalDevTokens = devBuyRecords.reduce((sum, record) => {
    return sum + BigInt(record.amountTokens || "0");
  }, BigInt(0));
  
  const totalSnipeTokens = snipeBuyRecords.reduce((sum, record) => {
    return sum + BigInt(record.amountTokens || "0");
  }, BigInt(0));
  
  const totalTokens = totalDevTokens + totalSnipeTokens;
  
  return {
    totalSpent: Number(totalSpent.toFixed(6)),
    totalDevSpent: Number(totalDevSpent.toFixed(6)),
    totalSnipeSpent: Number(totalSnipeSpent.toFixed(6)),
    totalTokens: totalTokens.toString(),
    totalDevTokens: totalDevTokens.toString(),
    totalSnipeTokens: totalSnipeTokens.toString(),
    successfulBuys: snipeBuyRecords.length,
    averageSpentPerWallet: snipeBuyRecords.length > 0 ? Number((totalSnipeSpent / snipeBuyRecords.length).toFixed(6)) : 0,
  };
};
