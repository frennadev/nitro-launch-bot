import { type Conversation } from "@grammyjs/conversations";
import { type Context, InlineKeyboard } from "grammy";
import { CallBackQueries } from "../types";
import { getUser, getUserTokenWithBuyWallets, getFundingWallet } from "../../backend/functions";
import { getTokenBalance } from "../../backend/utils";
import { connection } from "../../blockchain/common/connection";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

// Airdrop amount per wallet (0.01 SOL)
const AIRDROP_AMOUNT = 0.01;
const AIRDROP_AMOUNT_LAMPORTS = AIRDROP_AMOUNT * 1_000_000_000;

const airdropSolConversation = async (conversation: Conversation, ctx: Context, tokenAddress: string) => {
  try {
    // Validate token address
    new PublicKey(tokenAddress);
    
    // Get user info
    const user = await getUser(ctx.chat!.id!.toString());
    if (!user) {
      await ctx.reply("❌ User not found. Please use /start first.");
      await conversation.halt();
      return;
    }

    // Get user's token with buyer wallets
    const userToken = await getUserTokenWithBuyWallets(user.id, tokenAddress);
    if (!userToken) {
      await ctx.reply("❌ Token not found or you don't own this token.");
      await conversation.halt();
      return;
    }

    // Get buyer wallets
    const { getAllBuyerWallets } = await import("../../backend/functions");
    const buyerWallets = await getAllBuyerWallets(user.id);
    
    if (!buyerWallets || buyerWallets.length === 0) {
      await ctx.reply("❌ No buyer wallets found for this token.");
      await conversation.halt();
      return;
    }

    // Get funding wallet
    const fundingWalletData = await getFundingWallet(user.id);
    if (!fundingWalletData) {
      await ctx.reply("❌ No funding wallet found. Please add a funding wallet first.");
      await conversation.halt();
      return;
    }

    // Create funding wallet keypair
    const fundingWallet = Keypair.fromSecretKey(bs58.decode(fundingWalletData.privateKey));

    // Check funding wallet balance
    const fundingBalance = await connection.getBalance(fundingWallet.publicKey);
    const totalNeeded = AIRDROP_AMOUNT_LAMPORTS * buyerWallets.length;
    
    if (fundingBalance < totalNeeded) {
      await ctx.reply(
        `❌ Insufficient funding wallet balance.\n\n` +
        `💰 Required: ${(totalNeeded / 1_000_000_000).toFixed(6)} SOL\n` +
        `💳 Available: ${(fundingBalance / 1_000_000_000).toFixed(6)} SOL\n\n` +
        `Please add more SOL to your funding wallet.`
      );
      await conversation.halt();
      return;
    }

    // Show confirmation message
    const confirmationMessage = 
      `🎁 **SOL Airdrop Confirmation**\n\n` +
      `📋 **Token:** ${userToken.name} ($${userToken.symbol})\n` +
      `📍 **Address:** \`${tokenAddress}\`\n\n` +
      `👥 **Recipients:** ${buyerWallets.length} buyer wallets\n` +
      `💰 **Amount per wallet:** ${AIRDROP_AMOUNT} SOL\n` +
      `💸 **Total cost:** ${(totalNeeded / 1_000_000_000).toFixed(6)} SOL\n\n` +
      `⚠️ **Note:** Only wallets holding this token will receive SOL for gas fees.\n\n` +
      `Are you sure you want to proceed?`;

    const confirmationKeyboard = new InlineKeyboard()
      .text("✅ Confirm Airdrop", "CONFIRM_AIRDROP")
      .text("❌ Cancel", CallBackQueries.CANCEL);

    await ctx.reply(confirmationMessage, {
      parse_mode: "MarkdownV2",
      reply_markup: confirmationKeyboard,
    });

    // Wait for user confirmation
    const response = await conversation.waitFor("callback_query:data");
    
    if (response.callbackQuery?.data === CallBackQueries.CANCEL) {
      await ctx.reply("❌ Airdrop cancelled.");
      await conversation.halt();
      return;
    }

    if (response.callbackQuery?.data === "CONFIRM_AIRDROP") {
      // Start airdrop process
      await ctx.reply("🚀 Starting SOL airdrop to buyer wallets...");
      
      const results = await executeAirdrop(userToken, buyerWallets, fundingWallet);
      
      // Show results
      const successCount = results.filter(r => r.success).length;
      const failedCount = results.filter(r => !r.success).length;
      const totalCost = successCount * AIRDROP_AMOUNT;
      
      let resultMessage = 
        `🎁 **SOL Airdrop Complete\\!**\n\n` +
        `📋 **Token:** ${userToken.name} \\($${userToken.symbol}\\)\n` +
        `📍 **Address:** \`${tokenAddress}\`\n\n` +
        `✅ **Successful:** ${successCount} wallets\n` +
        `❌ **Failed:** ${failedCount} wallets\n` +
        `💰 **Total sent:** ${totalCost.toFixed(6)} SOL\n\n`;
      
      if (failedCount > 0) {
        resultMessage += `⚠️ **Failed wallets:**\n`;
        results.filter(r => !r.success).forEach((result, index) => {
          resultMessage += `• Wallet ${index + 1}: ${result.error}\n`;
        });
      }
      
      resultMessage += `\n💡 **Purpose:** SOL sent for gas fees to sell tokens\\.`;
      
      await ctx.reply(resultMessage, {
        parse_mode: "MarkdownV2",
      });
    }

  } catch (error: any) {
    await ctx.reply(`❌ Error: ${error.message}`);
    await conversation.halt();
  }
};

// Execute the actual airdrop
async function executeAirdrop(userToken: any, buyerWallets: any[], fundingWallet: Keypair) {
  const results = [];
  
  for (let i = 0; i < buyerWallets.length; i++) {
    const buyerWallet = buyerWallets[i];
    
    try {
      // Check if buyer wallet holds the token
      const tokenBalance = await getTokenBalance(userToken.tokenAddress, buyerWallet.publicKey);
      
      if (tokenBalance <= 0) {
        results.push({
          success: false,
          wallet: buyerWallet.publicKey,
          error: "No token balance"
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
      const signature = await connection.sendRawTransaction(transaction.serialize());
      
      // Wait for confirmation
      await connection.confirmTransaction(signature, "confirmed");
      
      results.push({
        success: true,
        wallet: buyerWallet.publicKey.toString(),
        signature: signature,
        amount: AIRDROP_AMOUNT
      });
      
      // Small delay between transactions
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error: any) {
      results.push({
        success: false,
        wallet: buyerWallet.publicKey.toString(),
        error: error.message
      });
    }
  }
  
  return results;
}

export { airdropSolConversation }; 