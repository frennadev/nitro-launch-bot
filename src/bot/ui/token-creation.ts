import { InlineKeyboard } from "grammy";
import { Context } from "grammy";

// Callback queries for token creation flow
export enum TokenCreationCallbacks {
  PUMPFUN = "pumpfun",
  LETSBONK = "letsbonk",
  CONFIRM_TOKEN_DETAILS = "confirm_token_details",
  CANCEL_CREATION = "cancel_creation",
}

// Mock data for token creation
export const mockTokenCreationData = {
  platforms: [
    { id: "pumpfun", name: "🎉 PumpFun", description: "Fast token launches with bonding curve" },
    { id: "letsbonk", name: "🚀 LetsBonk", description: "Bonk-style token creation" }
  ],
  defaultTokenDetails: {
    name: "My Awesome Token",
    symbol: "MAT",
    description: "A revolutionary token for the future"
  }
};

// Step 1: Platform Selection
export function generatePlatformSelectionMessage(): string {
  return `🚀 **Token Creation - Step 1: Choose Platform**

Select the platform where you want to create your token:

🎉 **PumpFun**
• Fast token launches
• Bonding curve mechanics
• High liquidity

🚀 **LetsBonk** 
• Bonk-style tokens
• Community focused
• Easy setup

Choose your preferred platform:`;
}

export function generatePlatformSelectionKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🎉 PumpFun", TokenCreationCallbacks.PUMPFUN)
    .row()
    .text("🚀 LetsBonk", TokenCreationCallbacks.LETSBONK)
    .row()
    .text("❌ Cancel", TokenCreationCallbacks.CANCEL_CREATION);
}

// Step 2: Token Details Input
export function generateTokenDetailsPrompt(): string {
  return `📝 **Token Creation - Step 2: Token Details**

Please provide the following information for your token:

**Current Details:**
• Name: ${mockTokenCreationData.defaultTokenDetails.name}
• Symbol: ${mockTokenCreationData.defaultTokenDetails.symbol}
• Description: ${mockTokenCreationData.defaultTokenDetails.description}

**To customize, send your new values in this format:**
\`Name|Symbol|Description\`

**Example:**
\`My Token|MTK|This is my amazing token\`

Or click "Use Default" to proceed with current values.`;
}

export function generateTokenDetailsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Use Default", TokenCreationCallbacks.CONFIRM_TOKEN_DETAILS)
    .row()
    .text("❌ Cancel", TokenCreationCallbacks.CANCEL_CREATION);
}

// Step 3: Confirmation
export function generateTokenConfirmationMessage(platform: string, details: any): string {
  return `✅ **Token Creation - Step 3: Confirmation**

**Platform:** ${platform === "pumpfun" ? "🎉 PumpFun" : "🚀 LetsBonk"}
**Token Name:** ${details.name}
**Token Symbol:** ${details.symbol}
**Description:** ${details.description}

**Estimated Cost:** 0.1 SOL
**Estimated Time:** 30-60 seconds

Ready to create your token?`;
}

export function generateTokenConfirmationKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🚀 Create Token", "create_token_now")
    .row()
    .text("❌ Cancel", TokenCreationCallbacks.CANCEL_CREATION);
}

// Step 4: Processing
export function generateTokenProcessingMessage(): string {
  return `🔄 **Creating Your Token...**

⏳ Step 1: Generating wallet...
⏳ Step 2: Creating token on blockchain...
⏳ Step 3: Setting up initial liquidity...

This may take 30-60 seconds. Please wait...`;
}

// Step 5: Success
export function generateTokenSuccessMessage(tokenAddress: string): string {
  return `🎉 **Token Created Successfully!**

**Token Details:**
• Name: My Awesome Token
• Symbol: MAT
• Address: \`${tokenAddress}\`

**Next Steps:**
1. Launch your token to make it tradeable
2. Add liquidity to enable trading
3. Share with your community

Your token is ready for launch! 🚀`;
}

export function generateTokenSuccessKeyboard(tokenAddress: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🚀 Launch Token", `launch_token_${tokenAddress}`)
    .row()
    .text("📋 View Token", `view_token_${tokenAddress}`)
    .row()
    .text("🔙 Back to Menu", "back_to_menu");
}

// Error handling
export function generateTokenErrorMessage(error: string): string {
  return `❌ **Token Creation Failed**

**Error:** ${error}

**Possible Solutions:**
• Check your wallet balance
• Try again in a few minutes
• Contact support if the issue persists

Would you like to try again?`;
}

export function generateTokenErrorKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔄 Try Again", "retry_token_creation")
    .row()
    .text("🔙 Back to Menu", "back_to_menu");
} 