import { Conversation } from "@grammyjs/conversations";
import { Context, InlineKeyboard } from "grammy";
import { TokenModel } from "../../backend/models";
import { 
  abbreviateNumber, 
  getNonEmptyBalances, 
  getUser, 
  getAllBuyerWallets,
  getWalletBalance
} from "../../backend/functions";
import { getTokenInfo, getTokenBalance } from "../../backend/utils";
import { sendMessage } from "../../backend/sender";
import { CallBackQueries } from "../types";

type WalletHolder = {
  pubkey: string;
  balance: number; // token amount
  tokenPrice: number; // USD value of that wallet's tokens
  solBalance: number; // SOL balance for gas fees
  shortAddress: string;
};

export const sellIndividualToken = async (conversation: Conversation<Context>, ctx: Context, address: string) => {
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    return conversation.halt();
  }

  const token = await TokenModel.findOne({ tokenAddress: address }).sort({ createdAt: -1 }).exec();
  if (!token) {
    await sendMessage(ctx, "Token not found ❌");
    return conversation.halt();
  }

  // Get all buyer wallets and their balances
  const buyerWallets = await getAllBuyerWallets(String(user._id));
  const walletHolders: WalletHolder[] = [];

  // Get token info for price calculation
  const tokenInfo = await getTokenInfo(address);
  const tokenPrice = tokenInfo?.price || 0;

  // Check each wallet for token balance
  for (const wallet of buyerWallets) {
    try {
      const tokenBalance = await getTokenBalance(address, wallet.publicKey);
      const solBalance = await getWalletBalance(wallet.publicKey);
      
      if (tokenBalance > 0) {
        const tokenValueUsd = (tokenBalance / 1e6) * tokenPrice;
        walletHolders.push({
          pubkey: wallet.publicKey,
          balance: tokenBalance,
          tokenPrice: tokenValueUsd,
          solBalance: solBalance,
          shortAddress: wallet.publicKey.slice(0, 6) + "…" + wallet.publicKey.slice(-4)
        });
      }
    } catch (error) {
      console.error(`Error checking wallet ${wallet.publicKey}:`, error);
    }
  }

  if (walletHolders.length === 0) {
    await sendMessage(ctx, "🔴 No wallets hold this token");
    return conversation.halt();
  }

  // Calculate totals
  const walletsCount = walletHolders.length;
  const totalTokens = walletHolders.reduce((sum, w) => sum + w.balance, 0);
  const totalValueUsd = walletHolders.reduce((sum, w) => sum + w.tokenPrice, 0);
  const totalSolBalance = walletHolders.reduce((sum, w) => sum + w.solBalance, 0);

  // Format values
  const totalTokensFormatted = (totalTokens / 1e6).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });

  const header = `
💊 *${token.name} (${token.symbol})*
🔑 Address: \`${token.tokenAddress}\`

📊 *Wallet Holdings Summary:*
👝 ${walletsCount} wallets holding tokens
💰 $${abbreviateNumber(totalValueUsd)} total value
🪙 ${totalTokensFormatted} tokens
💎 ${totalSolBalance.toFixed(4)} SOL available for gas

${tokenPrice > 0 ? `💵 Token Price: $${tokenPrice.toFixed(8)}` : ''}
  `.trim();

  // Build wallet breakdown
  const walletDetails = walletHolders
    .map((w, index) => {
      const walletTokensFormatted = (w.balance / 1e6).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      });
      return `${index + 1}. \`${w.shortAddress}\` | ${walletTokensFormatted} ${token.symbol} | $${abbreviateNumber(w.tokenPrice)} | 💎 ${w.solBalance.toFixed(4)} SOL`;
    })
    .join("\n");

  const message = `${header}

*Individual Wallet Breakdown:*
${walletDetails}

*Select a wallet to sell from:*`;

  // Build keyboard with wallet options
  const kb = new InlineKeyboard();
  
  walletHolders.forEach((wallet, index) => {
    const walletTokensFormatted = (wallet.balance / 1e6).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });
    
    kb.row(
      { 
        text: `🏦 ${wallet.shortAddress}`, 
        callback_data: `wallet_details_${wallet.pubkey}_${address}` 
      }
    );
    
    kb.row(
      { 
        text: `📈 Sell 25% (${(wallet.balance * 0.25 / 1e6).toFixed(2)} tokens)`, 
        callback_data: `sell_25_${wallet.pubkey}_${address}` 
      },
      { 
        text: `📈 Sell 50% (${(wallet.balance * 0.5 / 1e6).toFixed(2)} tokens)`, 
        callback_data: `sell_50_${wallet.pubkey}_${address}` 
      }
    );
    
    kb.row(
      { 
        text: `📈 Sell 75% (${(wallet.balance * 0.75 / 1e6).toFixed(2)} tokens)`, 
        callback_data: `sell_75_${wallet.pubkey}_${address}` 
      },
      { 
        text: `💸 Sell All (${walletTokensFormatted} tokens)`, 
        callback_data: `sell_all_${wallet.pubkey}_${address}` 
      }
    );
    
    // Add separator between wallets
    if (index < walletHolders.length - 1) {
      kb.row({ text: "━━━━━━━━━━━━━━━━━━━━", callback_data: "noop" });
    }
  });

  // Add back button
  kb.row({ text: "🔙 Back", callback_data: CallBackQueries.BACK });

  await sendMessage(ctx, message, {
    parse_mode: "Markdown",
    reply_markup: kb,
  });

  // Wait for user selection
  const response = await conversation.wait();
  
  if (response.callbackQuery?.data === CallBackQueries.BACK) {
    // Return to previous menu
    return conversation.halt();
  }

  // Handle wallet sell actions
  const data = response.callbackQuery?.data;
  if (data) {
    await handleWalletSellAction(conversation, response, data, address);
  }

  conversation.halt();
};

