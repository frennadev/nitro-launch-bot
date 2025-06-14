import { Bot, InlineKeyboard, type Context, type BotError, GrammyError, HttpError } from "grammy";
import { conversations, createConversation, type ConversationFlavor } from "@grammyjs/conversations";
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
} from "../backend/functions-main";
import { CallBackQueries } from "./types";
import { escape } from "./utils";
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
import { withdrawDevWalletConversation, withdrawBuyerWalletsConversation } from "./conversation/withdrawal";
import viewTokensConversation from "./conversation/viewTokenConversation";
import { logger } from "../blockchain/common/logger";

export const bot = new Bot<ConversationFlavor<Context>>(env.TELEGRAM_BOT_TOKEN);

// Global error handler
bot.catch((err: BotError<ConversationFlavor<Context>>) => {
  const ctx = err.ctx;
  logger.error("Error in bot middleware:", {
    error: err.error,
    update: ctx.update,
    stack: err.stack
  });
  
  // Don't crash the bot for callback query timeout errors
  if (err.error instanceof GrammyError && 
      (err.error.description.includes("query is too old") || 
       err.error.description.includes("response timeout expired"))) {
    logger.info("Ignoring callback query timeout error");
    return;
  }
  
  // For other errors, try to notify the user if possible
  if (ctx.chat) {
    ctx.reply("❌ An unexpected error occurred. Please try again or contact support.")
      .catch(() => logger.error("Failed to send error message to user"));
  }
});

// Safe wrapper for answerCallbackQuery to handle timeout errors
async function safeAnswerCallbackQuery(ctx: Context, text?: string): Promise<void> {
  try {
    await ctx.answerCallbackQuery(text);
  } catch (error: any) {
    // Ignore callback query timeout errors
    if (error instanceof GrammyError && 
        (error.description?.includes("query is too old") || 
         error.description?.includes("response timeout expired") ||
         error.description?.includes("query ID is invalid"))) {
      logger.info("Callback query timeout ignored:", error.description);
      return;
    }
    // Re-throw other errors
    throw error;
  }
}

// ----- Conversations -----
bot.use(conversations());
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
bot.use(createConversation(viewTokensConversation));

