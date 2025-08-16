import { type Conversation } from "@grammyjs/conversations";
import { type Context } from "grammy";
import { InlineKeyboard } from "grammy";
import {
  createToken,
  getUser,
  getDefaultDevWallet,
  getOrCreateFundingWallet,
} from "../../backend/functions";
import { createBonkToken } from "../../blockchain/letsbonk/integrated-token-creator";
import axios from "axios";
import { CallBackQueries } from "../types";
import { env } from "../../config";
import { sendLoadingMessage } from "../loading";
import { sendErrorWithAutoDelete } from "../utils";
import { sendMessage } from "../../backend/sender";

const cancelKeyboard = new InlineKeyboard().text(
  "❌ Cancel",
  CallBackQueries.BACK
);

const createTokenConversation = async (
  conversation: Conversation,
  ctx: Context
) => {
  await ctx.answerCallbackQuery();
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendErrorWithAutoDelete(ctx, "Unrecognized user ❌");
    return conversation.halt();
  }

  // === 1) Ask for launch mode first ===
  const modeKeyboard = new InlineKeyboard()
    .text("🎉 PumpFun", CallBackQueries.PUMPFUN)
    .row()
    .text("🚀 LetsBonk", CallBackQueries.LETSBONK)
    .row()
    .text("❌ Cancel", CallBackQueries.BACK);

  await sendMessage(ctx, "❓ Choose your launch mode:", {
    reply_markup: modeKeyboard,
  });

  let mode: CallBackQueries.PUMPFUN | CallBackQueries.LETSBONK;
  while (true) {
    const modeUpd = await conversation.wait();
    const data = modeUpd.callbackQuery?.data;
    if (!data || data === CallBackQueries.BACK) {
      if (data === CallBackQueries.BACK) {
        await modeUpd.answerCallbackQuery();
        await sendMessage(ctx, "Token creation cancelled.");
      }
      return conversation.halt();
    }
    await modeUpd.answerCallbackQuery();
    if (data === CallBackQueries.PUMPFUN) {
      mode = CallBackQueries.PUMPFUN;
      await modeUpd.reply("✅ Launch mode set to <b>PumpFun</b>.", {
        parse_mode: "HTML",
      });
      break;
    }
    if (data === CallBackQueries.LETSBONK) {
      mode = CallBackQueries.LETSBONK;
      await modeUpd.reply("✅ Launch mode set to <b>LetsBonk</b>.", {
        parse_mode: "HTML",
      });
      break;
    }
  }

  // === 2) Now send the token‐details prompt and wallet instructions ===
  const devWalletAddress = await getDefaultDevWallet(user.id);
  const fundingWalletAddress = await getOrCreateFundingWallet(user.id);

  await sendMessage(
    ctx,
    "🚀 <b>Token Launch Setup Instructions</b>\n\n" +
      "📝 Please send your token details as <b>name, symbol, description</b>, separated by commas.\n" +
      "<i>Example: <code>TokenName,TKN,My great token</code></i>\n\n" +
      "<b>Launch Instructions:</b>\n" +
      "🤖 Fund dev wallet with a minimum of <b>0.15 SOL</b> + your desired dev‐buy amount (optional)\n" +
      `<code>${devWalletAddress}</code>\n\n` +
      "💰 Fund your funding wallet with buyer amount + <b>0.1 SOL</b>\n" +
      `<code>${fundingWalletAddress}</code>\n`,
    { parse_mode: "HTML", reply_markup: cancelKeyboard }
  );

  // === 3) Collect name,symbol,description ===
  let details: string[];
  while (true) {
    const upd = await conversation.wait();
    if (upd.callbackQuery?.data === CallBackQueries.BACK) {
      await upd.answerCallbackQuery();
      await sendMessage(ctx, "Token creation cancelled.");
      return conversation.halt();
    }
    if (upd.message?.text) {
      // details = upd.message.text.split(",").map((s) => s.trim());
      const text = upd.message.text;
      const firstCommaIndex = text.indexOf(",");
      const secondCommaIndex = text.indexOf(",", firstCommaIndex + 1);
      if (firstCommaIndex !== -1 && secondCommaIndex !== -1) {
        const name = text.substring(0, firstCommaIndex).trim();
        const symbol = text
          .substring(firstCommaIndex + 1, secondCommaIndex)
          .trim();
        const description = text.substring(secondCommaIndex + 1).trim();
        details = [name, symbol, description];
      } else {
        details = [];
      }
      if (details.length === 3) break;
      await sendMessage(
        ctx,
        "Invalid format. Please send again as <b>name,symbol,description</b>.",
        {
          parse_mode: "HTML",
          reply_markup: cancelKeyboard,
        }
      );
    }
  }
  const [name, symbol, description] = details;

  let twitter: string = "";
  let telegram: string = "";
  let website: string = "";

  // Ask for all socials in a single message
  await sendMessage(
    ctx,
    "🌐 (Optional) Send your token's socials as <b>Twitter/X, Telegram, Website</b> links, separated by commas. Type 'skip' to leave any field blank.\n" +
      "<i>Example: <code>https://twitter.com/example, https://t.me/examplegroup, https://example.com</code></i>\n\n" +
      "You can also type 'skip' to leave all blank.",
    { parse_mode: "HTML", reply_markup: cancelKeyboard }
  );

  while (true) {
    const upd = await conversation.wait();
    if (upd.callbackQuery?.data === CallBackQueries.BACK) {
      await upd.answerCallbackQuery();
      await sendMessage(ctx, "Token creation cancelled.");
      return conversation.halt();
    }
    if (upd.message?.text) {
      const text = upd.message.text.trim();
      if (text.toLowerCase() === "skip" || text === "") {
        twitter = "";
        telegram = "";
        website = "";
        break;
      }
      const parts = text.split(",").map((s) => s.trim());
      // Fill missing fields with empty string
      while (parts.length < 3) parts.push("");
      const [tw, tg, web] = parts;

      // Validate Twitter/X
      if (
        tw &&
        !/^https?:\/\/(twitter\.com|x\.com)\/\S+/.test(tw) &&
        tw.toLowerCase() !== "skip"
      ) {
        await sendMessage(
          ctx,
          "Invalid Twitter/X link format. Please send as <b>Twitter,X,Telegram,Website</b> or type 'skip' for any field.",
          { parse_mode: "HTML", reply_markup: cancelKeyboard }
        );
        continue;
      }
      // Validate Telegram
      if (
        tg &&
        !/^https?:\/\/t\.me\/\S+/.test(tg) &&
        tg.toLowerCase() !== "skip"
      ) {
        await sendMessage(
          ctx,
          "Invalid Telegram link format. Please send as <b>Twitter,X,Telegram,Website</b> or type 'skip' for any field.",
          { parse_mode: "HTML", reply_markup: cancelKeyboard }
        );
        continue;
      }
      // Validate Website (basic)
      if (
        web &&
        !/^https?:\/\/.+\..+/.test(web) &&
        web.toLowerCase() !== "skip"
      ) {
        await sendMessage(
          ctx,
          "Invalid website URL format. Please send as <b>Twitter,X,Telegram,Website</b> or type 'skip' for any field.",
          { parse_mode: "HTML", reply_markup: cancelKeyboard }
        );
        continue;
      }

      twitter = tw.toLowerCase() === "skip" ? "" : tw;
      telegram = tg.toLowerCase() === "skip" ? "" : tg;
      website = web.toLowerCase() === "skip" ? "" : web;
      break;
    }
  }

  // === 4) Ask for image upload ===
  await sendMessage(ctx, "Upload an image for your token (max 20 MB):", {
    reply_markup: cancelKeyboard,
  });

  let fileCtx;
  while (true) {
    const upd = await conversation.wait();
    if (upd.callbackQuery?.data === CallBackQueries.BACK) {
      await upd.answerCallbackQuery();
      await sendMessage(ctx, "Token creation cancelled.");
      return conversation.halt();
    }
    if (upd.message?.photo) {
      fileCtx = upd;
      break;
    }
  }

  const file = await fileCtx.getFile();
  if ((file.file_size ?? 0) > 20 * 1024 * 1024) {
    await sendMessage(ctx, "Image too large. Please start over.");
    return conversation.halt();
  }

  const imageUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const { data: fileData } = await axios.get<ArrayBuffer>(imageUrl, {
    responseType: "arraybuffer",
  });

  // === 5) Create token based on mode and show result ===
  const { update } = await sendLoadingMessage(
    ctx,
    "🔄 <b>Creating your token...</b>\n\n⏳ Processing image and metadata..."
  );

  let token: any;
  if (mode === CallBackQueries.PUMPFUN) {
    token = await createToken(user.id, name, symbol, description, fileData, {
      website,
      telegram,
      twitter,
    });
  } else {
    token = await createBonkToken(name, symbol, imageUrl, true, user.id, {
      website,
      telegram,
      twitter,
    });
  }

  if (mode === CallBackQueries.PUMPFUN) {
    await update(
      `🎉 <b>Token Created Successfully!</b>\n\n✅ Your PumpFun token is ready to launch!\n\n<b>Token Address:</b> <code>${token.tokenAddress}</code>`
    );

    const launchKb = new InlineKeyboard().text(
      "🚀 Launch Token",
      `${CallBackQueries.LAUNCH_TOKEN}_${token.tokenAddress}`
    );

    let socialsInfo = "";
    if (twitter) {
      socialsInfo += `🐦 <b>Twitter:</b> <a href="${twitter}">Link</a>\n`;
    }
    if (telegram) {
      socialsInfo += `💬 <b>Telegram:</b> <a href="${telegram}">Link</a>\n`;
    }
    if (website) {
      socialsInfo += `🌐 <b>Website:</b> <a href="${website}">Link</a>\n`;
    }

    await ctx.reply(
      `🎉 <b>Token Created Successfully!</b>
🚀 <b>Platform:</b> <code>PumpFun</code>

📊 <b>Token Details:</b>
💎 <b>Name:</b> <code>${token.name}</code>
🏷️ <b>Symbol:</b> <code>${token.symbol}</code>
📝 <b>Description:</b> ${token.description}
🔗 <b>Contract Address:</b> <code>${token.tokenAddress}</code>

${socialsInfo ? `🌐 <b>Social Links:</b>\n${socialsInfo}` : ""}

✅ <b>Status:</b> Ready for launch on PumpFun! 🚀`,
      { parse_mode: "HTML", reply_markup: launchKb }
    );

    conversation.halt();
  } else {
    await update(
      `🎉 <b>Token Created Successfully!</b>\n\n✅ Your LetsBonk token is ready to launch!\n\n<b>Token Address:</b> <code>${token.tokenAddress}</code>`
    );

    const launchKb = new InlineKeyboard().text(
      "🚀 Launch Token",
      `${CallBackQueries.LAUNCH_TOKEN}_${token.tokenAddress}`
    );

    let socialsInfo = "";
    if (twitter) {
      socialsInfo += `🐦 <b>Twitter:</b> <a href="${twitter}">Link</a>\n`;
    }
    if (telegram) {
      socialsInfo += `💬 <b>Telegram:</b> <a href="${telegram}">Link</a>\n`;
    }
    if (website) {
      socialsInfo += `🌐 <b>Website:</b> <a href="${website}">Link</a>\n`;
    }

    await ctx.reply(
      `🎉 <b>Token Created Successfully!</b>
🚀 <b>Platform:</b> <code>LetsBonk</code>

📊 <b>Token Details:</b>
💎 <b>Name:</b> <code>${token.name}</code>
🏷️ <b>Symbol:</b> <code>${token.symbol}</code>
📝 <b>Description:</b> ${token.description}
🔗 <b>Contract Address:</b> <code>${token.tokenAddress}</code>

${socialsInfo ? `🌐 <b>Social Links:</b>\n${socialsInfo}` : ""}

✅ <b>Status:</b> Ready for launch on LetsBonk! 🚀`,
      { parse_mode: "HTML", reply_markup: launchKb }
    );

    conversation.halt();
  }
};

export default createTokenConversation;
