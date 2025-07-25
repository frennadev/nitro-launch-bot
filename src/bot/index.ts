import {
  Bot,
  InlineKeyboard,
  type Context,
  type BotError,
  GrammyError,
  HttpError,
} from "grammy";
import {
  Conversation,
  conversations,
  createConversation,
  type ConversationFlavor,
} from "@grammyjs/conversations";
import { env } from "../config";
import {
  rateLimitCommands,
  rateLimitCallbacks,
  rateLimitMessages,
  rateLimitTokenOperations,
  rateLimitWalletOperations,
  rateLimitTradingOperations,
  getRateLimitStats,
  resetRateLimits,
} from "./rateLimiter";
import {
  createUser,
  getDevWallet,
  getDefaultDevWallet,
  getTokensForUser,
  getUser,
  getUserToken,
  getOrCreateFundingWallet,
  getPumpAddressStats,
  markPumpAddressAsUsed,
  removeFailedToken,
  getAllBuyerWallets,
  getUserTokenWithBuyWallets,
  createUserWithReferral,
  getFundingWallet,
  getWalletForTrading,
  enqueueDevSell,
  generateReferralLink,
  checkSellAmountWithoutDecimals,
} from "../backend/functions";
import { CallBackQueries } from "./types";
import {
  escape,
  formatUSD,
  safeEditMessageReplyMarkup,
  safeEditMessageText,
  safeEditOrSendMessage,
} from "./utils";
import launchTokenConversation from "./conversation/launchToken";
import createTokenConversation from "./conversation/createToken";
import {
  devSellConversation,
  devSell100Conversation,
} from "./conversation/devSell";
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
import {
  getTokenInfo,
  getTokenBalance,
  decryptPrivateKey,
  checkTokenRenouncedAndFrozen,
  getSolBalance,
} from "../backend/utils";
import { getTransactionFinancialStats } from "../backend/functions-main";
import { buyExternalTokenConversation } from "./conversation/externalTokenBuy";
import { referralsConversation } from "./conversation/referrals";
import { ctoConversation } from "./conversation/ctoConversation";
import { ctoMonitorConversation } from "./conversation/ctoMonitor";
import { PublicKey } from "@solana/web3.js";
import { executeFundingBuy } from "../blockchain/pumpfun/buy";
import { buyCustonConversation } from "./conversation/buyCustom";
import { executeDevSell, executeWalletSell } from "../blockchain/pumpfun/sell";
import { sellIndividualToken } from "./conversation/sellIndividualToken";
import helpConversation from "./conversation/help";
import {
  getCachedPlatform,
  setCachedPlatform,
  detectTokenPlatformWithCache,
  markTokenAsPumpswap as markTokenAsPumpswapService,
  markTokenAsPumpFun,
} from "../service/token-detection-service";
import { TokenModel } from "../backend/models";
import { handleSingleSell } from "../blockchain/common/singleSell";
import { sellPercentageMessage } from "./conversation/sellPercent";
import { sendErrorWithAutoDelete } from "./utils";
import { startLoadingState } from "./loading";
import { TokenInfoService } from "../service/token-info-service";
import { airdropSolConversation } from "./conversation/airdropSol";
import { predictMcConversation } from "./conversation/predictMc";

// Platform detection and caching for external tokens
const platformCache = new Map<
  string,
  {
    platform: "pumpswap" | "pumpfun" | "unknown";
    timestamp: number;
    permanent: boolean;
  }
>();

// Cache TTL: 5 minutes for temporary results, permanent for confirmed detections
const PLATFORM_CACHE_TTL = 5 * 60 * 1000;

// Platform detection now handled by service layer

// Export function for external use
export function markTokenAsPumpswap(tokenAddress: string) {
  platformCache.set(tokenAddress, {
    platform: "pumpswap",
    timestamp: Date.now(),
    permanent: true,
  });
  console.log(
    `[platform-cache]: Cached ${tokenAddress.substring(0, 8)} as pumpswap (permanent: true)`
  );
}

