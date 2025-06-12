import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { createUser, getUser, getOrCreateDevWallet } from "../../backend/functions";
import { CallBackQueries } from "../types";
import { InlineKeyboard } from "grammy";

export default async function mainMenuConversation(conversation: Conversation<Context>, ctx: Context) {
  let user = await getUser(ctx?.chat!.id.toString());
  if (!user) {
    user = await createUser(
      ctx?.chat!.first_name,
      ctx?.chat!.last_name,
      ctx?.chat!.username ?? "",
      ctx?.chat!.id.toString()
    );
  }

  const devWallet = await getOrCreateDevWallet(String(user.id));
  const welcomeMsg = `
👋 *Welcome to Nitro Bot*

Launch your own tokens on [Pump\\.fun](https://pump\\.fun) in minutes—no coding, no fuss\\.

💳 *Your current dev wallet:*  
\`${devWallet}\`

To proceed, you can choose any of the actions below ⬇️
`;

  const keyboard = new InlineKeyboard()
    .text("Create Token", CallBackQueries.CREATE_TOKEN)
    .text("View Tokens", CallBackQueries.VIEW_TOKENS)
    .row()
    .text("Export Dev Wallet", CallBackQueries.EXPORT_DEV_WALLET)
    .text("Wallet Config", CallBackQueries.WALLET_CONFIG);

  await ctx.reply(welcomeMsg, {
    parse_mode: "MarkdownV2",
    reply_markup: keyboard,
  });
}
