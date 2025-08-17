import { type Conversation } from "@grammyjs/conversations";
import { type Context } from "grammy";
import {
  enqueueWalletSell,
  getUser,
  getUserTokenWithBuyWallets,
} from "../../backend/functions-main";
import { TokenState } from "../../backend/types";
import { startLoadingState, sendLoadingMessage } from "../loading";
import { decryptPrivateKey } from "../../backend/utils";
import { sendErrorWithAutoDelete } from "../utils";
import { sendMessage } from "../../backend/sender";

const walletSellConversation = async (
  conversation: Conversation,
  ctx: Context,
  tokenAddress: string,
  sellPercent?: number
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
  const token = await getUserTokenWithBuyWallets(user.id, tokenAddress);
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
  if (token.launchData?.lockWalletSell === true) {
    await conversation.halt();
    return;
  }

  // -------- Request & validate % of wallet holdings to sell ----------
  if (!sellPercent) {
    await sendMessage(
      ctx,
      "Enter the % of wallet holdings to sell \\(must not be less than 1 or greater than 100\\): ",
      {
        parse_mode: "MarkdownV2",
      }
    );
    let updatedCtx = await conversation.waitFor("message:text");
    sellPercent = 0;
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
  }

  // ------ SEND WALLET SELL DATA TO QUEUE WITH LOADING STATE -----
  const submitLoading = await sendLoadingMessage(
    ctx,
    "💸 **Submitting wallet sells...**\n\n⏳ Preparing transactions..."
  );

  try {
    // FIXED: Properly decrypt private keys from populated wallet documents
    const buyWallets = token.launchData!.buyWallets.map((wallet: any) => {
      if (!wallet.privateKey) {
        throw new Error("Wallet private key not found in database");
      }
      return decryptPrivateKey(wallet.privateKey);
    });

    // FIXED: Properly decrypt dev wallet private key
    const devWalletPrivateKey = decryptPrivateKey(
      (token.launchData!.devWallet! as any).privateKey
    );

    const result = await enqueueWalletSell(
      user.id,
      Number(user.telegramId),
      tokenAddress,
      devWalletPrivateKey,
      buyWallets,
      sellPercent
    );

    if (!result.success) {
      await submitLoading.update(
        "❌ <b>Failed to submit wallet sells</b>\n\nAn error occurred while submitting wallet sell details for execution. Please try again."
      );
      await sendMessage(
        ctx,
        "An error occurred while submitting wallet sell details for execution ❌. Please try again.."
      );
    } else {
      await submitLoading.update(
        "🎉 <b>Wallet sells submitted successfully!</b>\n\n⏳ Your wallet sells are now in the queue and will be processed shortly.\n\n📱 You'll receive a notification once the sells are completed."
      );

      // Start the loading state for the actual wallet sell process
      await startLoadingState(ctx, "wallet_sell", tokenAddress);
    }
  } catch (error: any) {
    await submitLoading.update(
      "❌ <b>Failed to decrypt wallet keys</b>\n\nThere was an issue accessing your wallet data. Please try again."
    );
    await sendErrorWithAutoDelete(
      ctx,
      `Wallet decryption error: ${error.message} ❌`
    );
  }
};

export default walletSellConversation;
