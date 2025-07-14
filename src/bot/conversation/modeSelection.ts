import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { sendMessage } from "../../backend/sender";
import { InlineKeyboard } from "grammy";
import { CallBackQueries } from "../types";

export const modeSelectionConversation = async (conversation: Conversation<Context>, ctx: Context): Promise<void> => {
  try {
    // If this conversation was triggered by a callback, acknowledge it
    await ctx.answerCallbackQuery();

    // Ask the user to choose between PumpFun or LetsBonk
    const prompt = "❓ Which mode would you like to use?";
    const keyboard = new InlineKeyboard()
      .text("🎉 PumpFun", CallBackQueries.PUMPFUN)
      .row()
      .text("🚀 LetsBonk", CallBackQueries.LETSBONK);

    await sendMessage(ctx, prompt, {
      reply_markup: keyboard,
    });

    // Wait for the user's choice
    const next = await conversation.wait();
    const data = next.callbackQuery?.data;
    if (!data) {
      // No data -> end the conversation
      return conversation.halt();
    }

    await next.answerCallbackQuery();

    // Handle the two options
    if (data === CallBackQueries.PUMPFUN) {
      await sendMessage(next, "✅ You selected *PumpFun*! Let's get the party started.", {
        parse_mode: "Markdown",
      });
    } else if (data === CallBackQueries.LETSBONK) {
      await sendMessage(next, "✅ You selected *LetsBonk*! Ready to blast off.", {
        parse_mode: "Markdown",
      });
    } else {
      // Fallback for unexpected callback data
      await sendMessage(next, "⚠️ Unknown option. Please try again.");
    }
  } catch (error: any) {
    console.error("Error in mode selection conversation:", error);
    await sendMessage(ctx, `❌ Something went wrong: ${error.message}`);
  }

  // End the conversation
  conversation.halt();
};
