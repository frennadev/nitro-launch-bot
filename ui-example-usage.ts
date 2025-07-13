// Comprehensive UI Example Usage
// This file demonstrates how all UI components work together

import { 
  // Welcome message components
  generateWelcomeMessage,
  generateWelcomeKeyboard,
  WelcomeUserData,
  WelcomeCallbacks,
  
  // Token creation components
  generatePlatformSelectionMessage,
  generatePlatformSelectionKeyboard,
  generateTokenDetailsPrompt,
  generateTokenDetailsKeyboard,
  generateTokenConfirmationMessage,
  generateTokenConfirmationKeyboard,
  generateTokenProcessingMessage,
  generateTokenSuccessMessage,
  generateTokenSuccessKeyboard,
  TokenCreationCallbacks,
  
  // Wallet configuration components
  generateWalletConfigMessage,
  generateWalletConfigKeyboard,
  generateDevWalletManagementMessage,
  generateDevWalletManagementKeyboard,
  generateBuyerWalletManagementMessage,
  generateBuyerWalletManagementKeyboard,
  WalletConfigCallbacks,
  
  // Trading operations components
  generateExternalBuyPromptMessage,
  generateExternalBuyKeyboard,
  generateTokenBuyOptionsMessage,
  generateTokenBuyOptionsKeyboard,
  generateBuyConfirmationMessage,
  generateBuyConfirmationKeyboard,
  TradingCallbacks,
  
  // Referral system components
  generateReferralMainMessage,
  generateReferralMainKeyboard,
  generateReferralDetailsMessage,
  generateReferralDetailsKeyboard,
  generateShareReferralMessage,
  generateShareReferralKeyboard,
  ReferralCallbacks,
  
  // Utility functions
  formatSOL,
  formatUSD,
  shortenAddress,
  generateErrorMessage,
  generateSuccessMessage,
  
  // Mock data
  defaultMockData
} from './src/bot/ui';

// Example: Complete user flow demonstration
async function demonstrateCompleteUserFlow() {
  console.log("=== NITRO BOT UI DEMONSTRATION ===\n");
  
  // 1. WELCOME MESSAGE
  console.log("1. WELCOME MESSAGE");
  console.log("==================");
  
  const welcomeUserData: WelcomeUserData = {
    devWallet: defaultMockData.user.devWallet,
    referralCount: defaultMockData.user.referralCount
  };
  
  console.log(generateWelcomeMessage(welcomeUserData));
  console.log("Keyboard:", generateWelcomeKeyboard());
  console.log("\n");
  
  // 2. TOKEN CREATION FLOW
  console.log("2. TOKEN CREATION FLOW");
  console.log("======================");
  
  // Step 1: Platform Selection
  console.log("Step 1: Platform Selection");
  console.log(generatePlatformSelectionMessage());
  console.log("Keyboard:", generatePlatformSelectionKeyboard());
  console.log("\n");
  
  // Step 2: Token Details
  console.log("Step 2: Token Details");
  console.log(generateTokenDetailsPrompt());
  console.log("Keyboard:", generateTokenDetailsKeyboard());
  console.log("\n");
  
  // Step 3: Confirmation
  console.log("Step 3: Confirmation");
  const tokenDetails = {
    name: "My Awesome Token",
    symbol: "MAT",
    description: "A revolutionary token for the future"
  };
  console.log(generateTokenConfirmationMessage("pumpfun", tokenDetails));
  console.log("Keyboard:", generateTokenConfirmationKeyboard());
  console.log("\n");
  
  // Step 4: Processing
  console.log("Step 4: Processing");
  console.log(generateTokenProcessingMessage());
  console.log("\n");
  
  // Step 5: Success
  console.log("Step 5: Success");
  const tokenAddress = "3oZ8DxXxDnxJ63Fc8DGja8xQnG1fgLshtKyLn9nkpUMP";
  console.log(generateTokenSuccessMessage(tokenAddress));
  console.log("Keyboard:", generateTokenSuccessKeyboard(tokenAddress));
  console.log("\n");
  
  // 3. WALLET CONFIGURATION
  console.log("3. WALLET CONFIGURATION");
  console.log("=======================");
  
  console.log("Main Wallet Config:");
  console.log(generateWalletConfigMessage());
  console.log("Keyboard:", generateWalletConfigKeyboard());
  console.log("\n");
  
  console.log("Dev Wallet Management:");
  console.log(generateDevWalletManagementMessage());
  console.log("Keyboard:", generateDevWalletManagementKeyboard());
  console.log("\n");
  
  console.log("Buyer Wallet Management:");
  console.log(generateBuyerWalletManagementMessage());
  console.log("Keyboard:", generateBuyerWalletManagementKeyboard());
  console.log("\n");
  
  // 4. TRADING OPERATIONS
  console.log("4. TRADING OPERATIONS");
  console.log("=====================");
  
  console.log("External Buy Prompt:");
  console.log(generateExternalBuyPromptMessage());
  console.log("Keyboard:", generateExternalBuyKeyboard());
  console.log("\n");
  
  console.log("Token Buy Options:");
  console.log(generateTokenBuyOptionsMessage(tokenAddress));
  console.log("Keyboard:", generateTokenBuyOptionsKeyboard(tokenAddress));
  console.log("\n");
  
  console.log("Buy Confirmation:");
  console.log(generateBuyConfirmationMessage(2.5, tokenAddress));
  console.log("Keyboard:", generateBuyConfirmationKeyboard(tokenAddress));
  console.log("\n");
  
  // 5. REFERRAL SYSTEM
  console.log("5. REFERRAL SYSTEM");
  console.log("==================");
  
  console.log("Main Referral Screen:");
  console.log(generateReferralMainMessage());
  console.log("Keyboard:", generateReferralMainKeyboard());
  console.log("\n");
  
  console.log("Referral Details:");
  console.log(generateReferralDetailsMessage());
  console.log("Keyboard:", generateReferralDetailsKeyboard());
  console.log("\n");
  
  console.log("Share Referral:");
  console.log(generateShareReferralMessage());
  console.log("Keyboard:", generateShareReferralKeyboard());
  console.log("\n");
  
  // 6. UTILITY FUNCTIONS
  console.log("6. UTILITY FUNCTIONS");
  console.log("====================");
  
  console.log("Format SOL:", formatSOL(2.456789));
  console.log("Format USD:", formatUSD(1234.56));
  console.log("Shorten Address:", shortenAddress("H497XdK28Tn5gvL859qmvLtm4qU9GLtgtnzAXiypcTWF"));
  console.log("Error Message:", generateErrorMessage("Transaction failed", "Insufficient balance"));
  console.log("Success Message:", generateSuccessMessage("Token Created", "Your token has been successfully created", [
    "Launch your token",
    "Add liquidity",
    "Share with community"
  ]));
  console.log("\n");
  
  console.log("=== DEMONSTRATION COMPLETE ===");
}

