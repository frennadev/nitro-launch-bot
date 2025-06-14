import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getUser } from "../../backend/functions-main";
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

  // Get the 10 most recent tokens, sorted by creation date (newest first)
  const tokens = await TokenModel.find({ user: user._id })
    .populate("launchData.devWallet")
    .populate("launchData.buyWallets")
    .sort({ createdAt: -1 }) // Sort by newest first
    .limit(10) // Limit to 10 most recent
    .exec();

  if (!tokens.length) {
    await sendMessage(ctx, "No tokens found.");
    return conversation.halt();
  }

  // Store tokens in conversation session for command access
  conversation.session.tokenList = tokens.map((token, index) => ({
    number: index + 1,
    tokenAddress: token.tokenAddress,
    name: token.name,
    symbol: token.symbol,
    state: token.state
  }));

  // Build the token list message
  const lines = [
    "🎯 <b>Your Recent Tokens</b>",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
  ];

  tokens.forEach((token, index) => {
    const number = index + 1;
    const stateIcon = token.state === TokenState.LAUNCHED ? "✅" : "⌛";
    const stateText = token.state === TokenState.LAUNCHED ? "Launched" : "Pending";
    
    lines.push(
      `<b>${number}.</b> ${token.name} (<code>${token.symbol}</code>) ${stateIcon}`,
      `    📍 <code>${token.tokenAddress.slice(0, 8)}...${token.tokenAddress.slice(-8)}</code>`,
      `    📊 ${stateText}`,
      ""
    );
  });

  lines.push(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "💡 <b>How to select a token:</b>",
    "• Type <code>/1</code> to <code>/10</code> to select a token",
    "• Or use the buttons below for quick actions",
    "",
    "🔄 <i>Showing your 10 most recent tokens</i>"
  );

  const message = lines.join("\n");

  // Create inline keyboard with back button
  const keyboard = new InlineKeyboard()
    .text("🔙 Back to Menu", CallBackQueries.BACK);

  await ctx.reply(message, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });

  // Wait for user input (either callback query or text command)
  while (true) {
    const response = await conversation.wait();
    
    // Handle callback queries (like back button)
    if (response.callbackQuery?.data) {
      await response.answerCallbackQuery();
      if (response.callbackQuery.data === CallBackQueries.BACK) {
        return conversation.halt();
      }
      continue;
    }

    // Handle text commands for token selection
    if (response.message?.text) {
      const text = response.message.text.trim();
      
      // Check if it's a numbered command (/1, /2, etc.)
      const numberMatch = text.match(/^\/(\d+)$/);
      if (numberMatch) {
        const tokenNumber = parseInt(numberMatch[1]);
        
        if (tokenNumber >= 1 && tokenNumber <= tokens.length) {
          const selectedToken = tokens[tokenNumber - 1];
          await showTokenDetails(conversation, ctx, selectedToken, tokenNumber);
          return;
        } else {
          await ctx.reply(`❌ Invalid token number. Please use /1 to /${tokens.length}`);
          continue;
        }
      }
      
      // Handle other commands or invalid input
      await ctx.reply("💡 Please use /1 to /10 to select a token, or click the Back button.");
      continue;
    }
  }
};

const showTokenDetails = async (
  conversation: Conversation<Context>, 
  ctx: Context, 
  token: any, 
  tokenNumber: number
) => {
  const { name, symbol, description, tokenAddress, state, launchData } = token;
  const { buyWallets, buyAmount, devBuy } = launchData!;

  const lines = [
    `💊 <b>${tokenNumber}. ${name} - Token Details</b>`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    `🔑 <b>Address:</b> <code>${tokenAddress}</code>`,
    `🏷️ <b>Symbol:</b> <code>${symbol}</code>`,
    `📝 <b>Description:</b> ${description || "–"}`,
    "",
    `👨‍💻 <b>Dev allocation:</b> <code>${devBuy || 0}</code> SOL`,
    `🛒 <b>Buyer allocation:</b> <code>${buyAmount || 0}</code> SOL`,
    `👥 <b>Worker wallets:</b> <code>${(buyWallets as any[])?.length || 0}</code>`,
    "",
    `📊 <b>Status:</b> ${state === TokenState.LAUNCHED ? "✅ Launched" : "⌛ Pending"}`,
  ].join("\n");

  // Create action buttons based on token state
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
  
  keyboard.text("🔙 Back to Token List", "back_to_list");

  await ctx.reply(lines, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });

  // Wait for user action
  const response = await conversation.waitFor("callback_query:data");
  await response.answerCallbackQuery();
  
  if (response.callbackQuery?.data === "back_to_list") {
    // Restart the conversation to show the token list again
    await viewTokensConversation(conversation, ctx);
  } else {
    // Let other callback handlers take over (launch, sell, etc.)
    conversation.halt();
  }
};

export default viewTokensConversation;