// Export function for use in external buy/sell operations
export function getPlatformFromCache(
  tokenAddress: string
): "pumpswap" | "pumpfun" | "unknown" | null {
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
async function detectPlatformInBackground(
  tokenAddress: string,
  chatId: number
) {
  const logId = `bg-detect-${tokenAddress.substring(0, 8)}`;

  try {
    logger.info(`[${logId}]: Starting fast background platform detection`);

    // Use fast detection that respects recent cache
    const { detectTokenPlatformFast } = await import(
      "../service/token-detection-service"
    );
    const platform = await detectTokenPlatformFast(tokenAddress);
    logger.info(`[${logId}]: Fast background detection completed: ${platform}`);

    // Update the token display with platform info
    // Note: We're not updating the message here since it's background detection
    // The platform info will be available immediately on next view due to caching
  } catch (error: any) {
    logger.error(
      `[${logId}]: Fast background platform detection failed: ${error.message}`
    );
  }
}

export const bot = new Bot<ConversationFlavor<Context>>(env.TELEGRAM_BOT_TOKEN);

// Apply rate limiting middleware globally
bot.use(rateLimitCommands()); // Rate limit all commands
bot.use(rateLimitCallbacks()); // Rate limit callback queries
bot.use(rateLimitMessages()); // Rate limit message handling

// Global error handler
bot.catch(async (err: BotError<ConversationFlavor<Context>>) => {
  const ctx = err.ctx;

  // Check for callback query timeout errors FIRST (before logging as errors)
  if (
    err.error instanceof GrammyError &&
    (err.error.description.includes("query is too old") ||
      err.error.description.includes("response timeout expired") ||
      err.error.description.includes("query ID is invalid"))
  ) {
    logger.debug("Callback query timeout ignored (normal behavior):", {
      description: err.error.description,
      user: ctx.from?.username || ctx.from?.id,
      callback_data: ctx.callbackQuery?.data,
    });
    return;
  }

  // Handle Grammy.js conversation state errors
  if (
    err.stack &&
    (err.stack.includes("Bad replay, expected op") ||
      err.stack.includes(
        "Cannot begin another operation after the replay has completed"
      ) ||
      err.stack.includes("are you missing an `await`?"))
  ) {
    logger.warn(
      "Grammy.js conversation state error detected in global handler:",
      {
        error: err.message,
        stack: err.stack?.split("\n").slice(0, 3).join("\n"), // First 3 lines of stack
        user: ctx.from?.username || ctx.from?.id,
        callback_data: ctx.callbackQuery?.data,
      }
    );

    // Clear the conversation state completely
    const cleared = await clearConversationState(ctx);
    logger.info(`Conversation state cleared: ${cleared}`);

    // Send user-friendly message with recovery options
    if (ctx.chat) {
      try {
        const keyboard = new InlineKeyboard()
          .text("🔧 Main Menu", CallBackQueries.BACK)
          .text("📋 View Tokens", CallBackQueries.VIEW_TOKENS)
          .row()
          .text("💳 Wallet Config", CallBackQueries.WALLET_CONFIG);

        await sendMessage(
          ctx,
          "🔧 **Session Reset Complete**\n\n" +
            "✅ Conversation state cleared\n" +
            "✅ Ready for new operations\n\n" +
            "**You can now continue using the bot:**",
          {
            parse_mode: "Markdown",
            reply_markup: keyboard,
          }
        );
      } catch (replyError: any) {
        logger.error(
          "Failed to send conversation reset message:",
          replyError.message
        );
      }
    }
    return;
  }

  // Handle message editing errors (common with long operations)
  if (
    err.error instanceof GrammyError &&
    (err.error.description.includes("message is not modified") ||
      err.error.description.includes("message to edit not found"))
  ) {
    logger.debug("Message edit error ignored (normal behavior):", {
      description: err.error.description,
      user: ctx.from?.username || ctx.from?.id,
    });
    return;
  }

  // Log other errors (after filtering out common timeouts and state issues)
  logger.error("Error in bot middleware:", {
    error: err.error instanceof Error ? err.error.message : String(err.error),
    name: err.error instanceof Error ? err.error.name : "UnknownError",
    user: ctx.from?.username || ctx.from?.id,
    update_type: ctx.update.message
      ? "message"
      : ctx.update.callback_query
        ? "callback_query"
        : "other",
    stack: err.stack?.split("\n").slice(0, 5).join("\n"), // First 5 lines of stack
  });

  // For other errors, try to notify the user if possible
  if (ctx.chat) {
    try {
      await sendErrorWithAutoDelete(
        ctx,
        "❌ An unexpected error occurred. Please try the main menu or contact support."
      );
    } catch (notifyError: any) {
      logger.error("Failed to send error notification:", notifyError.message);
    }
  }
});

// Safe wrapper for answerCallbackQuery to handle timeout errors
async function safeAnswerCallbackQuery(
  ctx: Context,
  text?: string
): Promise<void> {
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

// Clear conversation state helper function
async function clearConversationState(ctx: any): Promise<boolean> {
  try {
    if (ctx.conversation) {
      await ctx.conversation.exit();
    }
    return true;
  } catch (error: any) {
    logger.error("Error clearing conversation state:", error);
    return false;
  }
}

// Handle token address message helper
async function handleTokenAddressMessage(ctx: any, tokenAddress: string) {
  try {
    await ctx.conversation.enter("externalTokenBuyConversation", {
      tokenAddress,
    });
  } catch (error: any) {
    logger.error("Error handling token address message:", error);
    await sendMessage(
      ctx,
      "❌ Error processing token address. Please try again."
    );
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
      logger.warn(
        "Conversation replay error caught in middleware:",
        error.message
      );

      // Clear conversation state completely
      const cleared = await clearConversationState(ctx);

      // Instead of just showing an error, provide immediate recovery options
      const keyboard = new InlineKeyboard()
        .text("🚀 Direct Launch Token", "direct_launch_recovery")
        .row()
        .text("🔧 Fix & Try Again", "fix_and_retry")
        .row()
        .text("📋 View Tokens", CallBackQueries.VIEW_TOKENS);

      await sendMessage(
        ctx,
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
bot.use(createConversation(devSell100Conversation));
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
bot.use(createConversation(ctoConversation));
bot.use(createConversation(ctoMonitorConversation));
bot.use(createConversation(buyCustonConversation));
bot.use(createConversation(sellIndividualToken));
bot.use(createConversation(sellPercentageMessage));
bot.use(createConversation(helpConversation));
bot.use(createConversation(airdropSolConversation));
bot.use(createConversation(predictMcConversation));

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

    if (
      startPayload &&
      typeof startPayload === "string" &&
      startPayload.startsWith("REF_")
    ) {
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
      user = await createUser(
        ctx.chat.first_name,
        ctx.chat.last_name,
        ctx.chat.username!,
        ctx.chat.id.toString()
      );
    }
  }

  // Auto-create funding wallet for all users
  await getOrCreateFundingWallet(String(user?.id));

  const devWallet = await getDefaultDevWallet(String(user?.id));

  // Get user's referral stats
  const { getUserReferralStats } = await import("../backend/functions-main");
  const referralStats = await getUserReferralStats(String(user?.id));

  const welcomeMsg = `
👋 Welcome to Nitro Launch Bot! 🚀

Nitro Bot empowers you to deploy and manage Solana tokens on Pump.fun and LetsBonk.fun — no coding required!

What you can do:
• Create & launch tokens instantly on Pump.fun and LetsBonk.fun
• Private buys & sells for full privacy
• Easy token management with one click

💳 Your Dev Wallet
${devWallet}

🔗 Referrals: ${referralStats.referralCount} friend(s) joined via your link
Useful Links:
• Pump.fun: https://pump.fun
• LetsBonk.fun: https://letsbonk.fun
Get started below:`;

  const inlineKeyboard = new InlineKeyboard()
    .text("➕ Create Token", CallBackQueries.CREATE_TOKEN)
    .text("👁 View Tokens", CallBackQueries.VIEW_TOKENS)
    .row()
    .text("🔑 Export Dev Wallet", CallBackQueries.EXPORT_DEV_WALLET)
    .text("⚙️ Wallet Config", CallBackQueries.WALLET_CONFIG)
    .row()
    .text("🔗 Referrals", CallBackQueries.VIEW_REFERRALS)
    .text("📊 Predict MC", CallBackQueries.PREDICT_MC)
    .row()
    .text("🆘 Help", CallBackQueries.HELP);

  await sendMessage(ctx, welcomeMsg, {
    reply_markup: inlineKeyboard,
  });
});

bot.command("menu", async (ctx) => {
  let user = await getUser(ctx.chat.id.toString());
  let isFirstTime = user === null;

  if (isFirstTime) {
    // Check if there's a referral code in the start command
    const startPayload = ctx.match; // This gets the text after /start
    let referralCode: string | undefined;

    if (
      startPayload &&
      typeof startPayload === "string" &&
      startPayload.startsWith("REF_")
    ) {
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
      user = await createUser(
        ctx.chat.first_name,
        ctx.chat.last_name,
        ctx.chat.username!,
        ctx.chat.id.toString()
      );
    }
  }

  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    return;
  }

  // Auto-create funding wallet for all users
  await getOrCreateFundingWallet(String(user?.id));

  const devWallet = await getDefaultDevWallet(String(user?.id));

  // Get user's referral stats
  const { getUserReferralStats } = await import("../backend/functions-main");
  const referralStats = await getUserReferralStats(String(user?.id));

  const welcomeMsg = `
👋 Welcome to Nitro Launch Bot! 🚀

Nitro Bot empowers you to deploy and manage Solana tokens on Pump.fun and LetsBonk.fun — no coding required!

What you can do:
• Create & launch tokens instantly on Pump.fun and LetsBonk.fun
• Private buys & sells for full privacy
• Easy token management with one click

💳 Your Dev Wallet
${devWallet}

🔗 Referrals: ${referralStats.referralCount} friend(s) joined via your link
Useful Links:
• Pump.fun: https://pump.fun
• LetsBonk.fun: https://letsbonk.fun
Get started below:`;

  const inlineKeyboard = new InlineKeyboard()
    .text("➕ Create Token", CallBackQueries.CREATE_TOKEN)
    .text("👁 View Tokens", CallBackQueries.VIEW_TOKENS)
    .row()
    .text("🔑 Export Dev Wallet", CallBackQueries.EXPORT_DEV_WALLET)
    .text("⚙️ Wallet Config", CallBackQueries.WALLET_CONFIG)
    .row()
    .text("🔗 Referrals", CallBackQueries.VIEW_REFERRALS)
    .text("📊 Predict MC", CallBackQueries.PREDICT_MC)
    .row()
    .text("🆘 Help", CallBackQueries.HELP);

  await sendMessage(ctx, welcomeMsg, {
    reply_markup: inlineKeyboard,
  });
});

bot.command("help", async (ctx) => {
  await ctx.conversation.enter("helpConversation");
});

bot.command("admin", async (ctx) => {
  // Simple admin check - you can enhance this with proper admin user IDs
  const adminIds = env.ADMIN_IDS
    ? env.ADMIN_IDS.split(",").map((id: string) => parseInt(id))
    : [];

  if (!adminIds.includes(ctx.from!.id)) {
    await sendMessage(ctx, "❌ Access denied. Admin only command.");
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

    await sendMessage(ctx, message, { parse_mode: "MarkdownV2" });
  } catch (error: any) {
    await sendMessage(ctx, `❌ Error fetching stats: ${error.message}`);
  }
});

bot.command("markused", async (ctx) => {
  // Simple admin check
  const adminIds = env.ADMIN_IDS
    ? env.ADMIN_IDS.split(",").map((id: string) => parseInt(id))
    : [];

  if (!adminIds.includes(ctx.from!.id)) {
    await sendMessage(ctx, "❌ Access denied. Admin only command.");
    return;
  }

  const args = ctx.message?.text?.split(" ");
  if (!args || args.length < 2) {
    await sendMessage(
      ctx,
      "❌ Usage: /markused <address>\n\nExample: /markused <your_token_address>"
    );
    return;
  }

  const address = args[1];

  try {
    await markPumpAddressAsUsed(address);
    await sendMessage(
      ctx,
      `✅ Successfully marked address as used:\n\`${address}\`\n\nThis address will no longer be used for new token launches.`,
      { parse_mode: "MarkdownV2" }
    );
  } catch (error: any) {
    await sendMessage(
      ctx,
      `❌ Error marking address as used: ${error.message}`
    );
  }
});

bot.command("removetoken", async (ctx) => {
  // Simple admin check
  const adminIds = env.ADMIN_IDS
    ? env.ADMIN_IDS.split(",").map((id: string) => parseInt(id))
    : [];

  if (!adminIds.includes(ctx.from!.id)) {
    await sendMessage(ctx, "❌ Access denied. Admin only command.");
    return;
  }

  const args = ctx.message?.text?.split(" ");
  if (!args || args.length < 2) {
    await sendMessage(
      ctx,
      "❌ Usage: /removetoken <address>\n\nExample: /removetoken <your_token_address>\n\n⚠️ This will permanently delete the token from the database and mark the address as used."
    );
    return;
  }

  const tokenAddress = args[1];

  try {
    const result = await removeFailedToken(tokenAddress);
    await sendMessage(
      ctx,
      `✅ Successfully removed failed token:\n\`${tokenAddress}\`\n\n• Token deleted from database\n• Address marked as used (won't be reused)\n• Operation completed safely`,
      { parse_mode: "MarkdownV2" }
    );
  } catch (error: any) {
    if (error.message.includes("not found")) {
      await sendMessage(
        ctx,
        `⚠️ Token not found in database:\n\`${tokenAddress}\`\n\nThe token may have already been removed or the address is incorrect.`,
        { parse_mode: "MarkdownV2" }
      );
    } else {
      await sendMessage(ctx, `❌ Error removing token: ${error.message}`);
    }
  }
});

bot.command("wallets", async (ctx) => {
  await ctx.conversation.enter("walletConfigConversation");
});
bot.command("ratelimit", async (ctx) => {
  // Simple admin check
  const adminIds = env.ADMIN_IDS
    ? env.ADMIN_IDS.split(",").map((id: string) => parseInt(id))
    : [];

  if (!adminIds.includes(ctx.from!.id)) {
    await sendMessage(ctx, "❌ Access denied. Admin only command.");
    return;
  }

  const args = ctx.message?.text?.split(" ");

  if (!args || args.length < 2) {
    // Show rate limit stats
    const stats = getRateLimitStats();
    const message = `
🔧 *Rate Limit Statistics*

📊 *System Stats:*
• Total Entries: \`${stats.totalEntries}\`
• Active Users: \`${stats.activeUsers}\`
• Memory Usage: \`${(stats.memoryUsage / 1024 / 1024).toFixed(2)} MB\`

*Commands:*
• \`/ratelimit stats\` - Show detailed statistics
• \`/ratelimit reset <user_id>\` - Reset rate limits for a user
• \`/ratelimit user <user_id>\` - Show rate limit status for a user
`;
    await sendMessage(ctx, message, { parse_mode: "MarkdownV2" });
    return;
  }

  const subcommand = args[1];

  if (subcommand === "stats") {
    const stats = getRateLimitStats();
    const message = `
📊 *Detailed Rate Limit Statistics*

🔢 *System Overview:*
• Total Rate Limit Entries: \`${stats.totalEntries}\`
• Currently Active Users: \`${stats.activeUsers}\`
• Memory Usage: \`${(stats.memoryUsage / 1024 / 1024).toFixed(2)} MB\`

⏰ *Rate Limit Windows:*
• General Commands: Unlimited (999,999 per second)
• Token Operations: Unlimited (999,999 per second)
• Wallet Operations: Unlimited (999,999 per second)
• Trading Operations: Unlimited (999,999 per second)
• Admin Operations: Unlimited (999,999 per second)
• Message Handling: Unlimited (999,999 per second)
• Callback Queries: Unlimited (999,999 per second)
`;
    await sendMessage(ctx, message, { parse_mode: "MarkdownV2" });
  } else if (subcommand === "reset" && args[2]) {
    const userId = parseInt(args[2]);
    if (isNaN(userId)) {
      await sendMessage(
        ctx,
        "❌ Invalid user ID. Please provide a valid number."
      );
      return;
    }

    const reset = resetRateLimits(userId);
    if (reset) {
      await sendMessage(ctx, `✅ Rate limits reset for user \`${userId}\``, {
        parse_mode: "MarkdownV2",
      });
    } else {
      await sendMessage(ctx, `⚠️ No rate limits found for user \`${userId}\``, {
        parse_mode: "MarkdownV2",
      });
    }
  } else if (subcommand === "user" && args[2]) {
    const userId = parseInt(args[2]);
    if (isNaN(userId)) {
      await sendMessage(
        ctx,
        "❌ Invalid user ID. Please provide a valid number."
      );
      return;
    }

    const { getRateLimitStatus } = await import("./rateLimiter");
    const status = getRateLimitStatus(userId);

    const message = `
👤 *Rate Limit Status for User \`${userId}\`*

📊 *Current Limits:*
• General Commands: \`${status.general.count}/${status.general.remaining + status.general.count}\` (${status.general.remaining} remaining)
• Token Operations: \`${status.token_operations.count}/${status.token_operations.remaining + status.token_operations.count}\` (${status.token_operations.remaining} remaining)
• Wallet Operations: \`${status.wallet_operations.count}/${status.wallet_operations.remaining + status.wallet_operations.count}\` (${status.wallet_operations.remaining} remaining)
• Trading Operations: \`${status.trading_operations.count}/${status.trading_operations.remaining + status.trading_operations.count}\` (${status.trading_operations.remaining} remaining)
• Admin Operations: \`${status.admin_operations.count}/${status.admin_operations.remaining + status.admin_operations.count}\` (${status.admin_operations.remaining} remaining)

⏰ *Reset Times:*
• General: <t:${Math.floor(status.general.resetTime / 1000)}:R>
• Token Ops: <t:${Math.floor(status.token_operations.resetTime / 1000)}:R>
• Wallet Ops: <t:${Math.floor(status.wallet_operations.resetTime / 1000)}:R>
• Trading Ops: <t:${Math.floor(status.trading_operations.resetTime / 1000)}:R>
• Admin Ops: <t:${Math.floor(status.admin_operations.resetTime / 1000)}:R>
`;
    await sendMessage(ctx, message, { parse_mode: "MarkdownV2" });
  } else {
    await sendMessage(ctx, "❌ Unknown subcommand. Use /ratelimit for help.");
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
    await sendMessage(ctx, "Unrecognized user ❌");
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
  const sent = await sendMessage(ctx, msg, {
    parse_mode: "MarkdownV2",
    reply_markup: keyboard,
  });
});
bot.callbackQuery("del_message", async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "Message deleted");
  if (ctx.callbackQuery.message) {
    await ctx.api.deleteMessage(
      ctx.chat!.id,
      ctx.callbackQuery.message.message_id
    );
  }
});
bot.callbackQuery(/^launch_token_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  const tokenAddress = ctx.match![1];
  await ctx.conversation.enter("launchTokenConversation", tokenAddress);
});
bot.callbackQuery(/^sell_dev_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  const tokenAddressPrefix = ctx.match![1];

  // Find token by address prefix
  const user = await getUser(ctx.chat!.id!.toString());
  if (!user) {
    await sendMessage(ctx, "❌ User not found");
    return;
  }

  const { TokenModel } = await import("../backend/models");

  // Try to find token with multiple lookup strategies
  let token = await TokenModel.findOne({
    user: user.id,
    tokenAddress: { $regex: `^${tokenAddressPrefix}` },
  });

  // If not found with prefix match, try exact match (for full addresses)
  if (!token) {
    token = await TokenModel.findOne({
      user: user.id,
      tokenAddress: tokenAddressPrefix,
    });
  }

  // If still not found, try case-insensitive match
  if (!token) {
    token = await TokenModel.findOne({
      user: user.id,
      tokenAddress: { $regex: new RegExp(`^${tokenAddressPrefix}`, "i") },
    });
  }

  if (!token) {
    await sendMessage(ctx, "❌ Token not found");
    return;
  }

  await ctx.conversation.enter("devSellConversation", token.tokenAddress);
});

