import bot from ".";
import { CallBackQueries } from "./types";
import { escape } from "./utils";
import { getTokenInfo } from "../backend/utils";
import { getTransactionStats } from "../backend/functions-main";

export const sendLaunchSuccessNotification = async (
  chatId: number,
  tokenAddress: string,
  tokenName: string,
  symbol: string,
) => {
  // Get token info for market cap and price
  const tokenInfo = await getTokenInfo(tokenAddress);
  
  // Get transaction statistics
  const transactionStats = await getTransactionStats(tokenAddress);
  
  const msg = [
    `🎉 *Token launched successfully* \n`,
    `*Name*: ${escape(tokenName)}`,
    `*Symbol*: $\`${escape(symbol)}\``,
    `*Token Address*: \`${tokenAddress}\``,
    tokenInfo ? `*Market Cap*: ${escape(`$${tokenInfo.marketCap.toLocaleString()}`)}` : "",
    tokenInfo && tokenInfo.price !== undefined ? `*Price*: ${escape(`$${tokenInfo.price}`)}` : "",
    ``,
    `📊 *Launch Statistics*:`,
    `• Total Wallets: ${transactionStats.byType.snipe_buy.length}`,
    `• Successful: ${transactionStats.byType.snipe_buy.filter((t: any) => t.success).length}`,
    `• Failed: ${transactionStats.byType.snipe_buy.filter((t: any) => !t.success).length}`,
    `• Success Rate: ${transactionStats.byType.snipe_buy.length > 0 ? Math.round((transactionStats.byType.snipe_buy.filter((t: any) => t.success).length / transactionStats.byType.snipe_buy.length) * 100) : 0}%`,
    `\nClick the buttons below to perform other actions ⬇️`,
  ].filter(Boolean).join("\n");
  
  await bot.api.sendMessage(chatId, msg, {
    parse_mode: "MarkdownV2",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "👨‍💻 Sell Dev Supply",
            callback_data: `${CallBackQueries.SELL_DEV}_${tokenAddress}`,
          },
          {
            text: "📈 Sell % supply",
            callback_data: `${CallBackQueries.SELL_PERCENT}_${tokenAddress}`,
          },
        ],
        [
          {
            text: "🧨 Sell All",
            callback_data: `${CallBackQueries.SELL_ALL}_${tokenAddress}`,
          },
        ],
      ],
    },
  });
};

export const sendLaunchFailureNotification = async (
  chatId: number,
  tokenAddress: string,
  tokenName: string,
  symbol: string,
) => {
  const msg = [
    `❌ *Token launch Failed* \n`,
    `*Name*: ${escape(tokenName)}`,
    `*Symbol:* $\`${escape(symbol)}\``,
    `*Token Address*: \`${tokenAddress}\``,
    `\nClick the buttons below to retry the launch ⬇️`,
  ].join("\n");
  await bot.api.sendMessage(chatId, msg, {
    parse_mode: "MarkdownV2",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🚀 Launch Token",
            callback_data: `${CallBackQueries.LAUNCH_TOKEN}_${tokenAddress}`,
          },
        ],
      ],
    },
  });
};

export const sendNotification = async (chatId: number, message: string) => {
  await bot.api.sendMessage(chatId, message, { parse_mode: "MarkdownV2" });
};
