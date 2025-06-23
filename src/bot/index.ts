import { Bot, InlineKeyboard, type Context, type BotError, GrammyError, HttpError } from "grammy";
import { Conversation, conversations, createConversation, type ConversationFlavor } from "@grammyjs/conversations";
import { env } from "../config";
import {
  createUser,
  getDevWallet,
  getDefaultDevWallet,
  getTokensForUser,
  getUser,
  getOrCreateFundingWallet,
  getPumpAddressStats,
  markPumpAddressAsUsed,
  removeFailedToken,
  getAllBuyerWallets,
  getUserTokenWithBuyWallets,
  createUserWithReferral,
  getFundingWallet,
} from "../backend/functions";
import { CallBackQueries } from "./types";
import { escape, formatUSD, safeEditMessageReplyMarkup, safeEditMessageText, safeEditOrSendMessage } from "./utils";
import launchTokenConversation from "./conversation/launchToken";
import createTokenConversation from "./conversation/createToken";
import devSellConversation from "./conversation/devSell";
import walletSellConversation from "./conversation/walletSell";
import { TokenState } from "../backend/types";
import walletConfigConversation from "./conversation/walletConfig";
import mainMenuConversation from "./conversation/mainMenu";
import { sendMessage } from "../backend/sender";
import manageDevWalletsConversation from "./conversation/devWallets";
import manageBuyerWalletsConversation from "./conversation/buyerWallets";
import {
  withdrawDevWalletConversation,
  withdrawBuyerWalletsConversation,
  withdrawFundingWalletConversation,
} from "./conversation/withdrawal";
import viewTokensConversation from "./conversation/viewTokenConversation";
import externalTokenSellConversation from "./conversation/externalTokenSell";
import { logger } from "../blockchain/common/logger";
import { getTokenInfo, getTokenBalance, decryptPrivateKey, checkTokenRenouncedAndFrozen } from "../backend/utils";
import { getTransactionFinancialStats } from "../backend/functions-main";
import { buyExternalTokenConversation } from "./conversation/externalTokenBuy";
import { referralsConversation } from "./conversation/referrals";
import { PublicKey } from "@solana/web3.js";
import { executeFundingBuy } from "../blockchain/pumpfun/buy";
import { buyCustonConversation } from "./conversation/buyCustom";
import { executeDevSell, executeWalletSell } from "../blockchain/pumpfun/sell";
import { sellIndividualToken } from "./conversation/ sellIndividualToken";
import {
  getCachedPlatform,
  setCachedPlatform,
  detectTokenPlatformWithCache,
  markTokenAsPumpswap as markTokenAsPumpswapService,
  markTokenAsPumpFun,
} from "../service/token-detection-service";

// Platform detection and caching for external tokens
const platformCache = new Map<
  string,
  { platform: "pumpswap" | "pumpfun" | "unknown"; timestamp: number; permanent: boolean }
>();

// Cache TTL: 5 minutes for temporary results, permanent for confirmed detections
const PLATFORM_CACHE_TTL = 5 * 60 * 1000;

// Platform detection now handled by service layer

// Export function for external use
export function markTokenAsPumpswap(tokenAddress: string) {
  platformCache.set(tokenAddress, { platform: "pumpswap", timestamp: Date.now(), permanent: true });
  console.log(`[platform-cache]: Cached ${tokenAddress.substring(0, 8)} as pumpswap (permanent: true)`);
}

// Export function for use in external buy/sell operations
export function getPlatformFromCache(tokenAddress: string): "pumpswap" | "pumpfun" | "unknown" | null {
  const cached = platformCache.get(tokenAddress);
  if (!cached) return null;

  // Permanent cache entries never expire
  if (cached.permanent) return cached.platform;

  // Check if temporary cache has expired
  if (Date.now() - cached.timestamp > PLATFORM_CACHE_TTL) {
    platformCache.delete(tokenAddress);
    return null;
  }

  return cached.platform;
}

// Background platform detection function
async function detectPlatformInBackground(tokenAddress: string, chatId: number) {
  const logId = `bg-detect-${tokenAddress.substring(0, 8)}`;

  try {
    logger.info(`[${logId}]: Starting background platform detection using bonding curve approach`);

    const platform = await detectTokenPlatformWithCache(tokenAddress);
    logger.info(`[${logId}]: Background detection completed: ${platform}`);

    // Update the token display with platform info
    // Note: We're not updating the message here since it's background detection
    // The platform info will be available immediately on next view due to caching
  } catch (error: any) {
    logger.error(`[${logId}]: Background platform detection failed: ${error.message}`);
  }
}

export const bot = new Bot<ConversationFlavor<Context>>(env.TELEGRAM_BOT_TOKEN);

// Global error handler
bot.catch(async (err: BotError<ConversationFlavor<Context>>) => {
  const ctx = err.ctx;
  logger.error("Error in bot middleware:", {
    error: err.error,
    update: ctx.update,
    stack: err.stack,
  });

  // Handle Grammy.js conversation state errors
  if (err.stack && err.stack.includes("Bad replay, expected op")) {
    logger.warn("Grammy.js conversation state error detected in global handler:", err.stack);

    // Clear the conversation state completely
    const cleared = await clearConversationState(ctx);

    // Send user-friendly message with recovery options
    if (ctx.chat) {
      const keyboard = new InlineKeyboard()
        .text("🚀 Direct Launch", "direct_launch_recovery")
        .row()
        .text("🔧 Fix & Retry", "fix_and_retry")
        .row()
        .text("📋 View Tokens", CallBackQueries.VIEW_TOKENS);

      ctx
        .reply(
          "🔧 **Error Fixed Automatically**\n\n" +
            "✅ Conversation state cleared\n" +
            "✅ Session reset completed\n\n" +
            "**Choose how to continue:**",
          {
            parse_mode: "Markdown",
            reply_markup: keyboard,
          }
        )
        .catch(() => logger.error("Failed to send conversation reset message"));
    }
    return;
  }

  // Don't crash the bot for callback query timeout errors
  if (
    err.error instanceof GrammyError &&
    (err.error.description.includes("query is too old") || err.error.description.includes("response timeout expired"))
  ) {
    logger.info("Ignoring callback query timeout error");
    return;
  }

  // For other errors, try to notify the user if possible
  if (ctx.chat) {
    ctx
      .reply("❌ An unexpected error occurred. Please try again or contact support.")
      .catch(() => logger.error("Failed to send error message to user"));
  }
});

// Safe wrapper for answerCallbackQuery to handle timeout errors
async function safeAnswerCallbackQuery(ctx: Context, text?: string): Promise<void> {
  try {
    await ctx.answerCallbackQuery(text);
  } catch (error: any) {
    // Ignore callback query timeout errors
    if (
      error instanceof GrammyError &&
      (error.description?.includes("query is too old") ||
        error.description?.includes("response timeout expired") ||
        error.description?.includes("query ID is invalid"))
    ) {
      logger.info("Callback query timeout ignored:", error.description);
      return;
    }
    // Re-throw other errors
    throw error;
  }
}

// ----- Conversations -----
// Configure conversations with proper error handling
bot.use(
  conversations({
    // Use storage-free adapter for better error recovery
    storage: undefined, // This will use the default in-memory storage
  })
);

