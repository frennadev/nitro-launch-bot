import { type Conversation } from "@grammyjs/conversations";
import { type Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { createToken, getUser, getDefaultDevWallet, getOrCreateFundingWallet } from "../../backend/functions";
import { createBonkToken } from "../../blockchain/letsbonk/integrated-token-creator";
import axios from "axios";
import { CallBackQueries } from "../types";
import { env } from "../../config";
import { sendLoadingMessage } from "../loading";
import { sendErrorWithAutoDelete } from "../utils";

const cancelKeyboard = new InlineKeyboard().text("❌ Cancel", CallBackQueries.BACK);

const createTokenConversation = async (conversation: Conversation, ctx: Context) => {
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

  await ctx.reply("❓ Choose your launch mode:", {
    reply_markup: modeKeyboard,
  });

  let mode: CallBackQueries.PUMPFUN | CallBackQueries.LETSBONK;
  while (true) {
    const modeUpd = await conversation.wait();
    const data = modeUpd.callbackQuery?.data;
    if (!data || data === CallBackQueries.BACK) {
      if (data === CallBackQueries.BACK) {
        await modeUpd.answerCallbackQuery();
        await ctx.reply("Token creation cancelled.");
      }
      return conversation.halt();
    }
    await modeUpd.answerCallbackQuery();
    if (data === CallBackQueries.PUMPFUN) {
      mode = CallBackQueries.PUMPFUN;
      await modeUpd.reply("✅ Launch mode set to *PumpFun*.", { parse_mode: "Markdown" });
      break;
    }
    if (data === CallBackQueries.LETSBONK) {
      mode = CallBackQueries.LETSBONK;
      await modeUpd.reply("✅ Launch mode set to *LetsBonk*.", { parse_mode: "Markdown" });
      break;
    }
  }

  // === 2) Now send the token‐details prompt and wallet instructions ===
  const devWalletAddress = await getDefaultDevWallet(user.id);
  const fundingWalletAddress = await getOrCreateFundingWallet(user.id);

  await ctx.reply(
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

  // === 4) Ask for image upload ===
  await ctx.reply("Upload an image for your token (max 20 MB):", {
    reply_markup: cancelKeyboard,
  });

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
  const { data: fileData } = await axios.get<ArrayBuffer>(imageUrl, { responseType: "arraybuffer" });

  // === 5) Create token based on mode and show result ===
  const { update } = await sendLoadingMessage(
    ctx,
    "🔄 **Creating your token...**\n\n⏳ Processing image and metadata..."
  );

  let token: any;
  if (mode === CallBackQueries.PUMPFUN) {
    token = await createToken(user.id, name, symbol, description, fileData);
  } else {
    token = await createBonkToken(name, symbol, imageUrl, true, user.id);
  }

  if (mode === CallBackQueries.PUMPFUN) {
    await update(
      `🎉 **Token created successfully!**\n\n✅ Your token is ready to launch!\n\n**Token Address:** \`${token.tokenAddress}\``
    );

    const launchKb = new InlineKeyboard().text(
      "🚀 Launch Token",
      `${CallBackQueries.LAUNCH_TOKEN}_${token.tokenAddress}`
    );

    await ctx.reply(
      `<b>Token created successfully!</b>

<b>Launch Mode:</b> <code>${mode}</code>
<b>Name:</b> <code>${token.name}</code>
<b>Symbol:</b> <code>${token.symbol}</code>
<b>Description:</b> ${token.description}
<b>Token Address:</b> <code>${token.tokenAddress}</code>
`,
      { parse_mode: "HTML", reply_markup: launchKb }
    );
  } else {
    // Bonk tokens - metadata uploaded, ready for launch
    await update(
      `🎉 **Bonk Token Created Successfully!**\n\n✅ Metadata uploaded and token address assigned!\n\n**Token Address:** \`${token.tokenAddress}\``
    );

    const launchKb = new InlineKeyboard().text(
      "🚀 Launch Token",
      `${CallBackQueries.LAUNCH_TOKEN}_${token.tokenAddress}`
    );

    await ctx.reply(
      `<b>Bonk Token Created Successfully!</b>

<b>Launch Mode:</b> <code>${mode}</code>
<b>Name:</b> <code>${token.tokenName}</code>
<b>Symbol:</b> <code>${token.tokenSymbol}</code>
<b>Description:</b> ${token.description}
<b>Token Address:</b> <code>${token.tokenAddress}</code>

<b>Status:</b> ✅ Metadata uploaded, ready for launch
<b>Platform:</b> Raydium Launch Lab (LetsBonk.fun)

<i>💡 Your token metadata has been uploaded. Click "Launch Token" to create the token on Raydium Launch Lab.</i>
`,
      { parse_mode: "HTML", reply_markup: launchKb }
    );
  }

  conversation.halt();
};

export default createTokenConversation;
