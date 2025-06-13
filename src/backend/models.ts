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
const pumpAddressSchema = new Schema(
  {
    publicKey: { type: String, required: true, unique: true },
    secretKey: { type: String, required: true },
    rawSecretKey: [{ type: Number }],
    suffix: { type: String, required: true },
    workerId: { type: Number },
    attempts: { type: Number },
    isUsed: { type: Boolean, default: false },
    usedBy: { type: Schema.ObjectId, ref: "User" },
    usedAt: { type: Date },
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

const retryDataSchema = new Schema(
  {
    user: { type: Schema.ObjectId, ref: "User", required: true },
    telegramId: { type: String, required: true },
    conversationType: { type: String, enum: ["launch_token", "quick_launch"], required: true },
    
    // Launch Token retry data
    tokenAddress: { type: String }, // For launch token retries
    buyAmount: { type: Number },
    devBuy: { type: Number },
    
    // Quick Launch retry data
    name: { type: String },
    symbol: { type: String },
    description: { type: String },
    imageData: { type: Buffer }, // Store image as binary data
    totalBuyAmount: { type: Number },
    walletsNeeded: { type: Number },
    
    // Expiry for cleanup
    expiresAt: { type: Date, default: Date.now, expires: 3600 }, // Expires after 1 hour
  },
  { timestamps: true },
);

// ----------- DB MODELS & TYPES ------------
export type User = InferSchemaType<typeof userSchema>;
export const UserModel = model<User>("User", userSchema);
export type Wallet = InferSchemaType<typeof walletSchema>;
export const WalletModel = model<Wallet>("Wallet", walletSchema);
export type PumpAddress = InferSchemaType<typeof pumpAddressSchema>;
export const PumpAddressModel = model<PumpAddress>("PumpAddress", pumpAddressSchema, "pump_addresses");
export type Token = InferSchemaType<typeof tokenSchema>;
export const TokenModel = model<Token>("Token", tokenSchema);
export type RetryData = InferSchemaType<typeof retryDataSchema>;
export const RetryDataModel = model<RetryData>("RetryData", retryDataSchema);