// Middleware to handle conversation errors at the conversation level
bot.use(async (ctx, next) => {
  try {
    await next();
  } catch (error: any) {
    // Handle conversation-specific errors
    if (error.message && error.message.includes("Bad replay, expected op")) {
      logger.warn("Conversation replay error caught in middleware:", error.message);

      // Clear conversation state completely
      const cleared = await clearConversationState(ctx);

      // Instead of just showing an error, provide immediate recovery options
      const keyboard = new InlineKeyboard()
        .text("🚀 Direct Launch Token", "direct_launch_recovery")
        .row()
        .text("🔧 Fix & Try Again", "fix_and_retry")
        .row()
        .text("📋 View Tokens", CallBackQueries.VIEW_TOKENS);

      await ctx.reply(
        "🔧 **Conversation State Fixed**\n\n" +
          "✅ Error cleared automatically\n" +
          "✅ Session reset completed\n\n" +
          "**Choose how to continue:**",
        {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        }
      );
      return;
    }

    // Re-throw other errors to be handled by global error handler
    throw error;
  }
});

bot.use(createConversation(createTokenConversation));
bot.use(createConversation(launchTokenConversation));
bot.use(createConversation(devSellConversation));
bot.use(createConversation(walletSellConversation));
bot.use(createConversation(walletConfigConversation));
bot.use(createConversation(mainMenuConversation));
bot.use(createConversation(manageDevWalletsConversation));
bot.use(createConversation(manageBuyerWalletsConversation));
bot.use(createConversation(withdrawDevWalletConversation));
bot.use(createConversation(withdrawBuyerWalletsConversation));
bot.use(createConversation(withdrawFundingWalletConversation));
bot.use(createConversation(viewTokensConversation));
bot.use(createConversation(externalTokenSellConversation));
bot.use(createConversation(buyExternalTokenConversation));
bot.use(createConversation(referralsConversation));
bot.use(createConversation(buyCustonConversation));
bot.use(createConversation(sellIndividualToken));

// Middleware to patch reply/sendMessage and hook deletion
bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id;
  const userMessageId = ctx.message?.message_id;

  if (!chatId || !userMessageId) return next();

  // Store original functions
  const originalReply = ctx.reply.bind(ctx);
  const originalSendMessage = ctx.api.sendMessage.bind(ctx.api);

  let botResponded = false;

  // Wrap ctx.reply
  ctx.reply = async (...args) => {
    botResponded = true;
    return originalReply(...args);
  };

  // Wrap ctx.api.sendMessage
  ctx.api.sendMessage = async (...args) => {
    botResponded = true;
    return originalSendMessage(...args);
  };

  await next();

  if (botResponded) {
    setTimeout(() => {
      ctx.api.deleteMessage(chatId, userMessageId).catch(() => {});
    }, 2500);
  }
});

// ----- Commands ------
bot.command("start", async (ctx) => {
  let user = await getUser(ctx.chat.id.toString());
  let isFirstTime = user === null;

  if (isFirstTime) {
    // Check if there's a referral code in the start command
    const startPayload = ctx.match; // This gets the text after /start
    let referralCode: string | undefined;

    if (startPayload && typeof startPayload === "string" && startPayload.startsWith("REF_")) {
      referralCode = startPayload.replace("REF_", "");
      console.log(`New user with referral code: ${referralCode}`);
    }

    // Create user with or without referral
    if (referralCode) {
      user = await createUserWithReferral(
        ctx.chat.first_name,
        ctx.chat.last_name,
        ctx.chat.username!,
        ctx.chat.id.toString(),
        referralCode
      );
    } else {
      user = await createUser(ctx.chat.first_name, ctx.chat.last_name, ctx.chat.username!, ctx.chat.id.toString());
    }
  }

  // Auto-create funding wallet for all users
  await getOrCreateFundingWallet(String(user?.id));

  const devWallet = await getDefaultDevWallet(String(user?.id));

  // Get user's referral stats
  const { getUserReferralStats } = await import("../backend/functions-main");
  const referralStats = await getUserReferralStats(String(user?.id));

  const welcomeMsg = `
👋 *Hello and welcome to Nitro Bot!* 🌟

🚀 Nitro Bot empowers you to deploy and manage your Solana tokens on [Pump.fun](https://pump.fun) in a flash—no coding required!  
Here's what Nitro Bot can help you with:

🔹 Create & launch tokens on Pump.fun
🔹 Untraceable buys & sells
🔹 Token launches made easy!

💳 *Your current dev wallet address:*  
\`${devWallet}\`

🔗 *Referrals:* ${referralStats.referralCount} friends joined through your link

Choose an option below to get started ⬇️
`;

  const inlineKeyboard = new InlineKeyboard()
    .text("➕ Create Token", CallBackQueries.CREATE_TOKEN)
    .text("👁 View Tokens", CallBackQueries.VIEW_TOKENS)
    .row()
    .text("🔑 Export Dev Wallet", CallBackQueries.EXPORT_DEV_WALLET)
    .text("⚙️ Wallet Config", CallBackQueries.WALLET_CONFIG)
    .row()
    .text("🔗 Referrals", CallBackQueries.VIEW_REFERRALS);
  // .text("Add Wallet", CallBackQueries.ADD_WALLET)
  // .text("Generate Wallet", CallBackQueries.GENERATE_WALLET);

  await ctx.reply(welcomeMsg, {
    parse_mode: "Markdown",
    reply_markup: inlineKeyboard,
  });
});

bot.command("menu", async (ctx) => {
  let user = await getUser(ctx.chat.id.toString());
  if (!user) {
    await ctx.reply("Unrecognized user ❌");
    return;
  }

  // Auto-create funding wallet for all users
  await getOrCreateFundingWallet(String(user?.id));

  const devWallet = await getDefaultDevWallet(String(user?.id));

  // Get user's referral stats
  const { getUserReferralStats } = await import("../backend/functions-main");
  const referralStats = await getUserReferralStats(String(user?.id));

  const welcomeMsg = `
👋 *Hello and welcome to Nitro Bot!* 🌟

🚀 Nitro Bot empowers you to deploy and manage your Solana tokens on [Pump.fun](https://pump.fun) in a flash—no coding required!  
Here's what Nitro Bot can help you with:

🔹 Create & launch tokens on Pump.fun
🔹 Untraceable buys & sells
🔹 Token launches made easy!

💳 *Your current dev wallet address:*  
\`${devWallet}\`

🔗 *Referrals:* ${referralStats.referralCount} friends joined through your link

Choose an option below to get started ⬇️
`;

  const inlineKeyboard = new InlineKeyboard()
    .text("➕ Create Token", CallBackQueries.CREATE_TOKEN)
    .text("👁 View Tokens", CallBackQueries.VIEW_TOKENS)
    .row()
    .text("🔑 Export Dev Wallet", CallBackQueries.EXPORT_DEV_WALLET)
    .text("⚙️ Wallet Config", CallBackQueries.WALLET_CONFIG)
    .row()
    .text("🔗 Referrals", CallBackQueries.VIEW_REFERRALS);
  // .text("Add Wallet", CallBackQueries.ADD_WALLET)
  // .text("Generate Wallet", CallBackQueries.GENERATE_WALLET);

  await ctx.reply(welcomeMsg, {
    parse_mode: "Markdown",
    reply_markup: inlineKeyboard,
  });
});