bot.callbackQuery(/^sell_dev_supply_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "🔄 Starting 100% dev sell...");
  const tokenAddressPrefix = ctx.match![1];

  // Find token by address prefix
  const user = await getUser(ctx.chat!.id!.toString());
  if (!user) {
    await sendMessage(ctx, "❌ User not found");
    return;
  }

  const { TokenModel } = await import("../backend/models");

  // Try to find token with multiple lookup strategies
  let token = await TokenModel.findOne({
    user: user.id,
    tokenAddress: { $regex: `^${tokenAddressPrefix}` },
  });

  // If not found with prefix match, try exact match (for full addresses)
  if (!token) {
    token = await TokenModel.findOne({
      user: user.id,
      tokenAddress: tokenAddressPrefix,
    });
  }

  // If still not found, try case-insensitive match
  if (!token) {
    token = await TokenModel.findOne({
      user: user.id,
      tokenAddress: { $regex: new RegExp(`^${tokenAddressPrefix}`, "i") },
    });
  }

  if (!token) {
    await sendMessage(ctx, "❌ Token not found");
    return;
  }

  // Use the conversation system like other sell handlers to avoid state conflicts
  await ctx.conversation.enter("devSell100Conversation", token.tokenAddress);
});
bot.callbackQuery(/^sell_all_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  const tokenAddressPrefix = ctx.match![1];

  // Add logging for debugging
  logger.info(
    `[SellAll] Main sell all button clicked for token prefix: ${tokenAddressPrefix}`
  );
  console.log("Sell All button clicked for token prefix:", tokenAddressPrefix);

  // Find token by address prefix
  const user = await getUser(ctx.chat!.id!.toString());
  if (!user) {
    await sendMessage(ctx, "❌ User not found");
    return;
  }

  const { TokenModel } = await import("../backend/models");

  // Try to find token with multiple lookup strategies
  let token = await TokenModel.findOne({
    user: user.id,
    tokenAddress: { $regex: `^${tokenAddressPrefix}` },
  });

  // If not found with prefix match, try exact match (for full addresses)
  if (!token) {
    token = await TokenModel.findOne({
      user: user.id,
      tokenAddress: tokenAddressPrefix,
    });
  }

  // If still not found, try case-insensitive match
  if (!token) {
    token = await TokenModel.findOne({
      user: user.id,
      tokenAddress: { $regex: new RegExp(`^${tokenAddressPrefix}`, "i") },
    });
  }

  if (!token) {
    await sendMessage(ctx, "❌ Token not found");
    return;
  }

  await ctx.conversation.enter(
    "walletSellConversation",
    token.tokenAddress,
    100
  );
});
bot.callbackQuery(/^sell_percent_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  const tokenAddressPrefix = ctx.match![1];

  // Find token by address prefix
  const user = await getUser(ctx.chat!.id!.toString());
  if (!user) {
    await sendMessage(ctx, "❌ User not found");
    return;
  }

  const { TokenModel } = await import("../backend/models");

  // Try to find token with multiple lookup strategies
  let token = await TokenModel.findOne({
    user: user.id,
    tokenAddress: { $regex: `^${tokenAddressPrefix}` },
  });

  // If not found with prefix match, try exact match (for full addresses)
  if (!token) {
    token = await TokenModel.findOne({
      user: user.id,
      tokenAddress: tokenAddressPrefix,
    });
  }

  // If still not found, try case-insensitive match
  if (!token) {
    token = await TokenModel.findOne({
      user: user.id,
      tokenAddress: { $regex: new RegExp(`^${tokenAddressPrefix}`, "i") },
    });
  }

  if (!token) {
    await sendMessage(ctx, "❌ Token not found");
    return;
  }

  await ctx.conversation.enter("walletSellConversation", token.tokenAddress);
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

bot.callbackQuery(CallBackQueries.WITHDRAW_TO_FUNDING, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  await ctx.conversation.enter("withdrawBuyerWalletsConversation");
});

bot.callbackQuery(CallBackQueries.WITHDRAW_TO_EXTERNAL, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  await ctx.conversation.enter("withdrawBuyerWalletsConversation");
});

bot.command("referrals", async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  await ctx.conversation.enter("referralsConversation");
});

bot.callbackQuery(CallBackQueries.VIEW_REFERRALS, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  await ctx.conversation.enter("referralsConversation");
});

bot.callbackQuery(CallBackQueries.HELP, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  await ctx.conversation.enter("helpConversation");
});

bot.callbackQuery(CallBackQueries.PREDICT_MC, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  await ctx.conversation.enter("predictMcConversation");
});

// Callback handlers for token CA sell buttons
bot.callbackQuery(/^sell_ca_(\d+)_(.+)$/, async (ctx) => {
  const sellPercent = parseInt(ctx.match![1]);
  const tokenAddress = ctx.match![2];

  // Answer callback query immediately with feedback
  await safeAnswerCallbackQuery(ctx, `💸 Selling ${sellPercent}% of tokens...`);

  logger.info(
    `[ExternalTokenSell] Executing ${sellPercent}% sell for token: ${tokenAddress}`
  );

  // Start the external token sell conversation
  await ctx.conversation.enter(
    "externalTokenSellConversation",
    tokenAddress,
    sellPercent
  );
});

bot.callbackQuery(/^sell_individual_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  const tokenAddressPrefix = ctx.match![1];
  console.log("Found hereee");
  console.log(
    "Sell individual button clicked for token prefix:",
    tokenAddressPrefix
  );
  console.log("Full callback data:", ctx.callbackQuery?.data);

  // Find token by address prefix
  const user = await getUser(ctx.chat!.id!.toString());
  if (!user) {
    await sendMessage(ctx, "❌ User not found");
    return;
  }

  const { TokenModel } = await import("../backend/models");

  // Try to find token with multiple lookup strategies
  let token = await TokenModel.findOne({
    user: user.id,
    tokenAddress: { $regex: `^${tokenAddressPrefix}` },
  });

  // If not found with prefix match, try exact match (for full addresses)
  if (!token) {
    token = await TokenModel.findOne({
      user: user.id,
      tokenAddress: tokenAddressPrefix,
    });
  }

  // If still not found, try case-insensitive match
  if (!token) {
    token = await TokenModel.findOne({
      user: user.id,
      tokenAddress: { $regex: new RegExp(`^${tokenAddressPrefix}`, "i") },
    });
  }

  if (!token) {
    await sendMessage(ctx, "❌ Token not found");
    return;
  }

  await ctx.conversation.enter("sellIndividualToken", token.tokenAddress);
});

bot.callbackQuery(/^sellAll_([^_]+)_([^_]+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  const [, walletAddress, shortTokenAddress] = ctx.match!;

  console.log("Found hereee", { walletAddress, shortTokenAddress });

  // Reconstruct full token address from shortened format (E8UwNk-PUMP -> E8UwNkiXc26D5LNHkKRNKPP5ttsY4kzfNRjE5N7GPUMP)
  const [prefix, suffix] = shortTokenAddress.split("-");
  const re = new RegExp(`^${prefix}[A-Za-z0-9]*${suffix}$`);

  const token = await TokenModel.findOne({
    tokenAddress: { $regex: re },
  }).exec();

  if (token) {
    // Token found in database = launch token, use internal sell mechanism
    logger.info(
      `[SellAll] Found launch token in database: ${token.tokenAddress}`
    );

    const result = await handleSingleSell(
      new PublicKey(token.tokenAddress),
      walletAddress,
      "all"
    );
    if (!result)
      return sendMessage(ctx, "❌ Error selling all token in address");
    const { success, signature } = result;
    if (success)
      return sendMessage(
        ctx,
        `✅ Sold all tokens in address.\n\nTransaction Signature: <a href="https://solscan.io/tx/${signature}">View Transaction</a>`,
        { parse_mode: "HTML" }
      );
  } else {
    // Token not found in database = external token
    // Individual wallet sells are only for launch tokens, redirect to external sell
    logger.info(
      `[SellAll] Token ${shortTokenAddress} not found in database - redirecting to external sell`
    );

    // Try to reconstruct full address from current message context
    const messageText = ctx.callbackQuery?.message?.text || "";
    const fullAddressMatch = messageText.match(/🔑 Address: (\w+)/);

    if (fullAddressMatch) {
      const fullTokenAddress = fullAddressMatch[1];
      logger.info(
        `[SellAll] Extracted full address ${fullTokenAddress} from message context`
      );
      await ctx.conversation.enter(
        "externalTokenSellConversation",
        fullTokenAddress,
        100
      );
    } else {
      return sendMessage(
        ctx,
        "❌ Could not determine full token address. Please use the main sell buttons from the token display."
      );
    }
  }
});

bot.callbackQuery(/^sellPct_([^_]+)_([^_]+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  const [, walletAddress, shortTokenAddress] = ctx.match!;

  console.log("Found hereee", { walletAddress, shortTokenAddress });
  const [prefix, suffix] = shortTokenAddress.split("-");
  const re = new RegExp(`^${prefix}[A-Za-z0-9]*${suffix}$`);

  const token = await TokenModel.findOne({
    tokenAddress: { $regex: re },
  }).exec();

  if (!token) {
    // Token not found in database = external token
    // Extract full address from message context and route to external sell
    logger.info(
      `[SellPct] Token ${shortTokenAddress} not found in database - routing to external sell percentage selector`
    );

    const messageText = ctx.callbackQuery?.message?.text || "";
    const fullAddressMatch = messageText.match(/🔑 Address: (\w+)/);

    if (fullAddressMatch) {
      const fullTokenAddress = fullAddressMatch[1];
      logger.info(
        `[SellPct] Extracted full address ${fullTokenAddress} from message context`
      );

      // Show percentage selection for external tokens
      const keyboard = new InlineKeyboard()
        .text("💸 Sell 25%", `sell_ca_25_${fullTokenAddress}`)
        .text("💸 Sell 50%", `sell_ca_50_${fullTokenAddress}`)
        .row()
        .text("💸 Sell 75%", `sell_ca_75_${fullTokenAddress}`)
        .text("💸 Sell 100%", `sell_ca_100_${fullTokenAddress}`)
        .row()
        .text("❌ Cancel", CallBackQueries.CANCEL);

      await sendMessage(
        ctx,
        "💸 **Select Sell Percentage**\n\nChoose what percentage of your tokens to sell:",
        {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        }
      );
    } else {
      return sendMessage(
        ctx,
        "❌ Could not determine full token address. Please use the main sell buttons from the token display."
      );
    }
    return;
  }

  // Token found in database = launch token, use internal percentage selector
  await ctx.conversation.enter("sellPercentageMessage", {
    tokenAddress: token.tokenAddress,
    walletAddress,
  });
});

