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
};
