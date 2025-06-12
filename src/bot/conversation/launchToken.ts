import { type Conversation } from "@grammyjs/conversations";
import { type Context, InlineKeyboard } from "grammy";
import {
  enqueueTokenLaunch,
  enqueueTokenLaunchRetry,
  getUser,
  getUserToken,
  preLaunchChecks,
} from "../../backend/functions";
import { TokenState } from "../../backend/types";
import { secretKeyToKeypair } from "../../blockchain/common/utils";

enum CallBackQueries {
  CANCEL = "CANCEL_LAUNCH_PROCESS",
}

const cancelKeyboard = new InlineKeyboard().text("❌ Cancel", CallBackQueries.CANCEL);

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
  if (input.callbackQuery?.data === CallBackQueries.CANCEL) {
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

  // -------- REQUEST & VALIDATE FUNDER WALLET ----------
  let funderKey = "";
  let isValidKey = false;
  while (!isValidKey) {
    const updatedCtx = await waitForInputOrCancel(conversation, ctx, "Enter the private key of the funder wallet:");
    if (!updatedCtx) return;
    try {
      funderKey = updatedCtx?.message!.text;
      secretKeyToKeypair(funderKey);
      isValidKey = true;
    } catch {
      await sendMessage(ctx, "Invalid private key entered ❌. Please re-enter a correct private key:");
    }
  }

  // ------- REQUEST & VALIDATE BUY WALLETS -------
  let buyerKeys: string[] = [];
  let success = false;
  while (!success) {
    const updatedCtx = await waitForInputOrCancel(
      conversation,
      ctx,
      "Enter the private key of the buy wallets comma separated.\nExample: key1,key2,key3,key4:"
    );
    if (!updatedCtx) return;
    try {
      buyerKeys = updatedCtx?.message!.text.split(",");
      buyerKeys.map((pk) => secretKeyToKeypair(pk));
      success = true;
    } catch {
      await sendMessage(ctx, "One or more private keys are invalid ❌. Please re-enter correct private keys:");
    }
  }

  // -------- REQUEST & VALIDATE BUY AMOUNT ------
  let buyAmount = 0;
  let isValidAmount = false;
  while (!isValidAmount) {
    const updatedCtx = await waitForInputOrCancel(conversation, ctx, "Enter the amount in sol to buy for all wallets:");
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
  let devBuy = 0;
  let isValidDevAmount = false;
  while (!isValidDevAmount) {
    const updatedCtx = await waitForInputOrCancel(
      conversation,
      ctx,
      "Enter amount in sol to buy from dev wallet (enter 0 to skip):"
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

  // ------- CHECKS BEFORE LAUNCH ------
  await sendMessage(ctx, "Performing prelaunch checks 🔃...");
  const checkResult = await preLaunchChecks(
    funderKey,
    (token.launchData!.devWallet! as unknown as { privateKey: string }).privateKey,
    buyAmount,
    devBuy,
    buyerKeys.length
  );
  if (!checkResult.success) {
    await sendMessage(
      ctx,
      "PreLaunch checks failed ❌.\nKindly resolve the issues below and retry\n\n" + checkResult.message
    );
    await conversation.halt();
    return;
  }

  // ------ SEND LAUNCH DATA TO QUEUE -----
  const result = await enqueueTokenLaunch(
    user.id,
    ctx.chat!.id,
    tokenAddress,
    funderKey,
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