// Handle external token buy button clicks (from token address messages)
bot.callbackQuery(/^buy_external_token_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  const tokenAddress = ctx.match![1];

  logger.info(
    `[ExternalTokenBuy] Buy button clicked for token: ${tokenAddress}`
  );

  // Start the external token buy conversation
  await ctx.conversation.enter("buyExternalTokenConversation");
});

// Handle fund wallet button clicks
bot.callbackQuery(/^fund_wallet_(.+)_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "🔄 Funding wallet...");
  const [, walletAddress, tokenAddress] = ctx.match!;

  logger.info(
    `[FundWallet] Funding wallet ${walletAddress} for token ${tokenAddress}`
  );

  try {
    // Get user
    const user = await getUser(ctx.chat!.id!.toString());
    if (!user) {
      await sendMessage(ctx, "❌ User not found");
      return;
    }

    // Get funding wallet
    const { getFundingWallet, getWalletBalance } = await import(
      "../backend/functions"
    );
    const fundingWallet = await getFundingWallet(user.id);
    if (!fundingWallet) {
      await sendMessage(
        ctx,
        "❌ No funding wallet found. Please configure a funding wallet first."
      );
      return;
    }

    // Check funding wallet balance
    const fundingBalance = await getWalletBalance(fundingWallet.publicKey);
    if (fundingBalance < 0.011) {
      // 0.01 SOL + 0.001 SOL for transaction fee
      await sendMessage(
        ctx,
        `❌ **Insufficient funding wallet balance**\n\n**Required:** 0.011 SOL (0.01 SOL + 0.001 SOL fee)\n**Available:** ${fundingBalance.toFixed(6)} SOL\n\nPlease add more SOL to your funding wallet first.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Send 0.01 SOL to the wallet
    const { SystemProgram, Transaction, PublicKey } = await import(
      "@solana/web3.js"
    );
    const { connection } = await import("../blockchain/common/connection");
    const { secretKeyToKeypair } = await import("../blockchain/common/utils");

    const fundingKeypair = secretKeyToKeypair(fundingWallet.privateKey);
    const targetWallet = new PublicKey(walletAddress);

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fundingKeypair.publicKey,
        toPubkey: targetWallet,
        lamports: 0.01 * 1_000_000_000, // 0.01 SOL in lamports
      })
    );

    const signature = await connection.sendTransaction(transaction, [
      fundingKeypair,
    ]);
    await connection.confirmTransaction(signature, "confirmed");

    await sendMessage(
      ctx,
      `✅ **Wallet funded successfully!**\n\n💰 **0.01 SOL sent to:** \`${walletAddress}\`\n📝 **Transaction:** \`${signature}\`\n\nYou can now try selling your tokens again.`,
      { parse_mode: "Markdown" }
    );
  } catch (error: any) {
    logger.error("Error funding wallet:", error);
    await sendMessage(
      ctx,
      `❌ **Failed to fund wallet**\n\nError: ${error.message}\n\nPlease try again or contact support.`,
      { parse_mode: "Markdown" }
    );
  }
});

// Handle fund all wallets button clicks
bot.callbackQuery(/^fund_all_wallets_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "🔄 Funding all wallets...");
  const [, tokenAddress] = ctx.match!;

  logger.info(`[FundAllWallets] Funding all wallets for token ${tokenAddress}`);

  try {
    // Get user
    const user = await getUser(ctx.chat!.id!.toString());
    if (!user) {
      await sendMessage(ctx, "❌ User not found");
      return;
    }

    // Get funding wallet
    const { getFundingWallet, getWalletBalance, getAllTradingWallets } =
      await import("../backend/functions");
    const { getTokenBalance } = await import("../backend/utils");
    const fundingWallet = await getFundingWallet(user.id);
    if (!fundingWallet) {
      await sendMessage(
        ctx,
        "❌ No funding wallet found. Please configure a funding wallet first."
      );
      return;
    }

    // Get all buyer wallets and check which ones need funding
    const buyerWallets = await getAllTradingWallets(user.id);
    const walletsNeedingFunding = [];

    for (const wallet of buyerWallets) {
      try {
        const tokenBalance = await getTokenBalance(
          tokenAddress,
          wallet.publicKey
        );
        const solBalance = await getWalletBalance(wallet.publicKey);

        if (tokenBalance > 0 && solBalance < 0.01) {
          walletsNeedingFunding.push({
            publicKey: wallet.publicKey,
            privateKey: wallet.privateKey,
            tokenBalance,
            solBalance,
          });
        }
      } catch (error) {
        logger.warn(`Error checking wallet ${wallet.publicKey}:`, error);
      }
    }

    if (walletsNeedingFunding.length === 0) {
      await sendMessage(ctx, "❌ No wallets found that need funding.");
      return;
    }

    // Check funding wallet balance for all transfers
    const totalFundingNeeded = walletsNeedingFunding.length * 0.01;
    const totalFeesNeeded = walletsNeedingFunding.length * 0.001; // Transaction fees
    const totalRequired = totalFundingNeeded + totalFeesNeeded;

    const fundingBalance = await getWalletBalance(fundingWallet.publicKey);
    if (fundingBalance < totalRequired) {
      await sendMessage(
        ctx,
        `❌ **Insufficient funding wallet balance**\n\n**Required:** ${totalRequired.toFixed(6)} SOL (${totalFundingNeeded.toFixed(6)} SOL funding + ${totalFeesNeeded.toFixed(6)} SOL fees)\n**Available:** ${fundingBalance.toFixed(6)} SOL\n\nPlease add more SOL to your funding wallet first.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Send 0.01 SOL to each wallet
    const { SystemProgram, Transaction, PublicKey } = await import(
      "@solana/web3.js"
    );
    const { connection } = await import("../blockchain/common/connection");
    const { secretKeyToKeypair } = await import("../blockchain/common/utils");

    const fundingKeypair = secretKeyToKeypair(fundingWallet.privateKey);
    const results = [];

    for (const wallet of walletsNeedingFunding) {
      try {
        const targetWallet = new PublicKey(wallet.publicKey);

        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: fundingKeypair.publicKey,
            toPubkey: targetWallet,
            lamports: 0.01 * 1_000_000_000, // 0.01 SOL in lamports
          })
        );

        const signature = await connection.sendTransaction(transaction, [
          fundingKeypair,
        ]);
        await connection.confirmTransaction(signature, "confirmed");

        results.push({
          wallet: wallet.publicKey,
          success: true,
          signature,
        });

        // Small delay between transactions
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error: any) {
        results.push({
          wallet: wallet.publicKey,
          success: false,
          error: error.message,
        });
      }
    }

    // Show results
    const successfulTransfers = results.filter((r) => r.success);
    const failedTransfers = results.filter((r) => !r.success);

    let resultMessage = `✅ **Bulk funding completed!**\n\n`;
    resultMessage += `💰 **Successfully funded:** ${successfulTransfers.length}/${walletsNeedingFunding.length} wallets\n`;

    if (successfulTransfers.length > 0) {
      resultMessage += `\n**Successful transfers:**\n`;
      successfulTransfers.forEach((result, index) => {
        const shortAddress = `${result.wallet.slice(0, 6)}...${result.wallet.slice(-4)}`;
        resultMessage += `${index + 1}. \`${shortAddress}\` - \`${result.signature}\`\n`;
      });
    }

    if (failedTransfers.length > 0) {
      resultMessage += `\n**Failed transfers:**\n`;
      failedTransfers.forEach((result, index) => {
        const shortAddress = `${result.wallet.slice(0, 6)}...${result.wallet.slice(-4)}`;
        resultMessage += `${index + 1}. \`${shortAddress}\` - ${result.error}\n`;
      });
    }

    resultMessage += `\nYou can now try selling your tokens again.`;

    await sendMessage(ctx, resultMessage, { parse_mode: "Markdown" });
  } catch (error: any) {
    logger.error("Error funding all wallets:", error);
    await sendMessage(
      ctx,
      `❌ **Failed to fund wallets**\n\nError: ${error.message}\n\nPlease try again or contact support.`,
      { parse_mode: "Markdown" }
    );
  }
});

// Fast cancel button handler - must be before generic callback handler
bot.callbackQuery(CallBackQueries.CANCEL, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "❌ Cancelled");

  try {
    await ctx.editMessageText(
      "❌ **Operation Cancelled**\n\nYou can send a token address to start over.",
      {
        parse_mode: "Markdown",
      }
    );
  } catch (error) {
    // If editing fails, send a new message
    await sendMessage(
      ctx,
      "❌ **Operation Cancelled**\n\nYou can send a token address to start over."
    );
  }
});

// Optimized handlers for specific cancel types
bot.callbackQuery(CallBackQueries.CANCEL_EXTERNAL_BUY, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "❌ Buy cancelled");

  try {
    await ctx.editMessageText(
      "❌ **External token buy cancelled**\n\nYou can send a token address to start over.",
      {
        parse_mode: "Markdown",
      }
    );
  } catch (error) {
    await sendMessage(
      ctx,
      "❌ **External token buy cancelled**\n\nYou can send a token address to start over."
    );
  }
});

bot.callbackQuery(CallBackQueries.CANCEL_WITHDRAWAL, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "❌ Withdrawal cancelled");

  try {
    await ctx.editMessageText(
      "❌ **Withdrawal cancelled**\n\nUse /menu to return to main menu.",
      {
        parse_mode: "Markdown",
      }
    );
  } catch (error) {
    await sendMessage(
      ctx,
      "❌ **Withdrawal cancelled**\n\nUse /menu to return to main menu."
    );
  }
});

bot.callbackQuery(CallBackQueries.CANCEL_DEV_WALLET, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "❌ Dev wallet operation cancelled");

  try {
    await ctx.editMessageText(
      "❌ **Dev wallet operation cancelled**\n\nUse /menu to return to main menu.",
      {
        parse_mode: "Markdown",
      }
    );
  } catch (error) {
    await sendMessage(
      ctx,
      "❌ **Dev wallet operation cancelled**\n\nUse /menu to return to main menu."
    );
  }
});

bot.callbackQuery(CallBackQueries.CANCEL_BUYER_WALLET, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "❌ Buyer wallet operation cancelled");

  try {
    await ctx.editMessageText(
      "❌ **Buyer wallet operation cancelled**\n\nUse /menu to return to main menu.",
      {
        parse_mode: "Markdown",
      }
    );
  } catch (error) {
    await sendMessage(
      ctx,
      "❌ **Buyer wallet operation cancelled**\n\nUse /menu to return to main menu."
    );
  }
});

