export type LaunchTokenJob = {
  userChatId: number;
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  tokenMetadataUri: string;
  funderWallet: string;
  devWallet: string;
  buyAmount: number;
  devBuy: number;
  buyerWallets: string[];
};
