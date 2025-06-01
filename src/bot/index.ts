import { Bot, InlineKeyboard, type Context } from "grammy";
import {
  conversations,
  createConversation,
  type ConversationFlavor,
} from "@grammyjs/conversations";
import { env } from "../config";
import {
  createUser,
  getOrCreateDevWallet,
  getTokensForUser,
  getUser,
} from "../backend/functions";
import { CallBackQueries } from "./types";
import { escape } from "./utils";
import launchTokenConversation from "./conversation/launchToken";
import createTokenConversation from "./conversation/createToken";

const bot = new Bot<ConversationFlavor<Context>>(env.TELEGRAM_BOT_TOKEN);

// ----- Conversations -----
bot.use(conversations());
bot.use(createConversation(createTokenConversation));
bot.use(createConversation(launchTokenConversation));

// ----- Commands ------
bot.command("start", async (ctx) => {
  let user = await getUser(ctx.chat.id.toString());
  let isFirstTime = user === null;
  if (isFirstTime) {
    user = await createUser(
      ctx.chat.first_name,
      ctx.chat.last_name,
      ctx.chat.username!,
      ctx.chat.id.toString(),
    );
  }
  const devWallet = await getOrCreateDevWallet(String(user?.id));
  const welcomeMsg = `
👋 *Welcome to Viper Bot*

Launch your own tokens on [Pump\\.fun](https://pump\\.fun) in minutes—no coding, no fuss\\.  
Here’s what you can do right from this chat:

💳 *Your current dev wallet:*  
\`${devWallet}\`

To proceed, you can choose any of the actions below ⬇️
`;
  const inlineKeyboard = new InlineKeyboard()
    .text("Create Token", CallBackQueries.CREATE_TOKEN)
    .text("View Tokens", CallBackQueries.VIEW_TOKENS)
    .row()
    .text("Add Wallet", CallBackQueries.ADD_WALLET)
    .text("Generate Wallet", CallBackQueries.GENERATE_WALLET);

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
  const devWallet = await getOrCreateDevWallet(String(user?.id));
  const welcomeMsg = `
👋 *Welcome to Viper Bot*

Launch your own tokens on [Pump\\.fun](https://pump\\.fun) in minutes—no coding, no fuss\\.  
Here’s what you can do right from this chat:

💳 *Your current dev wallet:*  
\`${devWallet}\`

To proceed, you can choose any of the actions below ⬇️
`;
  const inlineKeyboard = new InlineKeyboard()
    .text("Create Token", CallBackQueries.CREATE_TOKEN)
    .text("View Tokens", CallBackQueries.VIEW_TOKENS)
    .row()
    .text("Add Wallet", CallBackQueries.ADD_WALLET)
    .text("Generate Wallet", CallBackQueries.GENERATE_WALLET);

  await ctx.reply(welcomeMsg, {
    parse_mode: "MarkdownV2",
    reply_markup: inlineKeyboard,
  });
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
    const kb = new InlineKeyboard().text(
      "🚀 Launch Token",
      `${CallBackQueries.LAUNCH_TOKEN}_${token.address}`,
    );

    await ctx.reply(msg, {
      parse_mode: "MarkdownV2",
      reply_markup: kb,
    });
  }
});
bot.callbackQuery(/^launch_token_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const tokenAddress = ctx.match![1];
  await ctx.conversation.enter("launchTokenConversation", tokenAddress);
});

await bot.api.setMyCommands([{ command: "menu", description: "Bot Menu" }]);
export default bot;
