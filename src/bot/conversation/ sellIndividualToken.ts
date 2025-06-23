import { Conversation } from "@grammyjs/conversations";
import { Context, InlineKeyboard } from "grammy";

interface WalletDetail {
  address: string;
  tokenAmount: number;
  usdValue: number;
}

interface TokenStats {
  name: string;
  tokenAddress: string;
  symbol: string;
  description?: string;
  walletsCount: number;
  totalValueUsd: number;
  totalTokens: number;
  walletDetails: WalletDetail[];
}

export const sellIndividualToken = async (conversation: Conversation<Context>, ctx: Context) => {
  // — Dummy data inline —
  const stats: TokenStats = {
    name: "DemoToken",
    tokenAddress: "D4CX9j7S8WTMPQ56PqQ3eHMdLpoTVjWF7ZLvSagj6vaV",
    symbol: "DMT",
    description: "This is just a demo token",
    walletsCount: 3,
    totalValueUsd: 1500,
    totalTokens: 3000,
    walletDetails: [
      { address: "0xAA...111", tokenAmount: 1000, usdValue: 500 },
      { address: "0xB3...222", tokenAmount: 500, usdValue: 250 },
      { address: "0xCC...333", tokenAmount: 1500, usdValue: 750 },
    ],
  };

  // Build the text message
  const header = `
💊 *${stats.name}*
🔑 Address: \`${stats.tokenAddress}\`
🏷️ Symbol: \`${stats.symbol}\`
📝 Description: ${stats.description}

📊 *Summary* \n👝 ${stats.walletsCount} wallets | \💰 $${stats.totalValueUsd} total | 🪙 ${stats.totalTokens} tokens
  `.trim();

  const details = stats.walletDetails
    .map((w) => `\`${w.address}\` | ${w.tokenAmount} ${stats.symbol} | \$${w.usdValue}`)
    .join("\n");

  const message = `${header}

*Per‐Wallet Breakdown:*
${details}
  `;

  // Build the inline keyboard: one row per wallet, with emojis
  const kb = new InlineKeyboard();
  stats.walletDetails.forEach((w) => {
    // truncate address for display
    const shortAddr = w.address.slice(0, 6) + "…" + w.address.slice(-4);

    kb.row(
      { text: `${shortAddr}`, callback_data: `wallet_${w.address}` },
      { text: `🟢 Sell %`, callback_data: `sellPct_${w.address}` },
      { text: `✅ Sell All`, callback_data: `sellAll_${w.address}` }
    );
  });

  // Send the message with inline buttons
  await ctx.reply(message, {
    parse_mode: "Markdown",
    reply_markup: kb,
  });
};

// In your bot flow:
// await sellIndividualToken(conversation, ctx);
