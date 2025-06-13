import { type Conversation } from "@grammyjs/conversations";
import { type Context, InlineKeyboard } from "grammy";
import {
  enqueueTokenLaunch,
  enqueueTokenLaunchRetry,
  getUser,
  getUserToken,
  preLaunchChecks,
  getFundingWallet,
  getAllBuyerWallets,
  getWalletBalance,
  saveRetryData,
  getRetryData,
  clearRetryData,
  calculateTotalLaunchCost,
  getDefaultDevWallet,
  getDevWallet,
} from "../../backend/functions-main";
import { TokenState } from "../../backend/types";
import { secretKeyToKeypair } from "../../blockchain/common/utils";
import { decryptPrivateKey } from "../../backend/utils";
import { CallBackQueries } from "../types";
import { env } from "../../config";

enum LaunchCallBackQueries {
  CANCEL = "CANCEL_LAUNCH",
  CONFIRM_LAUNCH = "CONFIRM_LAUNCH",
  RETRY = "RETRY_LAUNCH",
}

const cancelKeyboard = new InlineKeyboard().text("❌ Cancel", LaunchCallBackQueries.CANCEL);
const retryKeyboard = new InlineKeyboard()
  .text("🔄 Try Again", LaunchCallBackQueries.RETRY)
  .row()
  .text("❌ Cancel", LaunchCallBackQueries.CANCEL);

async function sendMessage(ctx: Context, text: string, options: any = {}) {
  await ctx.reply(text, options);
}

async function waitForInputOrCancel(
  conversation: Conversation,
  ctx: Context,
  prompt: string,
  parseMode: string = "HTML"
) {
  await sendMessage(ctx, prompt, {
    parse_mode: parseMode,
    reply_markup: cancelKeyboard,
  });

  const input = await conversation.waitFor(["message:text", "callback_query:data"]);
  if (input.callbackQuery?.data === LaunchCallBackQueries.CANCEL) {
    await sendMessage(ctx, "Process cancelled. Returning to the beginning.");
    await conversation.halt();
    return null;
  }
  return input;
}