async function handleWalletSellAction(
  conversation: Conversation<Context>, 
  ctx: Context, 
  data: string, 
  tokenAddress: string
) {
  const parts = data.split('_');
  const action = parts[0];
  const percentage = parts[1];
  const walletAddress = parts[2];
  const tokenAddr = parts[3];

  if (action === 'sell' && percentage && walletAddress && tokenAddr) {
    let sellPercent = 0;
    
    switch (percentage) {
      case '25':
        sellPercent = 25;
        break;
      case '50':
        sellPercent = 50;
        break;
      case '75':
        sellPercent = 75;
        break;
      case 'all':
        sellPercent = 100;
        break;
      default:
        await sendMessage(ctx, "❌ Invalid sell percentage");
        return;
    }

    // Get wallet private key
    const user = await getUser(ctx.chat!.id.toString());
    if (!user) {
      await sendMessage(ctx, "❌ User not found");
      return;
    }

    const buyerWallets = await getAllBuyerWallets(String(user._id));
    const targetWallet = buyerWallets.find(w => w.publicKey === walletAddress);
    
    if (!targetWallet) {
      await sendMessage(ctx, "❌ Wallet not found");
      return;
    }

    try {
      // Get wallet private key
      const { getBuyerWalletPrivateKey } = await import("../../backend/functions-main");
      const privateKey = await getBuyerWalletPrivateKey(String(user._id), targetWallet.id);
      
      // Get token balance
      const tokenBalance = await getTokenBalance(tokenAddress, walletAddress);
      const tokensToSell = sellPercent === 100 ? tokenBalance : Math.floor(tokenBalance * (sellPercent / 100));
      
      if (tokensToSell <= 0) {
        await sendMessage(ctx, "❌ No tokens to sell");
        return;
      }

      // Execute the sell
      await sendMessage(ctx, `🔄 Selling ${sellPercent}% of tokens from wallet ${targetWallet.publicKey.slice(0, 6)}…${targetWallet.publicKey.slice(-4)}...`);
      
      const { executeExternalSell } = await import("../../blockchain/pumpfun/externalSell");
      const { secretKeyToKeypair } = await import("../../blockchain/common/utils");
      
      const walletKeypair = secretKeyToKeypair(privateKey);
      const result = await executeExternalSell(tokenAddress, walletKeypair, tokensToSell);
      
      if (result.success) {
        await sendMessage(ctx, `✅ Successfully sold ${sellPercent}% of tokens!\n\nTransaction: ${result.signature}\nPlatform: ${result.platform}`);
      } else {
        await sendMessage(ctx, `❌ Sell failed: ${result.error}`);
      }
      
    } catch (error: any) {
      await sendMessage(ctx, `❌ Error: ${error.message}`);
    }
  } else if (action === 'wallet_details') {
    // Show detailed wallet information
    const walletAddress = parts[1];
    const tokenAddr = parts[2];
    
    const user = await getUser(ctx.chat!.id.toString());
    if (!user) {
      await sendMessage(ctx, "❌ User not found");
      return;
    }

    const buyerWallets = await getAllBuyerWallets(String(user._id));
    const targetWallet = buyerWallets.find(w => w.publicKey === walletAddress);
    
    if (!targetWallet) {
      await sendMessage(ctx, "❌ Wallet not found");
      return;
    }

    const tokenBalance = await getTokenBalance(tokenAddress, walletAddress);
    const solBalance = await getWalletBalance(walletAddress);
    const tokenInfo = await getTokenInfo(tokenAddress);
    const tokenPrice = tokenInfo?.price || 0;
    const tokenValue = (tokenBalance / 1e6) * tokenPrice;

    const walletTokensFormatted = (tokenBalance / 1e6).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });

    const detailsMessage = `
🏦 *Wallet Details*
Address: \`${walletAddress}\`

💰 *Token Holdings:*
${walletTokensFormatted} ${tokenInfo?.baseToken?.symbol || 'tokens'}
$${tokenValue.toFixed(2)} USD value

💎 *SOL Balance:*
${solBalance.toFixed(4)} SOL (for gas fees)

${tokenPrice > 0 ? `💵 Token Price: $${tokenPrice.toFixed(8)}` : ''}
    `.trim();

    const detailsKb = new InlineKeyboard()
      .row(
        { text: "📈 Sell 25%", callback_data: `sell_25_${walletAddress}_${tokenAddr}` },
        { text: "📈 Sell 50%", callback_data: `sell_50_${walletAddress}_${tokenAddr}` }
      )
      .row(
        { text: "📈 Sell 75%", callback_data: `sell_75_${walletAddress}_${tokenAddr}` },
        { text: "💸 Sell All", callback_data: `sell_all_${walletAddress}_${tokenAddr}` }
      )
      .row({ text: "🔙 Back to All Wallets", callback_data: `back_to_wallets_${tokenAddr}` });

    await sendMessage(ctx, detailsMessage, {
      parse_mode: "Markdown",
      reply_markup: detailsKb,
    });
  } else if (action === 'back_to_wallets') {
    // Return to wallet list
    const tokenAddr = parts[1];
    await sellIndividualToken(conversation, ctx, tokenAddr);
  }
} 