import { Conversation } from "@grammyjs/conversations";
import { Context, InlineKeyboard } from "grammy";
import { TokenModel } from "../../backend/models";
import {
  abbreviateNumber,
  getNonEmptyBalances,
  getUser,
  getAllBuyerWallets,
  getWalletBalance,
} from "../../backend/functions";
import { getTokenInfo, getTokenBalance } from "../../backend/utils";
import { solanaTrackerService } from "../../services/token/solana-tracker-service";
import { sendMessage } from "../../backend/sender";
import { sendErrorWithAutoDelete } from "../utils";
import { CallBackQueries } from "../types";
import { compressCallbackData } from "../utils";
import { logger } from "../../blockchain/common/logger";

type WalletHolder = {
  pubkey: string;
  balance: number; // token amount
  tokenPrice: number; // USD value of that wallet's tokens
  solBalance: number; // SOL balance for gas fees
  shortAddress: string;
};

export const sellIndividualToken = async (
  conversation: Conversation<Context>,
  ctx: Context,
  address: string,
  page: number = 0,
  specificWallet?: string
): Promise<any> => {
  console.log(
    "sellIndividualToken conversation started for token:",
    address,
    "specificWallet:",
    specificWallet
  );

  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(ctx, "Please try again ⚡");
    return conversation.halt();
  }

  const token = await TokenModel.findOne({ tokenAddress: address })
    .sort({ createdAt: -1 })
    .exec();
  if (!token) {
    await sendMessage(ctx, "Token not found. Try again ⚡");
    return conversation.halt();
  }

  // Get all buyer wallets and their balances
  const buyerWallets = await getAllBuyerWallets(String(user._id));
  const walletHolders: WalletHolder[] = [];

  // Get token info for price calculation using Solana Tracker
  const tokenInfo = await getTokenInfo(address);
  let tokenPrice = tokenInfo?.priceUsd ? parseFloat(tokenInfo.priceUsd) : 0;

  // If price is still 0, try direct Solana Tracker service as fallback
  if (tokenPrice === 0) {
    console.log(
      `[sellIndividualToken] Price is 0, trying direct Solana Tracker for ${address}`
    );
    try {
      const directTokenInfo = await solanaTrackerService.getTokenInfo(address);
      if (directTokenInfo?.price) {
        tokenPrice = directTokenInfo.price;
        console.log(
          `[sellIndividualToken] Direct Solana Tracker price: $${tokenPrice}`
        );
      }
    } catch (error) {
      console.error(
        `[sellIndividualToken] Direct Solana Tracker failed:`,
        error
      );
    }
  }

  console.log(`[sellIndividualToken] Final token ${address} price info:`, {
    priceUsd: tokenInfo?.priceUsd,
    finalPrice: tokenPrice,
    tokenInfo: tokenInfo ? "found" : "not found",
  });

  // If a specific wallet is provided, filter to only that wallet
  const walletsToCheck = specificWallet
    ? buyerWallets.filter((wallet) => wallet.publicKey === specificWallet)
    : buyerWallets;

  if (specificWallet && walletsToCheck.length === 0) {
    await sendMessage(
      ctx,
      "🔴 Specified wallet not found in your buyer wallets"
    );
    return conversation.halt();
  }

  // Check each wallet for token balance
  for (const wallet of walletsToCheck) {
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
          shortAddress:
            wallet.publicKey.slice(0, 6) + "…" + wallet.publicKey.slice(-4),
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
  const totalSolBalance = walletHolders.reduce(
    (sum, w) => sum + w.solBalance,
    0
  );

  // Format values
  const totalTokensFormatted = (totalTokens / 1e6).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });

  // Pagination settings
  const WALLETS_PER_PAGE = 3; // Limit to 3 wallets per page to prevent keyboard overflow
  const totalPages = Math.ceil(walletHolders.length / WALLETS_PER_PAGE);
  const startIndex = page * WALLETS_PER_PAGE;
  const endIndex = Math.min(
    startIndex + WALLETS_PER_PAGE,
    walletHolders.length
  );
  const currentPageWallets = walletHolders.slice(startIndex, endIndex);

  const header = `
💊 *${token.name} (${token.symbol})*
🔑 Address: \`${token.tokenAddress}\`

📊 *${specificWallet ? "Specific Wallet Holdings:" : "Wallet Holdings Summary:"}*
${specificWallet ? `🎯 Selected wallet: \`${specificWallet.slice(0, 6)}…${specificWallet.slice(-4)}\`` : `👝 ${walletsCount} wallets holding tokens`}
💰 $${abbreviateNumber(totalValueUsd)} total value
🪙 ${totalTokensFormatted} tokens
💎 ${totalSolBalance.toFixed(4)} SOL available for gas

