import { type Conversation } from "@grammyjs/conversations";
import { type Context } from "grammy";
import { sendMessage } from "../../backend/sender";
import { getFundingWallet, getUser } from "../../backend/functions";
import { executeFundingBuy } from "../../blockchain/pumpfun/buy";

export const buyCustonConversation = async (
  conversation: Conversation<Context>,
  ctx: Context,
  mint: string
) => {
  try {
    await ctx.answerCallbackQuery();
    await ctx.reply("How much SOL would you like to spend on this token?");
    const telegramId = String(ctx.from?.id);
    const res = await conversation.wait();
    const buyAmountText = res.message?.text;
    if (!buyAmountText) {
      await ctx.reply("❌ Please provide a valid amount.");
      return conversation.halt();
    }
    const buyAmount = Number(buyAmountText);
    if (isNaN(buyAmount) || buyAmount <= 0) {
      await ctx.reply("❌ Please enter a valid number greater than 0.");
      return conversation.halt();
    }
    await ctx.reply("Buying now....");
    const user = await getUser(telegramId);
    if (!user || !user.id) {
      await ctx.reply("❌ User not found. Please start the bot with /start.");
      return conversation.halt();
    }
    const fundingWallet = await getFundingWallet(String(user.id));
    if (!fundingWallet || !fundingWallet.privateKey) {
      await ctx.reply("❌ Funding wallet not found.");
      return conversation.halt();
    }
    await ctx.reply(`💰 Buying ${buyAmount} SOL of token: ${mint}...`);
    const result = await executeFundingBuy(
      mint,
      fundingWallet.privateKey,
      buyAmount
    );
    if (result.success) {
      await ctx.reply(
        `✅ Successfully bought ${buyAmount} SOL of token!\n\nTransaction Signature:\n<code>${result.signature}</code>`,
        { parse_mode: "HTML" }
      );
    } else {
      await ctx.reply(
        "❌ Failed to buy token. Please try again or contact support."
      );
    }
    return conversation.halt();
  } catch (error) {
    await sendMessage(ctx, `❌ Error buying token`);
    return conversation.halt();
  }
};
