import { Bot } from "grammy";
import { session } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import { connectDB } from "../backend/db";
import { env } from "../config";
import {
  createUser,
  getOrCreateDevWallet,
  getUser,
} from "../backend/functions";

type SessionData = { step?: string };
// type MyContext = FileFlavor<BotContext> & {
//   session: SessionData;
// };
const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
// bot.use(session({ initial: (): SessionData => ({}) }));
// bot.use(conversations());
// bot.use(createConversation(greetConversation));

// /* --- Menus ------------------------------------------------------------ */
// bot.use(mainMenu);

/* --- Commands --------------------------------------------------------- */
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
  await ctx.reply(
    welcomeMsg,
    {
      parse_mode: "MarkdownV2",
      reply_markup: {
        keyboard: [
          [{ text: "Add wallet" }, { text: "Create Token" }],
          [{ text: "Generate Wallets" }, { text: "my Tokens" }],
        ],
        resize_keyboard: true,
        one_time_keyboard: false,
      },
    }
  );
});

// /* --- Photo upload handler -------------------------------------------- */
// bot.on("message:photo", async (ctx) => {
//   // Telegram sends photos as an array of sizes—pick the largest
//   const file = ctx.message.photo.at(-1)!;
//   const fileUrl = await ctx.getFileLink(file.file_id); // instant CDN link
//   await ctx.reply(`Got it! I can now fetch your image from:\n${fileUrl}`);
// });

// /* --- Fallback --------------------------------------------------------- */
// bot.on("message", (ctx) => ctx.reply("🤖 I didn’t understand—try /start"));

// /* --- Launch ----------------------------------------------------------- */
export default bot;
