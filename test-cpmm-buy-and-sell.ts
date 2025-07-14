import { connection } from "./src/blockchain/common/connection";
import RaydiumCpmmService from "./src/blockchain/cpmm/buy";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, Keypair } from "@solana/web3.js";
import bs58 from "bs58";

async function testCpmmBuyAndSell() {
  console.log("🧪 Testing CPMM Buy and Sell");
  console.log("=============================");

  // Test parameters
  const tokenMint = "BmjaULzZoEKnGpwGMfdCSEeTio3giS1qgbGBnU5Gbonk"; // Provided CPMM token
  const privateKey = "43WgY2ekSNR8hxAAS62qq5MC4UWCakiFxaDVBir9qsHVJvGH9HnpnwNi9fNmxRUL4nxjVQwsGFfNnaHKXBKn3CgU"; // Replace with your private key
  const buyAmount = BigInt(5_000_000); // 0.005 SOL in lamports

  try {
    console.log(`🎯 Token Mint: ${tokenMint}`);
    console.log(`💰 Buy Amount: ${Number(buyAmount) / 1e9} SOL`);
    console.log(`🔑 Wallet: ${privateKey.slice(0, 8)}...`);

    // Create CPMM service instance
    const cpmmService = new RaydiumCpmmService();
    const owner = Keypair.fromSecretKey(bs58.decode(privateKey));
    const tokenMintPubkey = new PublicKey(tokenMint);
    const tokenAta = getAssociatedTokenAddressSync(tokenMintPubkey, owner.publicKey);

    // Test 1: Buy Transaction
    console.log("\n📈 Testing CPMM Buy Transaction...");
    const buyTx = await cpmmService.buyTx({
      mint: tokenMint,
      privateKey: privateKey,
      amount_in: buyAmount,
    });

    console.log(`📝 Buy Transaction Signature: ${buyTx.signatures[0].toString('base64')}`);
    
    // Send buy transaction
    const buyResult = await connection.sendTransaction(buyTx);
    console.log(`✅ Buy Transaction Sent: ${buyResult}`);
    
    // Wait for confirmation
    const buyConfirmation = await connection.confirmTransaction(buyResult, "confirmed");
    console.log(`✅ Buy Transaction Confirmed: ${buyConfirmation.value.err ? 'Failed' : 'Success'}`);

    if (buyConfirmation.value.err) {
      console.log(`❌ Buy Transaction Failed: ${JSON.stringify(buyConfirmation.value.err)}`);
      return;
    }

    // Check token balance after buy
    console.log("\n💰 Checking token balance after buy...");
    const tokenBalanceInfo = await connection.getTokenAccountBalance(tokenAta);
    const tokenBalance = BigInt(tokenBalanceInfo.value?.amount || 0);
    console.log(`📊 Token balance: ${tokenBalance} tokens`);

    if (tokenBalance === BigInt(0)) {
      console.log("❌ No tokens received from buy transaction");
      return;
    }

    // Wait a bit before selling
    console.log("⏳ Waiting 5 seconds before selling...");
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Test 2: Sell Transaction (sell entire balance)
    console.log(`\n📉 Testing CPMM Sell Transaction (selling ${tokenBalance} tokens)...`);
    const sellTx = await cpmmService.sellTx({
      mint: tokenMint,
      privateKey: privateKey,
      amount_in: tokenBalance, // Sell entire balance
    });

    console.log(`📝 Sell Transaction Signature: ${sellTx.signatures[0].toString('base64')}`);
    
    // Send sell transaction
    const sellResult = await connection.sendTransaction(sellTx);
    console.log(`✅ Sell Transaction Sent: ${sellResult}`);
    
    // Wait for confirmation
    const sellConfirmation = await connection.confirmTransaction(sellResult, "confirmed");
    console.log(`✅ Sell Transaction Confirmed: ${sellConfirmation.value.err ? 'Failed' : 'Success'}`);

    if (sellConfirmation.value.err) {
      console.log(`❌ Sell Transaction Failed: ${JSON.stringify(sellConfirmation.value.err)}`);
      return;
    }

    // Check final token balance
    console.log("\n💰 Checking final token balance...");
    const finalTokenBalanceInfo = await connection.getTokenAccountBalance(tokenAta);
    const finalTokenBalance = BigInt(finalTokenBalanceInfo.value?.amount || 0);
    console.log(`📊 Final token balance: ${finalTokenBalance} tokens`);

    console.log("\n🎉 Both CPMM Buy and Sell transactions completed successfully!");
    console.log(`📈 Tokens bought: ${tokenBalance}`);
    console.log(`📉 Tokens sold: ${tokenBalance}`);
    console.log(`💎 Remaining tokens: ${finalTokenBalance}`);

  } catch (error) {
    console.error("❌ Error during CPMM test:", error);
  }
}

// Run the test
testCpmmBuyAndSell().catch(console.error); 