export type LaunchTokenJob = {
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
  userChatId: number;
  tokenAddress: string;
  devWallet: string;
  sellPercent: number;
};

export type SellWalletJob = {
  userChatId: number;
  tokenAddress: string;
  devWallet: string;
  sellPercent: number;
  buyerWallets: string[];
};