const launchTokenConversation = async (conversation: Conversation, ctx: Context, tokenAddress: string) => {
  // --------- VALIDATE USER ---------
  const user = await getUser(ctx.chat!.id!.toString());
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    await conversation.halt();
    return;
  }

  // Check if this is a retry attempt
  const existingRetryData = await getRetryData(user.id, "launch_token");
  const isRetry = existingRetryData !== null;
  
  console.log("Launch Token - Retry check:", { isRetry, existingRetryData });

  // -------- VALIDATE TOKEN ----------
  const token = await getUserToken(user.id, tokenAddress);
  if (!token) {
    await sendMessage(ctx, "Token not found ❌");
    await conversation.halt();
    return;
  }
  if (token.state === TokenState.LAUNCHING) {
    await sendMessage(ctx, "Token is currently launching 🔄");
    await conversation.halt();
    return;
  }
  if (token.state === TokenState.LAUNCHED) {
    await sendMessage(ctx, "Token is already launched 🚀");
    await conversation.halt();
    return;
  }

  // -------- FOR RETRIES -------
  if ((token.launchData?.launchStage || 1) > 1) {
    const result = await enqueueTokenLaunchRetry(user.id, Number(user.telegramId), token.tokenAddress);
    if (!result.success) {
      await sendMessage(ctx, "An error occurred while submitting token launch for retry ❌. Please try again..");
    } else {
      await sendMessage(
        ctx,
        "Token Launch details has been submitted for retry ✅.\nYou would get a message once your launch has been completed."
      );
    }
    await conversation.halt();
    return;
  }

  // -------- GET FUNDING WALLET ----------
  const fundingWallet = await getFundingWallet(user.id);
  if (!fundingWallet) {
    await sendMessage(ctx, "❌ No funding wallet found. Please configure your funding wallet in Wallet Config first.");
    await conversation.halt();
    return;
  }

  // -------- GET BUYER WALLETS ----------
  const buyerWallets = await getAllBuyerWallets(user.id);
  if (buyerWallets.length === 0) {
    await sendMessage(ctx, "❌ No buyer wallets found. Please add buyer wallets in Wallet Config first.");
    await conversation.halt();
    return;
  }

  // -------- CHECK DEV WALLET BALANCE ----------
  const devWalletAddress = await getDefaultDevWallet(String(user.id));
  const devBalance = await getWalletBalance(devWalletAddress);
  const minDevBalance = env.LAUNCH_FEE_SOL + 0.1; // Platform fee + buffer (hidden from user)

  if (devBalance < minDevBalance) {
    await sendMessage(ctx, `❌ <b>Insufficient dev wallet balance!</b>

💰 <b>Required:</b> At least ${minDevBalance.toFixed(4)} SOL
💳 <b>Available:</b> ${devBalance.toFixed(4)} SOL

<b>Your dev wallet needs funding for token creation and dev buy operations.</b>

<b>Please fund your dev wallet:</b>
<code>${devWalletAddress}</code>

<i>💡 Tap the address above to copy it</i>`, { parse_mode: "HTML", reply_markup: retryKeyboard });

    // Wait for retry or cancel
    const response = await conversation.waitFor("callback_query:data");
    await response.answerCallbackQuery();
    
    if (response.callbackQuery?.data === LaunchCallBackQueries.RETRY) {
      // Exit conversation and let user manually retry from tokens list
      await sendMessage(response, "🔄 Please fund your dev wallet and try launching again from your tokens list.");
      await conversation.halt();
      return;
    } else {
      await sendMessage(response, "Process cancelled.");
      await conversation.halt();
      return;
    }
  }

  // -------- CHECK FUNDING WALLET BALANCE ----------
  const fundingBalance = await getWalletBalance(fundingWallet.publicKey);
  await sendMessage(ctx, `💳 Using funding wallet: ${fundingWallet.publicKey.slice(0, 6)}...${fundingWallet.publicKey.slice(-4)}\n💰 Balance: ${fundingBalance.toFixed(4)} SOL\n👥 Using ${buyerWallets.length} buyer wallets`);

  let buyAmount = 0;
  let devBuy = 0;

  // Use stored values if this is a retry, otherwise get new input
  if (isRetry && existingRetryData) {
    buyAmount = existingRetryData.buyAmount;
    devBuy = existingRetryData.devBuy;
    await sendMessage(ctx, `🔄 <b>Retrying with previous values:</b>
• <b>Buy Amount:</b> ${buyAmount} SOL
• <b>Dev Buy:</b> ${devBuy} SOL`, { parse_mode: "HTML" });
    
    // Clear retry data after use
    await clearRetryData(user.id, "launch_token");
  } else {
    // -------- GET BUY AMOUNT --------
    await sendMessage(ctx, "💰 Enter the total SOL amount to buy tokens with (e.g., 1.5):", { reply_markup: cancelKeyboard });

    while (true) {
      const buyAmountCtx = await conversation.waitFor(["message:text", "callback_query:data"]);
      
      if (buyAmountCtx.callbackQuery?.data === LaunchCallBackQueries.CANCEL) {
        await buyAmountCtx.answerCallbackQuery();
        await sendMessage(ctx, "Launch cancelled.");
        return conversation.halt();
      }
      
      if (buyAmountCtx.message?.text) {
        const parsed = parseFloat(buyAmountCtx.message.text);
        if (isNaN(parsed) || parsed <= 0) {
          await sendMessage(ctx, "❌ Invalid amount. Please enter a positive number:");
        } else if (parsed > 50) {
          await sendMessage(ctx, "⚠️ Amount seems very high. Please enter a reasonable amount (0.1-50 SOL):");
        } else {
          buyAmount = parsed;
          break;
        }
      }
    }

    // -------- GET DEV BUY AMOUNT --------
    await sendMessage(ctx, `💎 Enter SOL amount for dev to buy (0 to skip, recommended: 10-20% of buy amount = ${(buyAmount * 0.15).toFixed(3)} SOL):`, { reply_markup: cancelKeyboard });

    while (true) {
      const devBuyCtx = await conversation.waitFor(["message:text", "callback_query:data"]);
      
      if (devBuyCtx.callbackQuery?.data === LaunchCallBackQueries.CANCEL) {
        await devBuyCtx.answerCallbackQuery();
        await sendMessage(ctx, "Launch cancelled.");
        return conversation.halt();
      }
      
      if (devBuyCtx.message?.text) {
        const parsed = parseFloat(devBuyCtx.message.text);
        if (isNaN(parsed) || parsed < 0) {
          await sendMessage(ctx, "❌ Invalid amount. Please enter 0 or a positive number:");
        } else if (parsed > buyAmount) {
          await sendMessage(ctx, "⚠️ Dev buy amount should not exceed total buy amount. Please enter a smaller amount:");
        } else {
          devBuy = parsed;
          break;
        }
      }
    }

    // Store retry data for potential retry
    await saveRetryData(user.id, ctx.chat!.id!.toString(), "launch_token", {
      tokenAddress,
      buyAmount,
      devBuy
    });
  }

  // -------- CALCULATE TOTAL COSTS --------
  const costBreakdown = calculateTotalLaunchCost(buyAmount, devBuy, buyerWallets.length, false); // Don't show platform fee to user
  const requiredFundingAmount = costBreakdown.totalCost; // User sees total without knowing about hidden fee

  // Check funding wallet balance
  if (fundingBalance < requiredFundingAmount) {
    await sendMessage(ctx, `❌ <b>Insufficient funding wallet balance!</b>

💰 <b>Cost Breakdown:</b>
• Buy Amount: ${costBreakdown.breakdown.buyAmount} SOL
• Dev Buy: ${costBreakdown.breakdown.devBuy} SOL  
• Wallet Fees: ${costBreakdown.breakdown.walletFees} SOL
• Buffer: ${costBreakdown.breakdown.buffer} SOL

<b>Funding Wallet Required:</b> ${requiredFundingAmount.toFixed(4)} SOL
<b>Funding Wallet Available:</b> ${fundingBalance.toFixed(4)} SOL

<b>Please fund your wallet:</b>
<code>${fundingWallet.publicKey}</code>

<i>💡 Tap the address above to copy it, then send the required SOL and try again.</i>`, { parse_mode: "HTML", reply_markup: retryKeyboard });

    // Wait for retry or cancel
    const response = await conversation.waitFor("callback_query:data");
    await response.answerCallbackQuery();
    
    if (response.callbackQuery?.data === LaunchCallBackQueries.RETRY) {
      // Exit conversation and let user manually retry from tokens list
      await sendMessage(response, "🔄 Please check your wallet balance and try launching again from your tokens list.");
      await conversation.halt();
      return;
    } else {
      await sendMessage(response, "Process cancelled.");
      await clearRetryData(user.id, "launch_token");
      await conversation.halt();
      return;
    }
  }

  // ------- CHECKS BEFORE LAUNCH ------
  await sendMessage(ctx, "Performing prelaunch checks 🔃...");
  
  // Get buyer wallet private keys
  const { WalletModel } = await import("../../backend/models");
  const buyerWalletDocs = await WalletModel.find({
    user: user.id,
    isBuyer: true,
  }).lean();
  
  const buyerKeys = buyerWalletDocs.map(w => decryptPrivateKey(w.privateKey));
  
  const checkResult = await preLaunchChecks(
    fundingWallet.privateKey,
    (token.launchData!.devWallet! as unknown as { privateKey: string }).privateKey,
    buyAmount,
    devBuy,
    buyerKeys.length
  );
  if (!checkResult.success) {
    await sendMessage(
      ctx,
      `❌ <b>PreLaunch checks failed</b>

Please resolve the issues below and retry:

${checkResult.message}`, { parse_mode: "HTML", reply_markup: retryKeyboard }
    );

    // Wait for retry or cancel
    const response = await conversation.waitFor("callback_query:data");
    await response.answerCallbackQuery();
    
    if (response.callbackQuery?.data === LaunchCallBackQueries.RETRY) {
      // Exit conversation and let user manually retry from tokens list
      await sendMessage(response, "🔄 Please resolve the issues and try launching again from your tokens list.");
      await conversation.halt();
      return;
    } else {
      await sendMessage(response, "Process cancelled.");
      await clearRetryData(user.id, "launch_token");
      await conversation.halt();
      return;
    }
  }

  // ------ SEND LAUNCH DATA TO QUEUE -----
  const result = await enqueueTokenLaunch(
    user.id,
    ctx.chat!.id,
    tokenAddress,
    fundingWallet.privateKey,
    (token.launchData!.devWallet! as unknown as { privateKey: string }).privateKey,
    buyerKeys,
    devBuy,
    buyAmount
  );
  if (!result.success) {
    await sendMessage(ctx, "An error occurred while submitting launch details for execution ❌. Please try again..");
  } else {
    await sendMessage(
      ctx,
      "Token Launch details has been submitted for execution ✅.\nYou would get a message once your launch has been completed."
    );
  }
};

export default launchTokenConversation;