// Callback handler for refresh button
// bot.callbackQuery(/^refresh_ca_(.+)$/, async (ctx) => {
//   await safeAnswerCallbackQuery(ctx);
//   const tokenAddress = ctx.match![1];
//   await handleTokenAddressMessage(ctx, tokenAddress);
// });

// Callback handler for launch data refresh button
bot.callbackQuery(/^refresh_launch_data_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "🔄 Refreshing data...");
  const tokenAddress = ctx.match![1];

  // Get token info to get name and symbol
  const user = await getUser(ctx.chat!.id!.toString());
  if (!user) {
    await sendMessage(ctx, "❌ User not found");
    return;
  }

  const token = await getUserTokenWithBuyWallets(user.id, tokenAddress);
  if (!token) {
    await sendMessage(ctx, "❌ Token not found");
    return;
  }

  const { handleLaunchDataRefresh } = await import("./message");
  await handleLaunchDataRefresh(
    ctx.chat!.id,
    ctx.callbackQuery!.message!.message_id,
    tokenAddress,
    token.name,
    token.symbol
  );
});

// Callback handler for Bonk launch data refresh button
bot.callbackQuery(/^refresh_bonk_launch_data_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "🔄 Refreshing Bonk data...");
  const tokenAddressPrefix = ctx.match![1];

  // Get token info to get name and symbol
  const user = await getUser(ctx.chat!.id!.toString());
  if (!user) {
    await sendMessage(ctx, "❌ User not found");
    return;
  }

  // Find token by address prefix
  const { TokenModel } = await import("../backend/models");
  const token = await TokenModel.findOne({
    user: user.id,
    tokenAddress: { $regex: `^${tokenAddressPrefix}` },
  });

  if (!token) {
    await sendMessage(ctx, "❌ Token not found");
    return;
  }

  const { handleBonkLaunchDataRefresh } = await import("./message");
  await handleBonkLaunchDataRefresh(
    ctx.chat!.id,
    ctx.callbackQuery!.message!.message_id,
    token.tokenAddress,
    token.name,
    token.symbol
  );
});

// Callback handler for external token refresh button
bot.callbackQuery(/^refresh_ca_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "🔄 Refreshing token data...");
  const tokenAddress = ctx.match![1];

  try {
    // Validate the token address
    new PublicKey(tokenAddress);

    logger.info(`[refresh] Refreshing token data for: ${tokenAddress}`);

    // Get the existing message to update
    const messageId = ctx.callbackQuery?.message?.message_id;
    if (!messageId) {
      await sendMessage(ctx, "❌ Unable to refresh - message not found.");
      return;
    }

    // **INSTANT REFRESH: Show updated token page immediately**
    const tokenInfoService = TokenInfoService.getInstance();

    // Force fresh data by bypassing cache
    const tokenInfo = await tokenInfoService.getTokenInfo(tokenAddress); // TokenInfoService doesn't support force refresh parameter
    if (!tokenInfo) {
      await sendMessage(ctx, "❌ Token not found or invalid address.");
      return;
    }

    const tokenMessage = await formatTokenMessage(
      tokenInfo,
      ctx,
      ctx.chat!.id.toString(),
      "2"
    );

    // Update the existing message with refreshed data
    await ctx.api.editMessageText(ctx.chat!.id, messageId, tokenMessage, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .url("📊 Chart", `https://dexscreener.com/solana/${tokenAddress}`)
        .url("🔗 Contract", `https://solscan.io/token/${tokenAddress}`)
        .text("💸 Sell", `sell_token_${tokenAddress}`)
        .row()
        .text(
          "📊 Monitor",
          `${CallBackQueries.VIEW_TOKEN_TRADES}_${tokenAddress}`
        )
        .text("📈 CTO", `${CallBackQueries.CTO}_${tokenAddress}`)
        .text("🔄 Refresh", `refresh_ca_${tokenAddress}`)
        .row()
        .text("🏠 Menu", CallBackQueries.BACK),
    });

    logger.info(
      `[refresh] Successfully refreshed token data for ${tokenAddress}`
    );
  } catch (error) {
    logger.error(
      `[refresh] Error refreshing token data: ${(error as Error).message}`
    );
    await sendMessage(ctx, "❌ Error refreshing token data. Please try again.");
  }
});

// Callback handler for CTO button
bot.callbackQuery(/^cto_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "📈 Starting CTO operation...");
  const tokenAddress = ctx.match![1];

  logger.info(`[CTO] CTO button clicked for token: ${tokenAddress}`);

  // Start the CTO conversation
  await ctx.conversation.enter("ctoConversation", tokenAddress);
});

// Callback handler for CTO monitor refresh
bot.callbackQuery(/^refresh_cto_monitor_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "🔄 Refreshing monitor...");
  const tokenAddress = ctx.match![1];

  logger.info(`[CTO Monitor] Refresh clicked for token: ${tokenAddress}`);

  // Start the CTO monitor conversation
  await ctx.conversation.enter("ctoMonitorConversation", tokenAddress);
});

// Callback handler for CTO sell buttons
bot.callbackQuery(/^sell_ca_(\d+)_(.+)$/, async (ctx) => {
  const [, sellPercent, tokenAddress] = ctx.match!;
  await safeAnswerCallbackQuery(ctx, `💸 Selling ${sellPercent}%...`);

  logger.info(
    `[CTO Monitor] Sell ${sellPercent}% clicked for token: ${tokenAddress}`
  );

  // Start external token sell conversation
  await ctx.conversation.enter(
    "externalTokenSellConversation",
    tokenAddress,
    parseInt(sellPercent)
  );
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
      await sendMessage(
        ctx,
        "🔄 Please go to 'View Tokens' and select the token you want to launch."
      );
    }
  } catch (error) {
    logger.error("Error handling RETRY_LAUNCH:", error);
    await sendMessage(
      ctx,
      "❌ Unable to retry launch. Please go to 'View Tokens' and try launching again."
    );
  }
});

// Command to buy external tokens
bot.command("buyexternal", async (ctx) => {
  await ctx.conversation.enter("buy-external-token");
});

bot.callbackQuery(
  new RegExp(`^${CallBackQueries.VIEW_TOKEN_TRADES}_`),
  async (ctx) => {
    // Get user ID from context
    const userId = ctx?.chat!.id.toString();
    const user = await getUser(userId);
    if (!user) {
      await sendMessage(ctx, "Unrecognized user ❌");
      return;
    }
    await safeAnswerCallbackQuery(ctx, "💰 Loading");

    const tokenAddress = ctx.callbackQuery.data.split("_").pop();
    if (!tokenAddress) {
      await sendMessage(ctx, "❌ Invalid token address.");
      return;
    }

    try {
      const buyerWallets = await getAllBuyerWallets(user.id);

      const tokenInfo = await getTokenInfo(tokenAddress);
      if (!tokenInfo) {
        await sendMessage(ctx, "❌ Token not found.");
        return;
      }

      if (buyerWallets.length === 0) {
        await sendMessage(
          ctx,
          "❌ No buyer wallets found. Please add a buyer wallet first."
        );
        return;
      }
      // Calculate total snipes (buys) made by user's buyer wallets for this token
      const { TransactionRecordModel } = await import("../backend/models");

      // Get all buyer wallets for the user

      // For each wallet, get initial (total buy amount), payout (total sell amount), and current worth
      const walletStats = await Promise.all(
        buyerWallets.map(async (wallet) => {
          // Initial: sum of all buy transactions for this wallet and token
          const initialAgg = await TransactionRecordModel.aggregate([
            {
              $match: {
                user: user.id,
                tokenAddress,
                walletAddress: wallet.publicKey,
                transactionType: "snipe_buy",
              },
            },
            {
              $group: {
                _id: null,
                totalBuy: { $sum: "$amount" },
              },
            },
          ]);
          const initial = initialAgg[0]?.totalBuy || 0;

          // Payout: sum of all sell transactions for this wallet and token
          const payoutAgg = await TransactionRecordModel.aggregate([
            {
              $match: {
                user: user.id,
                tokenAddress,
                walletAddress: wallet.publicKey,
                transactionType: "snipe_sell",
              },
            },
            {
              $group: {
                _id: null,
                totalSell: { $sum: "$amount" },
              },
            },
          ]);
          const payout = payoutAgg[0]?.totalSell || 0;

          // Current worth: get current token balance and multiply by current price
          let currentWorth = 0;
          try {
            const { getTokenBalance } = await import("../backend/utils");
            const tokenBalance = await getTokenBalance(
              tokenAddress,
              wallet.publicKey
            );
            const price = tokenInfo.priceUsd || 0;
            currentWorth = tokenBalance * price;
          } catch (err) {
            currentWorth = 0;
          }

          return {
            wallet: wallet.publicKey,
            initial,
            payout,
            currentWorth,
          };
        })
      );

      // Aggregate total initial, payout, and current worth across all buyer wallets
      const totalInitial = walletStats.reduce((sum, w) => sum + w.initial, 0);
      const totalPayout = walletStats.reduce((sum, w) => sum + w.payout, 0);
      const totalCurrentWorth = walletStats.reduce(
        (sum, w) => sum + w.currentWorth,
        0
      );

      // Calculate stats for each wallet
      const walletStatsDetails = [];
      for (const wallet of buyerWallets) {
        // Count snipes (buy transactions) for this wallet and token
        const snipesCount = await TransactionRecordModel.countDocuments({
          user: user.id,
          tokenAddress,
          walletAddress: wallet.publicKey,
          transactionType: "snipe_buy",
        });

        // Initial: sum of all buy transactions for this wallet and token
        const initialAgg = await TransactionRecordModel.aggregate([
          {
            $match: {
              user: user.id,
              tokenAddress,
              walletAddress: wallet.publicKey,
              transactionType: "snipe_buy",
            },
          },
          {
            $group: {
              _id: null,
              totalBuy: { $sum: "$amount" },
            },
          },
        ]);
        const initial = initialAgg[0]?.totalBuy || 0;

        // Payout: sum of all sell transactions for this wallet and token
        const payoutAgg = await TransactionRecordModel.aggregate([
          {
            $match: {
              user: user.id,
              tokenAddress,
              walletAddress: wallet.publicKey,
              transactionType: "snipe_sell",
            },
          },
          {
            $group: {
              _id: null,
              totalSell: { $sum: "$amount" },
            },
          },
        ]);
        const payout = payoutAgg[0]?.totalSell || 0;

        // Worth: current token balance * current price
        let worth = 0;
        try {
          const { getTokenBalance } = await import("../backend/utils");
          const tokenBalance = await getTokenBalance(
            tokenAddress,
            wallet.publicKey
          );
          const price = tokenInfo.priceUsd || 0;
          worth = tokenBalance * price;
        } catch (err) {
          worth = 0;
        }

        walletStatsDetails.push({
          wallet: wallet.publicKey,
          snipesCount,
          initial,
          payout,
          worth,
        });
      }

      // Build wallet stats section for monitor page
      let walletStatsSection = "";
      if (walletStatsDetails.length > 0) {
        walletStatsSection =
          `<b>📊 Per-Wallet Stats</b>\n` +
          `<code>Wallet           | Buys | Initial   | Payout    | Worth     </code>\n` +
          `<code>────────────────|─────|──────────|──────────|───────────</code>\n` +
          walletStatsDetails
            .map((w) => {
              const shortWallet =
                w.wallet.length > 12
                  ? `${w.wallet.slice(0, 6)}...${w.wallet.slice(-4)}`
                  : w.wallet;
              return `<code>${shortWallet.padEnd(16)}| ${String(w.snipesCount).padEnd(4)} | ${w.initial.toFixed(3).padEnd(8)} | ${w.payout.toFixed(3).padEnd(8)} | ${w.worth.toFixed(3).padEnd(9)}</code>`;
            })
            .join("\n");
      } else {
        walletStatsSection = `<i>No buyer wallet stats found for this token.</i>`;
      }
      // You can use walletStatsDetails to display per-wallet stats in your message if needed.
      // snipesCount is the total number of snipes (buy transactions) for this token by user's buyer wallets

      // TODO fetch actual trade history
      const worth = totalCurrentWorth.toFixed(3);
      // Calculate PnL (Profit and Loss) percentage
      let pnl = "-";
      if (totalInitial > 0) {
        pnl =
          (
            ((totalPayout + totalCurrentWorth - totalInitial) / totalInitial) *
            100
          ).toFixed(2) + "%";
      }

      const age = "35:00";
      const initial = totalInitial;
      const payout = totalPayout;
      const marketCap = formatUSD(tokenInfo.marketCap);
      const price = tokenInfo.priceUsd;
      const botUsername = bot.botInfo.username;
      const referralLink = await generateReferralLink(user.id, botUsername);

      const message = await sendMessage(
        ctx,
        `
🌟 <b>${tokenInfo.baseToken.symbol}</b> • ⏰ ${age} • 🎯 <a href="${referralLink}">Referral</a>

💰 <b>Main Position</b> • 📈 <b>${pnl}</b>
┌─ Initial: <b>${initial.toFixed(3)} SOL</b>
├─ Payout: <b>${payout.toFixed(3)} SOL</b>
├─ Tokens: <b>2.3%</b>
└─ Worth: <b>${worth} SOL</b>

💎 <b>Market Data</b>
├─ Price: <b>$${price}</b>
└─ Market Cap: <b>${marketCap}</b>

<blockquote expandable>${walletStatsSection}</blockquote>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 <i>Auto-updates disabled • Click refresh to resume</i>
⚠️ <i>Limit orders are not impacted</i>
<i>Updated: ${new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}</i>
`,
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text("🔄 Refresh", `remonitor_data_${tokenAddress}`)
            .url("📊 Chart", `https://dexscreener.com/solana/${tokenAddress}`)
            .row()
            .text("💸 25%", `sell_ca_25_${tokenAddress}`)
            .text("💸 50%", `sell_ca_50_${tokenAddress}`)
            .text("💸 75%", `sell_ca_75_${tokenAddress}`)
            .text("💸 100%", `sell_ca_100_${tokenAddress}`)
            .row()
            .row()
            .url("🔗 Contract", `https://solscan.io/token/${tokenAddress}`)
            .text("📈 CTO", `${CallBackQueries.CTO}_${tokenAddress}`)
            .text("🏠 Menu", CallBackQueries.BACK),
        }
      );

      await bot.api.pinChatMessage(userId, message.message_id);
    } catch (error) {
      logger.error("Error fetching trade history:", error);
      await sendMessage(
        ctx,
        "❌ Error fetching trade history. Please try again later."
      );
    }
  }
);

