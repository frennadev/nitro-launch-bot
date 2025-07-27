import { type Conversation } from "@grammyjs/conversations";
import { type Context, InlineKeyboard } from "grammy";
import { CallBackQueries } from "../types";
import {
  getUser,
  getUserTokenWithBuyWallets,
  getFundingWallet,
} from "../../backend/functions";
import { getTokenBalance } from "../../backend/utils";
import { connection } from "../../blockchain/common/connection";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { sendMessage } from "../../backend/sender";

// Function to escape text for MarkdownV2
function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}

// Airdrop amount per wallet (0.01 SOL)
const AIRDROP_AMOUNT = 0.01;
const AIRDROP_AMOUNT_LAMPORTS = AIRDROP_AMOUNT * 1_000_000_000;

async function airdropSolConversation(
  conversation: Conversation,
  ctx: Context,
  tokenAddress: string
) {
  try {
    console.log("🎁 Airdrop conversation started for token:", tokenAddress);

    // Validate token address
    new PublicKey(tokenAddress);

    // Get user info
    const user = await getUser(ctx.chat!.id!.toString());
    if (!user) {
      await sendMessage(ctx, "❌ User not found. Please use /start first.");
      await conversation.halt();
      return;
    }

    // Get token info from external API (works for any token)
    const { getTokenInfo } = await import("../../backend/utils");
    const tokenInfo = await getTokenInfo(tokenAddress);
    if (!tokenInfo || !tokenInfo.baseToken) {
      await sendMessage(ctx, "❌ Token not found or invalid token address\\.");
      await conversation.halt();
      return;
    }

    // Use token info from external API and escape for MarkdownV2
    const originalTokenName = tokenInfo.baseToken.name || "Unknown Token";
    const originalTokenSymbol = tokenInfo.baseToken.symbol || "Unknown";

    console.log("🎁 Original token name:", originalTokenName);
    console.log("🎁 Original token symbol:", originalTokenSymbol);

    const tokenName = escapeMarkdownV2(originalTokenName);
    const tokenSymbol = escapeMarkdownV2(originalTokenSymbol);

    console.log("🎁 Escaped token name:", tokenName);
    console.log("🎁 Escaped token symbol:", tokenSymbol);

    // Get buyer wallets
    const { getAllBuyerWallets } = await import("../../backend/functions");
    const buyerWallets = await getAllBuyerWallets(user.id);

    if (!buyerWallets || buyerWallets.length === 0) {
      await sendMessage(ctx, "❌ No buyer wallets found for this token\\.");
      await conversation.halt();
      return;
    }

    // Get funding wallet
    const fundingWalletData = await getFundingWallet(user.id);
    if (!fundingWalletData) {
      await sendMessage(
        ctx,
        "❌ No funding wallet found\\. Please add a funding wallet first\\."
      );
      await conversation.halt();
      return;
    }

    // Create funding wallet keypair
    const fundingWallet = Keypair.fromSecretKey(
      bs58.decode(fundingWalletData.privateKey)
    );

    // Check funding wallet balance
    const fundingBalance = await connection.getBalance(fundingWallet.publicKey);
    const totalNeeded = AIRDROP_AMOUNT_LAMPORTS * buyerWallets.length;

    if (fundingBalance < totalNeeded) {
      await sendMessage(
        ctx,
        `❌ Insufficient funding wallet balance\\.\n\n` +
          `💰 Required: ${(totalNeeded / 1_000_000_000).toFixed(6)} SOL\n` +
          `💳 Available: ${(fundingBalance / 1_000_000_000).toFixed(6)} SOL\n\n` +
          `Please add more SOL to your funding wallet\\.`
      );
      await conversation.halt();
      return;
    }

    // Show confirmation message using HTML format (more forgiving)
    const confirmationMessage =
      `🎁 <b>SOL Airdrop Confirmation</b>\n\n` +
      `📋 <b>Token:</b> ${originalTokenName} ($${originalTokenSymbol})\n` +
      `📍 <b>Address:</b> <code>${tokenAddress}</code>\n\n` +
      `👥 <b>Recipients:</b> ${buyerWallets.length} buyer wallets\n` +
      `💰 <b>Amount per wallet:</b> ${AIRDROP_AMOUNT} SOL\n` +
      `💸 <b>Total cost:</b> ${(totalNeeded / 1_000_000_000).toFixed(6)} SOL\n\n` +
      `⚠️ <b>Note:</b> Only wallets holding this token will receive SOL for gas fees.\n\n` +
      `Are you sure you want to proceed?`;

    console.log("🎁 Final confirmation message:", confirmationMessage);

    const confirmationKeyboard = new InlineKeyboard()
      .text("✅ Confirm Airdrop", "CONFIRM_AIRDROP")
      .text("❌ Cancel", CallBackQueries.CANCEL);

    console.log("🎁 About to send confirmation message...");
    console.log("🎁 Confirmation message content:", confirmationMessage);
    try {
      await sendMessage(ctx, confirmationMessage, {
        parse_mode: "HTML",
        reply_markup: confirmationKeyboard,
      });
      console.log("🎁 Confirmation message sent successfully!");
    } catch (replyError: any) {
      console.error("🎁 Error sending confirmation message:", replyError);
      throw replyError;
    }

    // Wait for user confirmation
    const response = await conversation.waitFor("callback_query:data");

    if (response.callbackQuery?.data === CallBackQueries.CANCEL) {
      await sendMessage(ctx, "❌ Airdrop cancelled\\.");
      await conversation.halt();
      return;
    }

    if (response.callbackQuery?.data === "CONFIRM_AIRDROP") {
      // Start airdrop process
      await sendMessage(
        ctx,
        "🚀 Starting SOL airdrop to buyer wallets\\.\\.\\."
      );

      const results = await executeAirdrop(
        tokenAddress,
        buyerWallets,
        fundingWallet
      );

      // Show results
      const successCount = results.filter((r) => r.success).length;
      const failedCount = results.filter((r) => !r.success).length;
      const totalCost = successCount * AIRDROP_AMOUNT;

      let resultMessage =
        `🎁 <b>SOL Airdrop Complete!</b>\n\n` +
        `📋 <b>Token:</b> ${originalTokenName} ($${originalTokenSymbol})\n` +
        `📍 <b>Address:</b> <code>${tokenAddress}</code>\n\n` +
        `✅ <b>Successful:</b> ${successCount} wallets\n` +
        `❌ <b>Failed:</b> ${failedCount} wallets\n` +
        `💰 <b>Total sent:</b> ${totalCost.toFixed(6)} SOL\n\n`;

      if (failedCount > 0) {
        resultMessage += `⚠️ <b>Failed wallets:</b>\n`;
        results
          .filter((r) => !r.success)
          .forEach((result, index) => {
            resultMessage += `• Wallet ${index + 1}: ${result.error}\n`;
          });
      }

      resultMessage += `\n💡 <b>Purpose:</b> SOL sent for gas fees to sell tokens.`;

      await sendMessage(ctx, resultMessage, {
        parse_mode: "HTML",
      });
    }
  } catch (error: any) {
    console.error("🎁 Error in airdrop conversation:", error);
    await sendMessage(ctx, `❌ Error: ${error.message}`);
    await conversation.halt();
  }
}

