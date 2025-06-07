import { type Conversation } from "@grammyjs/conversations";
import { type Context } from "grammy";
import {
  enqueueTokenLaunch,
  enqueueTokenLaunchRetry,
  getUser,
  getUserToken,
  preLaunchChecks,
} from "../../backend/functions";
import { TokenState } from "../../backend/types";
import { secretKeyToKeypair } from "../../blockchain/common/utils";

const launchTokenConversation = async (
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
  if (token.state === TokenState.LAUNCHING) {
    await ctx.reply("Token is currently launching 🔄");
    await conversation.halt();
    return;
  }
  if (token.state === TokenState.LAUNCHED) {
    await ctx.reply("Token is already launched 🚀");
    await conversation.halt();
    return;
  }

  // -------- FOR RETRIES -------
  if ((token.launchData?.launchStage || 1) > 1) {
    const result = await enqueueTokenLaunchRetry(
      user.id,
      Number(user.telegramId),
      token.tokenAddress,
    );
    if (!result.success) {
      await ctx.reply(
        "An error occurred while submitting token launch for retry ❌. Please try again..",
      );
    } else {
      await ctx.reply(
        "Token Launch details has been submitted for retry ✅.\nYou would get a message once your launch has been completed.",
      );
    }
    await conversation.halt();
  }

  // -------- REQUEST & VALIDATE FUNDER WALLET ----------
  await ctx.reply("Enter the private key of the funder wallet: ", {
    parse_mode: "MarkdownV2",
  });
  let updatedCtx = await conversation.waitFor("message:text");
  let funderKey = "";
  let isValidKey = false;
  while (!isValidKey) {
    try {
      funderKey = updatedCtx.message.text;
      secretKeyToKeypair(funderKey);
      isValidKey = true;
    } catch (error) {
      await ctx.reply(
        "Invalid private key entered ❌. Please re-enter a correct private key: ",
      );
      updatedCtx = await conversation.waitFor("message:text");
    }
  }

  // ------- REQUEST & VALIDATE BUY WALLETS -------
  await ctx.reply(
    "Enter the private key of the buy wallets comma separated\\. \nExample: key1,key2,key3,key4: ",
    { parse_mode: "MarkdownV2" },
  );
  updatedCtx = await conversation.waitFor("message:text");
  let buyerKeys: string[] = [];
  let success = false;
  while (!success) {
    try {
      buyerKeys = updatedCtx.message.text.split(",");
      buyerKeys.map((pk) => secretKeyToKeypair(pk));
      success = true;
    } catch (error) {
      await ctx.reply(
        "One or more private keys are invalid ❌. Please re-enter correct private keys: ",
      );
      updatedCtx = await conversation.waitFor("message:text");
    }
  }

  // -------- REQUEST & VALIDATE BUY AMOUNT ------
  await ctx.reply("Enter the amount in sol to buy for all wallets: ", {
    parse_mode: "MarkdownV2",
  });
  updatedCtx = await conversation.waitFor("message:text");
  let buyAmount = 0;
  let isValidAmount = false;
  while (!isValidAmount) {
    const parsed = parseFloat(updatedCtx.message.text);
    if (isNaN(parsed) || parsed <= 0) {
      await ctx.reply("Invalid buyAmount. Please re-send: ");
      updatedCtx = await conversation.waitFor("message:text");
    } else {
      buyAmount = parsed;
      isValidAmount = true;
    }
  }

  // -------- REQUEST & VALIDATE DEV BUY --------
  await ctx.reply(
    "Enter amount in sol to buy from dev wallet \\(enter 0 to skip\\): ",
    { parse_mode: "MarkdownV2" },
  );
  updatedCtx = await conversation.waitFor("message:text");
  let devBuy = 0;
  let isValidDevAmount = false;
  while (!isValidDevAmount) {
    const parsed = parseFloat(updatedCtx.message.text);
    if (isNaN(parsed) || parsed < 0) {
      await ctx.reply("Invalid devBuy. Please re-send: ");
      updatedCtx = await conversation.waitFor("message:text");
    } else {
      devBuy = parsed;
      isValidDevAmount = true;
    }
  }

  // ------- CHECKS BEFORE LAUNCH ------
  await ctx.reply("Performing prelaunh checks 🔃...");
  const checkResult = await preLaunchChecks(
    funderKey,
    (token.launchData!.devWallet! as unknown as { privateKey: string })
      .privateKey,
    buyAmount,
    devBuy,
    buyerKeys.length,
  );
  if (!checkResult.success) {
    await ctx.reply(
      "PreLaunch checks failed ❌.\nKindly resolve the issues below and retry\n\n" +
        checkResult.message,
    );
    await conversation.halt();
  }

  // ------ SEND LAUNCH DATA TO QUEUE -----
  const result = await enqueueTokenLaunch(
    user.id,
    updatedCtx.message!.chat.id,
    tokenAddress,
    funderKey,
    (token.launchData!.devWallet! as unknown as { privateKey: string })
      .privateKey,
    buyerKeys,
    devBuy,
    buyAmount,
  );
  if (!result.success) {
    await ctx.reply(
      "An error occurred while submitting launch details for execution ❌. Please try again..",
    );
  } else {
    await ctx.reply(
      "Token Launch details has been submitted for execution ✅.\nYou would get a message once your launch has been completed.",
    );
  }
};

export default launchTokenConversation;
