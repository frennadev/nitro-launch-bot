import { InlineKeyboard } from "grammy";
import { Context } from "grammy";

// Essential callback queries for the welcome message
export enum WelcomeCallbacks {
  CREATE_TOKEN = "create_token",
  VIEW_TOKENS = "view_tokens", 
  EXPORT_DEV_WALLET = "export_dev_wallet",
  WALLET_CONFIG = "wallet_config",
  VIEW_REFERRALS = "view_referrals",
}

// Interface for user data needed for welcome message
export interface WelcomeUserData {
  devWallet: string;
  referralCount: number;
}

// Generate the welcome message text
export function generateWelcomeMessage(userData: WelcomeUserData): string {
  return `👋 *Hello and welcome to Nitro Bot!* 🌟

🚀 Nitro Bot empowers you to deploy and manage your Solana tokens on [Pump.fun](https://pump.fun) in a flash—no coding required!  
Here's what Nitro Bot can help you with:

🔹 Create & launch tokens on Pump.fun
🔹 Untraceable buys & sells
🔹 Token launches made easy!

💳 *Your current dev wallet address:*  
\`${userData.devWallet}\`

🔗 *Referrals:* ${userData.referralCount} friends joined through your link

Choose an option below to get started ⬇️`;
}

// Generate the welcome message keyboard
export function generateWelcomeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("➕ Create Token", WelcomeCallbacks.CREATE_TOKEN)
    .text("👁 View Tokens", WelcomeCallbacks.VIEW_TOKENS)
    .row()
    .text("🔑 Export Dev Wallet", WelcomeCallbacks.EXPORT_DEV_WALLET)
    .text("⚙️ Wallet Config", WelcomeCallbacks.WALLET_CONFIG)
    .row()
    .text("🔗 Referrals", WelcomeCallbacks.VIEW_REFERRALS);
}

// Send welcome message with user data
export async function sendWelcomeMessage(
  ctx: Context, 
  userData: WelcomeUserData
): Promise<void> {
  const message = generateWelcomeMessage(userData);
  const keyboard = generateWelcomeKeyboard();

  await ctx.reply(message, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
} 