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
  removeFailedToken,
  getAllBuyerWallets,
} from "../backend/functions";
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
import { withdrawDevWalletConversation, withdrawBuyerWalletsConversation, withdrawFundingWalletConversation } from "./conversation/withdrawal";
import viewTokensConversation from "./conversation/viewTokenConversation";
import externalTokenSellConversation from "./conversation/externalTokenSell";
import { logger } from "../blockchain/common/logger";
import { getTokenInfo, getTokenBalance } from "../backend/utils";
import { getTransactionFinancialStats } from "../backend/functions-main";

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
bot.use(createConversation(withdrawFundingWalletConversation));
bot.use(createConversation(viewTokensConversation));
bot.use(createConversation(externalTokenSellConversation));

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
    await ctx.reply(`✅ Successfully marked address as used:\n\`${address}\`\n\nThis address will no longer be used for new token launches.`, { parse_mode: "MarkdownV2" });
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
    await ctx.reply("❌ Usage: /removetoken <address>\n\nExample: /removetoken <your_token_address>\n\n⚠️ This will permanently delete the token from the database and mark the address as used.");
    return;
  }

  const tokenAddress = args[1];
  
  try {
    const result = await removeFailedToken(tokenAddress);
    await ctx.reply(`✅ Successfully removed failed token:\n\`${tokenAddress}\`\n\n• Token deleted from database\n• Address marked as used (won't be reused)\n• Operation completed safely`, { parse_mode: "MarkdownV2" });
  } catch (error: any) {
    if (error.message.includes("not found")) {
      await ctx.reply(`⚠️ Token not found in database:\n\`${tokenAddress}\`\n\nThe token may have already been removed or the address is incorrect.`, { parse_mode: "MarkdownV2" });
    } else {
      await ctx.reply(`❌ Error removing token: ${error.message}`);
    }
  }
});

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

bot.callbackQuery(CallBackQueries.WITHDRAW_FUNDING_WALLET, async (ctx) => {
  await ctx.conversation.enter("withdrawFundingWalletConversation");
  await safeAnswerCallbackQuery(ctx);
});

bot.callbackQuery(CallBackQueries.WITHDRAW_BUYER_WALLETS, async (ctx) => {
  await ctx.conversation.enter("withdrawBuyerWalletsConversation");
  await safeAnswerCallbackQuery(ctx);
});

// Callback handlers for token CA sell buttons
bot.callbackQuery(/^sell_ca_(\d+)_(.+)$/, async (ctx) => {
  await safeAnswerCallbackQuery(ctx);
  const sellPercent = parseInt(ctx.match![1]);
  const tokenAddress = ctx.match![2];
  
  // Start the external token sell conversation
  await ctx.conversation.enter("externalTokenSellConversation", tokenAddress, sellPercent);
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

bot.api.setMyCommands([
  { command: "menu", description: "Bot Menu" }
]);

// Message handler for token contract addresses
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  
  // Check if the message is a Solana token address (32-44 characters, alphanumeric)
  const solanaAddressRegex = /^[A-Za-z0-9]{32,44}$/;
  
  if (solanaAddressRegex.test(text)) {
    await handleTokenAddressMessage(ctx, text);
  }
});

bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  const [action, token, address] = data.split("_");
  if (action && token && address) {
    logger.info(`${action} called`);
    // You can add further handling logic here if needed
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

  try {
    // Get token information from DexScreener
    const tokenInfo = await getTokenInfo(tokenAddress);
    
    if (!tokenInfo) {
      await ctx.reply(`❌ Token not found or not available on DexScreener\n\n🔍 Address: \`${tokenAddress}\``, {
        parse_mode: "MarkdownV2"
      });
      return;
    }

    // Get buyer wallets for this user
    const buyerWallets = await getAllBuyerWallets(user.id);
    
    // Check token balances in buyer wallets
    let totalTokenBalance = 0;
    let walletsWithBalance = 0;
    const walletBalances: { publicKey: string, balance: number, value: number }[] = [];
    
    for (const wallet of buyerWallets) {
      try {
        const balance = await getTokenBalance(tokenAddress, wallet.publicKey);
        if (balance > 0) {
          const value = balance * (tokenInfo.priceUsd || 0);
          walletBalances.push({
            publicKey: wallet.publicKey,
            balance,
            value
          });
          totalTokenBalance += balance;
          walletsWithBalance++;
        }
      } catch (error) {
        // Ignore individual wallet errors
        logger.warn(`Error checking balance for wallet ${wallet.publicKey}:`, error);
      }
    }

    const totalValue = totalTokenBalance * (tokenInfo.priceUsd || 0);

    // Get financial stats if this is a token we launched
    let financialStats;
    try {
      financialStats = await getTransactionFinancialStats(tokenAddress);
    } catch (error) {
      // Token not in our database, which is fine
    }

    // Build the response message
    const lines = [
      `🪙 **Token Information**`,
      ``,
      `**Name:** ${escape(tokenInfo.name || "Unknown")}`,
      `**Symbol:** ${escape(tokenInfo.symbol || "Unknown")}`,
      `**Address:** \`${tokenAddress}\``,
      ``,
      `📊 **Market Data:**`,
      `• Market Cap: ${escape(`$${tokenInfo.marketCap?.toLocaleString() || "0"}`)}`,
      `• Price: ${escape(`$${tokenInfo.priceUsd || "0"}`)}`,
      tokenInfo.liquidity?.usd ? `• Liquidity: ${escape(`$${tokenInfo.liquidity.usd.toLocaleString()}`)}` : "",
      ``,
      `💼 **Your Holdings:**`,
      walletsWithBalance > 0 
        ? [
            `• Total Tokens: ${escape(totalTokenBalance.toLocaleString())}`,
            `• Total Value: ${escape(`$${totalValue.toFixed(2)}`)}`,
            `• Wallets Holding: ${walletsWithBalance}/${buyerWallets.length}`,
          ].join("\n")
        : `• No tokens found in your ${buyerWallets.length} buyer wallets`,
      ``
    ].filter(Boolean).join("\n");

    // Create keyboard with sell button if user has tokens
    const keyboard = new InlineKeyboard();
    
    if (walletsWithBalance > 0) {
      keyboard
        .text("💸 Sell 25%", `sell_ca_25_${tokenAddress}`)
        .text("💸 Sell 50%", `sell_ca_50_${tokenAddress}`)
        .row()
        .text("💸 Sell 75%", `sell_ca_75_${tokenAddress}`)
        .text("💸 Sell All", `sell_ca_100_${tokenAddress}`)
        .row();
    }
    
    keyboard.text("🔄 Refresh", `refresh_ca_${tokenAddress}`);

    await ctx.reply(lines, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });

  } catch (error: any) {
    logger.error("Error handling token address message:", error);
    await ctx.reply(`❌ Error fetching token information: ${error.message}`);
  }
}
