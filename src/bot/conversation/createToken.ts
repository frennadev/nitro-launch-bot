import { type Conversation } from "@grammyjs/conversations";
import { type Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { createToken, getUser } from "../../backend/functions-main";
import axios from "axios";
import { CallBackQueries } from "../types";
import { env } from "../../config";

const cancelKeyboard = new InlineKeyboard().text("❌ Cancel", CallBackQueries.BACK);

const createTokenConversation = async (conversation: Conversation, ctx: Context) => {
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await ctx.reply("Unrecognized user ❌");
    return conversation.halt();
  }

  await ctx.reply(
    "Please send your token details as <b>name, symbol, description</b>, separated by commas.\n\nExample: <code>TokenName,TKN,My great token</code>",
    { parse_mode: "HTML", reply_markup: cancelKeyboard }
  );

  let details: string[];
  while (true) {
    const upd = await conversation.wait();
    if (upd.callbackQuery?.data === CallBackQueries.BACK) {
      await upd.answerCallbackQuery();
      await ctx.reply("Token creation cancelled.");
      return conversation.halt();
    }
    if (upd.message?.text) {
      details = upd.message.text.split(",").map((s) => s.trim());
      if (details.length === 3) break;
      await ctx.reply("Invalid format. Please send again as <b>name,symbol,description</b>.", {
        parse_mode: "HTML",
        reply_markup: cancelKeyboard,
      });
    }
  }

  const [name, symbol, description] = details;

  await ctx.reply("Upload an image for your token (max 20 MB):", { reply_markup: cancelKeyboard });

  let fileCtx;
  while (true) {
    const upd = await conversation.wait();
    if (upd.callbackQuery?.data === CallBackQueries.BACK) {
      await upd.answerCallbackQuery();
      await ctx.reply("Token creation cancelled.");
      return conversation.halt();
    }
    if (upd.message?.photo) {
      fileCtx = upd;
      break;
    }
  }

  const file = await fileCtx.getFile();
  if ((file.file_size ?? 0) > 20 * 1024 * 1024) {
    await ctx.reply("Image too large. Please start over.");
    return conversation.halt();
  }

  const imageUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const { data: fileData } = await axios.get<ArrayBuffer>(imageUrl, {
    responseType: "arraybuffer",
  });

  await ctx.reply("Creating token… 🔄");

  const token = await createToken(user.id, name, symbol, description, fileData);

  const launchKb = new InlineKeyboard().text(
    "🚀 Launch Token",
    `${CallBackQueries.LAUNCH_TOKEN}_${token.tokenAddress}`
  );

  await ctx.reply(
    `<b>Token created successfully!</b>

<b>Name:</b> <code>${token.name}</code>
<b>Symbol:</b> <code>${token.symbol}</code>
<b>Description:</b> ${token.description}
`,
    { parse_mode: "HTML", reply_markup: launchKb }
  );

  conversation.halt();
};

export default createTokenConversation;
