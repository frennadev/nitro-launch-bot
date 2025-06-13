import { Bot, InlineKeyboard, type Context } from "grammy";
import { conversations, createConversation, type ConversationFlavor } from "@grammyjs/conversations";
import { env } from "../config";
import { createUser, getDevWallet, getDefaultDevWallet, getTokensForUser, getUser, getOrCreateFundingWallet, getPumpAddressStats } from "../backend/functions";
import { CallBackQueries } from "./types";
import { escape } from "./utils";
import launchTokenConversation from "./conversation/launchToken";
import createTokenConversation from "./conversation/createToken";
import quickLaunchConversation from "./conversation/quickLaunch";
import devSellConversation from "./conversation/devSell";
import walletSellConversation from "./conversation/walletSell";
import { TokenState } from "../backend/types";
import walletConfigConversation from "./conversation/walletConfig";
import mainMenuConversation from "./conversation/mainMenu";
import { sendMessage } from "../backend/sender";
import manageDevWalletsConversation from "./conversation/devWallets";
import manageBuyerWalletsConversation from "./conversation/buyerWallets";
import { withdrawDevWalletConversation, withdrawBuyerWalletsConversation } from "./conversation/withdrawal";

export const bot = new Bot<ConversationFlavor<Context>>(env.TELEGRAM_BOT_TOKEN);

// ----- Conversations -----
bot.use(conversations());
bot.use(createConversation(createTokenConversation));
bot.use(createConversation(quickLaunchConversation));
bot.use(createConversation(launchTokenConversation));
bot.use(createConversation(devSellConversation));
bot.use(createConversation(walletSellConversation));
bot.use(createConversation(walletConfigConversation));
bot.use(createConversation(mainMenuConversation));
bot.use(createConversation(manageDevWalletsConversation));
bot.use(createConversation(manageBuyerWalletsConversation));
bot.use(createConversation(withdrawDevWalletConversation));
bot.use(createConversation(withdrawBuyerWalletsConversation));

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
    .text("🚀 Quick Launch", CallBackQueries.QUICK_LAUNCH)
    .row()
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
    .text("🚀 Quick Launch", CallBackQueries.QUICK_LAUNCH)
    .row()
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
  const adminIds = env.ADMIN_IDS ? env.ADMIN_IDS.split(',').map((id: string) => parseInt(id)) : [];
  
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

${stats.available < 100 ? '⚠️ *Warning: Low address pool\\!*' : '✅ *Address pool healthy*'}
`;

    await ctx.reply(message, { parse_mode: "MarkdownV2" });
  } catch (error: any) {
    await ctx.reply(`❌ Error fetching stats: ${error.message}`);
  }
});

// ----- Callback Queries -----
bot.callbackQuery(CallBackQueries.CREATE_TOKEN, async (ctx) => {
  await ctx.conversation.enter("createTokenConversation");
  await ctx.answerCallbackQuery();
});
bot.callbackQuery(CallBackQueries.VIEW_TOKENS, async (ctx) => {
  await ctx.answerCallbackQuery();

  const userId = ctx.from!.id;
  const user = await getUser(userId.toString());
  const tokens = await getTokensForUser(user?.id);
  for (const token of tokens) {
    const msg = [
      `*Name*: ${escape(token.name)}`,
      `*Symbol:* $\`${escape(token.symbol)}\``,
      `*Description*: _${escape(token.description || "")}_`,
    ].join("\n");
    let kb;
    if (token.state == TokenState.LAUNCHED) {
      kb = new InlineKeyboard()
        .text("👨‍💻 Sell Dev Supply", `${CallBackQueries.SELL_DEV}_${token.address}`)
        .text("📈 Sell % supply", `${CallBackQueries.SELL_PERCENT}_${token.address}`)
        .row()
        .text("🧨 Sell All", `${CallBackQueries.SELL_ALL}_${token.address}`);
    } else {
      kb = new InlineKeyboard().text("🚀 Launch Token", `${CallBackQueries.LAUNCH_TOKEN}_${token.address}`);
    }
    await ctx.reply(msg, {
      parse_mode: "MarkdownV2",
      reply_markup: kb,
    });
  }
});
bot.callbackQuery(CallBackQueries.EXPORT_DEV_WALLET, async (ctx) => {
  let user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await ctx.reply("Unrecognized user ❌");
    return;
  }
  await ctx.answerCallbackQuery();
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
  await ctx.answerCallbackQuery("Message deleted");
  if (ctx.callbackQuery.message) {
    await ctx.api.deleteMessage(ctx.chat!.id, ctx.callbackQuery.message.message_id);
  }
});
bot.callbackQuery(/^launch_token_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const tokenAddress = ctx.match![1];
  await ctx.conversation.enter("launchTokenConversation", tokenAddress);
});
bot.callbackQuery(/^sell_dev_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const tokenAddress = ctx.match![1];
  await ctx.conversation.enter("devSellConversation", tokenAddress);
});
bot.callbackQuery(/^sell_all_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const tokenAddress = ctx.match![1];
  await ctx.conversation.enter("walletSellConversation", tokenAddress, 100);
});
bot.callbackQuery(/^sell_percent_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const tokenAddress = ctx.match![1];
  await ctx.conversation.enter("walletSellConversation", tokenAddress);
});

bot.api.setMyCommands([{ command: "menu", description: "Bot Menu" }]);
export default bot;

bot.callbackQuery(CallBackQueries.WALLET_CONFIG, async (ctx) => {
  await ctx.conversation.enter("walletConfigConversation");
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(CallBackQueries.BACK, async (ctx) => {
  await ctx.conversation.enter("mainMenuConversation");
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(CallBackQueries.CHANGE_DEV_WALLET, async (ctx) => {
  await ctx.conversation.enter("manageDevWalletsConversation");
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(CallBackQueries.MANAGE_BUYER_WALLETS, async (ctx) => {
  await ctx.conversation.enter("manageBuyerWalletsConversation");
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(CallBackQueries.QUICK_LAUNCH, async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter("quickLaunchConversation");
});

bot.callbackQuery(CallBackQueries.WITHDRAW_DEV_WALLET, async (ctx) => {
  await ctx.conversation.enter("withdrawDevWalletConversation");
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(CallBackQueries.WITHDRAW_BUYER_WALLETS, async (ctx) => {
  await ctx.conversation.enter("withdrawBuyerWalletsConversation");
  await ctx.answerCallbackQuery();
});
