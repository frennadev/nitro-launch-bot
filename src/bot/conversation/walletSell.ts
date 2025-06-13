import { type Conversation } from "@grammyjs/conversations";
import { type Context } from "grammy";
import {
  enqueueWalletSell,
  getUser,
  getUserTokenWithBuyWallets,
} from "../../backend/functions-main";
import { TokenState } from "../../backend/types";
import { startLoadingState, sendLoadingMessage } from "../loading";

const walletSellConversation = async (
  conversation: Conversation,
  ctx: Context,
  tokenAddress: string,
  sellPercent?: number,
) => {
  // --------- VALIDATE USER ---------
  const user = await getUser(ctx.chat!.id!.toString());
  if (!user) {
    await ctx.reply("Unrecognized user ❌");
    await conversation.halt();
    return;
  }

  // -------- VALIDATE TOKEN ----------
  const token = await getUserTokenWithBuyWallets(user.id, tokenAddress);
  if (!token) {
    await ctx.reply("Token not found ❌");
    await conversation.halt();
    return;
  }
  if (token.state !== TokenState.LAUNCHED) {
    await ctx.reply("Token is not launched yet 😑");
    await conversation.halt();
    return;
  }
  if (token.launchData?.lockWalletSell === true) {
    await ctx.reply("Wallet sell job is currently processing 😏");
    await conversation.halt();
    return;
  }

  // -------- Request & validate % of wallet holdings to sell ----------
  if (!sellPercent) {
    await ctx.reply(
      "Enter the % of wallet holdings to sell \\(must not be less than 1 or greater than 100\\): ",
      {
        parse_mode: "MarkdownV2",
      },
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
        await ctx.reply(
          "Invalid % entered ❌. Please re-enter a correct percentage: ",
        );
        updatedCtx = await conversation.waitFor("message:text");
      }
    }
  }

  // ------ SEND WALLET SELL DATA TO QUEUE WITH LOADING STATE -----
  const submitLoading = await sendLoadingMessage(ctx, "💸 **Submitting wallet sells...**\n\n⏳ Preparing transactions...");
  
  const buyWallets = token.launchData!.buyWallets.map(
    (w) => (w as unknown as { privateKey: string }).privateKey,
  );
  const result = await enqueueWalletSell(
    user.id,
    Number(user.telegramId),
    tokenAddress,
    (token.launchData!.devWallet! as unknown as { privateKey: string })
      .privateKey,
    buyWallets,
    sellPercent,
  );
  
  if (!result.success) {
    await submitLoading.update("❌ **Failed to submit wallet sells**\n\nAn error occurred while submitting wallet sell details for execution. Please try again.");
    await ctx.reply(
      "An error occurred while submitting wallet sell details for execution ❌. Please try again..",
    );
  } else {
    await submitLoading.update("🎉 **Wallet sells submitted successfully!**\n\n⏳ Your wallet sells are now in the queue and will be processed shortly.\n\n📱 You'll receive a notification once the sells are completed.");
    
    // Start the loading state for the actual wallet sell process
    await startLoadingState(ctx, "wallet_sell", tokenAddress);
  }
};

export default walletSellConversation;
