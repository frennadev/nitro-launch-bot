import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getUser } from "../../backend/functions";
import { TokenModel } from "../../backend/models";
import { CallBackQueries } from "../types";
import { sendMessage } from "../../backend/sender";
import { TokenState } from "../../backend/types";

const viewTokensConversation = async (conversation: Conversation<Context>, ctx: Context) => {
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    return conversation.halt();
  }

  const tokens = await TokenModel.find({ user: user._id })
    .populate("launchData.devWallet")
    .populate("launchData.buyWallets")
    .exec();

  if (!tokens.length) {
    await sendMessage(ctx, "No tokens found.");
    return conversation.halt();
  }

  let currentIndex = 0;
  let messageId: number | undefined;

  while (true) {
    const token = tokens[currentIndex];
    const { name, symbol, description, tokenAddress, state, launchData } = token;
    const { buyWallets, buyAmount, devBuy } = launchData!;

    const lines = [
      `💊 ${name} Launch Details`,
      `____________________________________________________`,
      ``,
      `🔑 <b>Mint:</b> <code>${tokenAddress}</code>`,
      `🏷️ <b>Symbol:</b> <code>${symbol}</code>`,
      `📝 <b>Description:</b> ${description || "–"}`,
      ``,
      `👨‍💻 <b>Dev allocation:</b> <code>${devBuy}</code>`,
      `🛒 <b>Buyer allocation:</b> <code>${buyAmount}</code>`,
      `👥 <b>Worker wallets:</b> <code>${(buyWallets as any[]).length}</code>`,
      ``,
      `📊 <b>State:</b> ${state === TokenState.LAUNCHED ? "✅ Launched" : "⌛ Pending"}`,
    ].join("\n");

    const kb = new InlineKeyboard();
    kb.text("←", "left").text("→", "right");
    if (state === TokenState.LAUNCHED) {
      kb.row()
        .text("👨‍💻 Sell Dev Supply", `${CallBackQueries.SELL_DEV}_${tokenAddress}`)
        .text("📈 Sell % Supply", `${CallBackQueries.SELL_PERCENT}_${tokenAddress}`)
        .row()
        .text("🧨 Sell All", `${CallBackQueries.SELL_ALL}_${tokenAddress}`);
      kb.row();
    } else {
      kb.row().text("🚀 Launch Token", `${CallBackQueries.LAUNCH_TOKEN}_${tokenAddress}`);
    }
    kb.row().text("🔙 Back", CallBackQueries.BACK);

    // Delete previous message if exists
    if (messageId) {
      try {
        await ctx.api.deleteMessage(ctx.chat!.id, messageId);
      } catch (e) {}
    }

    const sent = await ctx.reply(lines, {
      parse_mode: "HTML",
      reply_markup: kb,
    });
    messageId = sent.message_id;

    const next = await conversation.wait();
    const data = next.callbackQuery?.data;
    if (!data) return conversation.halt();

    await next.answerCallbackQuery();

    if (data === "right") {
      currentIndex = (currentIndex + 1) % tokens.length;
    } else if (data === "left") {
      currentIndex = (currentIndex - 1 + tokens.length) % tokens.length;
    } else {
      break;
    }
  }
};

export default viewTokensConversation;
