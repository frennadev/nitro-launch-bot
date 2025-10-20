export type LaunchTokenJob = {
  userId: string;
  userChatId: number;
  tokenAddress: string;
  tokenPrivateKey: string;
  tokenName: string;
  tokenSymbol: string;
  tokenMetadataUri: string;
  funderWallet: string;
  devWallet: string;
  buyAmount: number;
  devBuy: number;
  buyerWallets: string[];
  buyDistribution: number[];
  launchStage: number;
  mode: "normal" | "prefunded";
};

export type PrepareTokenLaunchJob = {
  userId: string;
  userChatId: number;
  tokenAddress: string;
  tokenPrivateKey: string;
  tokenName: string;
  tokenSymbol: string;
  tokenMetadataUri: string;
  funderWallet: string;
  devWallet: string;
  buyAmount: number;
  devBuy: number;
  buyerWallets: string[];
  mode: "normal" | "prefunded";
};

export type ExecuteTokenLaunchJob = {
  userId: string;
  userChatId: number;
  tokenAddress: string;
  tokenPrivateKey: string;
  tokenName: string;
  tokenSymbol: string;
  tokenMetadataUri: string;
  devWallet: string;
  buyAmount: number;
  devBuy: number;
  buyerWallets: string[];
  launchStage: number;
  mode: "normal" | "prefunded";
  socketUserId?: string;
};

export type SellDevJob = {
  userId: string;
  userChatId: number;
  tokenAddress: string;
  devWallet: string;
  sellPercent: number;
};

export type SellWalletJob = {
  userId: string;
  userChatId: number;
  tokenAddress: string;
  devWallet: string;
  sellPercent: number;
  buyerWallets: string[];
};

export type CreateTokenMetadataJob = {
  name: string;
  symbol: string;
  description: string;
  imageUrl: string;
  userId: string;
  userWalletAddress: string;
  platform: "pump" | "bonk";
  socials: {
    website?: string;
    twitter?: string;
    telegram?: string;
  };
  socketUserId?: string;
};

export type LaunchDappTokenJob = {
  userId: string;
  userChatId: number;
  tokenId: string;
  tokenName: string;
  tokenSymbol: string;
  devBuy: number;
  buyAmount: number;
  platform: "pump" | "bonk";
  launchMode: "normal" | "prefunded";
  socketUserId?: string;
};

export type CTOJob = {
  userId: string;
  userChatId: number;
  tokenAddress: string;
  buyAmount: number;
  mode: "standard" | "prefunded";
  platform: string;
  socketUserId?: string;
};

export type ExternalBuyJob = {
  userId: string;
  userChatId: number;
  tokenAddress: string;
  buyAmount: number;
  walletPrivateKey: string;
  slippage?: number;
  priorityFee?: number;
  platform?: string;
  socketUserId?: string;
};

export type PremixFundsJob = {
  userId: string;
  userChatId: number;
  mixAmount: number; // Amount to mix from funding wallet (in SOL)
  maxWallets?: number; // Maximum number of buyer wallets to use (default: use smart calculation)
  mode?: "standard" | "fast"; // Mixing mode (default: standard)
  socketUserId?: string;
};
