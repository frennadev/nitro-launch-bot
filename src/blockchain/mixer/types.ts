import { Keypair, PublicKey } from '@solana/web3.js';

export interface MixerConfig {
  /** Number of intermediate wallets to route through */
  intermediateWalletCount: number;
  /** Minimum delay between transactions (ms) */
  minDelay: number;
  /** Maximum delay between transactions (ms) */
  maxDelay: number;
  /** Whether to use fresh intermediate wallets or reuse existing ones */
  useFreshWallets: boolean;
  /** Solana RPC endpoint */
  rpcEndpoint: string;
  /** Priority fee in lamports */
  priorityFee?: number;
  /** Separate wallet to fund intermediate wallet transaction fees */
  feeFundingWallet?: Keypair;
}

export interface WalletInfo {
  keypair: Keypair;
  publicKey: PublicKey;
  balance?: number;
}

export interface MixingRoute {
  /** Source wallet */
  source: WalletInfo;
  /** Intermediate wallets in order */
  intermediates: WalletInfo[];
  /** Final destination wallet */
  destination: PublicKey;
  /** Amount to transfer (in lamports) */
  amount: number;
}

export interface MixingResult {
  success: boolean;
  transactionSignatures: string[];
  error?: string;
  route: MixingRoute;
  feeFundingSignatures?: string[]; // Signatures for fee funding transactions
}

export interface MixerState {
  /** Pool of intermediate wallets that can be reused */
  intermediateWalletPool: WalletInfo[];
  /** Transaction history for analysis */
  transactionHistory: {
    signature: string;
    from: string;
    to: string;
    amount: number;
    timestamp: number;
    type: 'transfer' | 'fee_funding';
  }[];
} 