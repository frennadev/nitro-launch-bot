import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { 
  getUser, 
  getDefaultDevWallet, 
  getFundingWallet, 
  getOrCreateFundingWallet,
  getAllBuyerWallets,
  getWalletBalance 
} from "../../backend/functions";
import { CallBackQueries } from "../types";
import type { ParseMode } from "grammy/types";
import { sendMessage } from "../../backend/sender";

const walletConfigConversation = async (conversation: Conversation<Context>, ctx: Context) => {
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
    .text("🛠️ Change Developer Wallet", CallBackQueries.CHANGE_DEV_WALLET)
    .row()
    .text("💰 Generate New Funding Wallet", CallBackQueries.GENERATE_FUNDING_WALLET)
    .row()
    .text("👥 Manage Buyer Wallets", CallBackQueries.MANAGE_BUYER_WALLETS)
    .row()
    .text("🔙 Back", CallBackQueries.BACK);

  const devShort = `${devWalletAddress.slice(0, 6)}…${devWalletAddress.slice(-4)}`;
  const fundingShort = `${fundingWalletAddress.slice(0, 6)}…${fundingWalletAddress.slice(-4)}`;

  const menuMessage = `
<b>💼 Wallet Configuration</b>
Configure and manage your wallets for token operations

<b>🔧 Developer Wallet:</b> <code>${devShort}</code>
💰 ${devBalance.toFixed(4)} SOL

<b>💳 Funding Wallet:</b> <code>${fundingShort}</code>
💰 ${fundingBalance.toFixed(4)} SOL

<b>👥 Buyer Wallets:</b> ${buyerWallets.length}/10 wallets
${buyerWallets.length > 0 ? '✅ Ready for launches' : '⚠️ No buyer wallets configured'}

<i>💡 Tip: Ensure your funding wallet has sufficient SOL for token launches!</i>
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
    return conversation.halt();
  }

  if (data === CallBackQueries.GENERATE_FUNDING_WALLET) {
    await next.reply("⚠️ This will replace your current funding wallet. Any funds in the old wallet will need to be transferred manually.\n\nAre you sure you want to continue?", {
      reply_markup: new InlineKeyboard()
        .text("✅ Yes, Generate New", "confirm_generate_funding")
        .text("❌ Cancel", CallBackQueries.BACK)
    });

    const confirmCtx = await conversation.wait();
    if (confirmCtx.callbackQuery?.data === "confirm_generate_funding") {
      await confirmCtx.answerCallbackQuery();
      try {
        const { generateNewFundingWallet } = await import("../../backend/functions");
        const newWallet = await generateNewFundingWallet(String(user.id));
        
        await sendMessage(confirmCtx, 
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

  conversation.halt();
};

export default walletConfigConversation;
