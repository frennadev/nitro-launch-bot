import { type Conversation } from "@grammyjs/conversations";
import { type Context, InlineKeyboard } from "grammy";
import { getUser, getAllBuyerWallets, getFundingWallet, getWalletBalance } from "../../backend/functions";
import { CallBackQueries } from "../types";
import { sendMessage } from "../../backend/sender";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { env } from "../../config";
import { secretKeyToKeypair } from "../../blockchain/common/utils";
import { executeExternalBuy } from "../../blockchain/pumpfun/externalBuy";

// Buy External Token Conversation
export const buyExternalTokenConversation = async (conversation: Conversation<Context>, ctx: Context) => {
  await ctx.answerCallbackQuery();
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    return conversation.halt();
  }

  await sendMessage(ctx, "💰 <b>Buy External Token</b>\n\nPlease enter the token address you wish to buy:", {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard().text("❌ Cancel", CallBackQueries.CANCEL_EXTERNAL_BUY),
  });

  const tokenInput = await conversation.wait();
  if (tokenInput.callbackQuery?.data === CallBackQueries.CANCEL_EXTERNAL_BUY) {
    await tokenInput.answerCallbackQuery();
    await sendMessage(tokenInput, "External token purchase cancelled.");
    return conversation.halt();
  }

  const tokenAddress = tokenInput.message?.text?.trim();
  if (!tokenAddress) {
    await sendMessage(tokenInput, "❌ No token address provided. Purchase cancelled.");
    return conversation.halt();
  }

  try {
    new PublicKey(tokenAddress); // Validate address
  } catch (error) {
    await sendMessage(tokenInput, "❌ Invalid token address. Purchase cancelled.");
    return conversation.halt();
  }

  // Get buyer wallets and funding wallet
  const buyerWallets = await getAllBuyerWallets(user.id);
  const fundingWallet = await getFundingWallet(user.id);

  if (buyerWallets.length === 0 && !fundingWallet) {
    await sendMessage(
      tokenInput,
      "❌ No wallets available for purchase. Please configure at least one buyer wallet or funding wallet."
    );
    return conversation.halt();
  }

  // Calculate total balance available for buying
  let totalBalance = 0;
  const walletBalances: { wallet: any; balance: number; type: string }[] = [];

  if (fundingWallet) {
    const balance = await getWalletBalance(fundingWallet.publicKey);
    if (balance > 0.001) {
      walletBalances.push({ wallet: fundingWallet, balance, type: "Funding" });
      totalBalance += balance;
    }
  }

  for (const wallet of buyerWallets) {
    const balance = await getWalletBalance(wallet.publicKey);
    if (balance > 0.001) {
      walletBalances.push({ wallet, balance, type: "Buyer" });
      totalBalance += balance;
    }
  }

  if (totalBalance < 0.001) {
    await sendMessage(
      tokenInput,
      `❌ Insufficient balance in wallets to make a purchase.\n\n<b>Total Available Balance:</b> ${totalBalance.toFixed(6)} SOL\n<b>Minimum Required:</b> 0.001 SOL`,
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  await sendMessage(
    tokenInput,
    `💰 <b>Buy External Token</b>\n\n<b>Token Address:</b> <code>${tokenAddress}</code>\n<b>Total Available Balance:</b> ${totalBalance.toFixed(6)} SOL\n\nHow much SOL would you like to spend on this token?`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("❌ Cancel", CallBackQueries.CANCEL_EXTERNAL_BUY),
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
    await sendMessage(amountInput, "❌ No amount provided. Purchase cancelled.");
    return conversation.halt();
  }

  const buyAmount = parseFloat(buyAmountText);
  if (isNaN(buyAmount) || buyAmount <= 0) {
    await sendMessage(amountInput, "❌ Invalid amount. Purchase cancelled.");
    return conversation.halt();
  }

  if (buyAmount > totalBalance - 0.001) {
    await sendMessage(
      amountInput,
      `❌ Insufficient balance for the requested purchase amount.\n\n<b>Requested Amount:</b> ${buyAmount.toFixed(6)} SOL\n<b>Available Balance:</b> ${totalBalance.toFixed(6)} SOL`,
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  // Distribute the buy amount across available wallets
  const buyDistribution: { wallet: any; amount: number; type: string }[] = [];
  let remainingBuyAmount = buyAmount;

  // First use funding wallet if available
  const fundingBalanceEntry = walletBalances.find((wb) => wb.type === "Funding");
  if (fundingBalanceEntry) {
    const availableFromFunding = Math.min(fundingBalanceEntry.balance - 0.001, remainingBuyAmount);
    if (availableFromFunding > 0) {
      buyDistribution.push({ wallet: fundingBalanceEntry.wallet, amount: availableFromFunding, type: "Funding" });
      remainingBuyAmount -= availableFromFunding;
    }
  }

  // Then distribute across buyer wallets
  if (remainingBuyAmount > 0) {
    const buyerBalances = walletBalances.filter((wb) => wb.type === "Buyer");
    for (const wb of buyerBalances) {
      if (remainingBuyAmount <= 0) break;
      const availableFromWallet = Math.min(wb.balance - 0.001, remainingBuyAmount);
      if (availableFromWallet > 0) {
        buyDistribution.push({ wallet: wb.wallet, amount: availableFromWallet, type: "Buyer" });
        remainingBuyAmount -= availableFromWallet;
      }
    }
  }

  if (remainingBuyAmount > 0) {
    await sendMessage(
      amountInput,
      "❌ Could not distribute the buy amount across available wallets. Purchase cancelled."
    );
    return conversation.halt();
  }

  // Confirm purchase
  let distributionText = buyDistribution.map((d) => `<b>${d.type} Wallet</b>: ${d.amount.toFixed(6)} SOL`).join("\n");
  await sendMessage(
    amountInput,
    `🔍 <b>Confirm External Token Purchase</b>\n\n<b>Token Address:</b> <code>${tokenAddress}</code>\n<b>Total Buy Amount:</b> ${buyAmount.toFixed(6)} SOL\n\n<b>Distribution Across Wallets:</b>\n${distributionText}\n\nProceed with purchase?`,
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

  if (confirmation.callbackQuery?.data === CallBackQueries.CANCEL_EXTERNAL_BUY) {
    await sendMessage(confirmation, "External token purchase cancelled.");
    return conversation.halt();
  }

  if (confirmation.callbackQuery?.data === "confirm_external_buy") {
    try {
      await sendMessage(confirmation, "🔄 Processing external token purchase...");

      let successfulBuys = 0;
      let totalBought = 0;
      const failedBuys = [];

      for (const dist of buyDistribution) {
        try {
          const keypair = secretKeyToKeypair(dist.wallet.privateKey);
          const result = await executeExternalBuy(tokenAddress, keypair, dist.amount);
          successfulBuys++;
          totalBought += dist.amount;
          // Small delay between transactions to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 220));
        } catch (error: any) {
          failedBuys.push({ walletType: dist.type, amount: dist.amount, error: error.message });
        }
      }

      if (successfulBuys > 0) {
        await sendMessage(
          confirmation,
          `✅ <b>External Token Purchase Successful!</b>\n\n<b>Successful Purchases:</b> ${successfulBuys} out of ${buyDistribution.length} attempts\n<b>Total Amount Spent:</b> ${totalBought.toFixed(6)} SOL\n<b>Token Address:</b> <code>${tokenAddress}</code>`,
          { parse_mode: "HTML" }
        );
      } else {
        await sendMessage(
          confirmation,
          `❌ <b>External Token Purchase Failed</b>\n\nNo purchases could be completed.`,
          { parse_mode: "HTML" }
        );
      }

      if (failedBuys.length > 0) {
        await sendMessage(confirmation, `⚠️ <b>Failed Purchases:</b> ${failedBuys.length} attempt(s) failed.`, {
          parse_mode: "HTML",
        });
      }
    } catch (error: any) {
      await sendMessage(confirmation, `❌ External token purchase failed: ${error.message}`);
    }
  }

  conversation.halt();
};