bot.callbackQuery(/^remonitor_data_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "🔄 Refreshing monitor data...");
  const tokenAddress = ctx.match![1];
  logger.info(
    `[RefreshMonitorData] Refreshing data for token: ${tokenAddress}`
  );

  // Get user ID from context
  const userId = ctx?.chat!.id.toString();
  const user = await getUser(userId);
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    return;
  }

  try {
    const tokenInfo = await getTokenInfo(tokenAddress);
    if (!tokenInfo) {
      await sendMessage(ctx, "❌ Token not found.");
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
    const botUsername = bot.botInfo.username;
    const referralLink = await generateReferralLink(user.id, botUsername);

    const monitorText = `
🌟 <b>${tokenInfo.baseToken.symbol}</b> • ⏰ ${age} • 🎯 <a href="${referralLink}">Referral</a>

💰 <b>Main Position</b> • 📈 <b>${pnl}</b>
┌─ Initial: <b>${initial.toFixed(3)} SOL</b>
├─ Payout: <b>${payout.toFixed(3)} SOL</b>
├─ Tokens: <b>2.3%</b>
└─ Worth: <b>${payout.toFixed(3)} SOL</b>

💎 <b>Market Data</b>
├─ Price: <b>$${price}</b>
└─ Market Cap: <b>${marketCap}</b>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 <i>Auto-updates disabled • Click refresh to resume</i>
⚠️ <i>Limit orders are not impacted</i>
<i>Updated: ${new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}</i>
`;

    const monitorKeyboard = new InlineKeyboard()
      .text("🔄 Refresh", `remonitor_data_${tokenAddress}`)
      .url("📊 Chart", `https://dexscreener.com/solana/${tokenAddress}`)
      .row()
      .text("💸 25%", `sell_ca_25_${tokenAddress}`)
      .text("💸 50%", `sell_ca_50_${tokenAddress}`)
      .text("💸 75%", `sell_ca_75_${tokenAddress}`)
      .text("💸 100%", `sell_ca_100_${tokenAddress}`)
      .row()
      .row()
      .url("🔗 Contract", `https://solscan.io/token/${tokenAddress}`)
      .text("📈 CTO", `${CallBackQueries.CTO}_${tokenAddress}`)
      .text("🏠 Menu", CallBackQueries.BACK);

    // Edit the existing message with refreshed data
    const messageId = ctx.callbackQuery?.message?.message_id;
    if (messageId) {
      await ctx.api.editMessageText(ctx.chat!.id, messageId, monitorText, {
        parse_mode: "HTML",
        reply_markup: monitorKeyboard,
      });
    } else {
      // If message not found, send a new one
      const message = await sendMessage(ctx, monitorText, {
        parse_mode: "HTML",
        reply_markup: monitorKeyboard,
      });
      await bot.api.pinChatMessage(userId, message.message_id);
    }
  } catch (error) {
    logger.error("Error refreshing monitor data:", error);
    await sendMessage(
      ctx,
      "❌ Error refreshing monitor data. Please try again later."
    );
  }
});

bot.api.setMyCommands([
  { command: "start", description: "Start the bot" },
  { command: "menu", description: "Bot Menu" },
  { command: "wallets", description: "Manage Wallets" },
  { command: "referrals", description: "View your referral stats" },
  { command: "help", description: "Get help with the bot" },
]);

// Message handler for token contract addresses

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  supply: string;
  price?: number;
  dex: string;
  dexId?: string;
  priceChange24h?: number;
  marketCap?: number;
  volume24h?: number;
  liquidity?: number;
  holders?: number;
  description?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  image?: string;
  verified?: boolean;
}

export const getHtmllinks = (address: string) => {
  const links = [
    {
      abbr: "CA",
      text: "Solscan",
      url: `https://solscan.io/token/${address}`,
    },
    {
      abbr: "DEX",
      text: "Dexscreener",
      url: `https://dexscreener.com/solana/${address}`,
    },
    {
      abbr: "BRD",
      text: "Birdeye",
      url: `https://birdeye.so/token/${address}?chain=solana`,
    },
    {
      abbr: "PHO",
      text: "Photon",
      url: `https://photon-sol.tinyastro.io/en/lp/${address}`,
    },
    {
      abbr: "NEO",
      text: "Neo",
      url: `https://neo.bullx.io/terminal?chainId=1399811149&address=${address}`,
    },
    {
      abbr: "AXIOM",
      text: "Axiom",
      url: `https://axiom.trade/meme/${address}`,
    },
    {
      abbr: "PF",
      text: "Pump.fun",
      url: `https://pump.fun/coin/${address}`,
    },
    {
      abbr: "GMGN",
      text: "GMGN",
      url: `https://gmgn.ai/sol/token/${address}`,
    },
    {
      abbr: "BBL",
      text: "Bubblemaps",
      url: `https://v2.bubblemaps.io/map?address=${address}&chain=solana`,
    },
  ];

  const linksHtml = links
    .map((link) => `<a href="${link.url}" target="_blank">${link.abbr}</a>`)
    .join(" • ");

  return linksHtml;
};

