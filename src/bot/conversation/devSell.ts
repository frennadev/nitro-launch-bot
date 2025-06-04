import { type Conversation } from "@grammyjs/conversations";
import { type Context } from "grammy";
import { enqueueDevSell, getUser, getUserToken } from "../../backend/functions";
import { TokenState } from "../../backend/types";

const devSellConversation = async (
  conversation: Conversation,
  ctx: Context,
  tokenAddress: string,
) => {
  // --------- VALIDATE USER ---------
  const user = await getUser(ctx.chat!.id!.toString());
  if (!user) {
    await ctx.reply("Unrecognized user ❌");
    await conversation.halt();
    return;
  }

  // -------- VALIDATE TOKEN ----------
  const token = await getUserToken(user.id, tokenAddress);
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
  if (token.launchData?.lockDevSell === true) {
    await ctx.reply("Dev sell job is currently processing 😏");
    await conversation.halt();
    return;
  }

  // -------- Request & validate % of dev holdings to sell ----------
  await ctx.reply(
    "Enter the % of dev holdings to sell (must not be less than 1 or greater than 100): ",
    {
      parse_mode: "MarkdownV2",
    },
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
      await ctx.reply(
        "Invalid % entered ❌. Please re-enter a correct percentage: ",
      );
      updatedCtx = await conversation.waitFor("message:text");
    }
  }

  // ------ SEND DEV SELL DATA TO QUEUE -----
  const result = await enqueueDevSell(
    user.id,
    updatedCtx.message!.chat.id,
    tokenAddress,
    (token.launchData!.devWallet! as { privateKey: string }).privateKey,
    sellPercent,
  );
  if (!result.success) {
    await ctx.reply(
      "An error occurred while submitting dev sell details for execution ❌. Please try again..",
    );
  } else {
    await ctx.reply(
      "Dev sell details has been submitted for execution ✅.\nYou would get a message once your sell has been completed.",
    );
  }
};

export default devSellConversation;
