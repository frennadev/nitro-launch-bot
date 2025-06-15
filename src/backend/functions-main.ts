// Main functions file - uses optimized versions by default
// Original functions available as backup with _original suffix

// Import all original functions
import * as originalFunctions from "./functions";

// Import optimized functions
import {
  getWalletBalance as getWalletBalanceOptimized,
  getBatchWalletBalances,
  preLaunchChecksOptimized,
  collectPlatformFeeOptimized,
  collectTransactionFeeOptimized,
  collectBatchTransactionFees,
  calculateTotalLaunchCostOptimized,
  getConnectionPoolStats,
  clearConnectionCache
} from "./functions-optimized";

// Export optimized versions as main functions with compatibility wrappers
export const getWalletBalance = getWalletBalanceOptimized;

// Compatibility wrapper for preLaunchChecks to maintain original API
export const preLaunchChecks = async (
  funderWallet: string,
  devWallet: string,
  buyAmount: number,
  devBuy: number,
  walletCount: number,
) => {
  const result = await preLaunchChecksOptimized(funderWallet, devWallet, buyAmount, devBuy, walletCount);
  
  if (result.success) {
    return { success: true, message: "PreLaunch Checks: ✅ All checks passed" };
  } else {
    // Format error message similar to original
    let message = "PreLaunch Checks:";
    if (result.error) {
      message += `\n❌ ${result.error}`;
    } else if ('funderBalance' in result && 'totalRequired' in result && 
               typeof result.funderBalance === 'number' && typeof result.totalRequired === 'number') {
      if (result.funderBalance < result.totalRequired) {
        message += `\n❌ <b>Funder wallet balance too low</b>
💰 <b>Required:</b> ${result.totalRequired.toFixed(4)} SOL
💳 <b>Available:</b> ${result.funderBalance.toFixed(4)} SOL`;
      }
    }
    return { success: false, message };
  }
};

export const collectPlatformFee = collectPlatformFeeOptimized;
export const collectTransactionFee = collectTransactionFeeOptimized;
export const calculateTotalLaunchCost = calculateTotalLaunchCostOptimized;

// Export new batch functions
export { getBatchWalletBalances, collectBatchTransactionFees, getConnectionPoolStats, clearConnectionCache };

// Export original functions as backup
export const getWalletBalance_original = originalFunctions.getWalletBalance;
export const preLaunchChecks_original = originalFunctions.preLaunchChecks;
export const collectPlatformFee_original = originalFunctions.collectPlatformFee;
export const calculateTotalLaunchCost_original = originalFunctions.calculateTotalLaunchCost;

// Re-export all other functions unchanged
export const getUser = originalFunctions.getUser;
export const getDevWallet = originalFunctions.getDevWallet;
export const getTokensForUser = originalFunctions.getTokensForUser;
export const getUserToken = originalFunctions.getUserToken;
export const getUserTokenWithBuyWallets = originalFunctions.getUserTokenWithBuyWallets;
export const createUser = originalFunctions.createUser;
export const getOrCreateDevWallet = originalFunctions.getOrCreateDevWallet;
export const getAllDevWallets = originalFunctions.getAllDevWallets;
export const getDefaultDevWallet = originalFunctions.getDefaultDevWallet;
export const addDevWallet = originalFunctions.addDevWallet;
export const setDefaultDevWallet = originalFunctions.setDefaultDevWallet;
export const deleteDevWallet = originalFunctions.deleteDevWallet;
export const generateNewDevWallet = originalFunctions.generateNewDevWallet;
export const addWallet = originalFunctions.addWallet;
export const generateWallets = originalFunctions.generateWallets;
export const getAvailablePumpAddress = originalFunctions.getAvailablePumpAddress;
export const releasePumpAddress = originalFunctions.releasePumpAddress;
export const markPumpAddressAsUsed = originalFunctions.markPumpAddressAsUsed;
export const getPumpAddressStats = originalFunctions.getPumpAddressStats;
export const getUserPumpAddresses = originalFunctions.getUserPumpAddresses;
export const createToken = originalFunctions.createToken;
export const enqueueTokenLaunch = originalFunctions.enqueueTokenLaunch;
export const enqueuePrepareTokenLaunch = originalFunctions.enqueuePrepareTokenLaunch;
export const enqueueExecuteTokenLaunch = originalFunctions.enqueueExecuteTokenLaunch;
export const enqueueTokenLaunchRetry = originalFunctions.enqueueTokenLaunchRetry;
export const enqueueDevSell = originalFunctions.enqueueDevSell;
export const enqueueWalletSell = originalFunctions.enqueueWalletSell;
export const updateTokenState = originalFunctions.updateTokenState;
export const updateLaunchStage = originalFunctions.updateLaunchStage;
export const updateBuyDistribution = originalFunctions.updateBuyDistribution;
export const acquireDevSellLock = originalFunctions.acquireDevSellLock;
export const releaseDevSellLock = originalFunctions.releaseDevSellLock;
export const acquireWalletSellLock = originalFunctions.acquireWalletSellLock;
export const releaseWalletSellLock = originalFunctions.releaseWalletSellLock;
export const getOrCreateFundingWallet = originalFunctions.getOrCreateFundingWallet;
export const getFundingWallet = originalFunctions.getFundingWallet;
export const generateNewFundingWallet = originalFunctions.generateNewFundingWallet;
export const getAllBuyerWallets = originalFunctions.getAllBuyerWallets;
export const addBuyerWallet = originalFunctions.addBuyerWallet;
export const generateNewBuyerWallet = originalFunctions.generateNewBuyerWallet;
export const deleteBuyerWallet = originalFunctions.deleteBuyerWallet;
export const getBuyerWalletPrivateKey = originalFunctions.getBuyerWalletPrivateKey;
export const deleteToken = originalFunctions.deleteToken;
export const handleTokenLaunchFailure = originalFunctions.handleTokenLaunchFailure;
export const saveRetryData = originalFunctions.saveRetryData;
export const getRetryData = originalFunctions.getRetryData;
export const clearRetryData = originalFunctions.clearRetryData;
export const clearAllRetryData = originalFunctions.clearAllRetryData;

// ========== TRANSACTION RECORDING FUNCTIONS ==========
export const recordTransaction = originalFunctions.recordTransaction;
export const getSuccessfulTransactions = originalFunctions.getSuccessfulTransactions;
export const getFailedTransactions = originalFunctions.getFailedTransactions;
export const isTransactionAlreadySuccessful = originalFunctions.isTransactionAlreadySuccessful;
export const getTransactionStats = originalFunctions.getTransactionStats;
export const getTransactionFinancialStats = originalFunctions.getTransactionFinancialStats; 