export async function formatTokenMessage(
  token: TokenInfo,
  ctx: Context,
  userId: string,
  stage: "1" | "2" = "1"
): Promise<string> {
  const user = await getUser(userId);
  if (!user) {
    // Don't send a message here, just return an error message that will be handled by the caller
    throw new Error("Unrecognized user");
  }
  const priceText = token.price ? `$${token.price.toFixed(8)}` : "N/A";
  const priceChangeText = token.priceChange24h
    ? `${token.priceChange24h > 0 ? "+" : ""}${token.priceChange24h.toFixed(2)}%`
    : "N/A";
  const priceChangeEmoji =
    token.priceChange24h && token.priceChange24h > 0 ? "🟢" : "🔴";

  const marketCapText = token.marketCap ? formatUSD(token.marketCap) : "N/A";
  const volumeText = token.volume24h ? formatUSD(token.volume24h) : "N/A";
  const liquidityText = token.liquidity ? formatUSD(token.liquidity) : "N/A";

  const verifiedBadge = token.verified ? "✅" : "";

  const linksHtml = await getHtmllinks(token.address);
  const botInfo = await ctx.api.getMe();
  const botUsername = botInfo.username;
  const [referralLinkResult] = await Promise.allSettled([
    generateReferralLink(user.id, botUsername),
  ]);

  const referralLink =
    referralLinkResult.status === "fulfilled" ? referralLinkResult.value : "";

  if (stage === "1") {
    // Additional formatting or data fetching for stage 1
    return `
🌟 <b>${token.name}</b> • $${token.symbol} ${verifiedBadge}
<code>${token.address}</code>
🤑 <a href="${referralLink}">🎁 Share & Earn Rewards</a>

💎 <b>Market Data</b>
├─ 💰 Price: <code>${priceText}</code>
├─ 📊 24h Change: ${priceChangeEmoji} <code>${priceChangeText}</code>
├─ 🏦 Market Cap: <code>${marketCapText}</code>
├─ 📈 Volume (24h): <code>${volumeText}</code>
└─ 💧 Liquidity: <code>${liquidityText}</code>

🔗 <b>External Links</b>
${linksHtml}

🎯 <b>Quick Actions</b>
Use the buttons below to interact with this token
<i>⏱ Loading additional data...</i>`;
  }

  let walletsBalanceSection = "";
  let supplyData: any = null;

  try {
    const { getFundingWallet, calculateUserTokenSupplyPercentage } =
      await import("../backend/functions");
    const [fundingWalletResult, supplyDataResult] = await Promise.allSettled([
      getFundingWallet(user.id),
      calculateUserTokenSupplyPercentage(user.id, token.address),
    ]);

    const fundingWallet =
      fundingWalletResult.status === "fulfilled"
        ? fundingWalletResult.value
        : null;

    supplyData =
      supplyDataResult.status === "fulfilled" ? supplyDataResult.value : null;

    const allWallets = [];

    if (fundingWallet) {
      allWallets.push({
        name: "Main",
        publicKey: fundingWallet.publicKey,
      });
    }

    if (allWallets.length > 0) {
      const balancePromises = allWallets.map(async (wallet) => {
        try {
          const [solBalanceResult, tokenBalanceResult] =
            await Promise.allSettled([
              getSolBalance(wallet.publicKey),
              checkSellAmountWithoutDecimals(token.address, wallet.publicKey),
            ]);

          const solBalance =
            solBalanceResult.status === "fulfilled"
              ? solBalanceResult.value
              : 0;
          const tokenBalance =
            tokenBalanceResult.status === "fulfilled"
              ? tokenBalanceResult.value
              : 0;

          const truncatedName =
            wallet.name.length > 8
              ? `${wallet.name.substring(0, 7)}...`
              : wallet.name.padEnd(8);

          const tokenAmount =
            tokenBalance > 0
              ? `${formatUSD(tokenBalance).replace("$", "")}`
              : "0";

          return `<code>${truncatedName}| ${tokenAmount.padEnd(12)}| ${solBalance.toFixed(3)}</code>`;
        } catch (error) {
          const truncatedName =
            wallet.name.length > 8
              ? `${wallet.name.substring(0, 7)}...`
              : wallet.name.padEnd(8);
          return `<code>${truncatedName}| 0 (0%)      | 0</code>`;
        }
      });

      const balanceLines = await Promise.all(balancePromises);

      walletsBalanceSection = `
<blockquote expandable><b>💰 Balances - Tap to expand</b>
<code>Wallet   | ${token.symbol.padEnd(8)} | SOL</code>
<code>─────────|${Array(token.symbol.length + 3)
        .fill("─")
        .join("")}|──────</code>
${balanceLines.join("\n")}
</blockquote>`;
    } else {
      walletsBalanceSection = `<pre class="tg-spoiler"><b>💰 Balances</b>
  <code>No wallets found</code>
  </pre>`;
    }
  } catch (error) {
    console.warn("Could not fetch wallet balances:", error);
    walletsBalanceSection = `<pre class="tg-spoiler"><b>💰 Balances</b>
  <code>Unable to load balances</code>
  </pre>`;
  }
  const refreshTime = new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  // Add supply percentage information if available
  logger.info(
    `Supply data for ${token.name} (${token.address}): ${JSON.stringify(supplyData)}`
  );
  let supplyPercentageSection = "";
  if (supplyData && supplyData.totalBalance > 0) {
    supplyPercentageSection = `
📊 Your Supply Ownership: ${supplyData.supplyPercentageFormatted} of total supply
💰 Total Holdings: ${supplyData.totalBalanceFormatted} tokens across ${supplyData.walletsWithBalance} wallet(s)`;
  }

  return `
🌟 <b>${token.name}</b> • $${token.symbol} ${verifiedBadge}
<code>${token.address}</code>
🤑 <a href="${referralLink}">🎁 Share & Earn Rewards</a>

💎 <b>Market Data</b>
├─ 💰 Price: <code>${priceText}</code>
├─ 📊 24h Change: ${priceChangeEmoji} <code>${priceChangeText}</code>
├─ 🏦 Market Cap: <code>${marketCapText}</code>
├─ 📈 Volume (24h): <code>${volumeText}</code>
└─ 💧 Liquidity: <code>${liquidityText}</code>
${supplyPercentageSection ? `\n📊 <b>Holdings</b>\n├─ <b>Ownership:</b> ${supplyData.supplyPercentageFormatted} of total supply\n└─ <b>Total:</b> ${supplyData.totalBalanceFormatted} tokens across ${supplyData.walletsWithBalance} wallet(s)` : ""}${walletsBalanceSection}
🔗 <b>External Links</b>
${linksHtml}

🎯 <b>Quick Actions</b>
Use the buttons below to interact with this token
<i>⏱ Updated: ${refreshTime}</i>`;
}

bot.on("message:text", async (ctx) => {
  try {
    // Check if the message is a Solana token address (32-44 characters, alphanumeric)
    const text = ctx.message.text.trim();
    if (/^[A-Za-z0-9]{32,44}$/.test(text)) {
      try {
        new PublicKey(text); // Validate if it's a valid Solana address
        logger.info(`User sent token address: ${text}`);

        // **ULTRA-FAST DISPLAY: Show token page IMMEDIATELY with zero blocking operations**
        let initialTokenName = "Loading...";
        let initialTokenSymbol = "...";
        let initialPlatformInfo = "🔍 Detecting...";
        let initialHoldingsText = "📌 Checking token holdings...";
        let initialMarketCap = "Loading...";
        let initialPrice = "Loading...";
        let initialLiquidity = "Loading...";
        let initialDex = "Loading...";
        let initialRenouncedText = "🔍 Checking...";
        let initialFrozenText = "🔍 Checking...";

        // Only check cache (this is instant, no blocking calls)
        const cachedPlatform = getCachedPlatform(text);
        if (cachedPlatform) {
          if (cachedPlatform === "pumpswap") {
            initialPlatformInfo = "⚡ Pumpswap";
          } else if (cachedPlatform === "pumpfun") {
            initialPlatformInfo = "🚀 PumpFun";
          } else {
            initialPlatformInfo = "❓ Unknown platform";
          }
          logger.info(
            `[token-display] Using cached platform for ${text}: ${cachedPlatform}`
          );
        }

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
            url: `https://photon-sol.tinyastro.io/en/lp/loading`,
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

        const linksHtml = links
          .map(
            (link) => `<a href="${link.url}" target="_blank">${link.abbr}</a>`
          )
          .join(" • ");

        // **INSTANT DISPLAY: Show token page immediately with ZERO blocking operations**
        const tokenInfoService = TokenInfoService.getInstance();

        const tokenInfo = await tokenInfoService.getTokenInfo(text);
        if (!tokenInfo) {
          await sendMessage(ctx, "❌ Token not found or invalid address.");
          return;
        }

        logger.info(
          `[token-display] Token info retrieved successfully for ${text}, calling formatTokenMessage...`
        );

        let tokenMessage: string;
        try {
          tokenMessage = await formatTokenMessage(
            tokenInfo,
            ctx,
            ctx.chat.id.toString(),
            "2"
          );
          logger.info(
            `[token-display] formatTokenMessage completed, message length: ${tokenMessage.length}, sending to user...`
          );
        } catch (formatError: any) {
          logger.error(
            `[token-display] formatTokenMessage failed: ${formatError.message}`,
            formatError
          );
          await sendMessage(
            ctx,
            "❌ Error formatting token information. Please try again."
          );
          return;
        }

        let message: any;
        try {
          message = await sendMessage(ctx, tokenMessage, {
            parse_mode: "HTML",
            reply_markup: new InlineKeyboard()
              .url("📊 Chart", `https://dexscreener.com/solana/${text}`)
              .url("🔗 Contract", `https://solscan.io/token/${text}`)
              .text("💸 Sell", `sell_token_${text}`)
              .row()
              .text(
                "📊 Monitor",
                `${CallBackQueries.VIEW_TOKEN_TRADES}_${text}`
              )
              .text("📈 CTO", `${CallBackQueries.CTO}_${text}`)
              .text("🔄 Refresh", `refresh_ca_${text}`)
              .row()
              .text("🎁 Airdrop SOL", `${CallBackQueries.AIRDROP_SOL}_${text}`)
              .row()
              .text("🏠 Menu", CallBackQueries.BACK),
          });

          logger.info(
            `[token-display] Message sent successfully to user, message_id: ${message.message_id}`
          );
        } catch (replyError: any) {
          logger.error(
            `[token-display] ctx.reply failed: ${replyError.message}`,
            replyError
          );
          await sendMessage(
            ctx,
            "❌ Error sending token information. Please try again."
          );
          return;
        }

        // **BACKGROUND UPDATES: ALL data fetching happens in background, including user checks**
        const updatePromises = [
          // User and token info fetch (moved to background)
          (async () => {
            try {
              // Get user info in background
              const user = await getUser(ctx.chat.id.toString());
              let tokenName = initialTokenName;
              let tokenSymbol = initialTokenSymbol;
              let isUserToken = false;

              // Check if it's a user token
              if (user) {
                const userToken = await getUserTokenWithBuyWallets(
                  user.id,
                  text
                );
                if (userToken) {
                  tokenName = userToken.name;
                  tokenSymbol = userToken.symbol;
                  isUserToken = true;
                }
              }

              // If not a user token, fetch from external API
              if (!isUserToken) {
                const tokenInfo = await getTokenInfo(text);
                if (tokenInfo && tokenInfo.baseToken) {
                  tokenName = tokenInfo.baseToken.name || tokenName;
                  tokenSymbol = tokenInfo.baseToken.symbol || tokenSymbol;
                  return {
                    type: "tokenInfo",
                    name: tokenName,
                    symbol: tokenSymbol,
                    marketCap: formatUSD(tokenInfo.marketCap),
                    price: tokenInfo.priceUsd,
                    liquidity: tokenInfo.liquidity
                      ? formatUSD(tokenInfo.liquidity.usd)
                      : "N/A",
                    dex: tokenInfo.dexId,
                    pairAddress: tokenInfo.pairAddress,
                    isUserToken: false,
                  };
                }
              }

              // Return user token info
              return {
                type: "tokenInfo",
                name: tokenName,
                symbol: tokenSymbol,
                marketCap: "User Token",
                price: "N/A",
                liquidity: "N/A",
                dex: "PUMPFUN",
                pairAddress: null,
                isUserToken: true,
              };
            } catch (error: any) {
              logger.warn(`Token info fetch failed: ${error.message}`);
              return null;
            }
          })(),

          // Holdings check (moved to background)
          (async () => {
            try {
              const user = await getUser(ctx.chat.id.toString());
              if (user) {
                // Use the new function to calculate supply percentage
                const { calculateUserTokenSupplyPercentage } = await import(
                  "../backend/functions"
                );
                const supplyData = await calculateUserTokenSupplyPercentage(
                  user.id,
                  text
                );

                let totalTokenBalance = supplyData.totalBalance;
                let walletsWithBalance = supplyData.walletsWithBalance;
                let devWalletBalance = 0;
                let supplyPercentageText = "";

                // Add supply percentage information if user has tokens
                if (supplyData.totalBalance > 0) {
                  supplyPercentageText = `\n📊 **Supply Ownership:** ${supplyData.supplyPercentageFormatted} of total supply`;
                }

                // Check dev wallet
                try {
                  const devWalletAddress = await getDefaultDevWallet(
                    String(user.id)
                  );
                  devWalletBalance = await getTokenBalance(
                    text,
                    devWalletAddress
                  );
                  if (devWalletBalance > 0) {
                    totalTokenBalance += devWalletBalance;
                    walletsWithBalance++;
                  }
                } catch (error) {
                  logger.warn(`Error checking dev wallet balance:`, error);
                }

                return {
                  type: "holdings",
                  balance: totalTokenBalance,
                  walletsWithBalance: walletsWithBalance,
                  devWalletBalance: devWalletBalance,
                  supplyPercentageText,
                };
              }
              return {
                type: "holdings",
                balance: 0,
                walletsWithBalance: 0,
                devWalletBalance: 0,
              };
            } catch (error: any) {
              logger.warn(`Holdings check failed: ${error.message}`);
              return {
                type: "holdings",
                balance: 0,
                walletsWithBalance: 0,
                devWalletBalance: 0,
              };
            }
          })(),

          // Platform detection (only if not cached)
          !cachedPlatform
            ? (async () => {
                try {
                  // Use fast detection that respects recent cache
                  const { detectTokenPlatformFast } = await import(
                    "../service/token-detection-service"
                  );
                  const platform = await detectTokenPlatformFast(text);

                  let platformText = "❓ Unknown platform";
                  if (platform === "pumpswap") {
                    platformText = "⚡ Pumpswap";
                  } else if (platform === "pumpfun") {
                    platformText = "🚀 PumpFun";
                  }
                  return { type: "platform", platform: platformText };
                } catch (error) {
                  return null;
                }
              })()
            : Promise.resolve(null),

          // Renounced and frozen check
          checkTokenRenouncedAndFrozen(text)
            .then((renouncedAndFrozen) => {
              return {
                type: "security",
                renouncedText: renouncedAndFrozen.isRenounced
                  ? "🟢 Renounced"
                  : "🔴 Not Renounced",
                frozenText: renouncedAndFrozen.isFrozen
                  ? "🟢 Freeze"
                  : "🔴 Not Freezed",
              };
            })
            .catch((error: any) => {
              logger.warn(`Security check failed: ${error.message}`);
              return {
                type: "security",
                renouncedText: "❓ Renounced check failed",
                frozenText: "❓ Freeze check failed",
              };
            }),
        ];

        // Wait for all background operations and update the message
        Promise.allSettled(updatePromises).then(async (results) => {
          try {
            let tokenName = initialTokenName;
            let tokenSymbol = initialTokenSymbol;
            let marketCap = initialMarketCap;
            let price = initialPrice;
            let liquidity = initialLiquidity;
            let dex = initialDex;
            let platformInfo = initialPlatformInfo;
            let holdingsText = initialHoldingsText;
            let walletsWithBalance = 0;
            let renouncedText = initialRenouncedText;
            let frozenText = initialFrozenText;
            let pairAddress = null;

            // Process results
            results.forEach((result) => {
              if (result.status === "fulfilled" && result.value) {
                const data = result.value;
                if (data.type === "tokenInfo") {
                  tokenName = (data as any).name;
                  tokenSymbol = (data as any).symbol;
                  marketCap = (data as any).marketCap;
                  price = (data as any).price;
                  liquidity = (data as any).liquidity;
                  dex = (data as any).dex.toLocaleUpperCase();
                  pairAddress = (data as any).pairAddress;
                } else if (data.type === "holdings") {
                  walletsWithBalance = (data as any).walletsWithBalance;
                  if ((data as any).balance > 0) {
                    const formattedBalance = (
                      (data as any).balance / 1e6
                    ).toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    });

                    // Check if dev wallet has tokens
                    const devWalletBalance =
                      (data as any).devWalletBalance || 0;
                    const supplyPercentageText =
                      (data as any).supplyPercentageText || "";

                    if (devWalletBalance > 0) {
                      const formattedDevBalance = (
                        devWalletBalance / 1e6
                      ).toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      });
                      holdingsText = `💰 ${formattedBalance} tokens across ${walletsWithBalance} wallet(s) (including dev wallet: ${formattedDevBalance})${supplyPercentageText}`;
                    } else {
                      holdingsText = `💰 ${formattedBalance} tokens across ${walletsWithBalance} buyer wallet(s)${supplyPercentageText}`;
                    }
                  } else {
                    holdingsText = `📌 No tokens found in your buyer wallets`;
                  }
                } else if (data.type === "platform") {
                  platformInfo = (data as any).platform;
                } else if (data.type === "security") {
                  renouncedText = (data as any).renouncedText;
                  frozenText = (data as any).frozenText;
                }
              }
            });

            // Update Photon link with actual pair address if available
            if (pairAddress) {
              const photonLink = links.find((link) => link.abbr === "PHO");
              if (photonLink) {
                photonLink.url = `https://photon-sol.tinyastro.io/en/lp/${pairAddress}`;
              }
            }

            const tokenInfoService = TokenInfoService.getInstance();

            const tokenInfo = await tokenInfoService.getTokenInfo(text);
            if (!tokenInfo) {
              await sendMessage(ctx, "❌ Token not found or invalid address.");
              return;
            }
            const tokenMessage = await formatTokenMessage(
              tokenInfo,
              ctx,
              ctx.chat.id.toString(),
              "2"
            );

            // Update the message with all the fetched data
            await ctx.api.editMessageText(
              ctx.chat!.id,
              message.message_id,
              tokenMessage,
              {
                parse_mode: "HTML",
                reply_markup: new InlineKeyboard()
                  .url("📊 Chart", `https://dexscreener.com/solana/${text}`)
                  .url("🔗 Contract", `https://solscan.io/token/${text}`)
                  .text("💸 Sell", `sell_token_${text}`)
                  .row()
                  .text(
                    "📊 Monitor",
                    `${CallBackQueries.VIEW_TOKEN_TRADES}_${text}`
                  )
                  .text("📈 CTO", `${CallBackQueries.CTO}_${text}`)
                  .text("🔄 Refresh", `refresh_ca_${text}`)
                  .row()
                  .text(
                    "🎁 Airdrop SOL",
                    `${CallBackQueries.AIRDROP_SOL}_${text}`
                  )
                  .row()
                  .text("🏠 Menu", CallBackQueries.BACK),
              }
            );

            logger.info(
              `[token-display] Successfully updated token details for ${text}`
            );
          } catch (updateError: any) {
            logger.error(
              `[token-display] Failed to update message: ${updateError.message}`
            );
          }
        });

        return;
      } catch (e) {
        // Not a valid Solana address, ignore or handle as regular text
      }
    }
    // If not a token address, do nothing or handle other text commands
  } catch (error) {
    logger.error("Error handling token address message:", error);
    // Send a user-friendly error message
    try {
      await sendMessage(
        ctx,
        "❌ Error displaying token information. Please try again or contact support if the issue persists."
      );
    } catch (replyError) {
      logger.error("Failed to send error message to user:", replyError);
    }
  }
});