// Example: Handle callback queries
async function handleCallbackQueryExample(callbackData: string) {
  console.log(`Handling callback: ${callbackData}`);
  
  switch (callbackData) {
    case WelcomeCallbacks.CREATE_TOKEN:
      console.log("User wants to create a token");
      console.log(generatePlatformSelectionMessage());
      break;
      
    case WelcomeCallbacks.WALLET_CONFIG:
      console.log("User wants to configure wallets");
      console.log(generateWalletConfigMessage());
      break;
      
    case WelcomeCallbacks.VIEW_REFERRALS:
      console.log("User wants to view referrals");
      console.log(generateReferralMainMessage());
      break;
      
    case TokenCreationCallbacks.PUMPFUN:
      console.log("User selected PumpFun platform");
      console.log(generateTokenDetailsPrompt());
      break;
      
    case TokenCreationCallbacks.LETSBONK:
      console.log("User selected LetsBonk platform");
      console.log(generateTokenDetailsPrompt());
      break;
      
    case WalletConfigCallbacks.CHANGE_DEV_WALLET:
      console.log("User wants to change dev wallet");
      console.log(generateDevWalletManagementMessage());
      break;
      
    case WalletConfigCallbacks.MANAGE_BUYER_WALLETS:
      console.log("User wants to manage buyer wallets");
      console.log(generateBuyerWalletManagementMessage());
      break;
      
    case TradingCallbacks.BUY_EXTERNAL_TOKEN:
      console.log("User wants to buy external token");
      console.log(generateExternalBuyPromptMessage());
      break;
      
    case ReferralCallbacks.SHARE_REFERRAL:
      console.log("User wants to share referral link");
      console.log(generateShareReferralMessage());
      break;
      
    default:
      console.log("Unknown callback:", callbackData);
  }
}

// Example: Simulate user interaction flow
async function simulateUserFlow() {
  console.log("=== SIMULATING USER FLOW ===\n");
  
  // User starts the bot
  console.log("1. User starts bot (/start)");
  const welcomeUserData: WelcomeUserData = {
    devWallet: defaultMockData.user.devWallet,
    referralCount: defaultMockData.user.referralCount
  };
  console.log(generateWelcomeMessage(welcomeUserData));
  console.log("\n");
  
  // User clicks "Create Token"
  console.log("2. User clicks 'Create Token'");
  await handleCallbackQueryExample(WelcomeCallbacks.CREATE_TOKEN);
  console.log("\n");
  
  // User selects PumpFun
  console.log("3. User selects PumpFun platform");
  await handleCallbackQueryExample(TokenCreationCallbacks.PUMPFUN);
  console.log("\n");
  
  // User confirms token details
  console.log("4. User confirms token details");
  const tokenDetails = {
    name: "My Awesome Token",
    symbol: "MAT",
    description: "A revolutionary token for the future"
  };
  console.log(generateTokenConfirmationMessage("pumpfun", tokenDetails));
  console.log("\n");
  
  // Token creation success
  console.log("5. Token creation successful");
  const tokenAddress = "3oZ8DxXxDnxJ63Fc8DGja8xQnG1fgLshtKyLn9nkpUMP";
  console.log(generateTokenSuccessMessage(tokenAddress));
  console.log("\n");
  
  console.log("=== USER FLOW SIMULATION COMPLETE ===");
}

// Export functions for use in actual bot implementation
export {
  demonstrateCompleteUserFlow,
  handleCallbackQueryExample,
  simulateUserFlow
};

// Run demonstration if this file is executed directly
if (require.main === module) {
  demonstrateCompleteUserFlow()
    .then(() => {
      console.log("\n\nRunning user flow simulation...\n");
      return simulateUserFlow();
    })
    .catch(console.error);
} 