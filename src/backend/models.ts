import { Schema, model, type InferSchemaType } from "mongoose";
import { LaunchDestination, TokenState } from "./types";

// ---------- DB SCHEMAS -------------
const userSchema = new Schema(
  {
    telegramId: { type: String, required: true, unique: true },
    userName: { type: String, required: true },
    firstName: { type: String },
    lastName: { type: String },
    fundingWallet: { type: Schema.ObjectId, ref: "Wallet" },
  },
  { timestamps: true },
);
const walletSchema = new Schema(
  {
    user: { type: Schema.ObjectId, ref: "User", required: true },
    publicKey: { type: String, required: true },
    privateKey: { type: String, required: true },
    isDev: { type: Boolean, required: true, default: false },
    isBuyer: { type: Boolean, required: true, default: false },
    isFunding: { type: Boolean, required: true, default: false },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);
const tokenSchema = new Schema(
  {
    user: { type: Schema.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    symbol: { type: String, required: true },
    description: { type: String },
    tokenMetadataUrl: { type: String, required: true },
    tokenAddress: { type: String, required: true },
    tokenPrivateKey: { type: String, required: true },
    launchData: {
      // Job Attempts
      launchAttempt: { type: Number, default: 0 },
      devSellAttempt: { type: Number, default: 0 },
      walletSellAttempt: { type: Number, default: 0 },
      // Launch
      launchStage: { type: Number, default: 1 },
      funderPrivateKey: { type: String, default: null },
      devWallet: { type: Schema.ObjectId, ref: "Wallet" },
      buyWallets: [{ type: Schema.ObjectId, ref: "Wallet" }],
      buyAmount: { type: Number, default: 0 },
      devBuy: { type: Number, default: 0 },
      buyDistribution: [{ type: Number }],
      destination: {
        type: String,
        enum: Object.values(LaunchDestination),
        default: LaunchDestination.PUMPFUN,
      },
      // Locks
      lockDevSell: { type: Boolean, default: false },
      lockWalletSell: { type: Boolean, default: false },
    },
    state: {
      type: String,
      enum: Object.values(TokenState),
      default: TokenState.LISTED,
    },
  },
  { timestamps: true },
);

// ----------- DB MODELS & TYPES ------------
export type User = InferSchemaType<typeof userSchema>;
export const UserModel = model<User>("User", userSchema);
export type Wallet = InferSchemaType<typeof walletSchema>;
export const WalletModel = model<Wallet>("Wallet", walletSchema);
export type Token = InferSchemaType<typeof tokenSchema>;
export const TokenModel = model<Token>("Token", tokenSchema);
