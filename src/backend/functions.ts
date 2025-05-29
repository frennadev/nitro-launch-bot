import { generateKeypairs } from "../blockchain/common/utils";
import { UserModel, WalletModel, type User } from "./models";
import { encryptPrivateKey } from "./utils";

export const getUser = async (telegramId: String) => {
  const user = await UserModel.findOne({
    telegramId,
  }).exec();
  return user;
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

// is dev, wallet key
export const addWallet = async (publickKey: string, secretKey: string) => {};

// count
// user
export const generateWallets = async () => {};

// enter the token name
// symbol
// upload the image
export const createToken = async () => {
  // set up uri
  // upload the image to ipfs
  // save the uri
};

// enter the name
export const launchToken = async () => {};
