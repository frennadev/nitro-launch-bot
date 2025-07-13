import { InlineKeyboard } from "grammy";

// Callback queries for trading operations
export enum TradingCallbacks {
  BUY_EXTERNAL_TOKEN = "buy_external_token",
  SELL_EXTERNAL_TOKEN = "sell_external_token",
  BUY_CUSTOM_AMOUNT = "buy_custom_amount",
  SELL_CUSTOM_PERCENT = "sell_custom_percent",
  CONFIRM_BUY = "confirm_buy",
  CONFIRM_SELL = "confirm_sell",
  CANCEL_TRADE = "cancel_trade",
  BACK = "back",
}

// Mock trading data
export const mockTradingData = {
  tokenInfo: {
    address: "3oZ8DxXxDnxJ63Fc8DGja8xQnG1fgLshtKyLn9nkpUMP",
    name: "Sample Token",
    symbol: "SMPL",
    price: 0.00012345,
    marketCap: 1234567,
    volume24h: 45678,
    liquidity: 23456
  },
  userBalances: {
    fundingWallet: 5.6789,
    tokenBalance: 1000000,
    tokenValue: 123.45
  },
  presetAmounts: [0.5, 1, 3, 5, 10],
  presetPercentages: [10, 25, 50, 75, 100]
};

// External token buy screen
export function generateExternalBuyPromptMessage(): string {
  return `💰 **Buy External Token**

Please enter the token address you wish to buy:

**Example:** \`3oZ8DxXxDnxJ63Fc8DGja8xQnG1fgLshtKyLn9nkpUMP\`

**Available Balance:** ${mockTradingData.userBalances.fundingWallet.toFixed(4)} SOL

Enter the token address:`;
}

export function generateExternalBuyKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("❌ Cancel", TradingCallbacks.CANCEL_TRADE);
}

// Token buy options screen
export function generateTokenBuyOptionsMessage(tokenAddress: string): string {
  const { tokenInfo, userBalances } = mockTradingData;
  
  return `💰 **Buy Token Options**

**Token:** ${tokenInfo.name} (${tokenInfo.symbol})
**Address:** \`${tokenAddress}\`
**Current Price:** $${tokenInfo.price.toFixed(8)}
**Market Cap:** $${tokenInfo.marketCap.toLocaleString()}

**Your Balance:** ${userBalances.fundingWallet.toFixed(4)} SOL

Select an amount to buy:`;
}

export function generateTokenBuyOptionsKeyboard(tokenAddress: string): InlineKeyboard {
  const { presetAmounts } = mockTradingData;
  
  const keyboard = new InlineKeyboard();
  
  // First row: Back and Refresh
  keyboard.text("← Back", `back-_${tokenAddress}`)
    .text("↻ Refresh", `refresh_buy_${tokenAddress}`)
    .row();
  
  // Second row: 0.5, 1, 3 SOL
  keyboard.text("0.5 SOL", `buy_0.5_${tokenAddress}`)
    .text("1 SOL", `buy_1_${tokenAddress}`)
    .text("3 SOL", `buy_3_${tokenAddress}`)
    .row();
  
  // Third row: 5, 10, Custom SOL
  keyboard.text("5 SOL", `buy_5_${tokenAddress}`)
    .text("10 SOL", `buy_10_${tokenAddress}`)
    .text("X SOL ✏️", `buy_custom_${tokenAddress}`)
    .row();
  
  // Fourth row: Menu
  keyboard.text("Menu", TradingCallbacks.BACK);
  
  return keyboard;
}

// Custom buy amount prompt
export function generateCustomBuyAmountMessage(): string {
  return `💰 **Custom Buy Amount**

**Available Balance:** ${mockTradingData.userBalances.fundingWallet.toFixed(4)} SOL

Enter the amount of SOL you want to spend:

**Example:** 2.5 (for 2.5 SOL)`;
}

export function generateCustomBuyAmountKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("❌ Cancel", TradingCallbacks.CANCEL_TRADE);
}

// Buy confirmation screen
export function generateBuyConfirmationMessage(amount: number, tokenAddress: string): string {
  const { tokenInfo } = mockTradingData;
  const estimatedTokens = amount / tokenInfo.price;
  
  return `✅ **Confirm Buy Order**

**Token:** ${tokenInfo.name} (${tokenInfo.symbol})
**Amount:** ${amount} SOL
**Estimated Tokens:** ${estimatedTokens.toLocaleString()}
**Current Price:** $${tokenInfo.price.toFixed(8)}

**Transaction Fee:** ~0.001 SOL
**Total Cost:** ${(amount + 0.001).toFixed(4)} SOL

Ready to execute this buy order?`;
}

export function generateBuyConfirmationKeyboard(tokenAddress: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Confirm Buy", `confirm_buy_${tokenAddress}`)
    .row()
    .text("❌ Cancel", TradingCallbacks.CANCEL_TRADE);
}

// External token sell screen
export function generateExternalSellPromptMessage(): string {
  return `💸 **Sell External Token**

Please enter the token address you wish to sell:

**Example:** \`3oZ8DxXxDnxJ63Fc8DGja8xQnG1fgLshtKyLn9nkpUMP\`

**Your Token Balance:** ${mockTradingData.userBalances.tokenBalance.toLocaleString()} ${mockTradingData.tokenInfo.symbol}
**Token Value:** $${mockTradingData.userBalances.tokenValue.toFixed(2)}

Enter the token address:`;
}

export function generateExternalSellKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("❌ Cancel", TradingCallbacks.CANCEL_TRADE);
}