// ----- Commands ------
bot.command("start", async (ctx) => {
  let user = await getUser(ctx.chat.id.toString());
  let isFirstTime = user === null;
  if (isFirstTime) {
    user = await createUser(ctx.chat.first_name, ctx.chat.last_name, ctx.chat.username!, ctx.chat.id.toString());
  }

  // Auto-create funding wallet for all users
  await getOrCreateFundingWallet(String(user?.id));

  const devWallet = await getDefaultDevWallet(String(user?.id));
  const welcomeMsg = `
👋 *Welcome to Nitro Bot*

Launch your own tokens on [Pump\\.fun](https://pump\\.fun) in minutes—no coding, no fuss\\.  
Here's what you can do right from this chat:

💳 *Your current dev wallet:*  
\`${devWallet}\`

To proceed, you can choose any of the actions below ⬇️
`;
  const inlineKeyboard = new InlineKeyboard()
    .text("Create Token", CallBackQueries.CREATE_TOKEN)
    .text("View Tokens", CallBackQueries.VIEW_TOKENS)
    .row()
    .text("Export Dev Wallet", CallBackQueries.EXPORT_DEV_WALLET)
    .text("Wallet Config ", CallBackQueries.WALLET_CONFIG);
  // .text("Add Wallet", CallBackQueries.ADD_WALLET)
  // .text("Generate Wallet", CallBackQueries.GENERATE_WALLET);

  await ctx.reply(welcomeMsg, {
    parse_mode: "MarkdownV2",
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
  const welcomeMsg = `
👋 *Welcome to Nitro Bot*

Launch your own tokens on [Pump\\.fun](https://pump\\.fun) in minutes—no coding, no fuss\\.  
Here's what you can do right from this chat:

💳 *Your current dev wallet:*  
\`${devWallet}\`

To proceed, you can choose any of the actions below ⬇️
`;
  const inlineKeyboard = new InlineKeyboard()
    .text("Create Token", CallBackQueries.CREATE_TOKEN)
    .text("View Tokens", CallBackQueries.VIEW_TOKENS)
    .row()
    .text("Export Dev Wallet", CallBackQueries.EXPORT_DEV_WALLET)
    .text("Wallet Config ", CallBackQueries.WALLET_CONFIG);
  // .text("Add Wallet", CallBackQueries.ADD_WALLET)
  // .text("Generate Wallet", CallBackQueries.GENERATE_WALLET);

  await ctx.reply(welcomeMsg, {
    parse_mode: "MarkdownV2",
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
    await ctx.reply("❌ Usage: /markused <address>\n\nExample: /markused 4PsSzzPA4NkrbCstre2YBpHAxJBntD1eKTwi6PmXpump");
    return;
  }

  const address = args[1];
  
  try {
    await markPumpAddressAsUsed(address);
    await ctx.reply(`✅ Successfully marked address as used:\n\`${address}\`\n\nThis address will no longer be used for new token launches.`, { parse_mode: "MarkdownV2" });
  } catch (error: any) {
    await ctx.reply(`❌ Error marking address as used: ${error.message}`);
  }
});

// Numbered token selection commands (/1 through /10)
for (let i = 1; i <= 10; i++) {
  bot.command(i.toString(), async (ctx) => {
    const user = await getUser(ctx.chat!.id.toString());
    if (!user) {
      await ctx.reply("❌ Unrecognized user. Please use /start first.");
      return;
    }

    try {
      // Get the user's 10 most recent tokens
      const { TokenModel } = await import("../backend/models");
      const tokens = await TokenModel.find({ user: user._id })
        .populate("launchData.devWallet")
        .populate("launchData.buyWallets")
        .sort({ createdAt: -1 })
        .limit(10)
        .exec();

      if (!tokens.length) {
        await ctx.reply("❌ No tokens found. Create a token first using the menu.");
        return;
      }

      const tokenIndex = i - 1;
      if (tokenIndex >= tokens.length) {
        await ctx.reply(`❌ Token #${i} not found. You only have ${tokens.length} token${tokens.length === 1 ? '' : 's'}.`);
        return;
      }

      const selectedToken = tokens[tokenIndex];
      const { name, symbol, description, tokenAddress, state, launchData } = selectedToken;
      const { buyWallets, buyAmount, devBuy } = launchData!;

      const lines = [
        `💊 <b>${i}. ${name} - Token Details</b>`,
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "",
        `🔑 <b>Address:</b> <code>${tokenAddress}</code>`,
        `🏷️ <b>Symbol:</b> <code>${symbol}</code>`,
        `📝 <b>Description:</b> ${description || "–"}`,
        "",
        `👨‍💻 <b>Dev allocation:</b> <code>${devBuy || 0}</code> SOL`,
        `🛒 <b>Buyer allocation:</b> <code>${buyAmount || 0}</code> SOL`,
        `👥 <b>Worker wallets:</b> <code>${(buyWallets as any[])?.length || 0}</code>`,
        "",
        `📊 <b>Status:</b> ${state === TokenState.LAUNCHED ? "✅ Launched" : "⌛ Pending"}`,
      ].join("\n");

      // Create action buttons based on token state
      const keyboard = new InlineKeyboard();
      
      if (state === TokenState.LAUNCHED) {
        keyboard
          .text("👨‍💻 Sell Dev Supply", `sell_dev_${tokenAddress}`)
          .text("📈 Sell % Supply", `sell_percent_${tokenAddress}`)
          .row()
          .text("🧨 Sell All", `sell_all_${tokenAddress}`)
          .row();
      } else {
        keyboard.text("🚀 Launch Token", `launch_token_${tokenAddress}`).row();
      }
      
      keyboard.text("🔙 Back to Menu", CallBackQueries.BACK);

      await ctx.reply(lines, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });

    } catch (error: any) {
      logger.error(`Error handling /${i} command:`, error);
      await ctx.reply(`❌ Error loading token #${i}. Please try again or use the View Tokens menu.`);
    }
  });
}

// ----- Callback Queries -----
bot.callbackQuery(CallBackQueries.CREATE_TOKEN, async (ctx) => {
  await ctx.conversation.enter("createTokenConversation");
  await safeAnswerCallbackQuery(ctx);
});
bot.callbackQuery(CallBackQueries.VIEW_TOKENS, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  await ctx.conversation.enter("viewTokensConversation");
});

bot.callbackQuery(CallBackQueries.EXPORT_DEV_WALLET, async (ctx) => {
  let user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await ctx.reply("Unrecognized user ❌");
    return;
  }
  await safeAnswerCallbackQuery(ctx);
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

bot.api.setMyCommands([
  { command: "menu", description: "Bot Menu" },
  { command: "1", description: "Select Token #1" },
  { command: "2", description: "Select Token #2" },
  { command: "3", description: "Select Token #3" },
  { command: "4", description: "Select Token #4" },
  { command: "5", description: "Select Token #5" },
  { command: "6", description: "Select Token #6" },
  { command: "7", description: "Select Token #7" },
  { command: "8", description: "Select Token #8" },
  { command: "9", description: "Select Token #9" },
  { command: "10", description: "Select Token #10" }
]);

bot.callbackQuery(CallBackQueries.WALLET_CONFIG, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  await ctx.conversation.enter("walletConfigConversation");
});

bot.callbackQuery(CallBackQueries.BACK, async (ctx) => {
  await ctx.conversation.enter("mainMenuConversation");
  await safeAnswerCallbackQuery(ctx);
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
  await ctx.conversation.enter("withdrawDevWalletConversation");
  await safeAnswerCallbackQuery(ctx);
});

bot.callbackQuery(CallBackQueries.WITHDRAW_BUYER_WALLETS, async (ctx) => {
  await ctx.conversation.enter("withdrawBuyerWalletsConversation");
  await safeAnswerCallbackQuery(ctx);
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

export default bot;

bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  const [action, token, address] = data.split("_");
  if (action && token && address) {
    logger.info(`${action} called`);
    // You can add further handling logic here if needed
  }
});
