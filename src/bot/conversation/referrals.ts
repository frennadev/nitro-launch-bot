import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import {
  getUserReferralStats,
  generateReferralLink,
} from "../../backend/functions-main";
import { sendMessage } from "../../backend/sender";
import { InlineKeyboard } from "grammy";
import { CallBackQueries } from "../types";

export const referralsConversation = async (
  conversation: Conversation<Context>,
  ctx: Context
): Promise<void> => {
  try {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery();
    }
    // Get user ID from chat
    const userId = ctx.chat!.id.toString();

    // Get user from the database to get the actual user ID
    const { getUser } = await import("../../backend/functions-main");
    const user = await getUser(userId);

    if (!user) {
      await sendMessage(ctx, "❌ User not found. Please start the bot first.");
      return conversation.halt();
    }

    await sendMessage(ctx, "🔄 Loading your referral information...");

    // Get user's referral stats
    const stats = await getUserReferralStats(user.id);

    // Get bot username for link generation
    const botInfo = await ctx.api.getMe();
    const botUsername = botInfo.username;

    // Generate referral link
    const referralLink = await generateReferralLink(user.id, botUsername);

    // Format the message
    const message = `🔗 <b>Your Referral Program</b>

<b>Your Referral Link:</b>
<code>${referralLink}</code>

<b>📊 Statistics:</b>
👥 <b>Total Referrals:</b> ${stats.referralCount}
🆔 <b>Your Code:</b> <code>${stats.affiliateCode || "Not Generated"}</code>

<b>🎯 How it works:</b>
• Share your unique referral link with friends
• When someone joins using your link, they become your referral
• Track your progress and build your network

<b>🚀 Coming Soon:</b>
💰 Earn rewards for successful referrals
📊 Advanced analytics and insights`;

    const keyboard = new InlineKeyboard()
      .text("🔄 Refresh Stats", CallBackQueries.VIEW_REFERRALS)
      .row()
      .text("🔙 Back", CallBackQueries.BACK);

    await sendMessage(ctx, message, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });

    // Wait for user interaction
    const next = await conversation.wait();
    const data = next.callbackQuery?.data;
    if (!data) return conversation.halt();

    await next.answerCallbackQuery();

    if (data === CallBackQueries.BACK) {
      // Import and start main menu conversation
      const mainMenuConversation = await import("./mainMenu");
      return await mainMenuConversation.default(conversation, next);
    }

    if (data === CallBackQueries.VIEW_REFERRALS) {
      // Restart the referrals conversation to refresh stats
      return await referralsConversation(conversation, next);
    }
  } catch (error: unknown) {
    console.error("Error in referrals conversation:", error);
    await sendMessage(
      ctx,
      `❌ Error loading referral information: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  conversation.halt();
};
