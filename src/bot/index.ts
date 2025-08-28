import {
  Bot,
  InlineKeyboard,
  type Context,
  type BotError,
  GrammyError,
  HttpError,
  InputFile,
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
  safeAnswerCallbackQuery,
  compressCallbackData,
  decompressCallbackData,
  isCompressedCallbackData,
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
import { lastMessageMap, sendMessage } from "../backend/sender";
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
  getCurrentSolPrice,
} from "../backend/utils";
import { getTransactionFinancialStats } from "../backend/functions-main";
import { buyExternalTokenConversation } from "./conversation/externalTokenBuy";
import { referralsConversation } from "./conversation/referrals";
import { ctoConversation } from "./conversation/ctoConversation";
import { ctoMonitorConversation } from "./conversation/ctoMonitor";
import { handleViewTokenWallets } from "./monitor";
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
import { TokenModel, TransactionRecordModel } from "../backend/models";
import { handleSingleSell } from "../blockchain/common/singleSell";
import { sellPercentageMessage } from "./conversation/sellPercent";
import { sendErrorWithAutoDelete } from "./utils";
import { startLoadingState } from "./loading";
import { TokenInfoService } from "../service/token-info-service";
import { airdropSolConversation } from "./conversation/airdropSol";
import { predictMcConversation } from "./conversation/predictMc";
import { fundTokenWalletsConversation } from "./conversation/fundTokenWallets";
import mongoose from "mongoose";
import { htmlToJpg } from "../utils/generatePnlCard";
import relaunchTokenConversation from "./conversation/relaunchTokenConversation";

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
// bot.use(rateLimitCommands()); // Rate limit all commands
// bot.use(rateLimitCallbacks()); // Rate limit callback queries
// bot.use(rateLimitMessages()); // Rate limit message handling

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

  // Handle button data invalid errors
  if (
    err.error instanceof GrammyError &&
    err.error.description.includes("BUTTON_DATA_INVALID")
  ) {
    logger.warn("Button data invalid error detected:", {
      description: err.error.description,
      user: ctx.from?.username || ctx.from?.id,
      callback_data: ctx.callbackQuery?.data,
    });

    // Send a user-friendly message about the error
    if (ctx.chat) {
      try {
        await sendMessage(
          ctx,
          "⚠️ **Button Error Detected**\n\n" +
            "There was an issue with the message buttons. This has been automatically fixed.\n\n" +
            "Please use /view_tokens to manage your tokens.",
          { parse_mode: "Markdown" }
        );
      } catch (replyError: any) {
        logger.error(
          "Failed to send button error message:",
          replyError.message
        );
      }
    }
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

// Enhanced conversation state clearing for token display
async function clearConversationStateForTokenDisplay(
  ctx: any
): Promise<boolean> {
  try {
    const sessionCtx = ctx as any;
    let cleared = false;

    // Clear conversation session data
    if (sessionCtx.session) {
      // Clear the main conversation state
      if (sessionCtx.session.__conversation) {
        delete sessionCtx.session.__conversation;
        cleared = true;
        logger.info("Cleared __conversation session data for token display");
      }

      // Clear any other conversation-related session data
      const sessionKeys = Object.keys(sessionCtx.session);
      sessionKeys.forEach((key) => {
        if (key.startsWith("__conversation") || key.includes("conversation")) {
          delete sessionCtx.session[key];
          cleared = true;
          logger.info(`Cleared session key for token display: ${key}`);
        }
      });

      // Clear Grammy.js internal conversation state keys
      const grammyConversationKeys = sessionKeys.filter(
        (key) =>
          key.startsWith("__grammyjs_conversations") ||
          key.startsWith("__conversations") ||
          key.includes("__conv_")
      );

      grammyConversationKeys.forEach((key) => {
        delete sessionCtx.session[key];
        cleared = true;
        logger.info(
          `Cleared Grammy conversation key for token display: ${key}`
        );
      });
    }

    // Try to access and clear conversation context if available
    if (sessionCtx.conversation) {
      try {
        if (typeof sessionCtx.conversation.halt === "function") {
          await sessionCtx.conversation.halt();
          cleared = true;
          logger.info("Successfully halted conversation for token display");
        } else if (typeof sessionCtx.conversation.exit === "function") {
          await sessionCtx.conversation.exit();
          cleared = true;
          logger.info("Successfully exited conversation for token display");
        } else {
          delete sessionCtx.conversation;
          cleared = true;
        }
      } catch (haltError) {
        logger.warn(
          "Failed to halt conversation for token display, forcing clear:",
          haltError
        );
        try {
          delete sessionCtx.conversation;
          cleared = true;
        } catch (deleteError) {
          logger.warn(
            "Failed to delete conversation object for token display:",
            deleteError
          );
        }
      }
    }

    return cleared;
  } catch (error: any) {
    logger.error("Error in clearConversationStateForTokenDisplay:", error);
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
// bot.use(async (ctx, next) => {
//   try {
//     await next();
//   } catch (error: any) {
//     // Handle conversation-specific errors
//     if (error.message && error.message.includes("Bad replay, expected op")) {
//       logger.warn(
//         "Conversation replay error caught in middleware:",
//         error.message
//       );

//       // Clear conversation state completely
//       const cleared = await clearConversationState(ctx);

//       // Instead of just showing an error, provide immediate recovery options
//       const keyboard = new InlineKeyboard()
//         .text("🚀 Direct Launch Token", "direct_launch_recovery")
//         .row()
//         .text("🔧 Fix & Try Again", "fix_and_retry")
//         .row()
//         .text("📋 View Tokens", CallBackQueries.VIEW_TOKENS);

//       await sendMessage(
//         ctx,
//         "🔧 **Conversation State Fixed**\n\n" +
//           "✅ Error cleared automatically\n" +
//           "✅ Session reset completed\n\n" +
//           "**Choose how to continue:**",
//         {
//           parse_mode: "Markdown",
//           reply_markup: keyboard,
//         }
//       );
//       return;
//     }

//     // Re-throw other errors to be handled by global error handler
//     throw error;
//   }
// });

// **CRITICAL FIX: Middleware to ensure token address messages always work**
// This middleware runs before conversation middleware and allows token addresses to bypass conversation state
// bot.use(async (ctx, next) => {
//   // Check if this is a token address message
//   const text = ctx.message?.text?.trim();
//   if (text && /^[A-Za-z0-9]{32,44}$/.test(text)) {
//     try {
//       new PublicKey(text); // Validate if it's a valid Solana address
//       logger.info(
//         `[token-display] Token address detected, bypassing conversation state: ${text}`
//       );

//       // Clear any active conversation state for token addresses
//       await clearConversationStateForTokenDisplay(ctx);

//       // Continue to the token address handler
//       return next();
//     } catch (e) {
//       // Not a valid Solana address, continue normally
//     }
//   }

//   // For non-token addresses, continue with normal middleware flow
//   return next();
// });

// Message cleaner to delete user messages after 1 minute
const messageCleanupQueue = new Map<string, Set<number>>();

// bot.use(async (ctx, next) => {
//   if (ctx.message?.text) {
//     setImmediate(() =>
//       logger.info(
//         `[DebugMiddleware] ALL text message received: "${ctx.message?.text}" from user ${ctx.chat?.id}`
//       )
//     );
//     const detectedAddresses = TokenInfoService.detectTokenAddresses(
//       ctx.message.text
//     );
//     if (ctx.message.text.startsWith("/") || detectedAddresses.length > 0) {
//       logger.info(ctx.conversation.active());
//       if (ctx.conversation.active()) {
//         logger.info(
//           `[DebugMiddleware] Exiting all conversations for user ${ctx.chat?.id}`
//         );
//         await ctx.conversation.exitAll();
//       }
//     }
//   }
//   return next();
// });

bot.use(async (ctx, next) => {
  // Store user messages for cleanup
  if (ctx.message?.text && ctx.from && ctx.chat) {
    const userId = ctx.from.id.toString();
    const messageId = ctx.message.message_id;
    const chatId = ctx.chat.id;

    // Initialize user's message set if not exists
    if (!messageCleanupQueue.has(userId)) {
      messageCleanupQueue.set(userId, new Set());
    }

    // Add message to cleanup queue
    messageCleanupQueue.get(userId)!.add(messageId);

    // Schedule message deletion after 1 minute
    setTimeout(async () => {
      try {
        await ctx.api.deleteMessage(chatId, messageId);
        messageCleanupQueue.get(userId)?.delete(messageId);

        // Clean up empty sets
        if (messageCleanupQueue.get(userId)?.size === 0) {
          messageCleanupQueue.delete(userId);
        }
      } catch (error) {
        // Message might already be deleted or bot lacks permissions
        logger.error(
          `Failed to delete message ${messageId} for user ${userId}:`,
          error
        );
        messageCleanupQueue.get(userId)?.delete(messageId);
      }
    }, 60000); // 1 minute
  }

  return next();
});

// bot.use(async (ctx, next) => {
//   if (ctx.message && ctx.message.text) {
//     logger.info(
//       `[DebugMiddleware] Received text message: "${ctx.message.text}" from user ${ctx.chat?.id}`
//     );
//     const detectedAddresses = TokenInfoService.detectTokenAddresses(
//       ctx.message.text
//     );

//     logger.info(
//       `[DebugMiddleware] Solana address match: ${
//         detectedAddresses.length > 0 ? detectedAddresses[0] : "None"
//       }`
//     );
//     if (
//       detectedAddresses.length > 0
//       // (ctx.message.text.startsWith("/") && !ctx.callbackQuery)
//     ) {
//       logger.info(
//         `[MessageHandler] Detected Solana address, exiting conversations: "${ctx.message.text}"`
//       );

//       const conv = ctx.conversation.active();

//       const conversationName = conv;

//       if (conv) {
//         for (const key of Object.keys(conv)) {
//           await ctx.conversation.exit(key);
//           logger.info(
//             `[MessageHandler] Exiting conversation key: ${key} for user ${ctx.chat?.id}`
//           );
//         }

//         // After exiting conversations, continue to intended text handlers
//         logger.info(
//           `[MessageHandler] Conversations exited, processing text message: "${ctx.message?.text}"`
//         );
//         return next();
//       }
//     }
//   }

//   return next();
// });

// Middleware to patch reply/sendMessage and hook deletion
// bot.use(async (ctx, next) => {
//   const chatId = ctx.chat?.id;
//   const userMessageId = ctx.message?.message_id;

//   if (!chatId || !userMessageId) return next();

//   // Store original functions
//   const originalReply = ctx.reply.bind(ctx);
//   const originalSendMessage = ctx.api.sendMessage.bind(ctx.api);

//   let botResponded = false;

//   // Wrap ctx.reply
//   ctx.reply = async (...args) => {
//     botResponded = true;
//     return originalReply(...args);
//   };

//   // Wrap ctx.api.sendMessage
//   ctx.api.sendMessage = async (...args) => {
//     botResponded = true;
//     return originalSendMessage(...args);
//   };

//   await next();

//   if (botResponded) {
//     setTimeout(() => {
//       ctx.api.deleteMessage(chatId, userMessageId).catch(() => {});
//     }, 2500);
//   }
// });

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
bot.use(createConversation(relaunchTokenConversation));
bot.use(createConversation(sellIndividualToken));
bot.use(createConversation(sellPercentageMessage));
bot.use(createConversation(helpConversation));
bot.use(createConversation(airdropSolConversation));
bot.use(createConversation(predictMcConversation));
bot.use(createConversation(fundTokenWalletsConversation));

// ----- Commands ------
bot.command("start", async (ctx) => {
  try {
    logger.info("Start command used by user:", ctx.chat?.id);

    // Clear any existing conversation state
    await clearConversationState(ctx);

    // Wait a moment for cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Start main menu conversation
    await ctx.conversation.enter("mainMenuConversation", {
      overwrite: true,
    });
  } catch (error: any) {
    logger.error("Error in start command:", error);
    await sendMessage(ctx, "❌ Error starting bot. Please try again.");
  }
});

bot.command("menu", async (ctx) => {
  try {
    logger.info("Menu command used by user:", ctx.chat?.id);

    // Clear any existing conversation state
    await clearConversationState(ctx);

    // Wait a moment for cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Start main menu conversation
    await ctx.conversation.enter("mainMenuConversation", {
      overwrite: true,
    });
  } catch (error: any) {
    logger.error("Error in menu command:", error);
    await sendMessage(
      ctx,
      "❌ Error accessing menu. Please try /start instead."
    );
  }
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

bot.command("referrals", async (ctx) => {
  await ctx.conversation.enter("referralsConversation");
});

bot.command("wallets", async (ctx) => {
  await ctx.conversation.enter("walletConfigConversation");
});

bot.command("create", async (ctx) => {
  try {
    logger.info("Create token command used by user:", ctx.chat?.id);

    // Clear any existing conversation state
    await clearConversationState(ctx);

    // Wait a moment for cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Start create token conversation
    await ctx.conversation.enter("createTokenConversation", {
      overwrite: true,
    });
  } catch (error: any) {
    logger.error("Error in create command:", error);
    await sendMessage(
      ctx,
      "❌ Error starting token creation. Please try again."
    );
  }
});

bot.command("tokens", async (ctx) => {
  try {
    logger.info("View tokens command used by user:", ctx.chat?.id);

    // Clear any existing conversation state
    await clearConversationState(ctx);

    // Wait a moment for cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Start view tokens conversation
    await ctx.conversation.enter("viewTokensConversation", {
      overwrite: true,
    });
  } catch (error: any) {
    logger.error("Error in tokens command:", error);
    await sendMessage(ctx, "❌ Error loading tokens. Please try again.");
  }
});

bot.command("commands", async (ctx) => {
  try {
    const commandsList = [
      "🤖 <b>Nitro Bot Commands</b>",
      "",
      "<b>🚀 Main Commands:</b>",
      "• <code>/start</code> - Start the bot and main menu",
      "• <code>/menu</code> - Show main menu",
      "• <code>/help</code> - Comprehensive help center",
      "",
      "<b>🎯 Token Commands:</b>",
      "• <code>/create</code> - Create a new token",
      "• <code>/tokens</code> - View your created tokens",
      "",
      "<b>💳 Wallet Commands:</b>",
      "• <code>/wallets</code> - Manage your wallets",
      "• <code>/referrals</code> - View referral system",
      "",
      "<b>🛒 Trading Commands:</b>",
      "• <code>/buyexternal</code> - Buy external tokens",
      "",
      "<i>💡 Tip: Use the buttons in conversations for easier navigation!</i>",
    ].join("\n");

    await sendMessage(ctx, commandsList, { parse_mode: "HTML" });
  } catch (error: any) {
    logger.error("Error in commands command:", error);
    await sendMessage(ctx, "❌ Error displaying commands. Please try again.");
  }
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
    "<b>Your Dev Wallet Private Key</b>\n",
    '<span class="tg-spoiler">' + wallet + "</span>",
    "<i>⚠️ Copy it now and delete this message as soon as you're done. Never share your private key with anyone!</i>",
  ].join("\n");
  const keyboard = new InlineKeyboard().text("🗑 Delete", "del_message");
  const sent = await sendMessage(ctx, msg, {
    parse_mode: "HTML",
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

  // Find token by address (improved order: exact match first)
  const user = await getUser(ctx.chat!.id!.toString());
  if (!user) {
    await sendMessage(ctx, "❌ User not found");
    return;
  }

  const { TokenModel } = await import("../backend/models");

  // 1. Try exact match first
  let token = await TokenModel.findOne({
    user: user.id,
    tokenAddress: tokenAddressPrefix,
  });

  // 2. If not found, try prefix regex (case-sensitive)
  if (!token) {
    token = await TokenModel.findOne({
      user: user.id,
      tokenAddress: { $regex: `^${tokenAddressPrefix}` },
    });
  }

  // 3. If still not found, try case-insensitive regex
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
// REMOVED: Conflicting fund_wallet_ handler - now handled by fundTokenWalletsConversation
// This was causing conflicts with the conversation-based funding system

// REMOVED: Conflicting fund_all_wallets_ handler - now handled by fundTokenWalletsConversation
// This was causing conflicts with the conversation-based funding system

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
    bot,
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
    bot,
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

    // **SEAMLESS REFRESH: Clear cache and fetch fresh data**
    const tokenInfoService = TokenInfoService.getInstance();

    // Clear token cache to force fresh data fetch
    tokenInfoService.clearTokenCache(tokenAddress);
    logger.info(`[refresh] Cleared cache for token: ${tokenAddress}`);

    // Fetch fresh token data
    const tokenInfo = await tokenInfoService.getTokenInfo(tokenAddress);
    if (!tokenInfo) {
      await sendMessage(ctx, "❌ Token not found or invalid address.");
      return;
    }

    // Generate fresh token message with current data
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
        .text(
          "👝 View Wallets",
          compressCallbackData(CallBackQueries.VIEW_TOKEN_WALLETS, tokenAddress)
        )
        .row()
        .text("📈 CTO", `${CallBackQueries.CTO}_${tokenAddress}`)
        .text("🔄 Refresh", `refresh_ca_${tokenAddress}`)
        .row()
        .text("🏠 Menu", CallBackQueries.BACK),
    });

    logger.info(
      `[refresh] Successfully refreshed token data for ${tokenAddress}`
    );

    // Provide user feedback about the refresh
    await safeAnswerCallbackQuery(ctx, "✅ Token data refreshed successfully!");
  } catch (error) {
    logger.error(
      `[refresh] Error refreshing token data: ${(error as Error).message}`
    );
    await sendMessage(ctx, "❌ Error refreshing token data. Please try again.");
    await safeAnswerCallbackQuery(ctx, "❌ Refresh failed. Try again.");
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

// Handle compressed callback data
function handleCompressedCallback(
  data: string
): { action: string; tokenAddress: string } | null {
  if (isCompressedCallbackData(data)) {
    return decompressCallbackData(data);
  }
  return null;
}

// Updated callback handlers to handle compressed data

// Handle fund token wallets button clicks
bot.callbackQuery(/^(ftw_|fund_token_wallets_)/, async (ctx) => {
  logger.info(
    `[FundTokenWallets] Callback triggered with data: ${ctx.callbackQuery.data}`
  );
  logger.info(`[FundTokenWallets] Pattern matched: ${ctx.callbackQuery.data}`);
  await safeAnswerCallbackQuery(ctx, "💸 Loading fund options...");

  let tokenAddress: string;
  const data = ctx.callbackQuery.data;

  if (isCompressedCallbackData(data)) {
    const decompressed = decompressCallbackData(data);
    if (!decompressed) {
      await sendMessage(ctx, "❌ Invalid callback data.");
      return;
    }
    tokenAddress = decompressed.tokenAddress;
  } else {
    // Handle legacy uncompressed format
    tokenAddress = data.split("_").slice(2).join("_");
  }

  // Validate and clean the token address
  try {
    // Remove any "wallets_" prefix that might have been accidentally added
    if (tokenAddress.startsWith("wallets_")) {
      tokenAddress = tokenAddress.substring(8); // Remove "wallets_" prefix
      logger.warn(
        `[FundTokenWallets] Removed 'wallets_' prefix from token address: ${tokenAddress}`
      );
    }

    // Validate that it's a valid Solana address
    const { PublicKey } = await import("@solana/web3.js");
    new PublicKey(tokenAddress);
  } catch (error) {
    logger.error(
      `[FundTokenWallets] Invalid token address: ${tokenAddress}`,
      error
    );
    await sendMessage(ctx, "❌ Invalid token address in callback data.");
    return;
  }

  logger.info(
    `[FundTokenWallets] Fund button clicked for token: ${tokenAddress}`
  );

  // Start the fund token wallets conversation
  try {
    await ctx.conversation.enter("fundTokenWalletsConversation", tokenAddress);
    logger.info(
      `[FundTokenWallets] Conversation started successfully for token: ${tokenAddress}`
    );
  } catch (error) {
    logger.error(
      `[FundTokenWallets] Failed to start conversation for token: ${tokenAddress}`,
      error
    );
    await sendMessage(
      ctx,
      "❌ Error starting fund token wallets conversation. Please try again."
    );
  }
});

// Handle fund all wallets button clicks (from conversation)
bot.callbackQuery(/^fund_all_wallets_(.+)$/, async (ctx) => {
  logger.info(
    `[FundAllWallets] Callback triggered with data: ${ctx.callbackQuery.data}`
  );
  await safeAnswerCallbackQuery(ctx, "💸 Processing fund all wallets...");

  const tokenAddress = ctx.callbackQuery.data.split("_").slice(2).join("_");
  logger.info(`[FundAllWallets] Fund all wallets for token: ${tokenAddress}`);

  // This should be handled by the conversation, but if it reaches here, redirect to conversation
  try {
    await ctx.conversation.enter("fundTokenWalletsConversation", tokenAddress);
  } catch (error) {
    logger.error(
      `[FundAllWallets] Failed to start conversation for token: ${tokenAddress}`,
      error
    );
    await sendMessage(
      ctx,
      "❌ Error starting fund token wallets conversation. Please try again."
    );
  }
});

// Handle fund top wallets button clicks (from conversation)
bot.callbackQuery(/^fund_top_wallets_(.+)_(\d+)$/, async (ctx) => {
  logger.info(
    `[FundTopWallets] Callback triggered with data: ${ctx.callbackQuery.data}`
  );
  await safeAnswerCallbackQuery(ctx, "💸 Processing fund top wallets...");

  const parts = ctx.callbackQuery.data.split("_");
  const tokenAddress = parts.slice(2, -1).join("_"); // Everything between fund_top_wallets_ and the count
  const walletCount = parseInt(parts[parts.length - 1]);

  logger.info(
    `[FundTopWallets] Fund top ${walletCount} wallets for token: ${tokenAddress}`
  );

  // This should be handled by the conversation, but if it reaches here, redirect to conversation
  try {
    await ctx.conversation.enter("fundTokenWalletsConversation", tokenAddress);
  } catch (error) {
    logger.error(
      `[FundTopWallets] Failed to start conversation for token: ${tokenAddress}`,
      error
    );
    await sendMessage(
      ctx,
      "❌ Error starting fund token wallets conversation. Please try again."
    );
  }
});

// Handle view token wallets button clicks
bot.callbackQuery(/^(vtw_|view_token_wallets_)/, async (ctx) => {
  logger.info(
    `[ViewTokenWallets] Callback triggered with data: ${ctx.callbackQuery.data}`
  );
  await safeAnswerCallbackQuery(ctx, "👝 Loading wallet holdings...");

  let tokenAddress: string;
  let page: number = 0;
  const data = ctx.callbackQuery.data;

  if (isCompressedCallbackData(data)) {
    const decompressed = decompressCallbackData(data);
    if (!decompressed) {
      await sendMessage(ctx, "❌ Invalid callback data.");
      return;
    }
    tokenAddress = decompressed.tokenAddress;
    // Check if page number is included in the decompressed data
    const pageMatch = decompressed.tokenAddress.match(/^(.+)_(\d+)$/);
    if (pageMatch) {
      tokenAddress = pageMatch[1];
      page = parseInt(pageMatch[2]);
    }
  } else {
    // Handle legacy uncompressed format
    const parts = data.split("_");
    tokenAddress = parts.slice(3).join("_");
    // Check if last part is a page number
    const lastPart = parts[parts.length - 1];
    if (/^\d+$/.test(lastPart)) {
      page = parseInt(lastPart);
      tokenAddress = parts.slice(3, -1).join("_");
    }
  }

  const userId = ctx.chat?.id.toString();
  if (!userId) {
    await sendMessage(ctx, "❌ User ID not found.");
    return;
  }

  logger.info(
    `[ViewTokenWallets] Displaying wallets for token: ${tokenAddress}, page: ${page}`
  );

  try {
    await handleViewTokenWallets(ctx, userId, tokenAddress, page);
  } catch (error) {
    logger.error(
      `[ViewTokenWallets] Error displaying wallets for token: ${tokenAddress}`,
      error
    );
    await sendMessage(ctx, "❌ Error loading wallet data. Please try again.");
  }
});

// Handle sell wallet token button clicks
bot.callbackQuery(/^(swt_|sell_wallet_token_)/, async (ctx) => {
  logger.info(
    `[SellWalletToken] Callback triggered with data: ${ctx.callbackQuery.data}`
  );
  await safeAnswerCallbackQuery(ctx, "💸 Preparing to sell wallet tokens...");

  let tokenAddress: string;
  let walletAddress: string;
  let walletType: string;
  const data = ctx.callbackQuery.data;

  if (isCompressedCallbackData(data)) {
    const decompressed = decompressCallbackData(data);
    if (!decompressed) {
      await sendMessage(ctx, "❌ Invalid callback data.");
      return;
    }
    // For sell wallet token, the format is: tokenAddress_walletAddress_walletType
    const parts = decompressed.tokenAddress.split("_");
    if (parts.length >= 3) {
      tokenAddress = parts[0];
      walletAddress = parts[1];
      walletType = parts[2];
    } else {
      await sendMessage(ctx, "❌ Invalid wallet token data format.");
      return;
    }
  } else {
    // Handle legacy uncompressed format
    const parts = data.split("_");
    if (parts.length >= 6) {
      // sell_wallet_token_tokenAddress_walletAddress_walletType
      tokenAddress = parts[3];
      walletAddress = parts[4];
      walletType = parts[5];
    } else {
      await sendMessage(ctx, "❌ Invalid wallet token data format.");
      return;
    }
  }

  const userId = ctx.chat?.id.toString();
  if (!userId) {
    await sendMessage(ctx, "❌ User ID not found.");
    return;
  }

  logger.info(
    `[SellWalletToken] Selling tokens from ${walletType} wallet: ${walletAddress} for token: ${tokenAddress}`
  );

  try {
    // Redirect to the existing sell individual token conversation with specific wallet
    await ctx.conversation.enter(
      "sellIndividualToken",
      tokenAddress,
      0,
      walletAddress
    );
  } catch (error) {
    logger.error(
      `[SellWalletToken] Error starting sell conversation for wallet: ${walletAddress}`,
      error
    );
    await sendMessage(ctx, "❌ Error starting sell process. Please try again.");
  }
});

// Handle refresh launch data button clicks
bot.callbackQuery(
  /^(rld_|rbld_|refresh_launch_data_|refresh_bonk_launch_data_)/,
  async (ctx) => {
    await safeAnswerCallbackQuery(ctx, "🔄 Refreshing...");

    let tokenAddress: string;
    let isBonk = false;
    const data = ctx.callbackQuery.data;

    if (isCompressedCallbackData(data)) {
      const decompressed = decompressCallbackData(data);
      if (!decompressed) {
        await sendMessage(ctx, "❌ Invalid callback data.");
        return;
      }
      tokenAddress = decompressed.tokenAddress;
      isBonk = decompressed.action === "REFRESH_BONK_LAUNCH_DATA";
    } else {
      // Handle legacy uncompressed format
      const parts = data.split("_");
      tokenAddress = parts.slice(3).join("_");
      isBonk = parts[2] === "bonk";
    }

    // Validate and clean the token address
    try {
      // Remove any "wallets_" prefix that might have been accidentally added
      if (tokenAddress.startsWith("wallets_")) {
        tokenAddress = tokenAddress.substring(8); // Remove "wallets_" prefix
        logger.warn(
          `[Refresh] Removed 'wallets_' prefix from token address: ${tokenAddress}`
        );
      }

      // Validate that it's a valid Solana address
      const { PublicKey } = await import("@solana/web3.js");
      new PublicKey(tokenAddress);
    } catch (error) {
      logger.error(`[Refresh] Invalid token address: ${tokenAddress}`, error);
      await sendMessage(ctx, "❌ Invalid token address in callback data.");
      return;
    }

    logger.info(
      `[Refresh] Refresh clicked for ${isBonk ? "Bonk" : "PumpFun"} token: ${tokenAddress}`
    );

    try {
      // First try to get token info from user's database
      const user = await getUser(ctx.chat!.id.toString());
      let tokenName = "Unknown Token";
      let tokenSymbol = "UNK";

      if (user) {
        const userToken = await getUserTokenWithBuyWallets(
          user.id,
          tokenAddress
        );
        if (userToken) {
          tokenName = userToken.name;
          tokenSymbol = userToken.symbol;
          logger.info(
            `[Refresh] Found token in user database: ${tokenName} (${tokenSymbol})`
          );
        }
      }

      // If not found in user database, try external APIs
      if (tokenName === "Unknown Token") {
        const tokenInfo = await getTokenInfo(tokenAddress);
        if (tokenInfo) {
          tokenName =
            tokenInfo.baseToken?.name || tokenInfo.name || "Unknown Token";
          tokenSymbol =
            tokenInfo.baseToken?.symbol || tokenInfo.symbol || "UNK";
          logger.info(
            `[Refresh] Found token in external API: ${tokenName} (${tokenSymbol})`
          );
        } else {
          logger.warn(
            `[Refresh] Token not found in external APIs: ${tokenAddress}`
          );
          // Still proceed with unknown token name/symbol
        }
      }

      // Import and call the appropriate refresh function
      const { handleLaunchDataRefresh, handleBonkLaunchDataRefresh } =
        await import("./message");

      if (isBonk) {
        await handleBonkLaunchDataRefresh(
          bot,
          ctx.chat!.id,
          ctx.callbackQuery.message!.message_id,
          tokenAddress,
          tokenName,
          tokenSymbol
        );
      } else {
        await handleLaunchDataRefresh(
          bot,
          ctx.chat!.id,
          ctx.callbackQuery.message!.message_id,
          tokenAddress,
          tokenName,
          tokenSymbol
        );
      }
    } catch (error) {
      logger.error(
        `[Refresh] Error refreshing token data: ${(error as Error).message}`
      );
      await sendMessage(
        ctx,
        "❌ Error refreshing token data. Please try again."
      );
    }
  }
);

// Handle sell dev supply button clicks
bot.callbackQuery(/^(sds_|sell_dev_supply_)/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "💸 Selling dev supply...");

  let tokenAddress: string;
  const data = ctx.callbackQuery.data;

  if (isCompressedCallbackData(data)) {
    const decompressed = decompressCallbackData(data);
    if (!decompressed) {
      await sendMessage(ctx, "❌ Invalid callback data.");
      return;
    }
    tokenAddress = decompressed.tokenAddress;
  } else {
    // Handle legacy uncompressed format
    tokenAddress = data.split("_").slice(2).join("_");
  }

  logger.info(
    `[SellDevSupply] Sell dev supply clicked for token: ${tokenAddress}`
  );

  // Start the sell dev supply conversation
  await ctx.conversation.enter("sellDevSupplyConversation", tokenAddress);
});

// Handle sell dev button clicks
bot.callbackQuery(/^(sd_|sell_dev_)/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "💸 Selling dev tokens...");

  let tokenAddress: string;
  const data = ctx.callbackQuery.data;

  if (isCompressedCallbackData(data)) {
    const decompressed = decompressCallbackData(data);
    if (!decompressed) {
      await sendMessage(ctx, "❌ Invalid callback data.");
      return;
    }
    tokenAddress = decompressed.tokenAddress;
  } else {
    // Handle legacy uncompressed format
    tokenAddress = data.split("_").slice(2).join("_");
  }

  logger.info(`[SellDev] Sell dev clicked for token: ${tokenAddress}`);

  // Start the sell dev conversation
  await ctx.conversation.enter("sellDevConversation", tokenAddress);
});

// Handle sell percent button clicks
bot.callbackQuery(/^(sp_|sell_percent_)/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "💸 Loading sell options...");

  let tokenAddress: string;
  const data = ctx.callbackQuery.data;

  if (isCompressedCallbackData(data)) {
    const decompressed = decompressCallbackData(data);
    if (!decompressed) {
      await sendMessage(ctx, "❌ Invalid callback data.");
      return;
    }
    tokenAddress = decompressed.tokenAddress;
  } else {
    // Handle legacy uncompressed format
    tokenAddress = data.split("_").slice(2).join("_");
  }

  logger.info(`[SellPercent] Sell percent clicked for token: ${tokenAddress}`);

  // Start the sell percent conversation
  await ctx.conversation.enter("sellPercentageMessage", tokenAddress);
});

