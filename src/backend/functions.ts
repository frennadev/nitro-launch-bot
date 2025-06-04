import mongoose from "mongoose";
import { connection } from "../blockchain/common/connection";
import {
  generateKeypairs,
  secretKeyToKeypair,
} from "../blockchain/common/utils";
import { env } from "../config";
import { TokenModel, UserModel, WalletModel, type User } from "./models";
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
} from "../jobs/queues";
import { logger } from "../blockchain/common/logger";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

export const getUser = async (telegramId: String) => {
  const user = await UserModel.findOne({
    telegramId,
  }).exec();
  return user;
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
    });
  }
  return wallet.publicKey;
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
  });
  const metadataUri = await createTokenMetadata(
    name,
    symbol,
    description,
    image,
  );
  if (!metadataUri) {
    throw new Error("Token metadata uri not uploaded");
  }
  const [tokenKey] = generateKeypairs(1);
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
    message += `\nFunder balance too low. Expected ${(expectedFunderBalance / LAMPORTS_PER_SOL).toFixed(2)} SOL, Gotten ${(funderBalance / LAMPORTS_PER_SOL).toFixed(2)} SOL`;
    success = false;
  }
  if (devBalance < expectedDevBalance) {
    message += `\nDev balance too low. Expected ${(expectedDevBalance / LAMPORTS_PER_SOL).toFixed(2)} SOL, Gotten ${(devBalance / LAMPORTS_PER_SOL).toFixed(2)} SOL`;
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
    await session.endSession();
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
        tokenAddress,
        tokenPrivateKey: decryptPrivateKey(updatedToken.tokenPrivateKey),
        userChatId: chatId,
        tokenName: updatedToken.name,
        tokenMetadataUri: updatedToken.tokenMetadataUrl,
        tokenSymbol: updatedToken.symbol,
        buyAmount: updatedToken.launchData!.buyAmount,
        buyerWallets: updatedToken.launchData!.buyWallets.map((w) =>
          decryptPrivateKey((w as { privateKey: string }).privateKey),
        ),
        devWallet: decryptPrivateKey(
          (updatedToken.launchData!.devWallet as { privateKey: string })
            .privateKey,
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
    await session.endSession();
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
          tokenAddress,
          userChatId: chatId,
          devWallet: decryptPrivateKey(devWallet),
          sellPercent,
        },
      );
    });
    return { success: true, message: "" };
  } catch (error: any) {
    logger.error("An error occurred during dev sell enque", error);
    await session.endSession();
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
      buyerWallets = buyerWallets.filter((w) => Boolean(w));
      const decrypted = buyerWallets.map((w) => decryptPrivateKey(w));
      await walletSellQueue.add(
        `wallet-sell-${tokenAddress}-${updatedToken.launchData?.walletSellAttempt}`,
        {
          tokenAddress,
          userChatId: chatId,
          devWallet: decryptPrivateKey(devWallet),
          buyerWallets: decrypted,
          sellPercent,
        },
      );
    });
    return { success: true, message: "" };
  } catch (error: any) {
    logger.error("An error occurred during wallet sell enque", error);
    await session.endSession();
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
) => {
  await TokenModel.findOneAndUpdate(
    {
      tokenAddress,
    },
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
