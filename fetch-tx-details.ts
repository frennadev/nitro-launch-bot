#!/usr/bin/env bun

/**
 * Fetch details from the actual sell transaction to analyze the structure
 */

import { connection } from './src/blockchain/common/connection';

const txSignature = '4ERTpLTjjJ9vP2MES7hs1HZw3VB9z5kvzP28sodwaPk4uY4Hr6g1Qqo48tM9FaZiq8Y8wcUKrYEECNA4euqD5J7Q';

async function fetchTransactionDetails() {
  try {
    console.log('🔍 Fetching transaction details...\n');
    
    const txDetails = await connection.getTransaction(txSignature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed'
    });

    if (!txDetails) {
      console.log('❌ Transaction not found or too old');
      return;
    }

    console.log('✅ Transaction found!');
    console.log(`📊 Slot: ${txDetails.slot}`);
    console.log(`⏰ Block Time: ${new Date((txDetails.blockTime || 0) * 1000).toISOString()}`);
    console.log(`💰 Fee: ${txDetails.meta?.fee} lamports`);
    console.log(`✅ Success: ${txDetails.meta?.err === null}\n`);

    if (txDetails.meta?.err) {
      console.log('❌ Transaction failed with error:', txDetails.meta.err);
      return;
    }

    // Analyze instructions
    console.log('🔍 Transaction Instructions:');
    txDetails.transaction.message.instructions.forEach((ix, index) => {
      const programId = txDetails.transaction.message.accountKeys[ix.programIdIndex];
      console.log(`  Instruction ${index}:`);
      console.log(`    Program: ${programId.toString()}`);
      console.log(`    Accounts: ${ix.accounts.length}`);
      console.log(`    Data: ${ix.data.length} bytes`);
      
      // Check if this is a PumpFun instruction
      if (programId.toString() === '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P') {
        console.log(`    🎯 This is a PumpFun instruction!`);
        
        // Try to decode the discriminator
        const data = Buffer.from(ix.data, 'base64');
        if (data.length >= 8) {
          const discriminator = Array.from(data.slice(0, 8));
          console.log(`    Discriminator: [${discriminator.join(', ')}]`);
          
          // Check if it matches sell discriminator [51, 230, 133, 164, 1, 127, 131, 173]
          const sellDiscriminator = [51, 230, 133, 164, 1, 127, 131, 173];
          const isSell = discriminator.every((byte, i) => byte === sellDiscriminator[i]);
          
          if (isSell) {
            console.log(`    🎯 CONFIRMED: This is a SELL instruction!`);
            console.log(`    📊 Accounts used: ${ix.accounts.length}`);
            
            // List all accounts
            console.log(`    Account details:`);
            ix.accounts.forEach((accountIndex, i) => {
              const account = txDetails.transaction.message.accountKeys[accountIndex];
              console.log(`      ${i.toString().padStart(2)}: ${account.toString()}`);
            });
          }
        }
      }
    });

    // Check logs for any errors
    if (txDetails.meta?.logMessages) {
      console.log('\n📝 Transaction Logs:');
      txDetails.meta.logMessages.forEach((log, index) => {
        if (log.includes('Error') || log.includes('failed')) {
          console.log(`  ❌ ${log}`);
        } else if (log.includes('Instruction:')) {
          console.log(`  🔧 ${log}`);
        }
      });
    }

  } catch (error) {
    console.error('❌ Error fetching transaction:', error);
  }
}

fetchTransactionDetails();