// Handle sell all button clicks
bot.callbackQuery(/^(sa_|sell_all_)/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "💸 Selling all tokens...");

  let tokenAddress: string;
  const data = ctx.callbackQuery.data;

  if (isCompressedCallbackData(data)) {
    const decompressed = decompressCallbackData(data);
    if (!decompressed) {
      await sendMessage(ctx, "❌ Invalid callback data.");
      return;
    }
    tokenAddress = decompressed.tokenAddress;
  } else {
    // Handle legacy uncompressed format
    tokenAddress = data.split("_").slice(2).join("_");
  }

  logger.info(`[SellAll] Sell all clicked for token: ${tokenAddress}`);

  // Start the sell all conversation
  await ctx.conversation.enter("sellAllConversation", tokenAddress);
});

// Handle sell individual button clicks
bot.callbackQuery(/^(si_|sell_individual_)/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "💸 Loading individual sells...");

  let tokenAddress: string;
  const data = ctx.callbackQuery.data;

  if (isCompressedCallbackData(data)) {
    const decompressed = decompressCallbackData(data);
    if (!decompressed) {
      await sendMessage(ctx, "❌ Invalid callback data.");
      return;
    }
    tokenAddress = decompressed.tokenAddress;
  } else {
    // Handle legacy uncompressed format
    tokenAddress = data.split("_").slice(2).join("_");
  }

  logger.info(
    `[SellIndividual] Sell individual clicked for token: ${tokenAddress}`
  );

  // Start the sell individual conversation
  await ctx.conversation.enter("sellIndividualTokenConversation", tokenAddress);
});

