import { type Conversation } from "@grammyjs/conversations";
import { type Context } from "grammy";
import {
  enqueueDevSell,
  getUser,
  getUserToken,
} from "../../backend/functions-main";
import { TokenState } from "../../backend/types";
import { startLoadingState, sendLoadingMessage } from "../loading";
import { decryptPrivateKey } from "../../backend/utils";
import { sendErrorWithAutoDelete } from "../utils";
import { sendMessage } from "../../backend/sender";
import { logger } from "../../utils/logger";

const devSellConversation = async (
  conversation: Conversation,
  ctx: Context,
  tokenAddress: string
) => {
  await ctx.answerCallbackQuery();
  // --------- VALIDATE USER ---------
  const user = await getUser(ctx.chat!.id!.toString());
  if (!user) {
    await sendErrorWithAutoDelete(ctx, "Unrecognized user ❌");
    await conversation.halt();
    return;
  }

  // -------- VALIDATE TOKEN ----------
  const token = await getUserToken(user.id, tokenAddress);
  if (!token) {
    await sendErrorWithAutoDelete(ctx, "Token not found ❌");
    await conversation.halt();
    return;
  }
  if (token.state !== TokenState.LAUNCHED) {
    await sendMessage(ctx, "Token is not launched yet 😑");
    await conversation.halt();
    return;
  }
  if (token.launchData?.lockDevSell === true) {
    await sendMessage(ctx, "Dev sell job is currently processing 😏");
    await conversation.halt();
    return;
  }

  // -------- Request & validate % of dev holdings to sell ----------
  await sendMessage(
    ctx,
    "Enter the % of dev holdings to sell \\(must not be less than 1 or greater than 100\\): ",
    {
      parse_mode: "MarkdownV2",
    }
  );
  let updatedCtx = await conversation.waitFor("message:text");
  let sellPercent = 0;
  let isValid = false;
  while (!isValid) {
    try {
      sellPercent = parseFloat(updatedCtx.message.text);
      if (sellPercent > 100 || sellPercent < 1)
        throw new Error("Invalid percentage");
      isValid = true;
    } catch (error) {
      await sendMessage(
        ctx,
        "Invalid % entered ❌. Please re-enter a correct percentage: "
      );
      updatedCtx = await conversation.waitFor("message:text");
    }
  }

  // ------ SEND DEV SELL DATA TO QUEUE WITH LOADING STATE -----
  const submitLoading = await sendLoadingMessage(
    ctx,
    "💰 **Submitting dev sell...**\n\n⏳ Preparing transaction..."
  );

  try {
    // FIXED: Properly decrypt dev wallet private key
    const devWalletPrivateKey = decryptPrivateKey(
      (token.launchData!.devWallet! as any).privateKey
    );

    const result = await enqueueDevSell(
      user.id,
      updatedCtx.message!.chat.id,
      tokenAddress,
      devWalletPrivateKey,
      sellPercent
    );

    if (!result.success) {
      await submitLoading.update(
        "❌ <b>Failed to submit dev sell</b>\n\nAn error occurred while submitting dev sell details for execution. Please try again."
      );
      await sendMessage(
        ctx,
        "An error occurred while submitting dev sell details for execution ❌. Please try again.."
      );
    } else {
      await submitLoading.update(
        "🎉 <b>Dev sell submitted successfully!</b>\n\n⏳ Your dev sell is now in the queue and will be processed shortly.\n\n📱 You'll receive a notification once the sell is completed."
      );

      // Start the loading state for the actual dev sell process
      await startLoadingState(ctx, "dev_sell", tokenAddress);
    }
  } catch (error: any) {
    await submitLoading.update(
      "❌ <b>Failed to decrypt dev wallet</b>\n\nThere was an issue accessing your dev wallet data. Please try again."
    );
    await sendErrorWithAutoDelete(
      ctx,
      `Dev wallet decryption error: ${error.message} ❌`
    );
  }
};

const devSell100Conversation = async (
  conversation: Conversation,
  ctx: Context,
  tokenAddress: string
) => {
  // Don't answer callback query here - already handled by main handler

  // --------- VALIDATE USER ---------
  const user = await getUser(ctx.chat!.id!.toString());
  if (!user) {
    await sendMessage(ctx, "❌ User not found");
    await conversation.halt();
    return;
  }

  // -------- VALIDATE TOKEN ----------
  const token = await getUserToken(user.id, tokenAddress);
  if (!token) {
    await sendMessage(ctx, "❌ Token not found");
    await conversation.halt();
    return;
  }

  if (token.state !== TokenState.LAUNCHED) {
    await sendMessage(ctx, "❌ Token is not launched yet");
    await conversation.halt();
    return;
  }

  if (token.launchData?.lockDevSell === true) {
    await sendMessage(
      ctx,
      "❌ Dev sell job is currently processing. Please wait..."
    );
    await conversation.halt();
    return;
  }

  // Send loading message
  const loadingMsg = await sendLoadingMessage(
    ctx,
    "💰 **Submitting 100% dev sell...**\n\n⏳ Adding to queue..."
  );

  try {
    // Get dev wallet private key
    const devWalletPrivateKey = decryptPrivateKey(
      (token.launchData!.devWallet! as any).privateKey
    );

    // Use the proper queue system for dev sell (100% = sell all)
    const result = await enqueueDevSell(
      user.id,
      ctx.chat!.id,
      tokenAddress,
      devWalletPrivateKey,
      100 // 100% dev sell
    );

    if (result.success) {
      await sendMessage(
        ctx,
        "🎉 <b>100% Dev Supply Sell Submitted!</b>\n\n⏳ Your dev sell is now in the queue and will be processed shortly.\n\n📱 You'll receive a notification once the sell is completed."
      );

      // Start the loading state for the actual dev sell process
      await startLoadingState(ctx, "dev_sell", tokenAddress);
    } else {
      await sendMessage(
        ctx,
        `❌ <b>Failed to submit 100% dev sell</b>\n\n🔍 <b>Error:</b> ${result.message}\n\n💡 <b>Try:</b> Use the regular "Sell Dev Supply" button for custom amounts.`
      );
    }
  } catch (error: any) {
    logger.error("Error in 100% dev sell conversation:", error);
    await sendMessage(
      ctx,
      `❌ <b>Failed to process 100% dev sell</b>\n\n🔍 <b>Error:</b> ${error.message}\n\n💡 <b>Try:</b> Use the regular "Sell Dev Supply" button for custom amounts.`
    );
  }

  await conversation.halt();
};

export { devSellConversation, devSell100Conversation };