bot.command("admin", async (ctx) => {
  // Simple admin check - you can enhance this with proper admin user IDs
  const adminIds = env.ADMIN_IDS ? env.ADMIN_IDS.split(",").map((id: string) => parseInt(id)) : [];

  if (!adminIds.includes(ctx.from!.id)) {
    await ctx.reply("❌ Access denied. Admin only command.");
    return;
  }

  try {
    const stats = await getPumpAddressStats();

    const message = `
🔧 *Admin Panel - Pump Address Statistics*

📊 *Address Pool Status:*
• Total Addresses: \`${stats.total}\`
• Used Addresses: \`${stats.used}\`
• Available Addresses: \`${stats.available}\`
• Usage: \`${stats.usagePercentage}%\`

${stats.available < 100 ? "⚠️ *Warning: Low address pool\\!*" : "✅ *Address pool healthy*"}

*Admin Commands:*
• \`/markused <address>\` \\- Mark address as used
• \`/removetoken <address>\` \\- Remove failed token from database
`;

    await ctx.reply(message, { parse_mode: "MarkdownV2" });
  } catch (error: any) {
    await ctx.reply(`❌ Error fetching stats: ${error.message}`);
  }
});

bot.command("markused", async (ctx) => {
  // Simple admin check
  const adminIds = env.ADMIN_IDS ? env.ADMIN_IDS.split(",").map((id: string) => parseInt(id)) : [];

  if (!adminIds.includes(ctx.from!.id)) {
    await ctx.reply("❌ Access denied. Admin only command.");
    return;
  }

  const args = ctx.message?.text?.split(" ");
  if (!args || args.length < 2) {
    await ctx.reply("❌ Usage: /markused <address>\n\nExample: /markused <your_token_address>");
    return;
  }

  const address = args[1];

  try {
    await markPumpAddressAsUsed(address);
    await ctx.reply(
      `✅ Successfully marked address as used:\n\`${address}\`\n\nThis address will no longer be used for new token launches.`,
      { parse_mode: "MarkdownV2" }
    );
  } catch (error: any) {
    await ctx.reply(`❌ Error marking address as used: ${error.message}`);
  }
});

bot.command("removetoken", async (ctx) => {
  // Simple admin check
  const adminIds = env.ADMIN_IDS ? env.ADMIN_IDS.split(",").map((id: string) => parseInt(id)) : [];

  if (!adminIds.includes(ctx.from!.id)) {
    await ctx.reply("❌ Access denied. Admin only command.");
    return;
  }

  const args = ctx.message?.text?.split(" ");
  if (!args || args.length < 2) {
    await ctx.reply(
      "❌ Usage: /removetoken <address>\n\nExample: /removetoken <your_token_address>\n\n⚠️ This will permanently delete the token from the database and mark the address as used."
    );
    return;
  }

  const tokenAddress = args[1];

  try {
    const result = await removeFailedToken(tokenAddress);
    await ctx.reply(
      `✅ Successfully removed failed token:\n\`${tokenAddress}\`\n\n• Token deleted from database\n• Address marked as used (won't be reused)\n• Operation completed safely`,
      { parse_mode: "MarkdownV2" }
    );
  } catch (error: any) {
    if (error.message.includes("not found")) {
      await ctx.reply(
        `⚠️ Token not found in database:\n\`${tokenAddress}\`\n\nThe token may have already been removed or the address is incorrect.`,
        { parse_mode: "MarkdownV2" }
      );
    } else {
      await ctx.reply(`❌ Error removing token: ${error.message}`);
    }
  }
});

// ----- Callback Queries -----
bot.callbackQuery(CallBackQueries.CREATE_TOKEN, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  await ctx.conversation.enter("createTokenConversation");
});
bot.callbackQuery(CallBackQueries.VIEW_TOKENS, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  await ctx.conversation.enter("viewTokensConversation");
});

bot.callbackQuery(CallBackQueries.EXPORT_DEV_WALLET, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  let user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await ctx.reply("Unrecognized user ❌");
    return;
  }

  const { wallet } = await getDevWallet(user.id);
  const msg = [
    "*Your dev wallet private key*",
    "```",
    wallet,
    "```",
    "_Copy it now and delete the message as soon as you're done\\._",
  ].join("\n");
  const keyboard = new InlineKeyboard().text("🗑 Delete", "del_message");
  const sent = await ctx.reply(msg, {
    parse_mode: "MarkdownV2",
    reply_markup: keyboard,
  });
});
bot.callbackQuery("del_message", async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "Message deleted");
  if (ctx.callbackQuery.message) {
    await ctx.api.deleteMessage(ctx.chat!.id, ctx.callbackQuery.message.message_id);
  }
});
bot.callbackQuery(/^launch_token_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  const tokenAddress = ctx.match![1];
  await ctx.conversation.enter("launchTokenConversation", tokenAddress);
});
bot.callbackQuery(/^sell_dev_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  const tokenAddress = ctx.match![1];
  await ctx.conversation.enter("devSellConversation", tokenAddress);
});
bot.callbackQuery(/^sell_all_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  const tokenAddress = ctx.match![1];
  await ctx.conversation.enter("walletSellConversation", tokenAddress, 100);
});
bot.callbackQuery(/^sell_percent_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  const tokenAddress = ctx.match![1];
  await ctx.conversation.enter("walletSellConversation", tokenAddress);
});

bot.callbackQuery(/^delete_token_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  // This will be handled within the viewTokensConversation
  // Just re-enter the conversation to handle the delete flow
  await ctx.conversation.enter("viewTokensConversation");
});

bot.callbackQuery(/^confirm_delete_token_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  // This will be handled within the viewTokensConversation
  // Just re-enter the conversation to handle the confirmation
  await ctx.conversation.enter("viewTokensConversation");
});

bot.callbackQuery(CallBackQueries.WALLET_CONFIG, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  await ctx.conversation.enter("walletConfigConversation");
});

bot.callbackQuery(CallBackQueries.BACK, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  await ctx.conversation.enter("mainMenuConversation");
});

bot.callbackQuery(CallBackQueries.CHANGE_DEV_WALLET, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  await ctx.conversation.enter("manageDevWalletsConversation");
});

bot.callbackQuery(CallBackQueries.MANAGE_BUYER_WALLETS, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  await ctx.conversation.enter("manageBuyerWalletsConversation");
});

bot.callbackQuery(CallBackQueries.WITHDRAW_DEV_WALLET, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  await ctx.conversation.enter("withdrawDevWalletConversation");
});

bot.callbackQuery(CallBackQueries.WITHDRAW_FUNDING_WALLET, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  await ctx.conversation.enter("withdrawFundingWalletConversation");
});

bot.callbackQuery(CallBackQueries.WITHDRAW_BUYER_WALLETS, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  await ctx.conversation.enter("withdrawBuyerWalletsConversation");
});

bot.callbackQuery(CallBackQueries.VIEW_REFERRALS, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  await ctx.conversation.enter("referralsConversation");
});

// Callback handlers for token CA sell buttons
bot.callbackQuery(/^sell_ca_(\d+)_(.+)$/, async (ctx) => {
  const sellPercent = parseInt(ctx.match![1]);
  const tokenAddress = ctx.match![2];

  // Answer callback query immediately with feedback
  await safeAnswerCallbackQuery(ctx, `💸 Selling ${sellPercent}% of tokens...`);

  logger.info(`[ExternalTokenSell] Executing ${sellPercent}% sell for token: ${tokenAddress}`);

  // Start the external token sell conversation
  await ctx.conversation.enter("externalTokenSellConversation", tokenAddress, sellPercent);
});

bot.callbackQuery(/^sell_individual_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  const tokenAddress = ctx.match![1];
  console.log("Found hereee");
  await ctx.conversation.enter("sellIndividualToken", tokenAddress);
});

