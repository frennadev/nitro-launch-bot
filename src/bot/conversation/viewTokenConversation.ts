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
    .sort({ createdAt: -1 })
    .exec();

  if (!tokens.length) {
    await sendMessage(ctx, "No tokens found.");
    return conversation.halt();
  }

  let currentIndex = 0;

  const showToken = async (index: number) => {
    const token = tokens[index];
    const { name, symbol, description, tokenAddress, state, launchData } = token;
    const { buyWallets, buyAmount, devBuy } = launchData!;

    const lines = [
      `💊 **${name}**`,
      `🔑 Address: \`${tokenAddress}\``,
      `🏷️ Symbol: \`${symbol}\``,
      `📝 Description: ${description || "–"}`,
      "",
      `👨‍💻 Dev allocation: \`${devBuy || 0}\` SOL`,
      `🛒 Buyer allocation: \`${buyAmount || 0}\` SOL`,
      `👥 Worker wallets: \`${(buyWallets as any[])?.length || 0}\``,
      "",
      `📊 Status: ${state === TokenState.LAUNCHED ? "✅ Launched" : "⌛ Pending"}`,
      "",
      `Showing ${index + 1} of ${tokens.length}`,
    ].join("\n");

    const keyboard = new InlineKeyboard();
    
    if (state === TokenState.LAUNCHED) {
      keyboard
        .text("👨‍💻 Sell Dev Supply", `${CallBackQueries.SELL_DEV}_${tokenAddress}`)
        .text("📈 Sell % Supply", `${CallBackQueries.SELL_PERCENT}_${tokenAddress}`)
        .row()
        .text("🧨 Sell All", `${CallBackQueries.SELL_ALL}_${tokenAddress}`)
        .row();
    } else {
      keyboard.text("🚀 Launch Token", `${CallBackQueries.LAUNCH_TOKEN}_${tokenAddress}`).row();
    }

    // Navigation buttons
    if (tokens.length > 1) {
      if (index > 0) {
        keyboard.text("⬅️", "prev");
      }
      if (index < tokens.length - 1) {
        keyboard.text("➡️", "next");
      }
      keyboard.row();
    }

    keyboard.text("🔙 Back", CallBackQueries.BACK);

    await ctx.reply(lines, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  };

  await showToken(currentIndex);

  while (true) {
    const response = await conversation.waitFor("callback_query:data");
    await response.answerCallbackQuery();

    const data = response.callbackQuery?.data;

    if (data === "prev" && currentIndex > 0) {
      currentIndex--;
      await showToken(currentIndex);
    } else if (data === "next" && currentIndex < tokens.length - 1) {
      currentIndex++;
      await showToken(currentIndex);
    } else if (data === CallBackQueries.BACK) {
      return conversation.halt();
    } else {
      // Let other callback handlers take over (launch, sell, etc.)
      return conversation.halt();
    }
  }
};

export default viewTokensConversation;
