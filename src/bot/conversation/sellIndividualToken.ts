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
import { sendErrorWithAutoDelete } from "../utils";
import { CallBackQueries } from "../types";

type WalletHolder = {
  pubkey: string;
  balance: number; // token amount
  tokenPrice: number; // USD value of that wallet's tokens
  solBalance: number; // SOL balance for gas fees
  shortAddress: string;
};

export const sellIndividualToken = async (conversation: Conversation<Context>, ctx: Context, address: string) => {
  console.log("sellIndividualToken conversation started for token:", address);
  
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
    
    // Shorten addresses for callback data to stay within 64-byte limit
    const shortWalletAddr = wallet.pubkey.slice(0, 8) + wallet.pubkey.slice(-8);
    const shortTokenAddr = address.slice(0, 8) + address.slice(-8);
    
    kb.row(
      { 
        text: `🏦 ${wallet.shortAddress}`, 
        callback_data: `wdet_${shortWalletAddr}_${shortTokenAddr}` 
      }
    );
    
    kb.row(
      { 
        text: `📈 Sell 25% (${(wallet.balance * 0.25 / 1e6).toFixed(2)} tokens)`, 
        callback_data: `s25_${shortWalletAddr}_${shortTokenAddr}` 
      },
      { 
        text: `📈 Sell 50% (${(wallet.balance * 0.5 / 1e6).toFixed(2)} tokens)`, 
        callback_data: `s50_${shortWalletAddr}_${shortTokenAddr}` 
      }
    );
    
    kb.row(
      { 
        text: `📈 Sell 75% (${(wallet.balance * 0.75 / 1e6).toFixed(2)} tokens)`, 
        callback_data: `s75_${shortWalletAddr}_${shortTokenAddr}` 
      },
      { 
        text: `💸 Sell All (${walletTokensFormatted} tokens)`, 
        callback_data: `sall_${shortWalletAddr}_${shortTokenAddr}` 
      }
    );
    
    // Add separator between wallets
    if (index < walletHolders.length - 1) {
      kb.row({ text: "━━━━━━━━━━━━━━━━━━━━", callback_data: "noop" });
    }
  });

  // Add back button
  kb.row({ text: "🔙 Back", callback_data: CallBackQueries.BACK });

  console.log("About to send wallet breakdown message with", walletHolders.length, "wallets");
  console.log("Message content:", message.substring(0, 200) + "...");

  await sendMessage(ctx, message, {
    parse_mode: "Markdown",
    reply_markup: kb,
  });

  console.log("Wallet breakdown message sent successfully");

  // Wait for user selection
  const response = await conversation.wait();
  
  console.log("Received callback response:", response.callbackQuery?.data);
  
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
  console.log("handleWalletSellAction called with data:", data);
  
  const parts = data.split('_');
  const action = parts[0]; // s25, s50, s75, sall, wdet, back_to_wallets
  const shortWalletAddr = parts[1];
  const shortTokenAddr = parts[2];

  console.log("Parsed action:", action, "wallet:", shortWalletAddr, "token:", shortTokenAddr);

  // Reconstruct full addresses from shortened versions
  const fullTokenAddress = tokenAddress; // We already have the full token address
  let fullWalletAddress = '';

  // Find the wallet with matching shortened address
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(ctx, "❌ User not found");
    return;
  }

  const buyerWallets = await getAllBuyerWallets(String(user._id));
  const targetWallet = buyerWallets.find(w => {
    const walletShort = w.publicKey.slice(0, 8) + w.publicKey.slice(-8);
    return walletShort === shortWalletAddr;
  });
  
  if (!targetWallet) {
    await sendMessage(ctx, "❌ Wallet not found");
    return;
  }

  fullWalletAddress = targetWallet.publicKey;

  if (action === 's25' || action === 's50' || action === 's75' || action === 'sall') {
    let sellPercent = 0;
    
    switch (action) {
      case 's25':
        sellPercent = 25;
        break;
      case 's50':
        sellPercent = 50;
        break;
      case 's75':
        sellPercent = 75;
        break;
      case 'sall':
        sellPercent = 100;
        break;
      default:
        await sendMessage(ctx, "❌ Invalid sell percentage");
        return;
    }

    console.log("Executing sell for", sellPercent, "% from wallet", fullWalletAddress);

    try {
      // Get wallet private key
      const { getBuyerWalletPrivateKey } = await import("../../backend/functions-main");
      const privateKey = await getBuyerWalletPrivateKey(String(user._id), targetWallet.id);
      
      // Get token balance
      const tokenBalance = await getTokenBalance(fullTokenAddress, fullWalletAddress);
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
      const result = await executeExternalSell(fullTokenAddress, walletKeypair, tokensToSell);
      
      if (result.success) {
        await sendMessage(ctx, `✅ Successfully sold ${sellPercent}% of tokens!\n\nTransaction: ${result.signature}\nPlatform: ${result.platform}`);
      } else {
        await sendErrorWithAutoDelete(ctx, `❌ Sell failed: ${result.error}`);
      }
      
    } catch (error: any) {
      await sendErrorWithAutoDelete(ctx, `❌ Error: ${error.message}`);
    }
  } else if (action === 'wdet') {
    // Show detailed wallet information
    const tokenBalance = await getTokenBalance(fullTokenAddress, fullWalletAddress);
    const solBalance = await getWalletBalance(fullWalletAddress);
    const tokenInfo = await getTokenInfo(fullTokenAddress);
    const tokenPrice = tokenInfo?.price || 0;
    const tokenValue = (tokenBalance / 1e6) * tokenPrice;

    const walletTokensFormatted = (tokenBalance / 1e6).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });

    const detailsMessage = `
🏦 *Wallet Details*
Address: \`${fullWalletAddress}\`

💰 *Token Holdings:*
${walletTokensFormatted} ${tokenInfo?.baseToken?.symbol || 'tokens'}
$${tokenValue.toFixed(2)} USD value

💎 *SOL Balance:*
${solBalance.toFixed(4)} SOL (for gas fees)

${tokenPrice > 0 ? `💵 Token Price: $${tokenPrice.toFixed(8)}` : ''}
    `.trim();

    const detailsKb = new InlineKeyboard()
      .row(
        { text: "📈 Sell 25%", callback_data: `s25_${shortWalletAddr}_${shortTokenAddr}` },
        { text: "📈 Sell 50%", callback_data: `s50_${shortWalletAddr}_${shortTokenAddr}` }
      )
      .row(
        { text: "📈 Sell 75%", callback_data: `s75_${shortWalletAddr}_${shortTokenAddr}` },
        { text: "💸 Sell All", callback_data: `sall_${shortWalletAddr}_${shortTokenAddr}` }
      )
      .row({ text: "🔙 Back to All Wallets", callback_data: `back_to_wallets_${shortTokenAddr}` });

    await sendMessage(ctx, detailsMessage, {
      parse_mode: "Markdown",
      reply_markup: detailsKb,
    });
  } else if (action === 'back_to_wallets') {
    // Return to wallet list
    await sellIndividualToken(conversation, ctx, fullTokenAddress);
  }
} 