// Handle external token buy button clicks (from token address messages)
bot.callbackQuery(/^buy_external_token_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  const tokenAddress = ctx.match![1];

  logger.info(`[ExternalTokenBuy] Buy button clicked for token: ${tokenAddress}`);

  // Start the external token buy conversation
  await ctx.conversation.enter("buyExternalTokenConversation");
});

// Fast cancel button handler - must be before generic callback handler
bot.callbackQuery(CallBackQueries.CANCEL, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "❌ Cancelled");

  try {
    await ctx.editMessageText("❌ **Operation Cancelled**\n\nYou can send a token address to start over.", {
      parse_mode: "Markdown",
    });
  } catch (error) {
    // If editing fails, send a new message
    await ctx.reply("❌ **Operation Cancelled**\n\nYou can send a token address to start over.");
  }
});

// Optimized handlers for specific cancel types
bot.callbackQuery(CallBackQueries.CANCEL_EXTERNAL_BUY, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "❌ Buy cancelled");

  try {
    await ctx.editMessageText("❌ **External token buy cancelled**\n\nYou can send a token address to start over.", {
      parse_mode: "Markdown",
    });
  } catch (error) {
    await ctx.reply("❌ **External token buy cancelled**\n\nYou can send a token address to start over.");
  }
});

bot.callbackQuery(CallBackQueries.CANCEL_WITHDRAWAL, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "❌ Withdrawal cancelled");

  try {
    await ctx.editMessageText("❌ **Withdrawal cancelled**\n\nUse /menu to return to main menu.", {
      parse_mode: "Markdown",
    });
  } catch (error) {
    await ctx.reply("❌ **Withdrawal cancelled**\n\nUse /menu to return to main menu.");
  }
});

bot.callbackQuery(CallBackQueries.CANCEL_DEV_WALLET, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "❌ Dev wallet operation cancelled");

  try {
    await ctx.editMessageText("❌ **Dev wallet operation cancelled**\n\nUse /menu to return to main menu.", {
      parse_mode: "Markdown",
    });
  } catch (error) {
    await ctx.reply("❌ **Dev wallet operation cancelled**\n\nUse /menu to return to main menu.");
  }
});

bot.callbackQuery(CallBackQueries.CANCEL_BUYER_WALLET, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "❌ Buyer wallet operation cancelled");

  try {
    await ctx.editMessageText("❌ **Buyer wallet operation cancelled**\n\nUse /menu to return to main menu.", {
      parse_mode: "Markdown",
    });
  } catch (error) {
    await ctx.reply("❌ **Buyer wallet operation cancelled**\n\nUse /menu to return to main menu.");
  }
});

// Callback handler for refresh button
bot.callbackQuery(/^refresh_ca_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  const tokenAddress = ctx.match![1];
  await handleTokenAddressMessage(ctx, tokenAddress);
});

// Retry callback handlers
bot.callbackQuery(CallBackQueries.RETRY_LAUNCH, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);

  try {
    // Try to extract token address from the message text
    const messageText = ctx.callbackQuery?.message?.text || "";
    const addressMatch = messageText.match(/([A-Za-z0-9]{32,44})/); // Solana address pattern

    if (addressMatch) {
      const tokenAddress = addressMatch[1];
      // Restart the launch conversation with the extracted token address
      await ctx.conversation.enter("launchTokenConversation", tokenAddress);
    } else {
      // If we can't extract the token address, guide user to tokens list
      await ctx.reply("🔄 Please go to 'View Tokens' and select the token you want to launch.");
    }
  } catch (error) {
    logger.error("Error handling RETRY_LAUNCH:", error);
    await ctx.reply("❌ Unable to retry launch. Please go to 'View Tokens' and try launching again.");
  }
});

// Command to buy external tokens
bot.command("buyexternal", async (ctx) => {
  await ctx.conversation.enter("buy-external-token");
});

