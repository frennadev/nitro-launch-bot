import { Bot, InlineKeyboard, type Context } from "grammy";
import { session } from "grammy";
import {
  conversations,
  createConversation,
  type Conversation,
  type ConversationFlavor,
} from "@grammyjs/conversations";
import { env } from "../config";
import {
  createToken,
  createUser,
  getOrCreateDevWallet,
  getTokensForUser,
  getUser,
  getUserToken,
  preLaunchChecks,
} from "../backend/functions";
import axios from "axios";
import { TokenState } from "../backend/types";
import { secretKeyToKeypair } from "../blockchain/common/utils";

enum CallBackQueries {
  CREATE_TOKEN = "create_token",
  VIEW_TOKENS = "view_tokens",
  LAUNCH_TOKEN = "launch_token",
  ADD_WALLET = "add_wallet",
  GENERATE_WALLET = "generate_wallets",
  UPDATE_DEV_WALLET = "update_dev_wallet"
}

function escape(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

const bot = new Bot<ConversationFlavor<Context>>(env.TELEGRAM_BOT_TOKEN);
bot.use(conversations());

const createTokenConversation = async (
  conversation: Conversation,
  ctx: Context,
) => {
  try {
    const user = await getUser(ctx.chat!.id!.toString());
    if (!user) {
      await ctx.reply("Unrecognized user ❌");
      await conversation.halt();
    }
    await ctx.reply(
      "Please send your token details as **name, symbol," +
        "description**, separated by commas\\. \n\nExample: `TokenName,TKN,My great token`",
      { parse_mode: "MarkdownV2" },
    );
    let { message } = await conversation.waitFor("message:text");
    let split = message.text.split(",");
    while (split.length != 3) {
      await ctx.reply("Invalid input. Enter token details again...");
      const { message } = await conversation.waitFor("message:text");
      split = message.text.split(",");
    }
    const name = split[0];
    const symbol = split[1];
    const description = split[2];

    await ctx.reply(
      `Upload an image for your token. (Must not be more than 20mb)`,
    );
    let newCtx = await conversation.waitFor("message:photo");
    const imageFile = await newCtx.getFile();
    // run this into a loop till the image finally get's corrected
    if ((imageFile.file_size || 0) > 20 * 1024 * 1024) {
      await newCtx.reply("Image size too big.. try again");
      await conversation.halt();
    }
    const imageUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${imageFile.file_path}`;
    const { data: fileData } = await axios.get<ArrayBuffer>(imageUrl, {
      responseType: "arraybuffer",
    });
    await newCtx.reply("Creating token...🔄");
    const token = await createToken(
      user?.id,
      name,
      symbol,
      description,
      fileData,
    );
    await ctx.reply(
      `🎉 *Token created successfully\!*\n\n*Name:* **${token.name}**\n*Symbol:* **${token.symbol}**\n*Description:* _${token.description}_\n\nTap **Launch Token** below to begin launch process\\.`,
      {
        parse_mode: "MarkdownV2",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🚀 Launch Token",
                callback_data: `${CallBackQueries.LAUNCH_TOKEN}_${token.tokenAddress}`,
              },
            ],
          ],
        },
      },
    );
  } catch (error: any) {
    console.log(`Error: ${error.message}`);
  }
};
const launchTokenConversation = async (
  conversation: Conversation,
  ctx: Context,
  tokenAddress: string
) => {
  const user = await getUser(ctx.chat!.id!.toString());
  if (!user) {
    await ctx.reply("Unrecognized user ❌")
    await conversation.halt()
    return
  }
  const token = await getUserToken(user.id, tokenAddress)
  if (!token) {
    await ctx.reply("Token not found ❌")
    await conversation.halt()
    return
  }
  if (token.state === TokenState.LAUNCHING) {
    await ctx.reply("Token is currently launching 🔄")
    await conversation.halt()
    return
  }
  if (token.state === TokenState.LAUNCHED) {
    await ctx.reply("Token is already launched 🚀")
    await conversation.halt()
    return
  }

  // FUNDER PRIVATE KEY
  await ctx.reply(
    "Enter the private key of the funder wallet: ",
    { parse_mode: "MarkdownV2" },
  );
  let updatedCtx = await conversation.waitFor("message:text")
  let funderKey = ""
  let funderKeypair 
  let isValidKey = false
  while (!isValidKey) {
    try {
      funderKey = updatedCtx.message.text
      funderKeypair = secretKeyToKeypair(funderKey)
      isValidKey = true
    } catch (error) {
      await ctx.reply("Invalid private key entered ❌. Please re-enter a correct private key: ")
      updatedCtx = await conversation.waitFor("message:text")
    }
  }

  // COMMA SEPARATED BUY WALLETS
  await ctx.reply(
    "Enter the private key of the buy wallets comma separated\\. \nExample: key1,key2,key3,key4: ",
    { parse_mode: "MarkdownV2" },
  );
  updatedCtx = await conversation.waitFor("message:text")
  let buyerKeys = []
  let buyerKeypairs = []
  let success = false
  while (!success) {
    try {
      buyerKeys = updatedCtx.message.text.split(",")
      buyerKeypairs = buyerKeys.map((pk) => secretKeyToKeypair(pk))
      success = true
    } catch (error) {
      await ctx.reply("One or more private keys are invalid ❌. Please re-enter correct private keys: ")
      updatedCtx = await conversation.waitFor("message:text")
    }
  }

  // BUY AMOUNT
  await ctx.reply(
    "Enter the amount in sol to buy for all wallets: ",
    { parse_mode: "MarkdownV2" },
  );
  updatedCtx = await conversation.waitFor("message:text")
  let buyAmount = 0
  let isValidAmount = false
  while (!isValidAmount) {
    const parsed = parseFloat(updatedCtx.message.text)
    if (isNaN(parsed) || parsed <= 0) {
      await ctx.reply("Invalid buyAmount. Please re-send: ")
      updatedCtx = await conversation.waitFor("message:text")
    } else {
      buyAmount = parsed
      isValidAmount = true
    }
  }

  // DEV BUY
  await ctx.reply(
    "Enter amount in sol to buy from dev wallet \\(enter 0 to skip\\): ",
    { parse_mode: "MarkdownV2" },
  );
  updatedCtx = await conversation.waitFor("message:text")
  let devBuy = 0
  let isValidDevAmount = false
  while (!isValidDevAmount) {
    const parsed = parseFloat(updatedCtx.message.text)
    if (isNaN(parsed) || parsed < 0) {
      await ctx.reply("Invalid devBuy. Please re-send: ")
      updatedCtx = await conversation.waitFor("message:text")
    } else {
      devBuy = parsed
      isValidDevAmount = true
    }
  }

  // Perform checks on the wallets
  await ctx.reply("Performing prelaunh checks 🔃...")
  const checkResult = await preLaunchChecks(tokenAddress, funderKey, buyAmount, devBuy, buyerKeys.length)
  if (!checkResult.success) {
    await ctx.reply("PreLaunch checks failed ❌.\nKindly resolve the issues below and retry\n\n" + checkResult.message)
    await conversation.halt()
  }

  // submit data into the queue for launch operation
}
bot.use(createConversation(createTokenConversation));
bot.use(createConversation(launchTokenConversation));

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
bot.callbackQuery(CallBackQueries.CREATE_TOKEN, async (ctx) => {
  await ctx.conversation.enter("createTokenConversation");
  await ctx.answerCallbackQuery();
});
bot.callbackQuery(CallBackQueries.VIEW_TOKENS, async (ctx) => {
  await ctx.answerCallbackQuery();

  const userId = ctx.from!.id;
  const user = await getUser(userId.toString())
  const tokens = await getTokensForUser(user?.id)
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
})
bot.callbackQuery(/^launch_token_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const tokenAddress = ctx.match![1]
  await ctx.conversation.enter("launchTokenConversation", tokenAddress)
})

await bot.api.setMyCommands([{ command: "menu", description: "Bot Menu" }]);
export default bot;
