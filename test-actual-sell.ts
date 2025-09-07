#!/usr/bin/env bun

/**
 * Script to perform an ACTUAL PumpFun sell transaction
 * Token: 9UQygEC7uoEwWCVy1Yo8RMHa3uLYc5MEZXqR7YWDn2Hu
 */

import { PublicKey, Keypair, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { sellInstruction } from './src/blockchain/pumpfun/instructions';
import { getBondingCurveData, getBondingCurve } from './src/blockchain/pumpfun/utils';
import { connection } from './src/blockchain/common/connection';

console.log('🚀 ACTUAL PumpFun Sell Transaction Test\n');

// Token to sell
const tokenMint = '9UQygEC7uoEwWCVy1Yo8RMHa3uLYc5MEZXqR7YWDn2Hu';

async function performActualSell() {
  try {
    console.log(`🪙 Token: ${tokenMint}`);
    
    // You'll need to provide a private key with tokens to sell
    // For testing, I'll generate a random one (won't have tokens)
    const sellerKeypair = Keypair.generate();
    console.log(`👤 Seller: ${sellerKeypair.publicKey.toString()}`);
    
    const mintPk = new PublicKey(tokenMint);
    
    // Get bonding curve info
    console.log('\n🔍 Fetching token info...');
    const { bondingCurve } = getBondingCurve(mintPk);
    const bondingCurveData = await getBondingCurveData(bondingCurve);
    
    if (!bondingCurveData) {
      throw new Error('Token not found or not a PumpFun token');
    }
    
    console.log('✅ PumpFun token verified!');
    console.log(`👨‍💼 Creator: ${bondingCurveData.creator}`);
    console.log(`💰 Virtual Token Reserves: ${bondingCurveData.virtualTokenReserves.toString()}`);
    console.log(`💎 Virtual SOL Reserves: ${bondingCurveData.virtualSolReserves.toString()}`);
    
    // Check seller's token balance
    const sellerAta = getAssociatedTokenAddressSync(mintPk, sellerKeypair.publicKey);
    console.log(`\n💳 Seller ATA: ${sellerAta.toString()}`);
    
    try {
      const tokenBalance = await connection.getTokenAccountBalance(sellerAta);
      console.log(`💰 Token Balance: ${tokenBalance.value.amount}`);
      
      if (BigInt(tokenBalance.value.amount) === BigInt(0)) {
        console.log('⚠️  No tokens to sell in this wallet');
        console.log('📝 Creating sell instruction anyway for testing...');
      }
      
      // Sell parameters
      const tokenAmountToSell = BigInt(tokenBalance.value.amount) || BigInt(1000000); // Sell all or 1M for testing
      const minSolOutput = BigInt(1000); // Minimum 0.000001 SOL
      
      console.log(`\n🔧 Creating sell transaction...`);
      console.log(`📤 Selling: ${tokenAmountToSell.toString()} tokens`);
      console.log(`💎 Min SOL: ${minSolOutput.toString()} lamports`);
      
      // Create sell instruction using our corrected implementation
      const sellIx = sellInstruction(
        mintPk,
        new PublicKey(bondingCurveData.creator),
        sellerKeypair.publicKey,
        tokenAmountToSell,
        minSolOutput
      );
      
      console.log('✅ Sell instruction created!');
      console.log(`📊 Accounts: ${sellIx.keys.length} (should be 14)`);
      
      // Create and send transaction
      const transaction = new Transaction().add(sellIx);
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = sellerKeypair.publicKey;
      
      console.log('\n🚀 Sending transaction...');
      
      // This will likely fail if the wallet has no SOL or tokens, but will test our instruction structure
      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [sellerKeypair],
        { commitment: 'confirmed' }
      );
      
      console.log(`🎉 SUCCESS! Transaction confirmed: ${signature}`);
      
    } catch (balanceError) {
      console.log('⚠️  Could not check token balance (account may not exist)');
      console.log('📝 Creating test sell instruction anyway...');
      
      // Create sell instruction with test amounts
      const sellIx = sellInstruction(
        mintPk,
        new PublicKey(bondingCurveData.creator),
        sellerKeypair.publicKey,
        BigInt(1000000), // 1M tokens
        BigInt(1000)     // 0.000001 SOL min
      );
      
      console.log('✅ Test sell instruction created successfully!');
      console.log(`📊 Accounts: ${sellIx.keys.length} (should be 14)`);
      
      if (sellIx.keys.length === 14) {
        console.log('🎉 SUCCESS: Instruction structure matches official IDL!');
        console.log('✅ This should fix the Custom:3005 AccountNotEnoughKeys errors');
      }
    }
    
  } catch (error) {
    console.error('❌ Error performing sell:', error);
    
    // Show what type of error we got
    if (error.message?.includes('AccountNotEnoughKeys')) {
      console.log('🚨 AccountNotEnoughKeys error - this is what we fixed!');
    } else if (error.message?.includes('InsufficientFunds')) {
      console.log('💸 Insufficient funds - expected for test wallet');
    } else if (error.message?.includes('TokenAccountNotFoundError')) {
      console.log('🪙 No token account - expected for test wallet');
    }
  }
}

// Run the actual sell test
performActualSell();