// Execute the actual airdrop
async function executeAirdrop(
  tokenAddress: string,
  buyerWallets: any[],
  fundingWallet: Keypair
) {
  const results = [];

  for (let i = 0; i < buyerWallets.length; i++) {
    const buyerWallet = buyerWallets[i];

    try {
      // Check if buyer wallet holds the token
      const tokenBalance = await getTokenBalance(
        tokenAddress,
        buyerWallet.publicKey
      );

      if (tokenBalance <= 0) {
        results.push({
          success: false,
          wallet: buyerWallet.publicKey,
          error: "No token balance",
        });
        continue;
      }

      // Create transfer transaction
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: fundingWallet.publicKey,
          toPubkey: buyerWallet.publicKey,
          lamports: AIRDROP_AMOUNT_LAMPORTS,
        })
      );

      // Get recent blockhash
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = fundingWallet.publicKey;

      // Sign and send transaction
      transaction.sign(fundingWallet);
      const signature = await connection.sendRawTransaction(
        transaction.serialize()
      );

      // Wait for confirmation
      await connection.confirmTransaction(signature, "confirmed");

      results.push({
        success: true,
        wallet: buyerWallet.publicKey.toString(),
        signature: signature,
        amount: AIRDROP_AMOUNT,
      });

      // Small delay between transactions
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error: any) {
      results.push({
        success: false,
        wallet: buyerWallet.publicKey.toString(),
        error: error.message,
      });
    }
  }

  return results;
}

export { airdropSolConversation };