// Handle airdrop SOL button clicks
bot.callbackQuery(/^(as_|airdrop_sol_)/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "🎁 Loading airdrop options...");

  let tokenAddress: string;
  const data = ctx.callbackQuery.data;

  if (isCompressedCallbackData(data)) {
    const decompressed = decompressCallbackData(data);
    if (!decompressed) {
      await sendMessage(ctx, "❌ Invalid callback data.");
      return;
    }
    tokenAddress = decompressed.tokenAddress;
  } else {
    // Handle legacy uncompressed format
    tokenAddress = data.split("_").slice(2).join("_");
  }

  logger.info(`[AirdropSol] Airdrop SOL clicked for token: ${tokenAddress}`);

  // Start the airdrop SOL conversation
  await ctx.conversation.enter("airdropSolConversation", tokenAddress);
});

bot.callbackQuery(
  new RegExp(`^(vtt_|${CallBackQueries.VIEW_TOKEN_TRADES}_)`),
  async (ctx) => {
    // Debug: Log when monitor button is clicked
    console.log(
      "Monitor button clicked! Callback data:",
      ctx.callbackQuery.data
    );

    // Get user ID from context
    const userId = ctx?.chat!.id.toString();
    const user = await getUser(userId);
    if (!user) {
      await sendMessage(ctx, "Unrecognized user ❌");
      return;
    }
    await safeAnswerCallbackQuery(ctx, "💰 Loading");

    let tokenAddress: string;
    const data = ctx.callbackQuery.data;

    if (isCompressedCallbackData(data)) {
      const decompressed = decompressCallbackData(data);
      if (!decompressed) {
        await sendMessage(ctx, "❌ Invalid callback data.");
        return;
      }
      tokenAddress = decompressed.tokenAddress;
    } else {
      // Handle legacy uncompressed format
      tokenAddress = data.split("_").pop() || "";
    }

    if (!tokenAddress) {
      await sendMessage(ctx, "❌ Invalid token address.");
      return;
    }

    try {
      const buyerWallets = await getAllBuyerWallets(user.id);
      const devWallet = await getDefaultDevWallet(String(user.id));
      const devWalletAddress = devWallet;

      // Get dev wallet token balance for this token
      let devWalletTokenBalance = 0;
      try {
        devWalletTokenBalance = await getTokenBalance(
          tokenAddress,
          devWalletAddress
        );
      } catch (error) {
        logger.warn(`Failed to get dev wallet token balance: ${error}`);
      }

      // Add dev wallet to buyer wallets if it has tokens
      if (devWalletTokenBalance > 0) {
        buyerWallets.push({
          id: `dev-${user.id}`,
          publicKey: devWalletAddress,
          createdAt: new Date(),
        });
      }

      logger.info(
        `Buyer wallets: ${JSON.stringify(buyerWallets, null, 2)}, for user ${user.id}`
      );

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
      // console.log(buyerWallets);
      const walletDetails = await Promise.all(
        buyerWallets.map(async (wallet) => {
          const transactions = await TransactionRecordModel.find({
            tokenAddress,
            walletPublicKey: wallet.publicKey,
          });

          // Get current token balance for this wallet
          let currentTokenBalance = 0;
          try {
            currentTokenBalance = await getTokenBalance(
              tokenAddress,
              wallet.publicKey
            );
          } catch (error) {
            logger.warn(
              `Failed to get token balance for wallet ${wallet.publicKey}:`,
              error
            );
          }

          // Group transactions by type
          const groupedTransactions = {
            devBuys: transactions.filter(
              (tx) => tx.transactionType === "dev_buy"
            ),
            devSells: transactions.filter(
              (tx) => tx.transactionType === "dev_sell"
            ),
            snipeBuys: transactions.filter(
              (tx) => tx.transactionType === "snipe_buy"
            ),
            snipeSells: transactions.filter(
              (tx) => tx.transactionType === "wallet_sell"
            ),
          };

          // Calculate totals for each category
          const summary = {
            devBuys: {
              count: groupedTransactions.devBuys.length,
              totalAmount: groupedTransactions.devBuys.reduce(
                (sum, tx) => sum + (tx.amountSol || 0),
                0
              ),
              totalValue: groupedTransactions.devBuys.reduce(
                (sum, tx) => sum + (tx.amountSol || 0),
                0
              ),
            },
            devSells: {
              count: groupedTransactions.devSells.length,
              totalAmount: groupedTransactions.devSells.reduce(
                (sum, tx) => sum + (tx.amountSol || 0),
                0
              ),
              totalValue: groupedTransactions.devSells.reduce(
                (sum, tx) => sum + (tx.amountSol || 0),
                0
              ),
            },
            snipeBuys: {
              count: groupedTransactions.snipeBuys.length,
              totalAmount: groupedTransactions.snipeBuys.reduce(
                (sum, tx) => sum + (tx.amountSol || 0),
                0
              ),
              totalValue: groupedTransactions.snipeBuys.reduce(
                (sum, tx) => sum + (tx.amountSol || 0),
                0
              ),
            },
            snipeSells: {
              count: groupedTransactions.snipeSells.length,
              totalAmount: groupedTransactions.snipeSells.reduce(
                (sum, tx) => sum + (tx.amountSol || 0),
                0
              ),
              totalValue: groupedTransactions.snipeSells.reduce(
                (sum, tx) => sum + (tx.amountSol || 0),
                0
              ),
            },
          };

          return {
            address: wallet.publicKey,
            currentTokenBalance,
            transactions: groupedTransactions,
            summary,
            totalTransactions: transactions.length,
          };
        })
      );

      // Calculate total initial (all buy transactions) and payout (all sell transactions)
      const initial = walletDetails.reduce((total, wallet) => {
        return (
          total +
          wallet.summary.devBuys.totalAmount +
          wallet.summary.snipeBuys.totalAmount
        );
      }, 0);

      const payout = walletDetails.reduce((total, wallet) => {
        return (
          total +
          wallet.summary.devSells.totalAmount +
          wallet.summary.snipeSells.totalAmount
        );
      }, 0);

      // Calculate total supply (sum of all current token balances across wallets)
      const totalSupply =
        walletDetails.reduce((total, wallet) => {
          return total + wallet.currentTokenBalance;
        }, 0) / Math.pow(10, tokenInfo.baseToken.decimals);

      // Calculate percentage of total token supply held
      let supplyPercentage = 0;
      let supplyPercentageText = "";

      if (tokenInfo.birdeye.totalSupply && totalSupply > 0) {
        // Convert supply to number (it might be a string)
        const totalTokenSupply =
          typeof tokenInfo.birdeye.totalSupply === "string"
            ? parseFloat(tokenInfo.birdeye.totalSupply)
            : tokenInfo.birdeye.totalSupply;

        // Calculate percentage held
        console.log(
          `Total supply: ${totalSupply}, Total token supply: ${totalTokenSupply}`
        );
        supplyPercentage = (totalSupply / totalTokenSupply) * 100;
        supplyPercentageText = `${supplyPercentage.toFixed(4)}%`;

        logger.info(
          `[TokenTrades] Supply calculation: ${totalSupply} / ${totalTokenSupply} = ${supplyPercentageText}`
        );
      }

      // Calculate current worth of all tokens in SOL
      const solPrice = await getCurrentSolPrice();
      const currentPrice = tokenInfo.priceUsd || 0;
      let totalCurrentWorthSol = 0;

      if (currentPrice && solPrice) {
        const priceInSol = currentPrice / solPrice;
        totalCurrentWorthSol = totalSupply * priceInSol;

        logger.info(
          `[TokenTrades] Total tokens: ${totalSupply}, Price in SOL: ${priceInSol}, Worth: ${totalCurrentWorthSol} SOL`
        );
      } else {
        logger.warn(
          `[TokenTrades] Unable to calculate worth - currentPrice: ${currentPrice}, solPrice: ${solPrice}`
        );
      }

      // Dummy data for demonstration
      const totalInitial = 10.5; // 10.5 SOL initial investment
      const totalPayout = 3.2; // 3.2 SOL already sold
      const totalCurrentWorth = 15.8; // Current worth of remaining tokens

      // Create dummy wallet stats section

      // TODO fetch actual trade history
      // Calculate PnL based on initial investment and current worth
      const totalPnL = totalCurrentWorthSol + payout - initial;
      const pnLPercentage =
        initial > 0 ? ((totalPnL / initial) * 100).toFixed(2) : "0.00";
      const pnLFormatted = `${totalPnL >= 0 ? "+" : ""}${totalPnL.toFixed(3)} SOL (${pnLPercentage}%)`;

      // const worth = totalCurrentWorthSol.toFixed(3);
      // Calculate PnL (Profit and Loss) percentage
      let pnl = "-";
      if (totalInitial > 0) {
        pnl =
          (
            ((totalPayout + totalCurrentWorth - totalInitial) / totalInitial) *
            100
          ).toFixed(2) + "%";
      }

      const marketCap = formatUSD(tokenInfo.marketCap);
      const price = tokenInfo.priceUsd;
      const botUsername = bot.botInfo.username;
      const referralLink = await generateReferralLink(user.id, botUsername);

      // Calculate token age
      let tokenAge = "Unknown";
      try {
        const { TransactionRecordModel } = await import("../backend/models");
        const creationTransaction = await TransactionRecordModel.findOne({
          tokenAddress: tokenAddress,
          transactionType: "token_creation",
        });
        console.log(`Creation transaction: ${creationTransaction}`);

        if (creationTransaction) {
          const createdAt = creationTransaction.createdAt;
          const now = new Date();
          const diffMs = now.getTime() - createdAt.getTime();

          // Convert to human readable format
          const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
          const diffMinutes = Math.floor(
            (diffMs % (1000 * 60 * 60)) / (1000 * 60)
          );

          if (diffHours > 0) {
            tokenAge = `${diffHours}h ${diffMinutes}m`;
          } else {
            tokenAge = `${diffMinutes}m`;
          }

          logger.info(
            `[TokenAge] Token ${tokenAddress} age calculated: ${tokenAge}`
          );
        } else {
          // Fallback: check token's blockchain creation time if available
          if (tokenInfo.createdAt) {
            const createdAt = new Date(tokenInfo.createdAt);
            const now = new Date();
            const diffMs = now.getTime() - createdAt.getTime();

            const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
            const diffMinutes = Math.floor(
              (diffMs % (1000 * 60 * 60)) / (1000 * 60)
            );

            if (diffHours > 0) {
              tokenAge = `${diffHours}h ${diffMinutes}m`;
            } else {
              tokenAge = `${diffMinutes}m`;
            }
          }
        }
      } catch (error) {
        logger.warn(`Error calculating token age for ${tokenAddress}:`, error);
        tokenAge = "Unknown";
      }

      const message = await sendMessage(
        ctx,
        `
🎯 <b>${tokenInfo.baseToken.symbol}</b> 🔗 <a href="${referralLink}">📢 Share & Earn</a> • ⏰ <code>${tokenAge}</code>

📊 <b>Position Overview</b>
┌─ 💰 Initial Investment: <code>${initial.toFixed(3)} SOL</code>
├─ 💸 Total Sold: <code>${payout.toFixed(3)} SOL</code>
├─ 🪙 Token Holdings: <code>${supplyPercentageText}</code>
├─ 💎 Current Worth: <code>${totalCurrentWorthSol.toFixed(3)} SOL</code>
└─ 📈 Total P&L: <b>${pnLFormatted}</b>

💹 <b>Market Information</b>
├─ 💵 Current Price: <code>$${Number(price).toFixed(5)}</code>
└─ 🏦 Market Cap: <code>${marketCap}</code>

🕐 Last Update: <code>${new Date().toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}</code>
💡 <i>Click refresh to resume live monitoring</i>
        `,
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text("🔄 Refresh", `remonitor_data_${tokenAddress}`)
            .url("📊 Chart", `https://dexscreener.com/solana/${tokenAddress}`)
            .text("📈 CTO", `${CallBackQueries.CTO}_${tokenAddress}`)
            .row()
            .text("💸 25%", `sell_ca_25_${tokenAddress}`)
            .text("💸 50%", `sell_ca_50_${tokenAddress}`)
            .text("💸 75%", `sell_ca_75_${tokenAddress}`)
            .text("💸 100%", `sell_ca_100_${tokenAddress}`)
            .row()
            .text("🔄 Generate PNL", `generate_pnl_${tokenAddress}`)
            .url("🔗 Contract", `https://solscan.io/token/${tokenAddress}`)
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
  // Get user ID from context
  const userId = ctx?.chat!.id.toString();
  const user = await getUser(userId);
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    return;
  }
  await safeAnswerCallbackQuery(ctx, "🔄 Refreshing monitor data...");

  let tokenAddress: string;
  const data = ctx.callbackQuery.data;

  if (isCompressedCallbackData(data)) {
    const decompressed = decompressCallbackData(data);
    if (!decompressed) {
      await sendMessage(ctx, "❌ Invalid callback data.");
      return;
    }
    tokenAddress = decompressed.tokenAddress;
  } else {
    // Handle legacy uncompressed format
    tokenAddress = ctx.match![1];
  }

  if (!tokenAddress) {
    await sendMessage(ctx, "❌ Invalid token address.");
    return;
  }

  logger.info(
    `[RefreshMonitorData] Refreshing data for token: ${tokenAddress}`
  );

  try {
    const buyerWallets = await getAllBuyerWallets(user.id);
    const devWallet = await getDefaultDevWallet(String(user.id));
    const devWalletAddress = devWallet;

    // Get dev wallet token balance for this token
    let devWalletTokenBalance = 0;
    try {
      devWalletTokenBalance = await getTokenBalance(
        tokenAddress,
        devWalletAddress
      );
    } catch (error) {
      logger.warn(`Failed to get dev wallet token balance: ${error}`);
    }

    // Add dev wallet to buyer wallets if it has tokens
    if (devWalletTokenBalance > 0) {
      buyerWallets.push({
        id: `dev-${user.id}`,
        publicKey: devWalletAddress,
        createdAt: new Date(),
      });
    }

    logger.info(
      `Buyer wallets: ${JSON.stringify(buyerWallets, null, 2)}, for user ${user.id}`
    );

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
    const walletDetails = await Promise.all(
      buyerWallets.map(async (wallet) => {
        const transactions = await TransactionRecordModel.find({
          tokenAddress,
          walletPublicKey: wallet.publicKey,
        });

        // Get current token balance for this wallet
        let currentTokenBalance = 0;
        try {
          currentTokenBalance = await getTokenBalance(
            tokenAddress,
            wallet.publicKey
          );
        } catch (error) {
          logger.warn(
            `Failed to get token balance for wallet ${wallet.publicKey}:`,
            error
          );
        }

        // Group transactions by type
        const groupedTransactions = {
          devBuys: transactions.filter(
            (tx) => tx.transactionType === "dev_buy"
          ),
          devSells: transactions.filter(
            (tx) => tx.transactionType === "dev_sell"
          ),
          snipeBuys: transactions.filter(
            (tx) => tx.transactionType === "snipe_buy"
          ),
          snipeSells: transactions.filter(
            (tx) => tx.transactionType === "wallet_sell"
          ),
        };

        // Calculate totals for each category
        const summary = {
          devBuys: {
            count: groupedTransactions.devBuys.length,
            totalAmount: groupedTransactions.devBuys.reduce(
              (sum, tx) => sum + (tx.amountSol || 0),
              0
            ),
            totalValue: groupedTransactions.devBuys.reduce(
              (sum, tx) => sum + (tx.amountSol || 0),
              0
            ),
          },
          devSells: {
            count: groupedTransactions.devSells.length,
            totalAmount: groupedTransactions.devSells.reduce(
              (sum, tx) => sum + (tx.amountSol || 0),
              0
            ),
            totalValue: groupedTransactions.devSells.reduce(
              (sum, tx) => sum + (tx.amountSol || 0),
              0
            ),
          },
          snipeBuys: {
            count: groupedTransactions.snipeBuys.length,
            totalAmount: groupedTransactions.snipeBuys.reduce(
              (sum, tx) => sum + (tx.amountSol || 0),
              0
            ),
            totalValue: groupedTransactions.snipeBuys.reduce(
              (sum, tx) => sum + (tx.amountSol || 0),
              0
            ),
          },
          snipeSells: {
            count: groupedTransactions.snipeSells.length,
            totalAmount: groupedTransactions.snipeSells.reduce(
              (sum, tx) => sum + (tx.amountSol || 0),
              0
            ),
            totalValue: groupedTransactions.snipeSells.reduce(
              (sum, tx) => sum + (tx.amountSol || 0),
              0
            ),
          },
        };

        return {
          address: wallet.publicKey,
          currentTokenBalance,
          transactions: groupedTransactions,
          summary,
          totalTransactions: transactions.length,
        };
      })
    );

    // Calculate total initial (all buy transactions) and payout (all sell transactions)
    const initial = walletDetails.reduce((total, wallet) => {
      return (
        total +
        wallet.summary.devBuys.totalAmount +
        wallet.summary.snipeBuys.totalAmount
      );
    }, 0);

    const payout = walletDetails.reduce((total, wallet) => {
      return (
        total +
        wallet.summary.devSells.totalAmount +
        wallet.summary.snipeSells.totalAmount
      );
    }, 0);

    // Calculate total supply (sum of all current token balances across wallets)
    const totalSupply =
      walletDetails.reduce((total, wallet) => {
        return total + wallet.currentTokenBalance;
      }, 0) / Math.pow(10, tokenInfo.baseToken.decimals);

    // Calculate percentage of total token supply held
    let supplyPercentage = 0;
    let supplyPercentageText = "";

    if (tokenInfo.birdeye.totalSupply && totalSupply > 0) {
      // Convert supply to number (it might be a string)
      const totalTokenSupply =
        typeof tokenInfo.birdeye.totalSupply === "string"
          ? parseFloat(tokenInfo.birdeye.totalSupply)
          : tokenInfo.birdeye.totalSupply;

      // Calculate percentage held
      console.log(
        `Total supply: ${totalSupply}, Total token supply: ${totalTokenSupply}`
      );
      supplyPercentage = (totalSupply / totalTokenSupply) * 100;
      supplyPercentageText = `${supplyPercentage.toFixed(4)}%`;

      logger.info(
        `[TokenTrades] Supply calculation: ${totalSupply} / ${totalTokenSupply} = ${supplyPercentageText}`
      );
    }

    // Calculate current worth of all tokens in SOL
    const solPrice = await getCurrentSolPrice();
    const currentPrice = tokenInfo.priceUsd || 0;
    let totalCurrentWorthSol = 0;

    if (currentPrice && solPrice) {
      const priceInSol = currentPrice / solPrice;
      totalCurrentWorthSol = totalSupply * priceInSol;

      logger.info(
        `[TokenTrades] Total tokens: ${totalSupply}, Price in SOL: ${priceInSol}, Worth: ${totalCurrentWorthSol} SOL`
      );
    } else {
      logger.warn(
        `[TokenTrades] Unable to calculate worth - currentPrice: ${currentPrice}, solPrice: ${solPrice}`
      );
    }

    // Calculate PnL based on initial investment and current worth
    const totalPnL = totalCurrentWorthSol + payout - initial;
    const pnLPercentage =
      initial > 0 ? ((totalPnL / initial) * 100).toFixed(2) : "0.00";
    const pnLFormatted = `${totalPnL >= 0 ? "+" : ""}${totalPnL.toFixed(3)} SOL (${pnLPercentage}%)`;

    const marketCap = formatUSD(tokenInfo.marketCap);
    const price = tokenInfo.priceUsd;
    const botUsername = bot.botInfo.username;
    const referralLink = await generateReferralLink(user.id, botUsername);

    // Calculate token age
    let tokenAge = "Unknown";
    try {
      const { TransactionRecordModel } = await import("../backend/models");
      const creationTransaction = await TransactionRecordModel.findOne({
        tokenAddress: tokenAddress,
        transactionType: "token_creation",
      });

      if (creationTransaction) {
        const createdAt = creationTransaction.createdAt;
        const now = new Date();
        const diffMs = now.getTime() - createdAt.getTime();

        // Convert to human readable format
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor(
          (diffMs % (1000 * 60 * 60)) / (1000 * 60)
        );

        if (diffHours > 0) {
          tokenAge = `${diffHours}h ${diffMinutes}m`;
        } else {
          tokenAge = `${diffMinutes}m`;
        }

        logger.info(
          `[TokenAge] Token ${tokenAddress} age calculated: ${tokenAge}`
        );
      } else {
        // Fallback: check token's blockchain creation time if available
        if (tokenInfo.createdAt) {
          const createdAt = new Date(tokenInfo.createdAt);
          const now = new Date();
          const diffMs = now.getTime() - createdAt.getTime();

          const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
          const diffMinutes = Math.floor(
            (diffMs % (1000 * 60 * 60)) / (1000 * 60)
          );

          if (diffHours > 0) {
            tokenAge = `${diffHours}h ${diffMinutes}m`;
          } else {
            tokenAge = `${diffMinutes}m`;
          }
        }
      }
    } catch (error) {
      logger.warn(`Error calculating token age for ${tokenAddress}:`, error);
      tokenAge = "Unknown";
    }

    // Get the existing message to update
    const messageId = ctx.callbackQuery?.message?.message_id;
    if (!messageId) {
      await sendMessage(ctx, "❌ Unable to refresh - message not found.");
      return;
    }

    const updatedMessage = `
🎯 <b>${tokenInfo.baseToken.symbol}</b> 🔗 <a href="${referralLink}">📢 Share & Earn</a> • ⏰ <code>${tokenAge}</code>

📊 <b>Position Overview</b>
┌─ 💰 Initial Investment: <code>${initial.toFixed(3)} SOL</code>
├─ 💸 Total Sold: <code>${payout.toFixed(3)} SOL</code>
├─ 🪙 Token Holdings: <code>${supplyPercentageText}</code>
├─ 💎 Current Worth: <code>${totalCurrentWorthSol.toFixed(3)} SOL</code>
└─ 📈 Total P&L: <b>${pnLFormatted}</b>

💹 <b>Market Information</b>
├─ 💵 Current Price: <code>$${Number(price).toFixed(5)}</code>
└─ 🏦 Market Cap: <code>${marketCap}</code>

🕐 Last Update: <code>${new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })}</code>
💡 <i>Click refresh to resume live monitoring</i>
    `;

    // Update the existing message instead of creating a new one
    await ctx.api.editMessageText(ctx.chat!.id, messageId, updatedMessage, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("🔄 Refresh", `remonitor_data_${tokenAddress}`)
        .url("📊 Chart", `https://dexscreener.com/solana/${tokenAddress}`)
        .text("📈 CTO", `${CallBackQueries.CTO}_${tokenAddress}`)
        .row()
        .text("💸 25%", `sell_ca_25_${tokenAddress}`)
        .text("💸 50%", `sell_ca_50_${tokenAddress}`)
        .text("💸 75%", `sell_ca_75_${tokenAddress}`)
        .text("💸 100%", `sell_ca_100_${tokenAddress}`)
        .row()
        .text("🔄 Generate PNL", `generate_pnl_${tokenAddress}`)
        .url("🔗 Contract", `https://solscan.io/token/${tokenAddress}`)
        .text("🏠 Menu", CallBackQueries.BACK),
    });

    logger.info(
      `[RefreshMonitorData] Successfully refreshed monitor data for ${tokenAddress}`
    );
  } catch (error) {
    logger.error("Error refreshing monitor data:", error);
    await sendMessage(
      ctx,
      "❌ Error refreshing monitor data. Please try again later."
    );
  }
});