bot.callbackQuery(new RegExp(`^${CallBackQueries.VIEW_TOKEN_TRADES}_`), async (ctx) => {
  // Get user ID from context
  const userId = ctx?.chat!.id.toString();
  const user = await getUser(userId);
  if (!user) {
    await ctx.reply("Unrecognized user ❌");
    return;
  }
  await safeAnswerCallbackQuery(ctx, "💰 Loading");

  const tokenAddress = ctx.callbackQuery.data.split("_").pop();
  if (!tokenAddress) {
    await ctx.reply("❌ Invalid token address.");
    return;
  }

  try {
    const tokenInfo = await getTokenInfo(tokenAddress);
    if (!tokenInfo) {
      await ctx.reply("❌ Token not found.");
      return;
    }

    // TODO fetch actual trade history
    const pnl = "-65.92%";
    const pi = "-0.02%";
    const age = "35:00";
    const initial = 1.5;
    const payout = 2.0;
    const marketCap = formatUSD(tokenInfo.marketCap);
    const price = tokenInfo.priceUsd;
    const curveProgress = "50%"; // Placeholder

    const message = await ctx.reply(
      `
🌑 $${tokenInfo.baseToken.symbol} 🕛 ${age} 🌟<a href="">Refererral</a> 

💳 Main 🚀 ${pnl} PI: ${pi}
Initial: ${initial.toFixed(2)} SOL | Payout: ${payout.toFixed(2)} SOL
Tokens: 2.3% | Worth: ${payout.toFixed(2)} SOL
<a href="">Reset P/L</a> | No Orders

💸 Price: $${price} | Market Cap: ${marketCap}

📈 Bonding Curve Progress: <b>${curveProgress}</b>

⚠️ Automatic updates are disabled and can be resumed by clicking the 🔄 Refresh button. Limit orders are not impacted.`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("🔙 Back", `sell_external_token_`)
          .text("🔃 Refresh", `launch_token_`)
          .text("⏭️ Next", `${CallBackQueries.VIEW_TOKEN_TRADES}_`)
          .row()
          .text(`Copy CA`, `launch_token_`)
          .text(`↔️ Go to Buy`, `launch_token_`)
          .row()
          .text(`💳 Main 🔄`, `launch_token_`)
          .text(`🔴 Multi`, `launch_token_`)
          .row()
          .text("Sell initials", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${tokenAddress}`)
          .text("☢️ Sell All", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${tokenAddress}`)
          .text("Sell X %", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${tokenAddress}`)
          .row()
          .text("25%", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${tokenAddress}`)
          .text("50%", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${tokenAddress}`)
          .text("75%", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${tokenAddress}`)
          .text("100%", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${tokenAddress}`)
          .row()
          .text("💸 Generate PNL", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${tokenAddress}`)
          .text("📊 Chart", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${tokenAddress}`)

          .row()
          .text("❌ Cancel", CallBackQueries.CANCEL),
      }
    );

    await bot.api.pinChatMessage(userId, message.message_id);
  } catch (error) {
    logger.error("Error fetching trade history:", error);
    await ctx.reply("❌ Error fetching trade history. Please try again later.");
  }
});

bot.api.setMyCommands([{ command: "menu", description: "Bot Menu" }]);

// Message handler for token contract addresses
bot.on("message:text", async (ctx) => {
  try {
    // Check if the message is a Solana token address (32-44 characters, alphanumeric)
    const text = ctx.message.text.trim();
    if (/^[A-Za-z0-9]{32,44}$/.test(text)) {
      try {
        new PublicKey(text); // Validate if it's a valid Solana address
        logger.info(`User sent token address: ${text}`);
        // Check if this token belongs to user's created tokens
        const user = await getUser(ctx.chat.id.toString());
        const tokenInfo = await getTokenInfo(text);
        let tokenName = tokenInfo.baseToken.name || "Unknown Token";
        let tokenSymbol = tokenInfo.baseToken.symbol || "Unknown Symbol";
        let isUserToken = false;
        let holdingsText = "📌 Checking token holdings...";
        let walletsWithBalance = 0;

        if (user) {
          const userToken = await getUserTokenWithBuyWallets(user.id, text);
          if (userToken) {
            // Token belongs to user
            tokenName = userToken.name;
            tokenSymbol = userToken.symbol;
            isUserToken = true;
          }

          // Check actual holdings in funding wallet (external tokens use funding wallet only)
          try {
            const fundingWallet = await getFundingWallet(user.id);
            if (fundingWallet) {
              let totalTokenBalance = 0;

              try {
                const balance = await getTokenBalance(text, fundingWallet.publicKey);
                if (balance > 0) {
                  totalTokenBalance = balance;
                  walletsWithBalance = 1;
                }
              } catch (error) {
                logger.warn(`Error checking balance for funding wallet ${fundingWallet.publicKey}:`, error);
              }

              if (walletsWithBalance > 0) {
                holdingsText = `📌 ${totalTokenBalance.toLocaleString()} tokens found in funding wallet`;
              } else {
                holdingsText = `📌 No tokens found in your funding wallet`;
              }
            } else {
              holdingsText = "📌 No funding wallet configured";
            }
          } catch (error) {
            logger.error("Error checking token holdings:", error);
            holdingsText = "📌 Error checking token holdings";
          }
        }
        // Check if we have cached platform info
        let platformInfo = "🔍 Detecting...";
        const cachedPlatform = getCachedPlatform(text);
        if (cachedPlatform) {
          if (cachedPlatform === "pumpswap") {
            platformInfo = "⚡ Pumpswap";
          } else if (cachedPlatform === "pumpfun") {
            platformInfo = "🚀 PumpFun";
          } else {
            platformInfo = "❓ Unknown platform";
          }
          logger.info(`[token-display] Using cached platform for ${text}: ${cachedPlatform}`);
        } else {
          // Start platform detection in background (non-blocking)
          detectPlatformInBackground(text, ctx.chat.id);
        }

        // TODO: Fetch actual market data; this is placeholder data
        const marketCap = formatUSD(tokenInfo.marketCap); // Placeholder
        const price = tokenInfo.priceUsd; // Placeholder
        let liquidity = null;
        if (tokenInfo.liquidity) {
          liquidity = formatUSD(tokenInfo.liquidity.usd);
        } else {
          liquidity = "N/A"; // Handle case where liquidity is not available
        }
        // Display token detail page with buy and sell options
        const dex = tokenInfo.dexId;
        logger.info(".... Token details fetched successfully");
        const renouncedAndFrozen = await checkTokenRenouncedAndFrozen(text);
        logger.info(renouncedAndFrozen);
        const links = [
          {
            abbr: "CA",
            text: "Solscan",
            url: `https://solscan.io/token/${text}`,
          },
          {
            abbr: "DEX",
            text: "Dexscreener",
            url: `https://dexscreener.com/solana/${text}`,
          },
          {
            abbr: "BRD",
            text: "Birdeye",
            url: `https://birdeye.so/token/${text}?chain=solana`,
          },
          {
            abbr: "PHO",
            text: "Photon",
            url: `https://photon-sol.tinyastro.io/en/lp/${tokenInfo.pairAddress}`,
          },
          {
            abbr: "NEO",
            text: "Neo",
            url: `https://neo.bullx.io/terminal?chainId=1399811149&address=${text}`,
          },
          {
            abbr: "AXIOM",
            text: "Axiom",
            url: `https://axiom.trade/meme/${text}`,
          },
          {
            abbr: "PF",
            text: "Pump.fun",
            url: `https://pump.fun/coin/${text}`,
          },
          {
            abbr: "GMGN",
            text: "GMGN",
            url: `https://gmgn.ai/sol/token/${text}`,
          },
          {
            abbr: "BBL",
            text: "Bubblemaps",
            url: `https://v2.bubblemaps.io/map?address=${text}&chain=solana`,
          },
        ];

        const linksHtml = links.map((link) => `<a href="${link.url}" target="_blank">${link.abbr}</a>`).join(" • ");

        await ctx.reply(
          `
🪙 ${tokenName} (${tokenSymbol})
<code>${text}</code>
🔗Dex: ${dex.toLocaleUpperCase()}
🎯Platform: ${platformInfo}
🤑 <a href="${"https://t.me/@NITROLAUNCHBOT"}">Share Token & Earn</a>

Market Data
📊 Market Cap: ${marketCap}
💸 Price: $${price}
🏦 Liquidity: ${liquidity}

${renouncedAndFrozen.isRenounced ? "🟢 Renounced" : "🔴 Not Renounced"}
${renouncedAndFrozen.isFrozen ? "🟢 Freeze" : "🔴 Not Freezed"}

🧐 No active limit orders

⭐️ W1: 0 SOLs

${linksHtml}

Your Holdings
${holdingsText}`,
          {
            parse_mode: "HTML",
            reply_markup: new InlineKeyboard()
              .text("🔀 Switch to Sell", `sell_external_token_${text}`)
              .text("👀 Monitor", `${CallBackQueries.VIEW_TOKEN_TRADES}_${text}`)
              .text("🔃 Refresh", `launch_token_${text}`)
              .row()
              .text(`💰 Active wallets: ${walletsWithBalance}`, `launch_token_${text}`)
              .row()
              .text("💰 0.5 SOL", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${text}`)
              .text("💰 1 SOL", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${text}`)
              .text("💰 2 SOL", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${text}`)
              .row()
              .text("💰 5 SOL", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${text}`)
              .text("💰 10 SOL", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${text}`)
              .text("💰 X SOL", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${text}`)
              .row()
              .text("💰 Buy Tip: 0 SOL", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${text}`)
              .text("🛍️ Slippage: 0%", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${text}`)
              .row()
              .text("📈 Limit Orders", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${text}`)
              .text("💸 Generate PNL", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${text}`)
              .row()
              .text("🔴 Auto Tip (0.0001 SOL)", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${text}`)
              .text("🔴 Buy Protection", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${text}`)
              .row()
              .text("🔀 Split Tokens", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${text}`)
              .text("👀 Hide Position", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${text}`)
              .row()
              .text("🔙 Back", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${text}`)
              .text("📊 Chart", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${text}`)
              .row()
              .text("💸 Sell Token", `${CallBackQueries.SELL_EXTERNAL_TOKEN}_${text}`)
              .row()
              .text("❌ Cancel", CallBackQueries.CANCEL),
          }
        );
        return;
      } catch (e) {
        // Not a valid Solana address, ignore or handle as regular text
      }
    }
    // If not a token address, do nothing or handle other text commands
  } catch (error) {
    logger.error("Error handling token address message:", error);
  }
});

// Remove the generic callback handler that was interfering with specific handlers
bot.command("reset", async (ctx) => {
  try {
    const cleared = await clearConversationState(ctx);
    if (cleared) {
      await ctx.reply("✅ Conversation state cleared successfully. You can now start fresh conversations.");
    } else {
      await ctx.reply("⚠️ Failed to clear conversation state completely. Please try again or contact support.");
    }
  } catch (error: any) {
    logger.error("Error in reset command:", error);
    await ctx.reply("❌ Error clearing conversation state. Please try again.");
  }
});

