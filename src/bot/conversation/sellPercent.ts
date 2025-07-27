import { Conversation } from "@grammyjs/conversations";
import { Context } from "grammy";
import { handleSingleSell } from "../../blockchain/common/singleSell";
import { PublicKey } from "@solana/web3.js";
import { sendErrorWithAutoDelete } from "../utils";
import { sendMessage } from "../../backend/sender";

export async function sellPercentageMessage(
  conversation: Conversation<Context>,
  ctx: Context,
  {
    tokenAddress,
    walletAddress,
  }: { tokenAddress: PublicKey; walletAddress: string }
) {
  await sendMessage(ctx, "How many percent do you want to sell");
  const res = await conversation.wait();

  const input = res.message?.text;
  const percentage = Number(input);

  if (!input || isNaN(percentage)) {
    await sendErrorWithAutoDelete(ctx, "❌ Please send a valid number.");
    return;
  }
  if (percentage > 100)
    return sendErrorWithAutoDelete(ctx, "❌ Amount should be 0 - 100");
  console.log("User sent percentage:", percentage);
  await sendMessage(ctx, "♻️ Please send a valid number.");
  const result = await handleSingleSell(
    tokenAddress,
    walletAddress,
    "percent",
    percentage / 100
  );
  if (!result)
    return sendErrorWithAutoDelete(
      ctx,
      "❌ Error selling all token in address"
    );
  const { success, signature } = result;
  if (success)
    return sendMessage(
      ctx,
      `✅ Sold ${percentage}% tokens in address.\n\nTransaction Signature: <a href="https://solscan.io/tx/${signature}">View Transaction</a>`,
      { parse_mode: "HTML" }
    );
}
