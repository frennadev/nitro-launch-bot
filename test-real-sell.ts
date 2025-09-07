#!/usr/bin/env bun

/**
 * Test script to send an ACTUAL sell transaction
 * Mint: 9UQygEC7uoEwWCVy1Yo8RMHa3uLYc5MEZXqR7YWDn2Hu
 * 
 * IMPORTANT: You need to provide a private key of a wallet that has tokens to sell
 */

import { 
  Connection, 
  PublicKey, 
  Keypair, 
  Transaction, 
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { sellInstruction } from './src/blockchain/pumpfun/instructions';
import { getBondingCurveData, getBondingCurve } from './src/blockchain/pumpfun/utils';

// Use Helius RPC for better reliability
const connection = new Connection('https://mainnet.helius-rpc.com/?api-key=417b1887-2994-4d66-a5db-a30a372b7c8e', 'confirmed');

const mintAddress = '9UQygEC7uoEwWCVy1Yo8RMHa3uLYc5MEZXqR7YWDn2Hu';

async function sendActualSell() {
  try {
    console.log('🚀 SENDING ACTUAL SELL TRANSACTION\n');
    
    // ⚠️ REPLACE THIS WITH A REAL PRIVATE KEY THAT HAS TOKENS
    // For testing, I'll generate a random one (won't work but will test instruction structure)
    console.log('⚠️  Using test wallet (replace with real private key that has tokens)');
    const sellerKeypair = Keypair.generate();
    
    // If you want to test with a real wallet, uncomment and add your private key:
    // const sellerKeypair = Keypair.fromSecretKey(new Uint8Array([/* your private key array */]));
    
    console.log(`👤 Seller: ${sellerKeypair.publicKey.toString()}`);
    
    const mintPk = new PublicKey(mintAddress);
    
    // Get token info
    console.log('\n🔍 Fetching token information...');
    const { bondingCurve } = getBondingCurve(mintPk);
    const bondingCurveData = await getBondingCurveData(bondingCurve);
    
    if (!bondingCurveData) {
      throw new Error('Token not found - not a valid PumpFun token');
    }
    
    console.log('✅ Valid PumpFun token!');
    console.log(`👨‍💼 Creator: ${bondingCurveData.creator}`);
    console.log(`💰 Virtual Token Reserves: ${bondingCurveData.virtualTokenReserves.toString()}`);
    console.log(`💎 Virtual SOL Reserves: ${bondingCurveData.virtualSolReserves.toString()}`);
    
    // Check seller's SOL balance
    const solBalance = await connection.getBalance(sellerKeypair.publicKey);
    console.log(`\n💰 Seller SOL Balance: ${solBalance / LAMPORTS_PER_SOL} SOL`);
    
    if (solBalance < 0.01 * LAMPORTS_PER_SOL) {
      console.log('⚠️  Low SOL balance - transaction may fail due to insufficient fees');
    }
    
    // Check token balance
    const sellerAta = getAssociatedTokenAddressSync(mintPk, sellerKeypair.publicKey);
    console.log(`💳 Token Account: ${sellerAta.toString()}`);
    
    let tokenBalance = BigInt(0);
    try {
      const balance = await connection.getTokenAccountBalance(sellerAta);
      tokenBalance = BigInt(balance.value.amount);
      console.log(`🪙 Token Balance: ${tokenBalance.toString()} tokens`);
    } catch (error) {
      console.log('⚠️  No token account found - wallet has no tokens');
    }
    
    if (tokenBalance === BigInt(0)) {
      console.log('\n📝 No tokens to sell, but testing instruction structure...');
      tokenBalance = BigInt(1000000); // Use 1M tokens for testing
    }
    
    // Calculate sell parameters
    const tokensToSell = tokenBalance;
    const minSolOutput = BigInt(1); // Minimum 1 lamport
    
    console.log(`\n🔧 Creating sell transaction...`);
    console.log(`📤 Selling: ${tokensToSell.toString()} tokens`);
    console.log(`💎 Min SOL: ${minSolOutput.toString()} lamports`);
    
    // Create sell instruction using our corrected implementation
    const sellIx = sellInstruction(
      mintPk,
      new PublicKey(bondingCurveData.creator),
      sellerKeypair.publicKey,
      tokensToSell,
      minSolOutput
    );
    
    console.log('✅ Sell instruction created!');
    console.log(`📊 Accounts: ${sellIx.keys.length} (should be 14)`);
    
    // Show all accounts
    console.log('\n📋 Instruction Accounts:');
    const accountNames = [
      'global', 'fee_recipient', 'mint', 'bonding_curve', 'associated_bonding_curve',
      'associated_user', 'user', 'system_program', 'creator_vault', 'token_program',
      'event_authority', 'program', 'fee_config', 'fee_program'
    ];
    
    sellIx.keys.forEach((key, index) => {
      const name = accountNames[index] || 'unknown';
      console.log(`  ${index.toString().padStart(2)}: ${name.padEnd(20)} - ${key.pubkey.toString()}`);
    });
    
    // Create transaction
    const transaction = new Transaction().add(sellIx);
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = sellerKeypair.publicKey;
    
    console.log('\n🚀 Sending transaction...');
    console.log('⏳ This may take a few seconds...');
    
    try {
      // Send the transaction
      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [sellerKeypair],
        {
          commitment: 'confirmed',
          skipPreflight: false, // Enable preflight to catch errors early
        }
      );
      
      console.log(`\n🎉 SUCCESS! Sell transaction confirmed!`);
      console.log(`📊 Signature: ${signature}`);
      console.log(`🔗 Explorer: https://solscan.io/tx/${signature}`);
      
    } catch (txError: any) {
      console.log(`\n❌ Transaction failed: ${txError.message}`);
      
      // Analyze the error
      if (txError.message?.includes('0xbbd') || txError.message?.includes('3005')) {
        console.log('🚨 AccountNotEnoughKeys error - our fix may not be working!');
      } else if (txError.message?.includes('insufficient funds')) {
        console.log('💸 Insufficient funds - expected for test wallet');
      } else if (txError.message?.includes('TokenAccountNotFoundError')) {
        console.log('🪙 Token account not found - wallet has no tokens');
      } else if (txError.message?.includes('InvalidAccountData')) {
        console.log('📊 Invalid account data - check account structure');
      }
      
      // Show transaction logs if available
      if (txError.logs) {
        console.log('\n📜 Transaction Logs:');
        txError.logs.forEach((log: string, i: number) => {
          console.log(`  ${i}: ${log}`);
        });
      }
    }
    
  } catch (error: any) {
    console.error('❌ Error in sell test:', error.message);
  }
}

console.log('🔥 REAL SELL TRANSACTION TEST');
console.log('⚠️  To test with real tokens, replace the Keypair.generate() with your private key\n');

sendActualSell();