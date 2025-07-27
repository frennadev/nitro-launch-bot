import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import {
  getUser,
  getDefaultDevWallet,
  getFundingWallet,
  getOrCreateFundingWallet,
  getAllBuyerWallets,
  getWalletBalance,
} from "../../backend/functions-main";
import { CallBackQueries } from "../types";
import type { ParseMode } from "grammy/types";
import { sendMessage } from "../../backend/sender";
import { safeAnswerCallbackQuery } from "../utils";

const walletConfigConversation = async (
  conversation: Conversation<Context>,
  ctx: Context
): Promise<void> => {
  if (ctx.callbackQuery) {
    await safeAnswerCallbackQuery(ctx);
  }

  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    return conversation.halt();
  }

  // Get wallet data
  const devWalletAddress = await getDefaultDevWallet(String(user.id));
  const fundingWalletAddress = await getOrCreateFundingWallet(String(user.id));
  const buyerWallets = await getAllBuyerWallets(String(user.id));

  // Get balances
  const devBalance = await getWalletBalance(devWalletAddress);
  const fundingBalance = await getWalletBalance(fundingWalletAddress);

  const keyboard = new InlineKeyboard()
    .text("🔧 Developer Wallet", CallBackQueries.CHANGE_DEV_WALLET)
    .text("💰 Funding Wallet", CallBackQueries.GENERATE_FUNDING_WALLET)
    .row()
    .text("👥 Buyer Wallets", CallBackQueries.MANAGE_BUYER_WALLETS)
    .row()
    .text("💸 Withdraw Dev", CallBackQueries.WITHDRAW_DEV_WALLET)
    .text("💸 Withdraw Funding", CallBackQueries.WITHDRAW_FUNDING_WALLET)
    .row()
    .text("💸 Withdraw Buyers", CallBackQueries.WITHDRAW_BUYER_WALLETS)
    .row()
    .text("← Back", CallBackQueries.BACK);

  const menuMessage = `
<b>💼 Wallet Configuration</b>

<b>🔧 Developer Wallet</b>
<code>${devWalletAddress}</code>
Balance: <b>${devBalance.toFixed(4)} SOL</b>

<b>💰 Funding Wallet</b>
<code>${fundingWalletAddress}</code>
Balance: <b>${fundingBalance.toFixed(4)} SOL</b>

<b>👥 Buyer Wallets</b>
Count: <b>${buyerWallets.length}/40</b>
Status: ${buyerWallets.length > 0 ? "✅ Ready" : "⚠️ Not configured"}

<i>💡 Keep your funding wallet topped up for launches</i>
`;

  await sendMessage(ctx, menuMessage, {
    parse_mode: "HTML" as ParseMode,
    reply_markup: keyboard,
  });

  const next = await conversation.wait();
  const data = next.callbackQuery?.data;
  if (!data) return conversation.halt();

  await next.answerCallbackQuery();

  if (data === CallBackQueries.BACK) {
    // Import and start main menu conversation
    const mainMenuConversation = await import("./mainMenu");
    return await mainMenuConversation.default(conversation, next);
  }

  if (data === CallBackQueries.GENERATE_FUNDING_WALLET) {
    await next.reply(
      "⚠️ This will replace your current funding wallet. Any funds in the old wallet will need to be transferred manually.\n\nAre you sure you want to continue?",
      {
        reply_markup: new InlineKeyboard()
          .text("✅ Yes, Generate New", "confirm_generate_funding")
          .text("❌ Cancel", CallBackQueries.BACK),
      }
    );

    const confirmCtx = await conversation.wait();
    if (confirmCtx.callbackQuery?.data === "confirm_generate_funding") {
      await confirmCtx.answerCallbackQuery();
      try {
        const { generateNewFundingWallet } = await import(
          "../../backend/functions-main"
        );
        const newWallet = await generateNewFundingWallet(String(user.id));

        await sendMessage(
          confirmCtx,
          `✅ New funding wallet generated!\n\n<b>Address:</b> <code>${newWallet.publicKey}</code>\n\n<b>Private Key:</b>\n<code>${newWallet.privateKey}</code>\n\n<i>⚠️ Save this private key securely and delete this message!</i>`,
          { parse_mode: "HTML" }
        );
      } catch (error: any) {
        await sendMessage(confirmCtx, `❌ Error: ${error.message}`);
      }
    } else {
      await confirmCtx.answerCallbackQuery();
      await sendMessage(confirmCtx, "Operation cancelled.");
    }
    return conversation.halt();
  }

  if (data === CallBackQueries.WITHDRAW_DEV_WALLET) {
    // Import and start dev wallet withdrawal conversation
    const { withdrawDevWalletConversation } = await import("./withdrawal");
    return await withdrawDevWalletConversation(conversation, next);
  }

  if (data === CallBackQueries.WITHDRAW_BUYER_WALLETS) {
    // Import and start buyer wallets withdrawal conversation
    const { withdrawBuyerWalletsConversation } = await import("./withdrawal");
    return await withdrawBuyerWalletsConversation(conversation, next);
  }

  if (data === CallBackQueries.WITHDRAW_FUNDING_WALLET) {
    // Import and start funding wallet withdrawal conversation
    const { withdrawFundingWalletConversation } = await import("./withdrawal");
    return await withdrawFundingWalletConversation(conversation, next);
  }

  if (data === CallBackQueries.MANAGE_BUYER_WALLETS) {
    // Import and start buyer wallets management conversation
    const { default: manageBuyerWalletsConversation } = await import(
      "./buyerWallets"
    );
    return await manageBuyerWalletsConversation(conversation, next);
  }

  if (data === CallBackQueries.CHANGE_DEV_WALLET) {
    // Import and start dev wallet management conversation
    const { default: devWalletsConversation } = await import("./devWallets");
    return await devWalletsConversation(conversation, next);
  }

  conversation.halt();
};

export default walletConfigConversation;
