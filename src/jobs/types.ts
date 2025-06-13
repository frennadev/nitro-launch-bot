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
