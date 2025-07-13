// Example usage of the welcome message component
import { sendWelcomeMessage, WelcomeUserData } from './src/bot/welcome-message';

// Example user data
const exampleUserData: WelcomeUserData = {
  devWallet: "H497XdK28Tn5gvL859qmvLtm4qU9GLtgtnzAXiypcTWF",
  referralCount: 7
};

// Example usage in a bot command handler
async function handleStartCommand(ctx: any) {
  // In a real implementation, you would:
  // 1. Get user from database
  // 2. Get their dev wallet
  // 3. Get their referral count
  // 4. Then call sendWelcomeMessage
  
  await sendWelcomeMessage(ctx, exampleUserData);
}

// Example of how to handle callback queries
import { WelcomeCallbacks } from './src/bot/welcome-message';

async function handleCallbackQuery(ctx: any, data: string) {
  switch (data) {
    case WelcomeCallbacks.CREATE_TOKEN:
      // Handle create token
      await ctx.reply("🚀 Starting token creation...");
      break;
      
    case WelcomeCallbacks.VIEW_TOKENS:
      // Handle view tokens
      await ctx.reply("👁 Loading your tokens...");
      break;
      
    case WelcomeCallbacks.EXPORT_DEV_WALLET:
      // Handle export dev wallet
      await ctx.reply("🔑 Exporting dev wallet...");
      break;
      
    case WelcomeCallbacks.WALLET_CONFIG:
      // Handle wallet config
      await ctx.reply("⚙️ Opening wallet configuration...");
      break;
      
    case WelcomeCallbacks.VIEW_REFERRALS:
      // Handle view referrals
      await ctx.reply("🔗 Loading referral information...");
      break;
      
    default:
      await ctx.reply("❌ Unknown action");
  }
} 