${tokenPrice > 0 ? `💵 Token Price: $${tokenPrice.toFixed(8)}` : ""}
  `.trim();

  // Build wallet breakdown for current page
  const walletDetails = currentPageWallets
    .map((w, index) => {
      const walletTokensFormatted = (w.balance / 1e6).toLocaleString(
        undefined,
        {
          maximumFractionDigits: 2,
        }
      );
      return `${startIndex + index + 1}. \`${w.shortAddress}\` | ${walletTokensFormatted} ${token.symbol} | $${abbreviateNumber(w.tokenPrice)} | 💎 ${w.solBalance.toFixed(4)} SOL`;
    })
    .join("\n");

  const message = `${header}

*Individual Wallet Breakdown (Page ${page + 1}/${totalPages}):*
${walletDetails}

*Select a wallet to sell from:*`;

  // Build keyboard with wallet options (limited to current page)
  const kb = new InlineKeyboard();

  currentPageWallets.forEach((wallet, index) => {
    const walletTokensFormatted = (wallet.balance / 1e6).toLocaleString(
      undefined,
      {
        maximumFractionDigits: 2,
      }
    );

    // Shorten addresses for callback data to stay within 64-byte limit
    const shortWalletAddr = wallet.pubkey.slice(0, 8) + wallet.pubkey.slice(-8);
    const shortTokenAddr = address.slice(0, 8) + address.slice(-8);

    kb.row({
      text: `🏦 ${wallet.shortAddress}`,
      callback_data: `wdet_${shortWalletAddr}_${shortTokenAddr}`,
    });

    kb.row(
      {
        text: `📈 Sell 0.5% (${((wallet.balance * 0.005) / 1e6).toFixed(2)} tokens)`,
        callback_data: `s0.5_${shortWalletAddr}_${shortTokenAddr}`,
      },
      {
        text: `📈 Sell 1% (${((wallet.balance * 0.01) / 1e6).toFixed(2)} tokens)`,
        callback_data: `s1_${shortWalletAddr}_${shortTokenAddr}`,
      },
      {
        text: `📈 Sell 5% (${((wallet.balance * 0.05) / 1e6).toFixed(2)} tokens)`,
        callback_data: `s5_${shortWalletAddr}_${shortTokenAddr}`,
      }
    );

    kb.row(
      {
        text: `📈 Sell 10% (${((wallet.balance * 0.1) / 1e6).toFixed(2)} tokens)`,
        callback_data: `s10_${shortWalletAddr}_${shortTokenAddr}`,
      },
      {
        text: `📈 Sell 25% (${((wallet.balance * 0.25) / 1e6).toFixed(2)} tokens)`,
        callback_data: `s25_${shortWalletAddr}_${shortTokenAddr}`,
      },
      {
        text: `📈 Sell 50% (${((wallet.balance * 0.5) / 1e6).toFixed(2)} tokens)`,
        callback_data: `s50_${shortWalletAddr}_${shortTokenAddr}`,
      }
    );

    kb.row(
      {
        text: `📈 Sell 75% (${((wallet.balance * 0.75) / 1e6).toFixed(2)} tokens)`,
        callback_data: `s75_${shortWalletAddr}_${shortTokenAddr}`,
      },
      {
        text: `💸 Sell All (${walletTokensFormatted} tokens)`,
        callback_data: `sall_${shortWalletAddr}_${shortTokenAddr}`,
      }
    );

    // Add separator between wallets (but not after the last one)
    if (index < currentPageWallets.length - 1) {
      kb.row({ text: "━━━━━━━━━━━━━━━━━━━━", callback_data: "noop" });
    }
  });

  // Add pagination controls if needed
  if (totalPages > 1) {
    const paginationRow = [];

    if (page > 0) {
      paginationRow.push({
        text: "⬅️ Previous",
        callback_data: `page_${page - 1}_${address}`,
      });
    }

    if (page < totalPages - 1) {
      paginationRow.push({
        text: "Next ➡️",
        callback_data: `page_${page + 1}_${address}`,
      });
    }

    if (paginationRow.length > 0) {
      kb.row(...paginationRow);
    }
  }

  // Add back button
  if (specificWallet) {
    // If we're dealing with a specific wallet, go back to the token wallets view
    kb.row({
      text: "🔙 Back to Wallets",
      callback_data: compressCallbackData(
        CallBackQueries.VIEW_TOKEN_WALLETS,
        address
      ),
    });
  } else {
    kb.row({ text: "🔙 Back", callback_data: CallBackQueries.BACK });
  }

  console.log(
    "About to send wallet breakdown message with",
    currentPageWallets.length,
    "wallets on page",
    page + 1,
    "of",
    totalPages
  );
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

  // Handle pagination
  const data = response.callbackQuery?.data;
  if (data && data.startsWith("page_")) {
    const parts = data.split("_");
    const newPage = parseInt(parts[1]);
    const tokenAddr = parts[2];
    // Recursively call with new page
    return sellIndividualToken(conversation, ctx, tokenAddr, newPage);
  }

  // Handle wallet sell actions
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

  const parts = data.split("_");
  const action = parts[0]; // s25, s50, s75, sall, wdet, back_to_wallets
  const shortWalletAddr = parts[1];
  const shortTokenAddr = parts[2];

  console.log(
    "Parsed action:",
    action,
    "wallet:",
    shortWalletAddr,
    "token:",
    shortTokenAddr
  );

  // Reconstruct full addresses from shortened versions
  const fullTokenAddress = tokenAddress; // We already have the full token address
  let fullWalletAddress = "";

  // Find the wallet with matching shortened address
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(ctx, "Please try again ⚡");
    return;
  }

  const buyerWallets = await getAllBuyerWallets(String(user._id));
  const targetWallet = buyerWallets.find((w) => {
    const walletShort = w.publicKey.slice(0, 8) + w.publicKey.slice(-8);
    return walletShort === shortWalletAddr;
  });

  if (!targetWallet) {
    await sendMessage(ctx, "Wallet not found. Try again ⚡");
    return;
  }

  fullWalletAddress = targetWallet.publicKey;

  if (
    action === "s0.5" ||
    action === "s1" ||
    action === "s5" ||
    action === "s10" ||
    action === "s25" ||
    action === "s50" ||
    action === "s75" ||
    action === "sall"
  ) {
    let sellPercent = 0;

    switch (action) {
      case "s0.5":
        sellPercent = 0.5;
        break;
      case "s1":
        sellPercent = 1;
        break;
      case "s5":
        sellPercent = 5;
        break;
      case "s10":
        sellPercent = 10;
        break;
      case "s25":
        sellPercent = 25;
        break;
      case "s50":
        sellPercent = 50;
        break;
      case "s75":
        sellPercent = 75;
        break;
      case "sall":
        sellPercent = 100;
        break;
      default:
        await sendMessage(ctx, "Invalid percentage. Try again ⚡");
        return;
    }

    console.log(
      "Executing sell for",
      sellPercent,
      "% from wallet",
      fullWalletAddress
    );

    try {
      // Get wallet private key
      const { getBuyerWalletPrivateKey } = await import(
        "../../backend/functions-main"
      );
      const privateKey = await getBuyerWalletPrivateKey(
        String(user._id),
        targetWallet.id
      );

      // Get token balance
      const tokenBalance = await getTokenBalance(
        fullTokenAddress,
        fullWalletAddress
      );
      const tokensToSell =
        sellPercent === 100
          ? tokenBalance
          : Math.floor(tokenBalance * (sellPercent / 100));

      // DEBUG LOGGING
      logger.info(`[SellIndividual] DEBUG - sellPercent: ${sellPercent}`);
      logger.info(`[SellIndividual] DEBUG - tokenBalance: ${tokenBalance}`);
      logger.info(
        `[SellIndividual] DEBUG - tokensToSell calculated: ${tokensToSell}`
      );
      logger.info(
        `[SellIndividual] DEBUG - Calculation: Math.floor(${tokenBalance} * (${sellPercent} / 100)) = ${tokensToSell}`
      );

      if (tokensToSell <= 0) {
        await sendMessage(ctx, "No tokens to sell ⚡");
        return;
      }

      // Execute the sell
      await sendMessage(
        ctx,
        `🔄 Selling ${sellPercent}% of tokens from wallet ${targetWallet.publicKey.slice(0, 6)}…${targetWallet.publicKey.slice(-4)}...`
      );

      const { executeExternalSell } = await import(
        "../../blockchain/pumpfun/externalSell"
      );
      const { secretKeyToKeypair } = await import(
        "../../blockchain/common/utils"
      );

      const walletKeypair = secretKeyToKeypair(privateKey);
      const result = await executeExternalSell(
        fullTokenAddress,
        walletKeypair,
        tokensToSell,
        ctx
      );

      if (result.success) {
        await sendMessage(
          ctx,
          `✅ Successfully sold ${sellPercent}% of tokens!\n\nTransaction: ${result.signature}\nPlatform: ${result.platform}`
        );
      } else {
        await sendErrorWithAutoDelete(ctx, "Sell failed. Try again ⚡");
      }
    } catch (error: any) {
      await sendErrorWithAutoDelete(ctx, "Something went wrong. Try again ⚡");
    }
  } else if (action === "wdet") {
    // Show detailed wallet information
    const tokenBalance = await getTokenBalance(
      fullTokenAddress,
      fullWalletAddress
    );
    const solBalance = await getWalletBalance(fullWalletAddress);
    const tokenInfo = await getTokenInfo(fullTokenAddress);
    const tokenPrice = tokenInfo?.price || 0;
    const tokenValue = (tokenBalance / 1e6) * tokenPrice;

    const walletTokensFormatted = (tokenBalance / 1e6).toLocaleString(
      undefined,
      {
        maximumFractionDigits: 2,
      }
    );

    const detailsMessage = `
🏦 *Wallet Details*
Address: \`${fullWalletAddress}\`

💰 *Token Holdings:*
${walletTokensFormatted} ${tokenInfo?.baseToken?.symbol || "tokens"}
$${tokenValue.toFixed(2)} USD value

💎 *SOL Balance:*
${solBalance.toFixed(4)} SOL (for gas fees)

${tokenPrice > 0 ? `💵 Token Price: $${tokenPrice.toFixed(8)}` : ""}
    `.trim();

    const detailsKb = new InlineKeyboard()
      .row(
        {
          text: "📈 Sell 0.5%",
          callback_data: `s0.5_${shortWalletAddr}_${shortTokenAddr}`,
        },
        {
          text: "📈 Sell 1%",
          callback_data: `s1_${shortWalletAddr}_${shortTokenAddr}`,
        },
        {
          text: "📈 Sell 5%",
          callback_data: `s5_${shortWalletAddr}_${shortTokenAddr}`,
        }
      )
      .row(
        {
          text: "📈 Sell 10%",
          callback_data: `s10_${shortWalletAddr}_${shortTokenAddr}`,
        },
        {
          text: "📈 Sell 25%",
          callback_data: `s25_${shortWalletAddr}_${shortTokenAddr}`,
        },
        {
          text: "📈 Sell 50%",
          callback_data: `s50_${shortWalletAddr}_${shortTokenAddr}`,
        }
      )
      .row(
        {
          text: "📈 Sell 75%",
          callback_data: `s75_${shortWalletAddr}_${shortTokenAddr}`,
        },
        {
          text: "💸 Sell All",
          callback_data: `sall_${shortWalletAddr}_${shortTokenAddr}`,
        }
      )
      .row({
        text: "🔙 Back to All Wallets",
        callback_data: `back_to_wallets_${shortTokenAddr}`,
      });

    await sendMessage(ctx, detailsMessage, {
      parse_mode: "Markdown",
      reply_markup: detailsKb,
    });
  } else if (action === "back_to_wallets") {
    // Return to wallet list
    await sellIndividualToken(conversation, ctx, fullTokenAddress);
  }
}
