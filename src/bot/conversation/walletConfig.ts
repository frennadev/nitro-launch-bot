import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getUser } from "../../backend/functions";
import { CallBackQueries } from "../types";
import type { ParseMode } from "grammy/types";
import { sendMessage } from "../../backend/sender";

const walletConfigConversation = async (conversation: Conversation<Context>, ctx: Context) => {
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    return conversation.halt();
  }

  const keyboard = new InlineKeyboard()
    .text("🛠️ Change developer wallet", CallBackQueries.CHANGE_DEV_WALLET)
    .row()
    .text("💰 Change funding wallet", CallBackQueries.CHANGE_FUNDING_WALLET)
    .row()
    .text("📤 Export wallets", CallBackQueries.LAUNCH_TOKEN)
    .row()
    .text("🔙 Back", CallBackQueries.BACK);

  const menuMessage = `
<b>Wallet Configuration</b>
Configure and select your wallet for launching tokens

<b>Dev</b>: <code>5UUmSV4oaaB9kp651r9CKhr4dh5zVzctmqW1YDvbXbzD</code>
🟢 0.05 SOL  | 💰 $50.50

<b>Funding</b>: <code>5UUmSV4oaaB9kp651r9CKhr4dh5zVzctmqW1YDvbXbzD</code>
🟢 0.05 SOL  | 💰 $50.50

<b>Worker</b>: <code>5UUmSV4oaaB9kp651r9CKhr4dh5zVzctmqW1YDvbXbzD</code>
🟢 1.45 SOL  | 50
`;

  await sendMessage(ctx, menuMessage, {
    parse_mode: "HTML" as ParseMode,
    reply_markup: keyboard,
  });

  const next = await conversation.wait();

  if (next.callbackQuery?.data === CallBackQueries.CHANGE_FUNDING_WALLET) {
    await next.answerCallbackQuery();
    const cancelKeyboard = new InlineKeyboard().text("❌ Cancel", CallBackQueries.CANCEL_FUNDING_WALLET);

    await sendMessage(next, "Please send me your new funding wallet private keys:", {
      reply_markup: cancelKeyboard,
    });

    const textCtx = await conversation.wait();

    if (textCtx.callbackQuery?.data === CallBackQueries.CANCEL_FUNDING_WALLET) {
      await textCtx.answerCallbackQuery();
      await sendMessage(textCtx, "Funding wallet update cancelled.");
      return conversation.halt();
    }

    const newAddress = textCtx.message?.text?.trim();
    if (newAddress) {
      // await setFundingWallet(ctx.chat!.id.toString(), newAddress);
      await sendMessage(textCtx, `✅ Funding wallet updated to <code>${newAddress}</code>`, { parse_mode: "HTML" });
    } else {
      await sendMessage(textCtx, "❌ Invalid address. Please try again.");
    }
  }
};

export default walletConfigConversation;
