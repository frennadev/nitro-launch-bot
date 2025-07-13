// UI Components Index
// Export all UI components for easy importing

// Welcome message components
export * from './welcome-message';

// Token creation components
export * from './token-creation';

// Wallet configuration components
export * from './wallet-config';

// Trading operations components
export * from './trading-operations';

// Referral system components
export * from './referrals';

// Utility functions
export * from './utils';

// Common types and interfaces
export interface UIComponent {
  generateMessage: (...args: any[]) => string;
  generateKeyboard: (...args: any[]) => any;
}

// Common callback query types
export enum CommonCallbacks {
  BACK = "back",
  CANCEL = "cancel",
  CONFIRM = "confirm",
  RETRY = "retry",
  REFRESH = "refresh",
  HELP = "help",
  MENU = "menu",
}

// Mock data types
export interface MockUserData {
  id: string;
  username: string;
  devWallet: string;
  referralCount: number;
  totalTokens: number;
  totalValue: number;
}

export interface MockTokenData {
  address: string;
  name: string;
  symbol: string;
  price: number;
  marketCap: number;
  volume24h: number;
  liquidity: number;
  status: 'created' | 'launched' | 'failed';
}

export interface MockWalletData {
  address: string;
  balance: number;
  type: 'dev' | 'funding' | 'buyer';
  isDefault?: boolean;
}

// UI State management
export interface UIState {
  currentScreen: string;
  userData: MockUserData;
  tokens: MockTokenData[];
  wallets: MockWalletData[];
  referralData: any;
}

// Default mock data
export const defaultMockData = {
  user: {
    id: "123456789",
    username: "@nitro_user",
    devWallet: "H497XdK28Tn5gvL859qmvLtm4qU9GLtgtnzAXiypcTWF",
    referralCount: 7,
    totalTokens: 3,
    totalValue: 1234.56
  },
  tokens: [
    {
      address: "3oZ8DxXxDnxJ63Fc8DGja8xQnG1fgLshtKyLn9nkpUMP",
      name: "My Awesome Token",
      symbol: "MAT",
      price: 0.00012345,
      marketCap: 1234567,
      volume24h: 45678,
      liquidity: 23456,
      status: 'launched' as const
    },
    {
      address: "4oZ8DxXxDnxJ63Fc8DGja8xQnG1fgLshtKyLn9nkpUMP",
      name: "Test Token",
      symbol: "TEST",
      price: 0.00098765,
      marketCap: 9876543,
      volume24h: 12345,
      liquidity: 54321,
      status: 'created' as const
    }
  ],
  wallets: [
    {
      address: "H497XdK28Tn5gvL859qmvLtm4qU9GLtgtnzAXiypcTWF",
      balance: 2.4567,
      type: 'dev' as const,
      isDefault: true
    },
    {
      address: "8xK8DxXxDnxJ63Fc8DGja8xQnG1fgLshtKyLn9nkpUMP",
      balance: 1.2345,
      type: 'funding' as const
    },
    {
      address: "7xK8DxXxDnxJ63Fc8DGja8xQnG1fgLshtKyLn9nkpUMP",
      balance: 0.5,
      type: 'buyer' as const
    }
  ]
}; 