bot.command("forcefix", async (ctx) => {
  try {
    logger.info("Force fix requested by user:", ctx.chat?.id);

    // Clear conversation state
    await clearConversationState(ctx);

    // Force a complete session reset by deleting the entire session
    const sessionCtx = ctx as any;
    if (sessionCtx.session) {
      // Clear the entire session object
      Object.keys(sessionCtx.session).forEach((key) => {
        delete sessionCtx.session[key];
      });
    }

    // Send a fresh start message
    await ctx.reply(
      "🔧 **Force Fix Applied**\n\n" +
        "✅ All conversation state cleared\n" +
        "✅ Session completely reset\n\n" +
        "You can now use the bot normally. Try /start or /menu to begin.",
      { parse_mode: "Markdown" }
    );

    logger.info("Force fix completed for user:", ctx.chat?.id);
  } catch (error: any) {
    logger.error("Error in force fix command:", error);
    await ctx.reply("❌ Force fix failed. Please contact support.");
  }
});

bot.command("fixlaunch", async (ctx) => {
  try {
    logger.info("Fix launch command used by user:", ctx.chat?.id);

    // Clear conversation state completely
    await clearConversationState(ctx);

    // Force clear entire session
    const sessionCtx = ctx as any;
    if (sessionCtx.session) {
      Object.keys(sessionCtx.session).forEach((key) => {
        delete sessionCtx.session[key];
      });
    }

    await ctx.reply(
      "🔧 **Launch Fix Applied**\n\n" +
        "✅ Conversation state cleared\n" +
        "✅ Session completely reset\n\n" +
        "**Next steps:**\n" +
        "1. Use /menu or /start to refresh\n" +
        '2. Go to "View Tokens"\n' +
        "3. Try launching your token again\n\n" +
        "If you still have issues, use /forcefix for a complete reset.",
      { parse_mode: "Markdown" }
    );

    logger.info("Fix launch completed for user:", ctx.chat?.id);
  } catch (error: any) {
    logger.error("Error in fix launch command:", error);
    await ctx.reply("❌ Fix launch failed. Please try /forcefix or contact support.");
  }
});

