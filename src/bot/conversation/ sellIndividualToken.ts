import { Conversation } from "@grammyjs/conversations";
import { Context, InlineKeyboard } from "grammy";
import { TokenModel } from "../../backend/models";
import { abbreviateNumber, getNonEmptyBalances, getUser } from "../../backend/functions";
import { sendMessage } from "../../backend/sender";

type Holder = {
  pubkey: string;
  balance: number; // token amount
  tokenPrice: number; // USD value of that wallet’s tokens
};

export const sellIndividualToken = async (conversation: Conversation<Context>, ctx: Context, address: string) => {
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    return conversation.halt();
  }

  const token = await TokenModel.findOne({ tokenAddress: address }).sort({ createdAt: -1 }).exec();
  if (!token) {
    await sendMessage(ctx, "Token not found ❌");
    return conversation.halt();
  }

  const holdersWallet = (await getNonEmptyBalances(String(user._id), address)) as Holder[];

  const walletsCount = holdersWallet.length;
  const totalTokens = holdersWallet.reduce((sum, w) => sum + w.balance, 0);
  const totalValueUsd = holdersWallet.reduce((sum, w) => sum + w.tokenPrice, 0);

  const header = `
💊 *${token.name}*
🔑 Address: \`${token.tokenAddress}\`
🏷️ Symbol: \`${token.symbol}\`
📝 Description: ${token.description || "–"}

📊 *Summary:*  
👝 ${walletsCount} wallets  
💰 $${abbreviateNumber(totalValueUsd)} total  
🪙 ${abbreviateNumber(totalTokens)} tokens
  `.trim();

  // 3) Build the per-wallet breakdown
  const details = holdersWallet
    .map((w) => {
      const shortAddr = w.pubkey.slice(0, 6) + "…" + w.pubkey.slice(-4);
      return `\`${shortAddr}\` | ${abbreviateNumber(w.balance)} ${token.symbol} | $${abbreviateNumber(w.tokenPrice)}`;
    })
    .join("\n");

  const message = `${header}

*Per-Wallet Breakdown:*
${details}`;

  // 4) Build an inline keyboard row per wallet
  const kb = new InlineKeyboard();
  holdersWallet.forEach((w) => {
    const shortAddr = w.pubkey.slice(0, 6) + "…" + w.pubkey.slice(-4);
    kb.row(
      { text: `🏦 ${shortAddr}`, callback_data: `wallet_${w.pubkey}` },
      { text: `📈 Sell %`, callback_data: `sellPct_${w.pubkey}` },
      { text: `💸 Sell All`, callback_data: `sellAll_${w.pubkey}` }
    );
  });

  // 5) Send it off
  await ctx.reply(message, {
    parse_mode: "Markdown",
    reply_markup: kb,
  });
};
