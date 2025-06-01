import { type Conversation } from "@grammyjs/conversations";
import { type Context } from "grammy";
import { createToken, getUser } from "../../backend/functions";
import axios from "axios";
import { CallBackQueries } from "../types";
import { env } from "../../config";

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
      `🎉 *Token created successfully*\n\n*Name:* **${token.name}**\n*Symbol:* **${token.symbol}**\n*Description:* _${token.description}_\n\nTap **Launch Token** below to begin launch process\\.`,
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

export default createTokenConversation;