bot.callbackQuery(/^generate_pnl_(.+)$/, async (ctx) => {
  const tradeId = ctx.match[1];
  logger.info(`[GeneratePNL] Generating PNL card for trade ${tradeId}`);

  try {
    await ctx.answerCallbackQuery("Generating PNL card...");
  } catch (error) {
    logger.warn(`[GeneratePNL] Failed to answer callback query: ${error}`);
    // Continue with the process even if callback answer fails
  }

  try {
    const userId = ctx.chat?.id.toString();
    if (!userId) {
      await ctx.reply("❌ User ID not found.");
      return;
    }

    const user = await getUser(userId);
    if (!user) {
      await ctx.reply("❌ User not found.");
      return;
    }

    // Get trade record by ID
    const trade = await TokenModel.findOne({ tokenAddress: tradeId });
    console.log(`Trade record: ${trade}`);

    if (!trade) {
      await ctx.reply("❌ Token record not found.");
      return;
    }
    if (trade.user.toString() !== user.id) {
      await ctx.reply("❌ Not authorized to view this trade.");
      return;
    }

    const tokenAddress = trade.tokenAddress;

    const buyerWallets = await getAllBuyerWallets(user.id);
    const devWallet = await getDefaultDevWallet(String(user.id));
    const devWalletAddress = devWallet;

    // Get dev wallet token balance for this token
    let devWalletTokenBalance = 0;
    try {
      devWalletTokenBalance = await getTokenBalance(
        tokenAddress,
        devWalletAddress
      );
    } catch (error) {
      logger.warn(`Failed to get dev wallet token balance: ${error}`);
    }

    // Add dev wallet to buyer wallets if it has tokens
    if (devWalletTokenBalance > 0) {
      buyerWallets.push({
        id: `dev-${user.id}`,
        publicKey: devWalletAddress,
        createdAt: new Date(),
      });
    }

    const walletDetails = await Promise.all(
      buyerWallets.map(async (wallet) => {
        const transactions = await TransactionRecordModel.find({
          tokenAddress,
          walletPublicKey: wallet.publicKey,
        });

        // Get current token balance for this wallet
        let currentTokenBalance = 0;
        try {
          currentTokenBalance = await getTokenBalance(
            tokenAddress,
            wallet.publicKey
          );
        } catch (error) {
          logger.warn(
            `Failed to get token balance for wallet ${wallet.publicKey}:`,
            error
          );
        }

        // Group transactions by type
        const groupedTransactions = {
          devBuys: transactions.filter(
            (tx) => tx.transactionType === "dev_buy"
          ),
          devSells: transactions.filter(
            (tx) => tx.transactionType === "dev_sell"
          ),
          snipeBuys: transactions.filter(
            (tx) => tx.transactionType === "snipe_buy"
          ),
          snipeSells: transactions.filter(
            (tx) => tx.transactionType === "wallet_sell"
          ),
        };

        // Calculate totals for each category
        const summary = {
          devBuys: {
            count: groupedTransactions.devBuys.length,
            totalAmount: groupedTransactions.devBuys.reduce(
              (sum, tx) => sum + (tx.amountSol || 0),
              0
            ),
            totalValue: groupedTransactions.devBuys.reduce(
              (sum, tx) => sum + (tx.amountSol || 0),
              0
            ),
          },
          devSells: {
            count: groupedTransactions.devSells.length,
            totalAmount: groupedTransactions.devSells.reduce(
              (sum, tx) => sum + (tx.amountSol || 0),
              0
            ),
            totalValue: groupedTransactions.devSells.reduce(
              (sum, tx) => sum + (tx.amountSol || 0),
              0
            ),
          },
          snipeBuys: {
            count: groupedTransactions.snipeBuys.length,
            totalAmount: groupedTransactions.snipeBuys.reduce(
              (sum, tx) => sum + (tx.amountSol || 0),
              0
            ),
            totalValue: groupedTransactions.snipeBuys.reduce(
              (sum, tx) => sum + (tx.amountSol || 0),
              0
            ),
          },
          snipeSells: {
            count: groupedTransactions.snipeSells.length,
            totalAmount: groupedTransactions.snipeSells.reduce(
              (sum, tx) => sum + (tx.amountSol || 0),
              0
            ),
            totalValue: groupedTransactions.snipeSells.reduce(
              (sum, tx) => sum + (tx.amountSol || 0),
              0
            ),
          },
        };

        return {
          address: wallet.publicKey,
          currentTokenBalance,
          transactions: groupedTransactions,
          summary,
          totalTransactions: transactions.length,
        };
      })
    );

    // Calculate total initial (all buy transactions) and payout (all sell transactions)
    const initial = walletDetails.reduce((total, wallet) => {
      return (
        total +
        wallet.summary.devBuys.totalAmount +
        wallet.summary.snipeBuys.totalAmount
      );
    }, 0);

    const payout = walletDetails.reduce((total, wallet) => {
      return (
        total +
        wallet.summary.devSells.totalAmount +
        wallet.summary.snipeSells.totalAmount
      );
    }, 0);

    const tokenInfo = await getTokenInfo(tokenAddress);
    if (!tokenInfo) {
      await ctx.reply("❌ Token information not available.");
      return;
    }

    const totalSupply =
      walletDetails.reduce((total, wallet) => {
        return total + wallet.currentTokenBalance;
      }, 0) / Math.pow(10, tokenInfo.baseToken.decimals);

    // Calculate current worth of all tokens in SOL
    const solPrice = await getCurrentSolPrice();
    const currentPrice = tokenInfo.priceUsd || 0;
    let totalCurrentWorthSol = 0;

    if (currentPrice && solPrice) {
      const priceInSol = currentPrice / solPrice;
      totalCurrentWorthSol = totalSupply * priceInSol;

      logger.info(
        `[TokenTrades] Total tokens: ${totalSupply}, Price in SOL: ${priceInSol}, Worth: ${totalCurrentWorthSol} SOL`
      );
    } else {
      logger.warn(
        `[TokenTrades] Unable to calculate worth - currentPrice: ${currentPrice}, solPrice: ${solPrice}`
      );
    }

    const totalPnL = totalCurrentWorthSol + payout - initial;
    const pnLPercentage =
      initial > 0 ? ((totalPnL / initial) * 100).toFixed(2) : "0.00";
    const pnLFormatted = `${totalPnL >= 0 ? "+" : ""}${totalPnL.toFixed(3)} SOL (${pnLPercentage}%)`;

    // const pnl = `${newPnl.toFixed(2)} %`;
    const tokenSymbol = tokenInfo?.baseToken.symbol || "Unknown";
    const marketCap = formatUSD(tokenInfo.marketCap || 0);
    const price = +0;

    // const pnlPercent = totalInvested > 0 ? (pnlSol / totalInvested) * 100 : 0;

    // Prepare data for PNL card generation
    const pnlCardData = {
      tokenSymbol,
      tokenName: tokenSymbol, // Use symbol as name for now
      positionType: "LONG" as const,
      pnlValue: totalCurrentWorthSol,
      roi: Math.abs(Number(pnLPercentage)),
      entryPrice: 0,
      currentPrice: +price,
      positionSize: `${initial.toFixed(3)} SOL`,
      marketCap,
      openedTime: "",
      username: user.userName || "Unknown",
      isProfit: totalCurrentWorthSol >= initial,
    };

    // Generate PNL card image buffer
    const pnlCardBuffer = await htmlToJpg(pnlCardData);

    const pnlKeyboard = new InlineKeyboard()
      .text("🔄 Refresh PNL", `generate_pnl_${tokenAddress}`)
      .text(
        "💸 Sell Token",
        `${CallBackQueries.VIEW_TOKEN_TRADES}_${tokenAddress}_0`
      );

    const message = await ctx.replyWithPhoto(new InputFile(pnlCardBuffer), {
      caption: `📊 PNL Card for ${tokenSymbol}`,
      reply_markup: pnlKeyboard,
    });

    lastMessageMap.set(String(userId), {
      chatId: userId,
      messageId: message.message_id,
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error(
      `[GeneratePNL] Error generating PNL card for trade ${tradeId}:`,
      error
    );
    await ctx.reply("❌ Error generating PNL card. Please try again later.");
  }
});

bot.api.setMyCommands([
  { command: "start", description: "Start the bot" },
  { command: "menu", description: "Bot Menu" },
  { command: "create", description: "Create a new token" },
  { command: "tokens", description: "View your created tokens" },
  { command: "wallets", description: "Manage Wallets" },
  { command: "referrals", description: "View your referral stats" },
  { command: "commands", description: "Show all available commands" },
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

    //     if (allWallets.length > 0) {
    //       const balancePromises = allWallets.map(async (wallet) => {
    //         try {
    //           const [solBalanceResult, tokenBalanceResult] =
    //             await Promise.allSettled([
    //               getSolBalance(wallet.publicKey),
    //               checkSellAmountWithoutDecimals(token.address, wallet.publicKey),
    //             ]);

    //           const solBalance =
    //             solBalanceResult.status === "fulfilled"
    //               ? solBalanceResult.value
    //               : 0;
    //           const tokenBalance =
    //             tokenBalanceResult.status === "fulfilled"
    //               ? tokenBalanceResult.value
    //               : 0;

    //           const truncatedName =
    //             wallet.name.length > 8
    //               ? `${wallet.name.substring(0, 7)}...`
    //               : wallet.name.padEnd(8);

    //           const tokenAmount =
    //             tokenBalance > 0
    //               ? `${formatUSD(tokenBalance).replace("$", "")}`
    //               : "0";

    //           return `<code>${truncatedName}| ${tokenAmount.padEnd(12)}| ${solBalance.toFixed(3)}</code>`;
    //         } catch (error) {
    //           const truncatedName =
    //             wallet.name.length > 8
    //               ? `${wallet.name.substring(0, 7)}...`
    //               : wallet.name.padEnd(8);
    //           return `<code>${truncatedName}| 0 (0%)      | 0</code>`;
    //         }
    //       });

    //       const balanceLines = await Promise.all(balancePromises);

    //       walletsBalanceSection = `
    // <blockquote expandable><b>💰 Balances - Tap to expand</b>
    // <code>Wallet   | ${token.symbol.padEnd(8)} | SOL</code>
    // <code>─────────|${Array(token.symbol.length + 3)
    //         .fill("─")
    //         .join("")}|──────</code>
    // ${balanceLines.join("\n")}
    // </blockquote>`;
    //     } else {
    //       walletsBalanceSection = `<pre class="tg-spoiler"><b>💰 Balances</b>
    //   <code>No wallets found</code>
    //   </pre>`;
    //     }
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
    // Get dev wallet balance to include in holdings
    let devWalletBalance = 0;
    let devWalletText = "";

    try {
      const devWalletAddress = await getDefaultDevWallet(String(user.id));
      devWalletBalance = await getTokenBalance(token.address, devWalletAddress);

      if (devWalletBalance > 0) {
        const formattedDevBalance = (
          devWalletBalance / Math.pow(10, token.decimals || 6)
        ).toLocaleString(undefined, {
          maximumFractionDigits: 2,
        });
        devWalletText = `\n└─ <b>Dev Wallet:</b> ${formattedDevBalance} tokens`;
      }
    } catch (error) {
      logger.warn(`Error checking dev wallet balance for holdings: ${error}`);
    }

    supplyPercentageSection = `
├─ <b>Ownership:</b> ${supplyData.supplyPercentageFormatted} of total supply
├─ <b>Total Tokens:</b> ${supplyData.totalBalanceFormatted}
├─ <b>Wallets:</b> ${supplyData.walletsWithBalance} wallet(s) with balance${devWalletText}`;
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
${supplyPercentageSection ? `\n📊 <b>Holdings</b>${supplyPercentageSection}` : ""}${walletsBalanceSection}

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

        // **CRITICAL FIX: Clear any active conversation state before processing token address**
        // This ensures token display works even after actions are taken
        try {
          const cleared = await clearConversationStateForTokenDisplay(ctx);
          if (cleared) {
            logger.info(
              `[token-display] Successfully cleared conversation state for token: ${text}`
            );
          } else {
            logger.info(
              `[token-display] No conversation state to clear for token: ${text}`
            );
          }
        } catch (clearError: any) {
          logger.warn(
            `[token-display] Failed to clear conversation state: ${clearError.message}`
          );
          // Continue with token display even if clearing fails
        }

        logger.info(
          `[token-display] Proceeding with token display for: ${text}`
        );

        // **ULTRA-FAST DISPLAY: Show token page IMMEDIATELY with zero blocking operations**

        // Only check cache (this is instant, no blocking calls)
        const cachedPlatform = getCachedPlatform(text);
        let initialPlatformInfo = "🔍 Detecting...";
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
              .text(
                "👝 View Wallets",
                compressCallbackData(CallBackQueries.VIEW_TOKEN_WALLETS, text)
              )
              .row()
              .text("📈 CTO", `${CallBackQueries.CTO}_${text}`)
              .text("🔄 Refresh", `refresh_ca_${text}`)
              .row()
              .text("🎁 Airdrop SOL", `${CallBackQueries.AIRDROP_SOL}_${text}`)
              .text("💰 Relaunch", `${CallBackQueries.RELAUNCH_TOKEN}_${text}`)
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

        // Token info page displayed - no auto refresh
        // Use the refresh button to manually update token data
        logger.info(
          `[token-display] Token info page displayed for ${text}. Auto-refresh disabled. Use refresh button for updates.`
        );

        logger.info(
          `[token-display] Token display handler completed for: ${text}`
        );

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

bot.command("cleartoken", async (ctx) => {
  try {
    logger.info("Clear token state command used by user:", ctx.chat?.id);

    // Clear conversation state specifically for token display
    const cleared = await clearConversationStateForTokenDisplay(ctx);

    if (cleared) {
      await sendMessage(
        ctx,
        "🔧 **Token Display Fix Applied**\n\n" +
          "✅ Conversation state cleared\n" +
          "✅ Token display should now work\n\n" +
          "**Test it:** Send any token address and it should display properly now.",
        { parse_mode: "Markdown" }
      );
    } else {
      await sendMessage(
        ctx,
        "⚠️ **No Active Conversation State**\n\n" +
          "No conversation state was found to clear.\n" +
          "Token display should work normally.\n\n" +
          "**Test it:** Send any token address to verify.",
        { parse_mode: "Markdown" }
      );
    }

    logger.info("Clear token state completed for user:", ctx.chat?.id);
  } catch (error: any) {
    logger.error("Error in clear token command:", error);
    await sendMessage(
      ctx,
      "❌ Clear token state failed. Please try /forcefix or contact support."
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

bot.callbackQuery(/^relaunch_token_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx, "🚀 Loading relaunch options...");
  const tokenAddress = ctx.match![1];

  try {
    logger.info(
      `[Relaunch] Relaunch button clicked for token: ${tokenAddress}`
    );

    // Validate the token address
    try {
      new PublicKey(tokenAddress);
    } catch (error) {
      await sendMessage(
        ctx,
        "❌ Invalid token address. Please send a valid token address to relaunch."
      );
      return;
    }

    // Check if user exists
    const user = await getUser(ctx.chat!.id.toString());
    if (!user) {
      await sendMessage(
        ctx,
        "❌ User not found. Please use /start to register."
      );
      return;
    }

    // Clear any existing conversation state
    await clearConversationState(ctx);

    // Wait a moment for cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Start the relaunch token conversation with the existing token address
    await ctx.conversation.enter("relaunchTokenConversation", {
      mode: "relaunch",
      tokenAddress: tokenAddress,
    });

    logger.info(
      `[Relaunch] Successfully started relaunch conversation for token: ${tokenAddress}`
    );
  } catch (error: any) {
    logger.error(`[Relaunch] Error handling relaunch token callback:`, error);
    await sendMessage(
      ctx,
      "❌ Error starting relaunch process. Please try again or contact support."
    );
  }
});

bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;

  console.log(data, "From firsttt");
  logger.info(`[GenericHandler] Received callback data: ${data}`);

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
  // Skip fund token wallets callbacks - they have their own specific handler
  if (data.startsWith("fund_token_wallets_") || data.startsWith("ftw_")) {
    return; // Let the specific handler deal with this
  }

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
bot.on("callback_query", async (ctx) => {
  try {
    await ctx.answerCallbackQuery({
      text: "❌ This button is no longer valid or has expired. Please try again from the main menu.",
      show_alert: true,
    });
  } catch (e) {
    // Ignore errors from answering callback
  }
});
