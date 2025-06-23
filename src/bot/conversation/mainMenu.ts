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

export default async function mainMenuConversation(
  conversation: Conversation<Context>,
  ctx: Context
) {
  await ctx.answerCallbackQuery();
  let user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await ctx.reply("Unrecognized user ❌");
    return conversation.halt();
  }

  // Auto-create funding wallet for all users
  await getOrCreateFundingWallet(String(user.id));

  const devWallet = await getDefaultDevWallet(String(user.id));
  const welcomeMsg = `
👋 *Welcome to Nitro Launch Bot*

Launch your own tokens on [Pump\\.fun](https://pump\\.fun) in minutes—no coding, no fuss\\.
Specialized for token creation and launch with privacy features\\.

💳 *Your current dev wallet:*  
\`${devWallet}\`

To proceed, you can choose any of the actions below ⬇️
`;

  const keyboard = new InlineKeyboard()
    .text("🚀 Create Token", CallBackQueries.CREATE_TOKEN)
    .text("📊 View Tokens", CallBackQueries.VIEW_TOKENS)
    .row()
    .text("👨‍💼 Dev Wallets", CallBackQueries.EXPORT_DEV_WALLET)
    .text("💰 Buyer Wallets", CallBackQueries.ADD_BUYER_WALLET)
    .row()
    .text("🔗 Referrals", CallBackQueries.VIEW_REFERRALS);

  await ctx.reply(welcomeMsg, {
    parse_mode: "MarkdownV2",
    reply_markup: keyboard,
  });
}
