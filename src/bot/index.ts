import { Bot } from "grammy";
import { session } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import { connectDB } from "../backend/db";
import { env } from "../config";

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
  // check if the user exists
  // else, create a new user
  // proceed to send the mainMenu
  await ctx.reply(
    "Hey! Choose an action below ⬇️",
    // { reply_markup: mainMenu }
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
export default bot