// Token sell options screen
export function generateTokenSellOptionsMessage(tokenAddress: string): string {
  const { tokenInfo, userBalances } = mockTradingData;
  
  return `💸 **Sell Token Options**

**Token:** ${tokenInfo.name} (${tokenInfo.symbol})
**Address:** \`${tokenAddress}\`
**Your Balance:** ${userBalances.tokenBalance.toLocaleString()} ${tokenInfo.symbol}
**Token Value:** $${userBalances.tokenValue.toFixed(2)}
**Current Price:** $${tokenInfo.price.toFixed(8)}

Select percentage to sell:`;
}

export function generateTokenSellOptionsKeyboard(tokenAddress: string): InlineKeyboard {
  const { presetPercentages } = mockTradingData;
  
  const keyboard = new InlineKeyboard();
  
  // First row: Back and Refresh
  keyboard.text("← Back", `back-_${tokenAddress}`)
    .text("↻ Refresh", `refresh_sell_${tokenAddress}`)
    .row();
  
  // Second row: 10%, 25%, 50%
  keyboard.text("10%", `sell_ca_10_${tokenAddress}`)
    .text("25%", `sell_ca_25_${tokenAddress}`)
    .text("50%", `sell_ca_50_${tokenAddress}`)
    .row();
  
  // Third row: 75%, 100%, Custom
  keyboard.text("75%", `sell_ca_75_${tokenAddress}`)
    .text("100%", `sell_ca_100_${tokenAddress}`)
    .row()
    .text("Custom % ✏️", `sell_custom_${tokenAddress}`)
    .row();
  
  // Fourth row: Menu
  keyboard.text("Menu", TradingCallbacks.BACK);
  
  return keyboard;
}

// Custom sell percentage prompt
export function generateCustomSellPercentMessage(): string {
  return `💸 **Custom Sell Percentage**

**Your Token Balance:** ${mockTradingData.userBalances.tokenBalance.toLocaleString()} ${mockTradingData.tokenInfo.symbol}

Enter the percentage you want to sell (1-100):

**Example:** 25 (for 25%)`;
}

export function generateCustomSellPercentKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("❌ Cancel", TradingCallbacks.CANCEL_TRADE);
}

// Sell confirmation screen
export function generateSellConfirmationMessage(percentage: number, tokenAddress: string): string {
  const { tokenInfo, userBalances } = mockTradingData;
  const tokensToSell = (userBalances.tokenBalance * percentage) / 100;
  const estimatedSOL = tokensToSell * tokenInfo.price;
  
  return `✅ **Confirm Sell Order**

**Token:** ${tokenInfo.name} (${tokenInfo.symbol})
**Percentage:** ${percentage}%
**Tokens to Sell:** ${tokensToSell.toLocaleString()}
**Estimated SOL:** ${estimatedSOL.toFixed(4)} SOL
**Current Price:** $${tokenInfo.price.toFixed(8)}

**Transaction Fee:** ~0.001 SOL
**Net SOL Received:** ${(estimatedSOL - 0.001).toFixed(4)} SOL

Ready to execute this sell order?`;
}

export function generateSellConfirmationKeyboard(tokenAddress: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Confirm Sell", `confirm_sell_${tokenAddress}`)
    .row()
    .text("❌ Cancel", TradingCallbacks.CANCEL_TRADE);
}

// Processing screens
export function generateBuyProcessingMessage(): string {
  return `🔄 **Processing Buy Order...**

⏳ Step 1: Validating token address...
⏳ Step 2: Checking wallet balance...
⏳ Step 3: Executing buy transaction...
⏳ Step 4: Confirming transaction...

This may take 15-30 seconds. Please wait...`;
}

export function generateSellProcessingMessage(): string {
  return `🔄 **Processing Sell Order...**

⏳ Step 1: Validating token address...
⏳ Step 2: Checking token balance...
⏳ Step 3: Executing sell transaction...
⏳ Step 4: Confirming transaction...

This may take 15-30 seconds. Please wait...`;
}

// Success screens
export function generateBuySuccessMessage(amount: number, tokenAddress: string, txHash: string): string {
  return `✅ **Buy Order Successful!**

**Amount Spent:** ${amount} SOL
**Token Address:** \`${tokenAddress}\`
**Transaction:** \`${txHash}\`

**Next Steps:**
• Monitor your token holdings
• Set up price alerts
• Consider taking profits

Your tokens have been added to your wallet! 🎉`;
}

export function generateSellSuccessMessage(percentage: number, tokenAddress: string, txHash: string, solReceived: number): string {
  return `✅ **Sell Order Successful!**

**Percentage Sold:** ${percentage}%
**SOL Received:** ${solReceived.toFixed(4)} SOL
**Token Address:** \`${tokenAddress}\`
**Transaction:** \`${txHash}\`

**Next Steps:**
• Check your SOL balance
• Monitor remaining tokens
• Consider reinvesting

Your SOL has been added to your wallet! 💰`;
}

export function generateTradeSuccessKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📊 View Transaction", "view_transaction")
    .row()
    .text("🔙 Back to Menu", TradingCallbacks.BACK);
}

// Error handling
export function generateTradeErrorMessage(error: string): string {
  return `❌ **Trade Failed**

**Error:** ${error}

**Possible Solutions:**
• Check your wallet balance
• Verify the token address
• Try again in a few minutes
• Contact support if the issue persists

Would you like to try again?`;
}

export function generateTradeErrorKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔄 Try Again", "retry_trade")
    .row()
    .text("🔙 Back to Menu", TradingCallbacks.BACK);
} 