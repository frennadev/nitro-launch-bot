import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getUser, deleteToken } from "../../backend/functions";
import { TokenModel } from "../../backend/models";
import { CallBackQueries } from "../types";
import { sendMessage } from "../../backend/sender";
import { TokenState } from "../../backend/types";

const viewTokensConversation = async (conversation: Conversation<Context>, ctx: Context) => {
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    return conversation.halt();
  }

  console.log(`[DEBUG] User lookup - Chat ID: ${ctx.chat!.id}, User ID: ${user._id}, Username: ${user.userName}`);

  const tokens = await TokenModel.find({ user: user._id })
    .populate("launchData.devWallet")
    .populate("launchData.buyWallets")
    .sort({ createdAt: -1 })
    .exec();

  // Debug logging to understand what tokens are being loaded
  console.log(`[DEBUG] User ${user._id} has ${tokens.length} tokens:`);
  tokens.forEach((token, index) => {
    console.log(`[DEBUG] Token ${index + 1}: ${token.name} (${token.symbol}) - ${token.tokenAddress} - State: ${token.state}`);
  });

  // Also check if there are any tokens in the database at all
  const allTokensCount = await TokenModel.countDocuments();
  console.log(`[DEBUG] Total tokens in database: ${allTokensCount}`);

  if (!tokens.length) {
    await sendMessage(ctx, "No tokens found.");
    return conversation.halt();
  }

  let currentIndex = 0;

  const showToken = async (index: number) => {
    const token = tokens[index];
    const { name, symbol, description, tokenAddress, state, launchData } = token;
    const { buyWallets, buyAmount, devBuy } = launchData!;

    const lines = [
      `💊 **${name}**`,
      `🔑 Address: \`${tokenAddress}\``,
      `🏷️ Symbol: \`${symbol}\``,
      `📝 Description: ${description || "–"}`,
      "",
      `👨‍💻 Dev allocation: \`${devBuy || 0}\` SOL`,
      `🛒 Buyer allocation: \`${buyAmount || 0}\` SOL`,
      `👥 Worker wallets: \`${(buyWallets as any[])?.length || 0}\``,
      "",
      `📊 Status: ${state === TokenState.LAUNCHED ? "✅ Launched" : "⌛ Pending"}`,
      "",
      `Showing ${index + 1} of ${tokens.length}`,
    ].join("\n");

    const keyboard = new InlineKeyboard();
    
    if (state === TokenState.LAUNCHED) {
      keyboard
        .text("👨‍💻 Sell Dev Supply", `${CallBackQueries.SELL_DEV}_${tokenAddress}`)
        .text("📈 Sell % Supply", `${CallBackQueries.SELL_PERCENT}_${tokenAddress}`)
        .row()
        .text("🧨 Sell All", `${CallBackQueries.SELL_ALL}_${tokenAddress}`)
        .row();
    } else {
      keyboard.text("🚀 Launch Token", `${CallBackQueries.LAUNCH_TOKEN}_${tokenAddress}`).row();
    }

    // Add delete button for all tokens
    keyboard.text("🗑️ Delete Token", `${CallBackQueries.DELETE_TOKEN}_${tokenAddress}`).row();

    // Navigation buttons
    if (tokens.length > 1) {
      if (index > 0) {
        keyboard.text("⬅️", "prev");
      }
      if (index < tokens.length - 1) {
        keyboard.text("➡️", "next");
      }
      keyboard.row();
    }

    keyboard.text("🔙 Back", CallBackQueries.BACK);

    await ctx.reply(lines, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  };

  const showDeleteConfirmation = async (tokenAddress: string, tokenName: string) => {
    const message = `⚠️ **Delete Token Confirmation**

Are you sure you want to delete this token?

**Token:** ${tokenName}
**Address:** \`${tokenAddress}\`

⚠️ **Warning:** This action cannot be undone. The token will be permanently removed from your account.

Note: If this token was launched, it will continue to exist on the blockchain, but you will lose access to manage it through this bot.`;

    const keyboard = new InlineKeyboard()
      .text("✅ Yes, Delete", `${CallBackQueries.CONFIRM_DELETE_TOKEN}_${tokenAddress}`)
      .text("❌ Cancel", "cancel_delete")
      .row();

    await ctx.reply(message, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  };

  await showToken(currentIndex);

  while (true) {
    const response = await conversation.waitFor("callback_query:data");
    await response.answerCallbackQuery();

    const data = response.callbackQuery?.data;

    if (data === "prev" && currentIndex > 0) {
      currentIndex--;
      await showToken(currentIndex);
    } else if (data === "next" && currentIndex < tokens.length - 1) {
      currentIndex++;
      await showToken(currentIndex);
    } else if (data === CallBackQueries.BACK) {
      return conversation.halt();
    } else if (data?.startsWith(`${CallBackQueries.DELETE_TOKEN}_`)) {
      const tokenAddress = data.substring(`${CallBackQueries.DELETE_TOKEN}_`.length);
      const token = tokens.find(t => t.tokenAddress === tokenAddress);
      if (token) {
        await showDeleteConfirmation(tokenAddress, token.name);
      }
    } else if (data?.startsWith(`${CallBackQueries.CONFIRM_DELETE_TOKEN}_`)) {
      const tokenAddress = data.substring(`${CallBackQueries.CONFIRM_DELETE_TOKEN}_`.length);
      
      try {
        const result = await deleteToken(String(user._id), tokenAddress);
        
        if (result.success) {
          await ctx.reply("✅ **Token deleted successfully!**\n\nThe token has been removed from your account.", {
            parse_mode: "Markdown"
          });
          
          // Refresh the tokens list and return to main menu
          return conversation.halt();
        } else {
          await ctx.reply(`❌ **Failed to delete token**\n\n${result.message}`, {
            parse_mode: "Markdown"
          });
        }
      } catch (error: any) {
        await ctx.reply(`❌ **Error deleting token**\n\n${error.message}`, {
          parse_mode: "Markdown"
        });
      }
    } else if (data === "cancel_delete") {
      await showToken(currentIndex);
    } else {
      // Let other callback handlers take over (launch, sell, etc.)
      return conversation.halt();
    }
  }
};

export default viewTokensConversation;