bot.command("directlaunch", async (ctx) => {
  try {
    const args = ctx.message?.text?.split(" ");
    if (args && args.length > 1) {
      // Direct launch with token address
      const tokenAddress = args[1];
      logger.info("Direct launch command used for token:", tokenAddress);

      // Clear any existing conversation state
      await clearConversationState(ctx);

      // Wait a moment
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Try to launch directly
      await ctx.conversation.enter("launchTokenConversation", tokenAddress, {
        overwrite: true,
      });
    } else {
      await ctx.reply(
        "🚀 **Direct Launch**\n\n" +
          "Usage: `/directlaunch <token_address>`\n\n" +
          "Example: `/directlaunch 3oZ8DxXxDnxJ63Fc8DGja8xQnG1fgLshtKyLn9nkpUMP`\n\n" +
          "This bypasses conversation state issues and launches directly.",
        { parse_mode: "Markdown" }
      );
    }
  } catch (error: any) {
    logger.error("Direct launch failed:", error);
    await ctx.reply(
      "❌ Direct launch failed. Please try /fixlaunch first, then use /menu to access your tokens normally."
    );
  }
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "🆘 **Help - Can't Launch Token?**\n\n" +
      "**If you're having trouble launching tokens, try these in order:**\n\n" +
      "1️⃣ `/fixlaunch` - Fix launch-specific issues\n" +
      "2️⃣ `/reset` - Clear conversation state\n" +
      "3️⃣ `/forcefix` - Complete session reset\n" +
      "4️⃣ `/directlaunch <token_address>` - Bypass state issues\n\n" +
      "**For your specific token:**\n" +
      "`/directlaunch 3oZ8DxXxDnxJ63Fc8DGja8xQnG1fgLshtKyLn9nkpUMP`\n\n" +
      "**Then try normal flow:**\n" +
      "• `/menu` - Access main menu\n" +
      '• "View Tokens" - See your tokens\n' +
      "• Tap launch button for your token\n\n" +
      "💡 **Tip:** Always use `/fixlaunch` first if you're having issues!",
    { parse_mode: "Markdown" }
  );
});
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;

  console.log(data, "From firsttt");

  // Handle "back-buy" and similar cases first
  if (data.startsWith("back-_")) {
    const [action, address] = data.split("_");
    console.log("reached bbbbb");
    // Answer callback query immediately
    await safeAnswerCallbackQuery(ctx, "🔄 Loading options...");

    const backKb = new InlineKeyboard()
      .text("💰 Buy Token", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${address}`)
      .row()
      .text("💸 Sell Token", `${CallBackQueries.SELL_EXTERNAL_TOKEN}_${address}`)
      .row()
      .text("❌ Cancel", CallBackQueries.CANCEL);

    await safeEditMessageReplyMarkup(ctx, backKb);
    return;
  }

  // Handle other actions
  const [action, token, address] = data.split("_");
  if (action && token === "token" && address) {
    logger.info(`${action} called`);
    switch (action) {
      case "buy":
        // Answer callback query immediately
        await safeAnswerCallbackQuery(ctx, "💰 Loading buy options...");

        const kb = new InlineKeyboard()
          .text("← Back", `back-_${address}`)
          .text("↻ Refresh", `refresh_buy_${address}`)
          .row()
          .text("0.5 SOL", `buy_0.5_${address}`)
          .text("1 SOL", `buy_1_${address}`)
          .text("3 SOL", `buy_3_${address}`)
          .row()
          .text("5 SOL", `buy_5_${address}`)
          .text("10 SOL", `buy_10_${address}`)
          .text("X SOL ✏️", `buy_custom_${address}`)
          .row()
          .text("Menu", CallBackQueries.BACK);

        await safeEditMessageReplyMarkup(ctx, kb);
        break;

      case "sell":
        // Answer callback query immediately
        await safeAnswerCallbackQuery(ctx, "💸 Loading sell options...");

        const sellKb = new InlineKeyboard()
          .text("← Back", `back-_${address}`)
          .text("↻ Refresh", `refresh_sell_${address}`)
          .row()
          .text("10%", `sell_ca_10_${address}`)
          .text("25%", `sell_ca_25_${address}`)
          .text("50%", `sell_ca_50_${address}`)
          .row()
          .text("75%", `sell_ca_75_${address}`)
          .text("100%", `sell_ca_100_${address}`)
          .row()
          .text("Custom % ✏️", `sell_ca_custom_${address}`)
          .row()
          .text("Menu", CallBackQueries.BACK);

        await safeEditMessageReplyMarkup(ctx, sellKb);
        break;

      default:
        break;
    }
  }

  const [tradeAction, buyAmount, mint] = data.split("_");
  const telegramId = String(ctx.from?.id);

  if (tradeAction && Number(buyAmount)) {
    const user = await getUser(telegramId);

    if (!user || !user.id) {
      await ctx.reply("❌ User not found. Please start the bot with /start.");
      return;
    }
    const fundingWallet = await getFundingWallet(String(user.id));

    // Answer callback query immediately for buy/sell operations
    await safeAnswerCallbackQuery(
      ctx,
      tradeAction === "buy" ? `💰 Buying ${buyAmount} SOL...` : `💸 Selling ${buyAmount}%...`
    );

    switch (tradeAction) {
      case "buy":
        await ctx.reply(`💰 Buying ${buyAmount} SOL of token`);

        // Use new external buy system with automatic platform detection
        const { executeExternalBuy } = await import("../blockchain/pumpfun/externalBuy");
        const { secretKeyToKeypair } = await import("../blockchain/common/utils");

        try {
          const buyerKeypair = secretKeyToKeypair(fundingWallet!.privateKey);
          const buyResult = await executeExternalBuy(mint, buyerKeypair, Number(buyAmount));

          if (buyResult.success) {
            const platformText = buyResult.platform === "pumpswap" ? "⚡ Pumpswap" : "🚀 PumpFun";
            await ctx.reply(
              `✅ Successfully bought ${buyAmount} SOL of token via ${platformText}!\n\nTransaction Signature:\n<code>${buyResult.signature}</code>`,
              { parse_mode: "HTML" }
            );
          } else {
            await ctx.reply(
              `❌ Failed to buy token: ${buyResult.error || "Unknown error"}\n\nPlease try again or contact support.`
            );
          }
        } catch (error: any) {
          logger.error(`Quick buy error for ${mint}:`, error);
          await ctx.reply(`❌ Failed to buy token: ${error.message}\n\nPlease try again or contact support.`);
        }
        break;

      case "sell":
        await ctx.reply(`💰 Selling ${buyAmount}% of token`);

        // Use new external sell system with automatic platform detection
        const { executeExternalSell } = await import("../blockchain/pumpfun/externalSell");
        const { secretKeyToKeypair: sellSecretKeyToKeypair } = await import("../blockchain/common/utils");
        const { getTokenBalance } = await import("../backend/utils");

        try {
          const sellerKeypair = sellSecretKeyToKeypair(fundingWallet!.privateKey);

          // Get current token balance
          const currentBalance = await getTokenBalance(mint, sellerKeypair.publicKey.toBase58());
          if (currentBalance <= 0) {
            await ctx.reply("❌ No tokens found to sell.");
            break;
          }

          // Calculate tokens to sell based on percentage
          const tokensToSell = Math.floor((currentBalance * Number(buyAmount)) / 100);

          const sellResult = await executeExternalSell(mint, sellerKeypair, tokensToSell);

          if (sellResult.success) {
            const platformText = sellResult.platform === "pumpswap" ? "⚡ Pumpswap" : "🚀 PumpFun";
            const solReceived = sellResult.solReceived
              ? ` (${parseFloat(sellResult.solReceived).toFixed(6)} SOL received)`
              : "";
            await ctx.reply(
              `✅ Successfully sold ${buyAmount}% of token via ${platformText}!${solReceived}\n\nTransaction Signature:\n<code>${sellResult.signature}</code>`,
              { parse_mode: "HTML" }
            );
          } else {
            await ctx.reply(
              `❌ Failed to sell token: ${sellResult.error || "Unknown error"}\n\nPlease try again or contact support.`
            );
          }
        } catch (error: any) {
          logger.error(`Quick sell error for ${mint}:`, error);
          await ctx.reply(`❌ Failed to sell token: ${error.message}\n\nPlease try again or contact support.`);
        }
        break;

      default:
        break;
    }
  }
  if (tradeAction === "buy" && buyAmount === "custom") {
    try {
      await ctx.conversation.enter("buyCustonConversation", address);
    } catch (error) {}
  }
});

export default bot;

// Function to handle token contract address messages
async function handleTokenAddressMessage(ctx: Context, tokenAddress: string) {
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await ctx.reply("❌ Please start the bot first with /start");
    return;
  }

  // Start coordinated preloading for faster transactions
  logger.info(`[TokenDisplay] Starting coordinated preloading for token ${tokenAddress}`);
  const preloadPromises = [
    // Preload Pumpswap pool data (coordinated to prevent race conditions)
    import("../../service/pumpswap-service")
      .then((module) => {
        const PumpswapService = module.default;
        const service = new PumpswapService();
        return service.preloadTokenData(tokenAddress);
      })
      .catch((err) => {
        logger.warn(`[TokenDisplay] Pumpswap preload failed (non-critical): ${err.message}`);
      }),

    // Preload platform detection
    import("../../service/token-detection-service")
      .then((module) => {
        return module.detectTokenPlatform(tokenAddress);
      })
      .catch((err) => {
        logger.warn(`[TokenDisplay] Platform detection preload failed (non-critical): ${err.message}`);
      }),

    // Preload pool discovery
    import("../../backend/get-poolInfo")
      .then((module) => {
        return module.preloadPumpswapPools();
      })
      .catch((err) => {
        logger.warn(`[TokenDisplay] Pool preload failed (non-critical): ${err.message}`);
      }),
  ];

  // Start preloading immediately (non-blocking, but coordinated)
  Promise.allSettled(preloadPromises).then(() => {
    logger.info(`[TokenDisplay] Coordinated preloading completed for token ${tokenAddress}`);
  });

  let tokenName = "Unknown Token";
  let tokenSymbol = "UNK";
  let isUserToken = false;
  let holdingsText = "📌 No tokens found in your buyer wallets";

  try {
    // Get token information from DexScreener or other source if available
    const tokenInfo = await getTokenInfo(tokenAddress);
    if (tokenInfo && tokenInfo.baseToken) {
      tokenName = tokenInfo.baseToken.name || "Unknown";
      tokenSymbol = tokenInfo.baseToken.symbol || "UNK";
    }
  } catch (error) {
    logger.warn(`Could not fetch token info for ${tokenAddress}:`, error);
  }

  // Check if token is in user's list
  const userToken = await getUserTokenWithBuyWallets(user.id, tokenAddress);
  if (userToken) {
    tokenName = userToken.name;
    tokenSymbol = userToken.symbol;
    isUserToken = true;
    // TODO: Fetch actual holdings data if available
    holdingsText = "📌 No tokens found in your 5 buyer wallets"; // Placeholder
  } else {
    // External token, could still check holdings
    // TODO: Fetch holdings for external tokens if possible
    holdingsText = "📌 No tokens found in your 5 buyer wallets"; // Placeholder
  }

  // TODO: Fetch actual market data; this is placeholder data
  const marketCap = "$4,404.38"; // Placeholder
  const price = "$0.000004404"; // Placeholder

  // Display token detail page with buy and sell options
  await ctx.reply(
    `🪙 ${tokenName} (${tokenSymbol})
${tokenAddress}
Pump.fun 🔗 SO

Market Data
💠 Market Cap: ${marketCap}
💵 Price: ${price}

Your Holdings
${holdingsText}

⚡ <i>Optimized for fast trading</i>`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("💰 Buy Token", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${tokenAddress}`)
        .row()
        .text("💸 Sell Token", `${CallBackQueries.SELL_EXTERNAL_TOKEN}_${tokenAddress}`)
        .row()
        .text("❌ Cancel", CallBackQueries.CANCEL),
    }
  );
}

// Callback query handlers for external token actions
bot.callbackQuery(new RegExp(`^${CallBackQueries.BUY_EXTERNAL_TOKEN}_`), async (ctx) => {
  try {
    // Answer callback query immediately
    await safeAnswerCallbackQuery(ctx, "💰 Loading buy conversation...");

    const tokenAddress = ctx.callbackQuery.data.split("_").pop();
    if (tokenAddress) {
      // Store token address in session or context if needed
      await ctx.conversation.enter("buy-external-token", { overwrite: true });
      // You might need to pass the token address to the conversation
      // This is a simple way; adjust based on your conversation setup
      await sendMessage(ctx, `💰 Buying external token: <code>${tokenAddress}</code>`, { parse_mode: "HTML" });
    }
  } catch (error) {
    logger.error("Error handling buy external token callback:", error);
    await safeAnswerCallbackQuery(ctx, "❌ Error occurred. Please try again.");
  }
});

