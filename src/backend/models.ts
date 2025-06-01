import { Schema, model, type InferSchemaType, Types } from "mongoose";
import { LaunchDestination, TokenState } from "./types";

// ---------- DB SCHEMAS -------------
const userSchema = new Schema(
  {
    telegramId: { type: String, required: true, unique: true },
    userName: { type: String, required: true },
    firstName: { type: String },
    lastName: { type: String },
  },
  { timestamps: true },
);
const walletSchema = new Schema(
  {
    user: { type: Types.ObjectId, ref: "User", required: true },
    publicKey: { type: String, required: true },
    privateKey: { type: String, required: true, select: false },
    isDev: { type: String, required: true, default: false },
  },
  { timestamps: true },
);
const tokenSchema = new Schema(
  {
    user: { type: Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    symbol: { type: String, required: true },
    description: { type: String },
    tokenMetadataUrl: { type: String, required: true },
    tokenAddress: { type: String, required: true },
    tokenPrivateKey: { type: String, required: true },
    launchData: {
      funderPrivateKey: { type: String, default: null },
      devWallet: { type: Types.ObjectId, ref: "Wallet" },
      buyWallets: [{ type: Types.ObjectId, ref: "Wallet" }],
      buyAmount: { type: Number, default: 0 },
      devBuy: { type: Number, default: 0 },
      destination: {
        type: String,
        enum: Object.values(LaunchDestination),
        default: LaunchDestination.PUMPFUN,
      },
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
