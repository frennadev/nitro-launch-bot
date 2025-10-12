/**
 * Environment Configuration Template
 * Copy this to your .env file and update with your actual values
 */

export const environmentTemplate = {
  // ===============================================
  // RPC ENDPOINTS
  // ===============================================
  HELIUS_API_KEY: "your_helius_api_key",
  HELIUS_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=your_helius_api_key",
  UTILS_HELIUS_RPC: "https://mainnet.helius-rpc.com/?api-key=your_helius_api_key",
  SOLANA_RPC_URL: "https://api.mainnet-beta.solana.com",

  // ===============================================
  // API SERVICES
  // ===============================================
  SOLANA_TRACKER_API_KEY: "your_solanatracker_api_key",
  SOLANA_TRACKER_BASE_URL: "https://api.solanatracker.io",
  BIRDEYE_API_KEY: "your_birdeye_api_key", // Legacy

  // ===============================================
  // PROGRAM IDs (Updated December 2024)
  // ===============================================
  PUMPFUN_PROGRAM_ID: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  LAUNCHLAB_PROGRAM_ID: "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
  METEORA_PROGRAM_ID: "24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi",
  
  // ===============================================
  // TRADING CONFIGURATION
  // ===============================================
  DEFAULT_BUY_SLIPPAGE: "5",
  DEFAULT_SELL_SLIPPAGE: "5",
  MAX_SLIPPAGE: "50",
  DEFAULT_PRIORITY_FEE: "100000",
  MAX_TRANSACTION_RETRIES: "3",

  // ===============================================
  // CACHE CONFIGURATION
  // ===============================================
  POOL_CACHE_TTL_DEFAULT: "30",
  TOKEN_CACHE_TTL_DEFAULT: "30",
  TOKEN_CACHE_TTL_POPULAR: "60",
  TOKEN_CACHE_TTL_NEW: "15",
};

// Example .env file content:
export const envFileTemplate = `
# Nitro Launch Bot - Environment Configuration

# RPC ENDPOINTS
HELIUS_API_KEY=your_helius_api_key
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your_helius_api_key
UTILS_HELIUS_RPC=https://mainnet.helius-rpc.com/?api-key=your_helius_api_key
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# API SERVICES
SOLANA_TRACKER_API_KEY=your_solanatracker_api_key
SOLANA_TRACKER_BASE_URL=https://api.solanatracker.io

# PROGRAM IDs
PUMPFUN_PROGRAM_ID=6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
LAUNCHLAB_PROGRAM_ID=LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj

# TRADING SETTINGS
DEFAULT_BUY_SLIPPAGE=5
DEFAULT_SELL_SLIPPAGE=5
DEFAULT_PRIORITY_FEE=100000
MAX_TRANSACTION_RETRIES=3

# CACHE SETTINGS
POOL_CACHE_TTL_DEFAULT=30
TOKEN_CACHE_TTL_DEFAULT=30
TOKEN_CACHE_TTL_POPULAR=60
TOKEN_CACHE_TTL_NEW=15
`;