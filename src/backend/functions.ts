import { connection } from "../blockchain/common/connection";
import { generateKeypairs, secretKeyToKeypair } from "../blockchain/common/utils";
import { env } from "../config";
import { TokenModel, UserModel, WalletModel, type User } from "./models";
import {
    decryptPrivateKey,
  encryptPrivateKey,
  uploadFileToPinata,
  uploadJsonToPinata,
} from "./utils";

export const getUser = async (telegramId: String) => {
  const user = await UserModel.findOne({
    telegramId,
  }).exec();
  return user;
};

export const getTokensForUser = async (userId: string) => {
    const result = await TokenModel.find({
        user: userId
    }).lean()
    return result.map(token => ({
        id: String(token._id),
        address: token.tokenAddress,
        name: token.name,
        symbol: token.symbol,
        description: token.description
    }))
}

export const getUserToken = async (userId: string, tokenAddress: string) => {
    const token = await TokenModel.findOne({
        user: userId,
        tokenAddress
    }).exec()
    return token
}

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
    console.error(`Error Occurred While uploading metadata: ${error.message}`);
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

export const preLaunchChecks = async (tokenAddress: string, funderWallet: string, buyAmount: number, devBuy: number, walletCount: number) => {
    const token = await TokenModel.findOne({
        tokenAddress
    }).populate(["launchData.devWallet"]).lean()
    let success = true
    const funderKeypair = secretKeyToKeypair(funderWallet)
    // @ts-ignore
    const devKeypair = secretKeyToKeypair(decryptPrivateKey(token!.launchData!.devWallet!.privateKey))

    // expectations
    const expectedFunderBalance = buyAmount + (walletCount * 0.05)
    const expectedDevBalance = 0.5 + (devBuy * 0.05)

    // balances
    const funderBalance = await connection.getBalance(funderKeypair.publicKey)
    const devBalance = await connection.getBalance(devKeypair.publicKey)

    let message = "PreLaunch Checks:"
    if (funderBalance < expectedFunderBalance) {
        message += `\nFunder balance too low. Expected ${expectedFunderBalance} SOL, Gotten ${funderBalance} SOL`
        success = false
    }
    if (devBalance < expectedDevBalance) {
        message += `\nDev balance too low. Expected ${expectedDevBalance} SOL, Gotten ${devBalance} SOL`
        success = false
    }
    return { success, message }
}

export const launchToken = async () => {};
