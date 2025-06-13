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
} from "../../backend/functions";
import { TokenState } from "../../backend/types";
import { secretKeyToKeypair } from "../../blockchain/common/utils";
import { decryptPrivateKey } from "../../backend/utils";
import { CallBackQueries } from "../types";

enum LaunchCallBackQueries {
  CANCEL = "CANCEL_LAUNCH_PROCESS",
  RETRY = "RETRY_LAUNCH_PROCESS",
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
    // -------- REQUEST & VALIDATE BUY AMOUNT ------
    let isValidAmount = false;
    while (!isValidAmount) {
      const updatedCtx = await waitForInputOrCancel(conversation, ctx, "Enter the amount in SOL to buy for all wallets:");
      if (!updatedCtx) return;
      const parsed = parseFloat(updatedCtx?.message!.text);
      if (isNaN(parsed) || parsed <= 0) {
        await sendMessage(ctx, "Invalid buyAmount. Please re-send:");
      } else {
        buyAmount = parsed;
        isValidAmount = true;
      }
    }

    // -------- REQUEST & VALIDATE DEV BUY --------
    let isValidDevAmount = false;
    while (!isValidDevAmount) {
      const updatedCtx = await waitForInputOrCancel(
        conversation,
        ctx,
        "Enter amount in SOL to buy from dev wallet (enter 0 to skip):"
      );
      if (!updatedCtx) return;
      const parsed = parseFloat(updatedCtx?.message!.text);
      if (isNaN(parsed) || parsed < 0) {
        await sendMessage(ctx, "Invalid devBuy. Please re-send:");
      } else {
        devBuy = parsed;
        isValidDevAmount = true;
      }
    }

    // Store the input for potential retry
    // await saveRetryData(user.id, "launch_token", { buyAmount, devBuy }); // Fixed - using correct call below
    // Store the input for potential retry
    await saveRetryData(user.id, ctx.chat!.id!.toString(), "launch_token", { 
      tokenAddress, 
      buyAmount, 
      devBuy 
    });
  }

  // -------- CHECK IF FUNDING WALLET HAS SUFFICIENT BALANCE ----------
  const requiredAmount = buyAmount + devBuy + (buyerWallets.length * 0.05) + 0.2; // Buy amount + dev buy + fees + buffer
  if (fundingBalance < requiredAmount) {
    await sendMessage(ctx, `❌ <b>Insufficient funding wallet balance!</b>

💰 <b>Required:</b> ~${requiredAmount.toFixed(4)} SOL
💳 <b>Available:</b> ${fundingBalance.toFixed(4)} SOL

<b>Please fund your wallet:</b>
<code>${fundingWallet.publicKey}</code>

<i>💡 Tap the address above to copy it, then send the required SOL and try again.</i>`, { parse_mode: "HTML", reply_markup: retryKeyboard });

    // Wait for retry or cancel
    const response = await conversation.waitFor("callback_query:data");
    console.log("Received callback data:", response.callbackQuery?.data);
    console.log("Expected retry data:", LaunchCallBackQueries.RETRY);
    if (response.callbackQuery?.data === LaunchCallBackQueries.RETRY) {
      await response.answerCallbackQuery();
      console.log("Retry button clicked - restarting conversation");
      // Restart the conversation with stored data
      return launchTokenConversation(conversation, ctx, tokenAddress);
    } else {
      await response.answerCallbackQuery();
      console.log("Cancel button clicked or unexpected data");
      await sendMessage(ctx, "Process cancelled.");
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
    console.log("Received callback data:", response.callbackQuery?.data);
    console.log("Expected retry data:", LaunchCallBackQueries.RETRY);
    if (response.callbackQuery?.data === LaunchCallBackQueries.RETRY) {
      await response.answerCallbackQuery();
      console.log("Retry button clicked - restarting conversation");
      // Restart the conversation with stored data
      return launchTokenConversation(conversation, ctx, tokenAddress);
    } else {
      await response.answerCallbackQuery();
      console.log("Cancel button clicked or unexpected data");
      await sendMessage(ctx, "Process cancelled.");
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
