import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { CallBackQueries } from "../types";
import { safeAnswerCallbackQuery } from "../utils";
import { sendFirstMessage } from "../../backend/sender";

export default async function helpConversation(
  conversation: Conversation<Context>,
  ctx: Context
) {
  // Only answer callback query if this was triggered by a callback query
  if (ctx.callbackQuery) {
    await safeAnswerCallbackQuery(ctx);
  }

  const helpSections = {
    main: {
      title: "🆘 Bundler Help Center",
      content: [
        "Welcome to the *Bundler Help Center*! 🌟",
        "",
        "Bundler is your complete solution for launching and managing Solana tokens on Pump.fun with ease.",
        "",
        "*Choose a help section below:*",
      ].join("\n"),
      keyboard: new InlineKeyboard()
        .text("🚀 Token Creation", "help_token_creation")
        .text("💰 Token Launch", "help_token_launch")
        .row()
        .text("💳 Wallet Management", "help_wallet_management")
        .text("💸 Buying & Selling", "help_trading")
        .row()
        .text("📊 Monitoring & Stats", "help_monitoring")
        .text("🔗 Referrals", "help_referrals")
        .row()
        .text("🛠 Advanced Features", "help_advanced")
        .text("❓ FAQ", "help_faq")
        .row()
        .text("🔙 Back to Menu", CallBackQueries.BACK),
    },

    token_creation: {
      title: "🚀 Token Creation Guide",
      content: [
        "*Creating Your Token*",
        "",
        "1️⃣ *Start Creation*: Use one of these methods:",
        '   • "Create Token" button from main menu',
        "   • `/create` command (direct access)",
        "   • `/start` command",
        "",
        "2️⃣ *Token Details*: Provide:",
        '   • Token name (e.g., "My Amazing Token")',
        '   • Token symbol (e.g., "MAT")',
        "   • Token description",
        "   • Token image (upload or provide URL)",
        "",
        "3️⃣ *Review & Confirm*: Check all details before deployment",
        "4️⃣ *Deployment*: Your token will be created on Pump.fun",
        "",
        "*Quick Commands:*",
        "• `/create` - Start token creation",
        "• `/tokens` - View your created tokens",
        "• `/menu` - Return to main menu",
        "",
        "*Tips:*",
        "• Choose a catchy name and symbol",
        "• Write an engaging description",
        "• Use high-quality images (1:1 ratio recommended)",
        "• Double-check everything - details can't be changed after deployment",
        "",
        "*Cost*: ~0.02 SOL for token creation",
      ].join("\n"),
      keyboard: new InlineKeyboard()
        .text("💰 Launch Guide", "help_token_launch")
        .text("🔙 Help Menu", "help_main"),
    },

    token_launch: {
      title: "💰 Token Launch Guide",
      content: [
        "*Launching Your Token*",
        "",
        "After creating your token, you need to launch it on Pump.fun:",
        "",
        "1️⃣ *Initial Buy*: Set your initial purchase amount (recommended: 0.1-1 SOL)",
        "2️⃣ *Buyer Wallets*: Configure multiple wallets for distribution",
        "3️⃣ *Launch Strategy*: Choose your approach:",
        "   • *Quick Launch*: Immediate deployment",
        "   • *Staged Launch*: Multiple buys over time",
        "",
        "*Launch Parameters:*",
        "• *Dev Buy Amount*: Your initial investment",
        "• *Buyer Wallets*: 1-73 wallets for token distribution",
        "• *Buy Amounts*: Customize per wallet or use equal distribution",
        "",
        "*Important Notes:*",
        "• Ensure your dev wallet has enough SOL",
        "• Launch immediately after creation for best results",
        "• Monitor bonding curve progress (0-100%)",
        "• Dev tokens are automatically distributed to your wallet",
      ].join("\n"),
      keyboard: new InlineKeyboard()
        .text("💳 Wallet Setup", "help_wallet_management")
        .text("💸 Trading Guide", "help_trading")
        .row()
        .text("🔙 Help Menu", "help_main"),
    },

    wallet_management: {
      title: "💳 Wallet Management Guide",
      content: [
        "*Wallet Types in Bundler*",
        "",
        "🔐 *Dev Wallet*: Your main wallet for token creation and management",
        "💰 *Funding Wallet*: Main trading wallet for buying/selling external tokens",
        "🎯 *Buyer Wallets*: Multiple wallets for token launches and distribution",
        "",
        "*Wallet Operations:*",
        "",
        "*Export Private Keys:*",
        '• Use "Export Dev Wallet" for dev wallet key',
        "• Navigate to Wallet Config → Export for other wallets",
        "",
        "*Manage Wallets:*",
        "• Add/remove buyer wallets",
        "• Configure wallet settings",
        "• Set custom wallet names",
        "",
        "*Withdrawals:*",
        "• Withdraw from dev wallet to external address",
        "• Consolidate buyer wallets to funding wallet",
        "• Withdraw funding wallet to external address",
        "",
        "*Security Tips:*",
        "• Never share private keys",
        "• Store keys in secure locations",
        "• Use hardware wallets for large amounts",
        "• Delete exported keys from chat immediately",
      ].join("\n"),
      keyboard: new InlineKeyboard()
        .text("💸 Trading Guide", "help_trading")
        .text("🛠 Advanced Features", "help_advanced")
        .row()
        .text("🔙 Help Menu", "help_main"),
    },

    trading: {
      title: "💸 Trading Guide",
      content: [
        "*Buying & Selling Tokens*",
        "",
        "*Buying External Tokens:*",
        "1️⃣ Send any Solana token address to the bot",
        "2️⃣ Bot automatically detects platform (Pump.fun/Pumpswap)",
        "3️⃣ Choose buy amount (SOL or percentage of wallet)",
        "4️⃣ Confirm transaction",
        "",
        "*Selling Your Tokens:*",
        "",
        "*Dev Sells* (Your launched tokens):",
        "• Sell partial or entire dev supply",
        "• Choose percentage (25%, 50%, 75%, 100%)",
        "• Instant execution from dev wallet",
        "",
        "*Wallet Sells* (From buyer wallets):",
        "• Sell from individual wallets",
        "• Sell all wallets at once",
        "• Custom percentage per wallet",
        "",
        "*External Token Sells:*",
        "• Sell tokens bought from other projects",
        "• Choose sell percentage",
        "• Works with Pump.fun and Pumpswap tokens",
        "",
        "*Trading Features:*",
        "• Real-time price updates",
        "• Slippage protection",
        "• MEV protection",
        "• Fast execution (1-3 seconds)",
      ].join("\n"),
      keyboard: new InlineKeyboard()
        .text("📊 Monitoring", "help_monitoring")
        .text("💳 Wallet Setup", "help_wallet_management")
        .row()
        .text("🔙 Help Menu", "help_main"),
    },

    monitoring: {
      title: "📊 Monitoring & Stats Guide",
      content: [
        "*Track Your Tokens*",
        "",
        "*Token Dashboard:*",
        "• Real-time price updates",
        "• Market cap tracking",
        "• Volume and liquidity data",
        "• Bonding curve progress (0-100%)",
        "• Holder count and distribution",
        "",
        "*Portfolio Management:*",
        "• View all your launched tokens",
        "• Track token performance",
        "• Monitor wallet balances",
        "• Calculate total holdings and percentages",
        "",
        "*Key Metrics:*",
        "• *Price*: Current token price in USD",
        "• *Market Cap*: Total value of all tokens",
        "• *Volume 24h*: Trading volume in last 24 hours",
        "• *Liquidity*: Available liquidity for trading",
        "• *Bonding Curve*: Progress toward Raydium migration",
        "",
        "*Performance Tracking:*",
        "• PnL (Profit and Loss) calculations",
        "• ROI tracking per token",
        "• Historical performance data",
        "• Trade history and analytics",
        "",
        "*Refresh Options:*",
        "• Manual refresh buttons",
        "• Auto-updates every 30 seconds",
        "• Real-time notifications for major changes",
      ].join("\n"),
      keyboard: new InlineKeyboard()
        .text("🔗 Referrals", "help_referrals")
        .text("🛠 Advanced Features", "help_advanced")
        .row()
        .text("🔙 Help Menu", "help_main"),
    },

    referrals: {
      title: "🔗 Referral System Guide",
      content: [
        "*Earn with Referrals*",
        "",
        "*How It Works:*",
        '1️⃣ Get your unique referral link from "Referrals" section',
        "2️⃣ Share with friends and crypto communities",
        "3️⃣ Earn rewards when they use the bot",
        "4️⃣ Track your referral stats and earnings",
        "",
        "*Referral Benefits:*",
        "• *For You*: Earn percentage of referral's transaction fees",
        "• *For Referrals*: Get discount on their first transactions",
        "• *Lifetime Earnings*: Earn from all their future transactions",
        "",
        "*Best Practices:*",
        "• Share in crypto communities and social media",
        "• Explain Bundler's benefits",
        "• Help new users get started",
        "• Build long-term relationships",
        "",
        "*Tracking:*",
        "• View total referrals count",
        "• Monitor active referrals",
        "• Track earnings and statistics",
        "• See referral activity",
        "",
        "*Referral Tiers:*",
        "• Bronze: 1-10 referrals (5% commission)",
        "• Silver: 11-50 referrals (7% commission)",
        "• Gold: 51+ referrals (10% commission)",
      ].join("\n"),
      keyboard: new InlineKeyboard()
        .text("💸 Trading Guide", "help_trading")
        .text("🛠 Advanced Features", "help_advanced")
        .row()
        .text("🔙 Help Menu", "help_main"),
    },

    advanced: {
      title: "🛠 Advanced Features Guide",
      content: [
        "*Advanced Bot Features*",
        "",
        "*CTO (Copy Trading Operations):*",
        "• Monitor and copy successful traders",
        "• Automated trading based on patterns",
        "• Risk management and stop-losses",
        "• Real-time trade notifications",
        "",
        "*Platform Detection:*",
        "• Automatic Pump.fun vs Pumpswap detection",
        "• Optimized routing for best prices",
        "• Cross-platform compatibility",
        "• Smart contract interaction",
        "",
        "*Security Features:*",
        "• Encrypted private key storage",
        "• Rate limiting protection",
        "• MEV (Maximum Extractable Value) protection",
        "• Slippage protection",
        "",
        "*Admin Commands* (for bot owners):",
        "• /admin - View system statistics",
        "• /markused <address> - Mark addresses as used",
        "• /removetoken <address> - Remove failed tokens",
        "• /ratelimit - Manage rate limits",
        "",
        "*API Integration:*",
        "• Real-time price feeds",
        "• Multiple data sources",
        "• Backup providers for reliability",
        "• Custom token analysis",
        "",
        "*Performance Optimization:*",
        "• Ultra-fast execution (1-3 seconds)",
        "• Parallel processing",
        "• Smart caching",
        "• Optimized transaction routing",
      ].join("\n"),
      keyboard: new InlineKeyboard()
        .text("❓ FAQ", "help_faq")
        .text("📊 Monitoring", "help_monitoring")
        .row()
        .text("🔙 Help Menu", "help_main"),
    },

    faq: {
      title: "❓ Frequently Asked Questions",
      content: [
        "*Common Questions & Answers*",
        "",
        "*Q: How much SOL do I need to start?*",
        "A: Minimum 0.1 SOL recommended. Token creation costs ~0.02 SOL, plus initial buy amount.",
        "",
        "*Q: Can I edit my token after creation?*",
        "A: No, token details are permanent once deployed. Double-check everything before confirming.",
        "",
        "*Q: What happens when bonding curve reaches 100%?*",
        "A: Token migrates to Raydium DEX with permanent liquidity pool.",
        "",
        "*Q: How fast are transactions?*",
        "A: Most transactions complete in 1-3 seconds with our optimized routing.",
        "",
        "*Q: Is my wallet secure?*",
        "A: Yes, private keys are encrypted and stored securely. Always export and backup your keys.",
        "",
        "*Q: Can I use hardware wallets?*",
        "A: Currently, the bot uses generated wallets. You can export keys to import into hardware wallets.",
        "",
        "*Q: What fees does the bot charge?*",
        "A: Small service fee on launches and trades. Check current rates in bot settings.",
        "",
        "*Q: Can I sell before launch?*",
        "A: You can only sell after successful token launch on Pump.fun.",
        "",
        "*Q: What if my transaction fails?*",
        "A: Failed transactions are automatically refunded. Contact support if issues persist.",
        "",
        "*Q: How do I contact support?*",
        "A: Use /help command or contact bot administrators for assistance.",
      ].join("\n"),
      keyboard: new InlineKeyboard()
        .text("🚀 Token Creation", "help_token_creation")
        .text("💰 Token Launch", "help_token_launch")
        .row()
        .text("🛠 Advanced Features", "help_advanced")
        .text("🔙 Help Menu", "help_main"),
    },
  };

  let currentSection = "main";

  // Send initial message
  await sendFirstMessage(ctx, helpSections.main.content, {
    parse_mode: "Markdown",
    reply_markup: helpSections.main.keyboard,
  });

  while (true) {
    const response = await conversation.waitFor("callback_query");
    await safeAnswerCallbackQuery(response);

    const callbackData = response.callbackQuery!.data;

    // Handle navigation
    if (callbackData === "help_main") {
      currentSection = "main";
    } else if (callbackData === CallBackQueries.BACK) {
      // Exit help and return to main menu
      return;
    } else if (callbackData && callbackData.startsWith("help_")) {
      const newSection = callbackData.replace("help_", "");
      if (helpSections[newSection as keyof typeof helpSections]) {
        currentSection = newSection;
      } else {
        // Unknown section, break out
        break;
      }
    } else {
      // Unhandled callback, break out
      break;
    }

    // Update the message with new content
    const section = helpSections[currentSection as keyof typeof helpSections];
    try {
      await response.editMessageText(section.content, {
        parse_mode: "Markdown",
        reply_markup: section.keyboard,
      });
    } catch {
      // If editing fails, send a new message
      await response.reply(section.content, {
        parse_mode: "Markdown",
        reply_markup: section.keyboard,
      });
    }
  }
}
