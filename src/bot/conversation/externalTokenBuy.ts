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
    await sendMessage(
      ctx,
      "❌ <b>Access Denied</b>\n\nUnrecognized user. Please start the bot first.",
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  await sendMessage(
    ctx,
    [
      "💰 <b>External Token Purchase</b>",
      "",
      "🎯 <b>Step 1:</b> Token Address",
      "",
      "Please enter the token address you wish to purchase:",
      "",
      "<i>💡 Make sure to double-check the address before proceeding</i>",
    ].join("\n"),
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
    await sendMessage(
      tokenInput,
      "❌ <b>Purchase Cancelled</b>\n\nExternal token purchase has been cancelled.",
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  const tokenAddress = tokenInput.message?.text?.trim();
  if (!tokenAddress) {
    await sendMessage(
      tokenInput,
      [
        "❌ <b>Invalid Input</b>",
        "",
        "No token address provided.",
        "",
        "<i>Purchase cancelled.</i>",
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  try {
    new PublicKey(tokenAddress); // Validate address
  } catch (error) {
    await sendMessage(
      tokenInput,
      [
        "❌ <b>Invalid Token Address</b>",
        "",
        "The provided address is not a valid Solana address.",
        "",
        "<i>Please check the address and try again.</i>",
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  // Check if this token is already being launched by someone
  const { checkTokenAddressUsage } = await import("../../backend/functions");
  const usage = await checkTokenAddressUsage(tokenAddress);

  if (usage.isUsed && usage.state && usage.state !== "LAUNCHED") {
    await sendMessage(
      tokenInput,
      [
        "⚠️ <b>Token Launch in Progress</b>",
        "",
        `This token is currently being launched${usage.tokenName ? ` (<b>${usage.tokenName}</b>)` : ""}.`,
        "",
        "⏳ <b>Please wait</b> for the launch to complete before attempting to buy.",
        "",
        "<i>💡 You can only purchase tokens that are already launched or available on the market.</i>",
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  // Get funding wallet for external token purchases
  const fundingWallet = await getFundingWallet(user.id);

  if (!fundingWallet) {
    await sendMessage(
      tokenInput,
      [
        "❌ <b>No Funding Wallet</b>",
        "",
        "No funding wallet available for purchase.",
        "",
        "⚙️ Please configure a funding wallet first.",
        "",
        "<i>Use the wallet management menu to set up your funding wallet.</i>",
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  // Check funding wallet balance
  const fundingBalance = await getWalletBalance(fundingWallet.publicKey);

  if (fundingBalance < 0.001) {
    await sendMessage(
      tokenInput,
      [
        "❌ <b>Insufficient Balance</b>",
        "",
        "💰 <b>Current Balance:</b> <code>" +
          fundingBalance.toFixed(6) +
          " SOL</code>",
        "⚡ <b>Minimum Required:</b> <code>0.001 SOL</code>",
        "",
        "<i>Please fund your wallet before proceeding.</i>",
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  await sendMessage(
    tokenInput,
    [
      "💰 <b>External Token Purchase</b>",
      "",
      "🎯 <b>Step 2:</b> Purchase Amount",
      "",
      "📍 <b>Token Address:</b>",
      `<code>${tokenAddress}</code>`,
      "",
      "💳 <b>Funding Wallet Balance:</b> <code>" +
        fundingBalance.toFixed(6) +
        " SOL</code>",
      "",
      "💵 <b>How much SOL would you like to spend?</b>",
      "",
      "<i>💡 Reserve at least 0.001 SOL for transaction fees</i>",
    ].join("\n"),
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
    await sendMessage(
      amountInput,
      "❌ <b>Purchase Cancelled</b>\n\nExternal token purchase has been cancelled.",
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  const buyAmountText = amountInput.message?.text?.trim();
  if (!buyAmountText) {
    await sendMessage(
      amountInput,
      [
        "❌ <b>Invalid Input</b>",
        "",
        "No amount provided.",
        "",
        "<i>Purchase cancelled.</i>",
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  const buyAmount = parseFloat(buyAmountText);
  if (isNaN(buyAmount) || buyAmount <= 0) {
    await sendMessage(
      amountInput,
      [
        "❌ <b>Invalid Amount</b>",
        "",
        "Please enter a valid positive number.",
        "",
        "<i>Purchase cancelled.</i>",
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  if (buyAmount > fundingBalance - 0.001) {
    await sendMessage(
      amountInput,
      [
        "❌ <b>Insufficient Balance</b>",
        "",
        "💵 <b>Requested Amount:</b> <code>" +
          buyAmount.toFixed(6) +
          " SOL</code>",
        "💳 <b>Available Balance:</b> <code>" +
          fundingBalance.toFixed(6) +
          " SOL</code>",
        "",
        "<i>Please reduce the amount or fund your wallet.</i>",
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  // Confirm purchase with funding wallet
  await sendMessage(
    amountInput,
    [
      "🔍 <b>Confirm External Token Purchase</b>",
      "",
      "📍 <b>Token Address:</b>",
      `<code>${tokenAddress}</code>`,
      "",
      "💵 <b>Purchase Amount:</b> <code>" +
        buyAmount.toFixed(6) +
        " SOL</code>",
      "💳 <b>Payment Method:</b> <code>Funding Wallet</code>",
      "",
      "⚡ <b>Are you ready to proceed?</b>",
      "",
      "<i>⚠️ This action cannot be undone</i>",
    ].join("\n"),
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
    await sendMessage(
      confirmation,
      "❌ <b>Purchase Cancelled</b>\n\nExternal token purchase has been cancelled.",
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  if (confirmation.callbackQuery?.data === "confirm_external_buy") {
    try {
      await sendMessage(
        confirmation,
        [
          "🔄 <b>Processing Purchase</b>",
          "",
          "⏳ Executing external token purchase...",
          "",
          "<i>Please wait while we process your transaction</i>",
        ].join("\n"),
        { parse_mode: "HTML" }
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
          [
            "✅ <b>Purchase Successful!</b>",
            "",
            "🎉 Your external token purchase has been completed successfully.",
            "",
            "💵 <b>Amount Spent:</b> <code>" +
              buyAmount.toFixed(6) +
              " SOL</code>",
            "🔗 <b>Platform:</b> <code>" + platformText + "</code>",
            "",
            "📍 <b>Token Address:</b>",
            `<code>${tokenAddress}</code>`,
            "",
            "📝 <b>Transaction Signature:</b>",
            `<code>${result.signature}</code>`,
            "",
            "💡 <i>Your tokens should appear in your wallet shortly.</i>",
          ].join("\n"),
          { parse_mode: "HTML" }
        );
      } else {
        await sendMessage(
          confirmation,
          [
            "❌ <b>Purchase Failed</b>",
            "",
            "Unfortunately, your external token purchase could not be completed.",
            "",
            "🔍 <b>Error Details:</b>",
            `<code>${result.error || "Unknown error occurred"}</code>`,
            "",
            "<i>Please try again or contact support if the issue persists.</i>",
          ].join("\n"),
          {
            parse_mode: "HTML",
            reply_markup: new InlineKeyboard()
              .text("🔄 Retry Purchase", "retry_external_buy")
              .row()
              .text("❌ Cancel", CallBackQueries.CANCEL_EXTERNAL_BUY),
          }
        );

        // Handle retry or cancel
        const retryResponse = await conversation.waitFor("callback_query:data");
        await retryResponse.answerCallbackQuery();

        if (retryResponse.callbackQuery?.data === "retry_external_buy") {
          await sendMessage(
            retryResponse,
            [
              "🔄 <b>Retrying Purchase</b>",
              "",
              "⏳ Attempting to purchase the token again...",
              "",
              "<i>Please wait while we process your transaction</i>",
            ].join("\n"),
            { parse_mode: "HTML" }
          );

          const retryResult = await executeExternalBuy(
            tokenAddress,
            keypair,
            buyAmount,
            3,
            0.002,
            retryResponse
          );

          if (retryResult.success) {
            const platformText =
              retryResult.platform === "pumpswap"
                ? "⚡ Pumpswap"
                : "🚀 PumpFun";
            await sendMessage(
              retryResponse,
              [
                "✅ <b>Purchase Successful!</b>",
                "",
                "🎉 Your external token purchase has been completed successfully.",
                "",
                "💵 <b>Amount Spent:</b> <code>" +
                  buyAmount.toFixed(6) +
                  " SOL</code>",
                "🔗 <b>Platform:</b> <code>" + platformText + "</code>",
                "",
                "📍 <b>Token Address:</b>",
                `<code>${tokenAddress}</code>`,
                "",
                "📝 <b>Transaction Signature:</b>",
                `<code>${retryResult.signature}</code>`,
                "",
                "💡 <i>Your tokens should appear in your wallet shortly.</i>",
              ].join("\n"),
              { parse_mode: "HTML" }
            );
          } else {
            await sendMessage(
              retryResponse,
              [
                "❌ <b>Retry Failed</b>",
                "",
                "The purchase attempt failed again.",
                "",
                "🔍 <b>Error Details:</b>",
                `<code>${retryResult.error || "Unknown error occurred"}</code>`,
                "",
                "<i>Please contact support for assistance.</i>",
              ].join("\n"),
              { parse_mode: "HTML" }
            );
          }
        }
        // If cancel is selected, the conversation will naturally halt
      }
    } catch (error: any) {
      await sendMessage(
        confirmation,
        [
          "❌ <b>Purchase Failed</b>",
          "",
          "Unfortunately, your external token purchase could not be completed.",
          "",
          "🔍 <b>Error Details:</b>",
          `<code>${result.error || "Unknown error occurred"}</code>`,
          "",
          "<i>Please try again or contact support if the issue persists.</i>",
        ].join("\n"),
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text("🔄 Retry Purchase", "retry_external_buy")
            .row()
            .text("❌ Cancel", CallBackQueries.CANCEL_EXTERNAL_BUY),
        }
      );

      // Handle retry or cancel
      const retryResponse = await conversation.waitFor("callback_query:data");
      await retryResponse.answerCallbackQuery();

      if (retryResponse.callbackQuery?.data === "retry_external_buy") {
        await sendMessage(
          retryResponse,
          [
            "🔄 <b>Retrying Purchase</b>",
            "",
            "⏳ Attempting to purchase the token again...",
            "",
            "<i>Please wait while we process your transaction</i>",
          ].join("\n"),
          { parse_mode: "HTML" }
        );

        const retryResult = await executeExternalBuy(
          tokenAddress,
          keypair,
          buyAmount,
          3,
          0.002,
          retryResponse
        );

        if (retryResult.success) {
          const platformText =
            retryResult.platform === "pumpswap" ? "⚡ Pumpswap" : "🚀 PumpFun";
          await sendMessage(
            retryResponse,
            [
              "✅ <b>Purchase Successful!</b>",
              "",
              "🎉 Your external token purchase has been completed successfully.",
              "",
              "💵 <b>Amount Spent:</b> <code>" +
                buyAmount.toFixed(6) +
                " SOL</code>",
              "🔗 <b>Platform:</b> <code>" + platformText + "</code>",
              "",
              "📍 <b>Token Address:</b>",
              `<code>${tokenAddress}</code>`,
              "",
              "📝 <b>Transaction Signature:</b>",
              `<code>${retryResult.signature}</code>`,
              "",
              "💡 <i>Your tokens should appear in your wallet shortly.</i>",
            ].join("\n"),
            { parse_mode: "HTML" }
          );
        } else {
          await sendMessage(
            retryResponse,
            [
              "❌ <b>Retry Failed</b>",
              "",
              "The purchase attempt failed again.",
              "",
              "🔍 <b>Error Details:</b>",
              `<code>${retryResult.error || "Unknown error occurred"}</code>`,
              "",
              "<i>Please contact support for assistance.</i>",
            ].join("\n"),
            { parse_mode: "HTML" }
          );
        }
      }
      // If cancel is selected, the conversation will naturally halt
    }
  }

  conversation.halt();
};
