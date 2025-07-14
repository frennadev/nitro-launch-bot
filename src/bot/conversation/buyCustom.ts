import { type Conversation } from "@grammyjs/conversations";
import { type Context } from "grammy";
import { sendMessage } from "../../backend/sender";
import { getFundingWallet, getUser } from "../../backend/functions";
import { executeExternalBuy } from "../../blockchain/pumpfun/externalBuy";
import { secretKeyToKeypair } from "../../blockchain/common/utils";
import { sendErrorWithAutoDelete } from "../utils";

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
      await sendErrorWithAutoDelete(ctx, "❌ Please provide a valid amount.");
      return conversation.halt();
    }
    const buyAmount = Number(buyAmountText);
    if (isNaN(buyAmount) || buyAmount <= 0) {
      await sendErrorWithAutoDelete(ctx, "❌ Please enter a valid number greater than 0.");
      return conversation.halt();
    }
    await ctx.reply("Buying now....");
    const user = await getUser(telegramId);
    if (!user || !user.id) {
      await sendErrorWithAutoDelete(ctx, "❌ User not found. Please start the bot with /start.");
      return conversation.halt();
    }
    const fundingWallet = await getFundingWallet(String(user.id));
    if (!fundingWallet || !fundingWallet.privateKey) {
      await sendErrorWithAutoDelete(ctx, "❌ Funding wallet not found.");
      return conversation.halt();
    }
    await ctx.reply(`💰 Buying ${buyAmount} SOL of token: ${mint}...`);
    
    // Use new external buy system with automatic platform detection
    const buyerKeypair = secretKeyToKeypair(fundingWallet.privateKey);
    const result = await executeExternalBuy(mint, buyerKeypair, buyAmount);
    
    if (result.success) {
      const platformText = result.platform === "pumpswap" ? "⚡ Pumpswap" : "🚀 PumpFun";
      await ctx.reply(
        `✅ Successfully bought ${buyAmount} SOL of token via ${platformText}!\n\nTransaction Signature:\n<code>${result.signature}</code>`,
        { parse_mode: "HTML" }
      );
    } else {
      await ctx.reply(
        `❌ Failed to buy token: ${result.error || "Unknown error"}\n\nPlease try again or contact support.`
      );
    }
    return conversation.halt();
  } catch (error: any) {
    await sendErrorWithAutoDelete(ctx, `❌ Error buying token: ${error.message}`);
    return conversation.halt();
  }
};
