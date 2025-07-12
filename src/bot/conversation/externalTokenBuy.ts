import { type Conversation } from "@grammyjs/conversations";
import { type Context, InlineKeyboard } from "grammy";
import {
  getUser,
  getAllBuyerWallets,
  getFundingWallet,
  getWalletBalance,
} from "../../backend/functions";
import { CallBackQueries } from "../types";
import { sendMessage } from "../../backend/sender";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { env } from "../../config";
import { secretKeyToKeypair } from "../../blockchain/common/utils";
import { executeExternalBuy } from "../../blockchain/pumpfun/externalBuy";

// Buy External Token Conversation
export const buyExternalTokenConversation = async (
  conversation: Conversation<Context>,
  ctx: Context
) => {
  await ctx.answerCallbackQuery();
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    return conversation.halt();
  }

  await sendMessage(
    ctx,
    "💰 <b>Buy External Token</b>\n\nPlease enter the token address you wish to buy:",
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text(
        "❌ Cancel",
        CallBackQueries.CANCEL_EXTERNAL_BUY
      ),
    }
  );

  const tokenInput = await conversation.wait();
  if (tokenInput.callbackQuery?.data === CallBackQueries.CANCEL_EXTERNAL_BUY) {
    await tokenInput.answerCallbackQuery();
    await sendMessage(tokenInput, "External token purchase cancelled.");
    return conversation.halt();
  }

  const tokenAddress = tokenInput.message?.text?.trim();
  if (!tokenAddress) {
    await sendMessage(
      tokenInput,
      "❌ No token address provided. Purchase cancelled."
    );
    return conversation.halt();
  }

  try {
    new PublicKey(tokenAddress); // Validate address
  } catch (error) {
    await sendMessage(
      tokenInput,
      "❌ Invalid token address. Purchase cancelled."
    );
    return conversation.halt();
  }

  // Check if this token is already being launched by someone
  const { checkTokenAddressUsage } = await import("../../backend/functions");
  const usage = await checkTokenAddressUsage(tokenAddress);

  if (usage.isUsed && usage.state && usage.state !== "LAUNCHED") {
    await sendMessage(
      tokenInput,
      `⚠️ <b>Token Launch in Progress</b>\n\nThis token is currently being launched${usage.tokenName ? ` (${usage.tokenName})` : ""}. Please wait for the launch to complete before attempting to buy.\n\n<i>You can only buy tokens that are already launched or available on the market.</i>`,
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  // Get funding wallet for external token purchases
  const fundingWallet = await getFundingWallet(user.id);

  if (!fundingWallet) {
    await sendMessage(
      tokenInput,
      "❌ No funding wallet available for purchase. Please configure a funding wallet first."
    );
    return conversation.halt();
  }

  // Check funding wallet balance
  const fundingBalance = await getWalletBalance(fundingWallet.publicKey);

  if (fundingBalance < 0.001) {
    await sendMessage(
      tokenInput,
      `❌ Insufficient balance in funding wallet.\n\n<b>Current Balance:</b> ${fundingBalance.toFixed(6)} SOL\n<b>Minimum Required:</b> 0.001 SOL`,
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  await sendMessage(
    tokenInput,
    `💰 <b>Buy External Token</b>\n\n<b>Token Address:</b> <code>${tokenAddress}</code>\n<b>Funding Wallet Balance:</b> ${fundingBalance.toFixed(6)} SOL\n\nHow much SOL would you like to spend on this token?`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text(
        "❌ Cancel",
        CallBackQueries.CANCEL_EXTERNAL_BUY
      ),
    }
  );

  const amountInput = await conversation.wait();
  if (amountInput.callbackQuery?.data === CallBackQueries.CANCEL_EXTERNAL_BUY) {
    await amountInput.answerCallbackQuery();
    await sendMessage(amountInput, "External token purchase cancelled.");
    return conversation.halt();
  }

  const buyAmountText = amountInput.message?.text?.trim();
  if (!buyAmountText) {
    await sendMessage(
      amountInput,
      "❌ No amount provided. Purchase cancelled."
    );
    return conversation.halt();
  }

  const buyAmount = parseFloat(buyAmountText);
  if (isNaN(buyAmount) || buyAmount <= 0) {
    await sendMessage(amountInput, "❌ Invalid amount. Purchase cancelled.");
    return conversation.halt();
  }

  if (buyAmount > fundingBalance - 0.001) {
    await sendMessage(
      amountInput,
      `❌ Insufficient balance for the requested purchase amount.\n\n<b>Requested Amount:</b> ${buyAmount.toFixed(6)} SOL\n<b>Available Balance:</b> ${fundingBalance.toFixed(6)} SOL`,
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  // Confirm purchase with funding wallet
  await sendMessage(
    amountInput,
    `🔍 <b>Confirm External Token Purchase</b>\n\n<b>Token Address:</b> <code>${tokenAddress}</code>\n<b>Buy Amount:</b> ${buyAmount.toFixed(6)} SOL\n<b>Using:</b> Funding Wallet\n\nProceed with purchase?`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("✅ Confirm Purchase", "confirm_external_buy")
        .row()
        .text("❌ Cancel", CallBackQueries.CANCEL_EXTERNAL_BUY),
    }
  );

  const confirmation = await conversation.waitFor("callback_query:data");
  await confirmation.answerCallbackQuery();

  if (
    confirmation.callbackQuery?.data === CallBackQueries.CANCEL_EXTERNAL_BUY
  ) {
    await sendMessage(confirmation, "External token purchase cancelled.");
    return conversation.halt();
  }

  if (confirmation.callbackQuery?.data === "confirm_external_buy") {
    try {
      await sendMessage(
        confirmation,
        "🔄 Processing external token purchase..."
      );

      // Execute single buy transaction using funding wallet
      const keypair = secretKeyToKeypair(fundingWallet.privateKey);
      const result = await executeExternalBuy(
        tokenAddress,
        keypair,
        buyAmount,
        3,
        0.002,
        ctx
      );

      if (result.success) {
        const platformText =
          result.platform === "pumpswap" ? "⚡ Pumpswap" : "🚀 PumpFun";
        await sendMessage(
          confirmation,
          `✅ <b>External Token Purchase Successful!</b>\n\n<b>Amount Spent:</b> ${buyAmount.toFixed(6)} SOL\n<b>Platform:</b> ${platformText}\n<b>Token Address:</b> <code>${tokenAddress}</code>\n\n<b>Transaction:</b> <code>${result.signature}</code>`,
          { parse_mode: "HTML" }
        );
      } else {
        await sendMessage(
          confirmation,
          `❌ <b>External Token Purchase Failed</b>\n\n<b>Error:</b> ${result.error || "Unknown error"}`,
          { parse_mode: "HTML" }
        );
      }
    } catch (error: any) {
      await sendMessage(
        confirmation,
        `❌ External token purchase failed: ${error.message}`
      );
    }
  }

  conversation.halt();
};
