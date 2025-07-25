import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import {
  createUser,
  getUser,
  getDefaultDevWallet,
  getOrCreateFundingWallet,
} from "../../backend/functions-main";
import { CallBackQueries } from "../types";
import { InlineKeyboard } from "grammy";
import { safeAnswerCallbackQuery, sendErrorWithAutoDelete } from "../utils";

export default async function mainMenuConversation(
  conversation: Conversation<Context>,
  ctx: Context
) {
  await safeAnswerCallbackQuery(ctx);
  let user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendErrorWithAutoDelete(ctx, "Unrecognized user ❌");
    return conversation.halt();
  }

  // Auto-create funding wallet for all users
  await getOrCreateFundingWallet(String(user.id));

  const devWallet = await getDefaultDevWallet(String(user.id));
  const welcomeMsg = `
👋 Welcome to Nitro Launch Bot! 🚀

Nitro Bot empowers you to deploy and manage Solana tokens on Pump.fun and LetsBonk.fun — no coding required!

What you can do:
• Create & launch tokens instantly on Pump.fun and LetsBonk.fun
• Private buys & sells for full privacy
• Easy token management with one click

💳 Your Dev Wallet
${devWallet}

🔗 Referrals: (see /start for your count) friend(s) joined via your link
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

  await ctx.reply(welcomeMsg, {
    reply_markup: keyboard,
  });
}
