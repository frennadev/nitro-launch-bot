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
👋 *Welcome to Nitro Bot*

Launch your own tokens on [Pump\\.fun](https://pump\\.fun) in minutes—no coding, no fuss\\.
Here's what you can do right from this chat:

💳 *Your current dev wallet:*  
\`${devWallet}\`

To proceed, you can choose any of the actions below ⬇️
`;

  const keyboard = new InlineKeyboard()
    .text("Create Token", CallBackQueries.CREATE_TOKEN)
    .text("View Tokens", CallBackQueries.VIEW_TOKENS)
    .row()
    .text("Export Dev Wallet", CallBackQueries.EXPORT_DEV_WALLET)
    .text("Wallet Config", CallBackQueries.WALLET_CONFIG)
    .row()
    .text("🔗 Referrals", CallBackQueries.VIEW_REFERRALS)
    .text("🆘 Help", CallBackQueries.HELP);

  await ctx.reply(welcomeMsg, {
    parse_mode: "MarkdownV2",
    reply_markup: keyboard,
  });
}