// Remove the generic callback handler that was interfering with specific handlers
bot.command("reset", async (ctx) => {
  try {
    const cleared = await clearConversationState(ctx);
    if (cleared) {
      await sendMessage(
        ctx,
        "✅ Conversation state cleared successfully. You can now start fresh conversations."
      );
    } else {
      await sendMessage(
        ctx,
        "⚠️ Failed to clear conversation state completely. Please try again or contact support."
      );
    }
  } catch (error: any) {
    logger.error("Error in reset command:", error);
    await sendMessage(
      ctx,
      "❌ Error clearing conversation state. Please try again."
    );
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
    await sendMessage(
      ctx,
      "🔧 **Force Fix Applied**\n\n" +
        "✅ All conversation state cleared\n" +
        "✅ Session completely reset\n\n" +
        "You can now use the bot normally. Try /start or /menu to begin.",
      { parse_mode: "Markdown" }
    );

    logger.info("Force fix completed for user:", ctx.chat?.id);
  } catch (error: any) {
    logger.error("Error in force fix command:", error);
    await sendMessage(ctx, "❌ Force fix failed. Please contact support.");
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

    await sendMessage(
      ctx,
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
    await sendMessage(
      ctx,
      "❌ Fix launch failed. Please try /forcefix or contact support."
    );
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
      await sendMessage(
        ctx,
        "🚀 **Direct Launch**\n\n" +
          "Usage: `/directlaunch <token_address>`\n\n" +
          "Example: `/directlaunch 3oZ8DxXxDnxJ63Fc8DGja8xQnG1fgLshtKyLn9nkpUMP`\n\n" +
          "This bypasses conversation state issues and launches directly.",
        { parse_mode: "Markdown" }
      );
    }
  } catch (error: any) {
    logger.error("Direct launch failed:", error);
    await sendMessage(
      ctx,
      "❌ Direct launch failed. Please try /fixlaunch first, then use /menu to access your tokens normally."
    );
  }
});

bot.command("help", async (ctx) => {
  await sendMessage(
    ctx,
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

  // Apply specific rate limiting based on callback type
  try {
    if (data === CallBackQueries.CREATE_TOKEN) {
      // Token creation is resource intensive
      const tokenRateLimiter = rateLimitTokenOperations();
      await tokenRateLimiter(ctx, async () => {});
    } else if (
      data.startsWith(CallBackQueries.MANAGE_BUYER_WALLETS) ||
      data.startsWith(CallBackQueries.CHANGE_DEV_WALLET) ||
      data.includes("DELETE_BUYER_WALLET") ||
      data.includes("DELETE_DEV")
    ) {
      // Wallet operations are sensitive
      const walletRateLimiter = rateLimitWalletOperations();
      await walletRateLimiter(ctx, async () => {});
    } else if (
      data.includes("SELL_") ||
      data.includes("BUY_") ||
      data.includes("buy_") ||
      data.includes("sell_")
    ) {
      // Trading operations need higher frequency limits
      const tradingRateLimiter = rateLimitTradingOperations();
      await tradingRateLimiter(ctx, async () => {});
    }
  } catch (error) {
    // If rate limiting fails, log but continue
    logger.warn("Rate limiting check failed:", error);
  }

  // Handle "back-buy" and similar cases first
  if (data.startsWith("back-_")) {
    const [action, address] = data.split("_");
    console.log("reached bbbbb");
    // Answer callback query immediately
    await safeAnswerCallbackQuery(ctx, "🔄 Loading options...");

    const backKb = new InlineKeyboard()
      .text("💰 Buy Token", `${CallBackQueries.BUY_EXTERNAL_TOKEN}_${address}`)
      .row()
      .text(
        "💸 Sell Token",
        `${CallBackQueries.SELL_EXTERNAL_TOKEN}_${address}`
      )
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
          .text("Custom % ✏️", `sell_custom_${address}`)
          .row()
          .text("Menu", CallBackQueries.BACK);

        await safeEditMessageReplyMarkup(ctx, sellKb);
        break;
    }
  }

  // Handle airdrop SOL callback
  if (data.startsWith(`${CallBackQueries.AIRDROP_SOL}_`)) {
    console.log("🎁 Airdrop SOL callback detected:", data);
    const tokenAddress = data.replace(`${CallBackQueries.AIRDROP_SOL}_`, "");
    console.log("🎁 Token address extracted:", tokenAddress);

    try {
      // Answer callback query immediately
      await safeAnswerCallbackQuery(ctx, "🎁 Starting SOL airdrop...");
      console.log("🎁 Callback query answered, entering conversation...");

      // Enter airdrop conversation
      await ctx.conversation.enter("airdropSolConversation", tokenAddress);
      console.log("🎁 Airdrop conversation entered successfully");
    } catch (error: any) {
      console.error("🎁 Error in airdrop callback handler:", error);
      logger.error("Error starting airdrop conversation:", error);
      await safeAnswerCallbackQuery(ctx, "❌ Error starting airdrop");
    }
    return; // Add return to prevent further processing
  }
});

export default bot;

// Add this at the end of the file, after all other handlers
bot.on('callback_query', async (ctx) => {
  try {
    await ctx.answerCallbackQuery({
      text: '❌ This button is no longer valid or has expired. Please try again from the main menu.',
      show_alert: true,
    });
  } catch (e) {
    // Ignore errors from answering callback
  }
});