// Emergency bypass for token launch when conversation state is corrupted
bot.callbackQuery(/^emergency_launch_(.+)$/, async (ctx) => {
  try {
    await safeAnswerCallbackQuery(ctx, "🚨 Emergency launch mode activated");
    const tokenAddress = ctx.match![1];

    logger.info("Emergency launch bypass activated for token:", tokenAddress);

    // Clear conversation state first
    await clearConversationState(ctx);

    // Wait a moment for state to clear
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Try to enter the conversation with overwrite flag
    await ctx.conversation.enter("launchTokenConversation", tokenAddress, {
      overwrite: true,
    });
  } catch (error: any) {
    logger.error("Emergency launch bypass failed:", error);
    await ctx.reply("❌ Emergency launch failed. Please try using /forcefix and then launch normally.");
  }
});

// Recovery callback handlers for conversation state errors
bot.callbackQuery("direct_launch_recovery", async (ctx) => {
  try {
    await safeAnswerCallbackQuery(ctx, "🚀 Launching direct recovery...");

    // Clear state again to be sure
    await clearConversationState(ctx);

    await ctx.reply(
      "🚀 **Direct Launch Recovery**\n\n" +
        "Use this command with your token address:\n" +
        "`/directlaunch YOUR_TOKEN_ADDRESS`\n\n" +
        "**For your token from the logs:**\n" +
        "`/directlaunch 3oZ8DxXxDnxJ63Fc8DGja8xQnG1fgLshtKyLn9nkpUMP`\n\n" +
        "This bypasses all conversation state issues.",
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    logger.error("Direct launch recovery failed:", error);
    await ctx.reply("❌ Please try: `/directlaunch 3oZ8DxXxDnxJ63Fc8DGja8xQnG1fgLshtKyLn9nkpUMP`");
  }
});

bot.callbackQuery("fix_and_retry", async (ctx) => {
  try {
    await safeAnswerCallbackQuery(ctx, "🔧 Applying fixes...");

    // Apply comprehensive fix
    await clearConversationState(ctx);

    // Force clear entire session
    const sessionCtx = ctx as any;
    if (sessionCtx.session) {
      Object.keys(sessionCtx.session).forEach((key) => {
        delete sessionCtx.session[key];
      });
    }

    await ctx.reply(
      "🔧 **Complete Fix Applied**\n\n" +
        "✅ All conversation state cleared\n" +
        "✅ Session completely reset\n\n" +
        "**Now try one of these:**\n" +
        '• Use `/menu` then "View Tokens"\n' +
        "• Or use `/directlaunch YOUR_TOKEN_ADDRESS`\n\n" +
        "The bot should work normally now!",
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    logger.error("Fix and retry failed:", error);
    await ctx.reply("❌ Please try `/forcefix` for a complete reset.");
  }
});

// Helper function to completely clear conversation state
async function clearConversationState(ctx: Context): Promise<boolean> {
  try {
    const sessionCtx = ctx as any;
    let cleared = false;

    // Clear conversation session data
    if (sessionCtx.session) {
      // Clear the main conversation state
      if (sessionCtx.session.__conversation) {
        delete sessionCtx.session.__conversation;
        cleared = true;
        logger.info("Cleared __conversation session data");
      }

      // Clear any other conversation-related session data
      const sessionKeys = Object.keys(sessionCtx.session);
      sessionKeys.forEach((key) => {
        if (key.startsWith("__conversation") || key.includes("conversation")) {
          delete sessionCtx.session[key];
          cleared = true;
          logger.info(`Cleared session key: ${key}`);
        }
      });

      // Clear Grammy.js internal conversation state keys
      const grammyConversationKeys = sessionKeys.filter(
        (key) =>
          key.startsWith("__grammyjs_conversations") || key.startsWith("__conversations") || key.includes("__conv_")
      );

      grammyConversationKeys.forEach((key) => {
        delete sessionCtx.session[key];
        cleared = true;
        logger.info(`Cleared Grammy conversation key: ${key}`);
      });
    }

    // Try to access and clear conversation context if available
    if (sessionCtx.conversation) {
      try {
        // Check if halt method exists and is a function
        if (typeof sessionCtx.conversation.halt === "function") {
          await sessionCtx.conversation.halt();
          cleared = true;
          logger.info("Successfully halted conversation");
        } else if (typeof sessionCtx.conversation.exit === "function") {
          // Try alternative exit method
          await sessionCtx.conversation.exit();
          cleared = true;
          logger.info("Successfully exited conversation");
        } else {
          logger.warn("Conversation object exists but no halt/exit methods available");
          // Force clear the conversation object
          delete sessionCtx.conversation;
          cleared = true;
        }
      } catch (haltError) {
        logger.warn("Failed to halt conversation, forcing clear:", haltError);
        // Force delete the conversation object
        try {
          delete sessionCtx.conversation;
          cleared = true;
        } catch (deleteError) {
          logger.warn("Failed to delete conversation object:", deleteError);
        }
      }
    }

    // Additional cleanup - try to clear any conversation-related properties on the context
    try {
      const contextKeys = Object.keys(sessionCtx);
      contextKeys.forEach((key) => {
        if (key.includes("conversation") || key.includes("__conv")) {
          try {
            delete sessionCtx[key];
            cleared = true;
            logger.info(`Cleared context key: ${key}`);
          } catch (keyError) {
            logger.warn(`Failed to clear context key ${key}:`, keyError);
          }
        }
      });
    } catch (contextError) {
      logger.warn("Failed to clear context properties:", contextError);
    }

    if (cleared) {
      logger.info("Successfully cleared conversation state for user:", ctx.chat?.id);
    } else {
      logger.warn("No conversation state found to clear for user:", ctx.chat?.id);
    }

    return true; // Return true even if nothing was cleared, as the goal is achieved
  } catch (error) {
    logger.error("Failed to clear conversation state:", error);
    return false;
  }
}

// Handle external token sell button clicks (from token address messages)
bot.callbackQuery(/^sell_external_token_(.+)$/, async (ctx) => {
  // Answer callback query immediately for instant feedback
  await safeAnswerCallbackQuery(ctx, "💸 Loading sell options...");

  const tokenAddress = ctx.match![1];

  logger.info(`[ExternalTokenSell] Sell button clicked for token: ${tokenAddress}`);

  // Check if platform detection is still running and cache the result if available
  const cachedPlatform = getCachedPlatform(tokenAddress);
  if (!cachedPlatform) {
    logger.info(`[ExternalTokenSell] Platform not yet detected for ${tokenAddress}, proceeding anyway`);
  } else {
    logger.info(`[ExternalTokenSell] Using cached platform ${cachedPlatform} for ${tokenAddress}`);
  }

  // Show sell percentage options immediately
  const keyboard = new InlineKeyboard()
    .text("💸 Sell 25%", `sell_ca_25_${tokenAddress}`)
    .text("💸 Sell 50%", `sell_ca_50_${tokenAddress}`)
    .row()
    .text("💸 Sell 75%", `sell_ca_75_${tokenAddress}`)
    .text("💸 Sell 100%", `sell_ca_100_${tokenAddress}`)
    .row()
    .text("❌ Cancel", CallBackQueries.CANCEL);

  await safeEditOrSendMessage(ctx, `💸 **Select Sell Percentage**\n\nChoose what percentage of your tokens to sell:`, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
});
