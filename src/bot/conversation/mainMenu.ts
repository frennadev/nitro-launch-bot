import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import {
  createUser,
  getUser,
  getDefaultDevWallet,
  getOrCreateFundingWallet,
  createUserWithReferral,
  getUserReferralStats,
} from "../../backend/functions-main";
import { CallBackQueries } from "../types";
import { InlineKeyboard } from "grammy";
import { safeAnswerCallbackQuery, sendErrorWithAutoDelete } from "../utils";
import { sendFirstMessage } from "../../backend/sender";

export default async function mainMenuConversation(
  conversation: Conversation<Context>,
  ctx: Context
) {
  // Only answer callback query if this is triggered by a callback query
  if (ctx.callbackQuery) {
    await safeAnswerCallbackQuery(ctx);
  }

  let user = await getUser(ctx.chat!.id.toString());
  let isFirstTime = user === null;

  if (isFirstTime) {
    // Check if there's a referral code in the start command
    const startPayload = ctx.message?.text?.split(" ")[1]; // Get text after /start
    let referralCode: string | undefined;

    if (
      startPayload &&
      typeof startPayload === "string" &&
      startPayload.startsWith("REF_")
    ) {
      referralCode = startPayload.replace("REF_", "");
      console.log(`New user with referral code: ${referralCode}`);
    }

    // Create user with or without referral
    if (referralCode) {
      user = await createUserWithReferral(
        ctx.chat!.first_name,
        ctx.chat!.last_name,
        ctx.chat!.username!,
        ctx.chat!.id.toString(),
        referralCode
      );
    } else {
      user = await createUser(
        ctx.chat!.first_name,
        ctx.chat!.last_name,
        ctx.chat!.username!,
        ctx.chat!.id.toString()
      );
    }
  }

  if (!user) {
    await sendErrorWithAutoDelete(ctx, "Unrecognized user ❌");
    return conversation.halt();
  }

  // Auto-create funding wallet for all users
  await getOrCreateFundingWallet(String(user.id));

  const devWallet = await getDefaultDevWallet(String(user.id));

  // Get user's referral stats
  const referralStats = await getUserReferralStats(String(user.id));

  const welcomeMsg = `
👋 Welcome to SUP BOT! 🚀

SUP BOT empowers you to deploy and manage Solana tokens on Pump.fun and LetsBonk.fun — no coding required!

What you can do:
• Create & launch tokens instantly on Pump.fun and LetsBonk.fun
• Private buys & sells for full privacy
• Easy token management with one click

💳 Your Dev Wallet
${devWallet}

🔗 Referrals: ${referralStats.referralCount} friend(s) joined via your link
Useful Links:
• Pump.fun: https://pump.fun
• LetsBonk.fun: https://letsbonk.fun
Get started below:`;

  const keyboard = new InlineKeyboard()
    .text("Create Token", CallBackQueries.CREATE_TOKEN)
    .text("View Tokens", CallBackQueries.VIEW_TOKENS)
    .row()
    .text("Export Dev Wallet", CallBackQueries.EXPORT_DEV_WALLET)
    .text("Wallet Config", CallBackQueries.WALLET_CONFIG)
    .row()
    .text("🔗 Referrals", CallBackQueries.VIEW_REFERRALS)
    .text("📊 Predict MC", CallBackQueries.PREDICT_MC)
    .row()
    .text("🆘 Help", CallBackQueries.HELP);

  await sendFirstMessage(ctx, welcomeMsg, {
    reply_markup: keyboard,
  });
}
