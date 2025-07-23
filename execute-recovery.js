import { MongoClient } from 'mongodb';
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import * as crypto from 'crypto';

// Configuration
const DESTINATION_WALLET = 'D8HzTnuLAk5nL76cDq9bjZWc8LqQizodXC1G7oBVNQL2';
const FEE_FUNDING_PRIVATE_KEY = '5DxL2BEk9RWyd9vatheaRp6m91oRTpd5PEaDtFJV4kGFgEzhFSukbLX66tF9eo3KuvCwmBHTxwGyVDGgwX2vPwKD';

// The two main wallets with stuck SOL
const STUCK_WALLETS = [
  '5FsGFoSfFDnmV6S28uBqhDnjWWVaE6UTcyovmmcFbpUs', // 0.499000 SOL
  'PbHRCv4jJXaN6QksQGdL3MJT6993QUoNUZWJSHazB4r'   // 0.613770 SOL
];

async function executeRecovery() {
  console.log('🚀 Executing SOL recovery...\n');
  
  const mongoUri = process.env.MONGODB_URI || "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=Bundler";
  const databaseName = process.env.DATABASE_NAME || "test";
  
  let client;
  
  try {
    // Connect to MongoDB
    client = new MongoClient(mongoUri);
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db(databaseName);
    const walletsCollection = db.collection('mixer_wallets');
    
    // Setup Solana connection
    const connection = new Connection(
      process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
      'confirmed'
    );
    
    // Setup fee funding wallet
    const feeFundingWallet = Keypair.fromSecretKey(bs58.decode(FEE_FUNDING_PRIVATE_KEY));
    console.log(`💳 Fee funding wallet: ${feeFundingWallet.publicKey.toString()}`);
    
    // Check fee funding wallet balance
    const feeFundingBalance = await connection.getBalance(feeFundingWallet.publicKey);
    console.log(`💰 Fee funding balance: ${(feeFundingBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    
    if (feeFundingBalance < 0.01 * LAMPORTS_PER_SOL) {
      throw new Error('Insufficient funds in fee funding wallet. Need at least 0.01 SOL for fees.');
    }
    
    let totalRecovered = 0;
    let successfulRecoveries = 0;
    
    // Process each stuck wallet
    for (const walletAddress of STUCK_WALLETS) {
      try {
        console.log(`\n🔄 Processing wallet: ${walletAddress.slice(0, 8)}...${walletAddress.slice(-8)}`);
        
        // Get wallet from MongoDB
        const walletDoc = await walletsCollection.findOne({ publicKey: walletAddress });
        if (!walletDoc) {
          console.log(`❌ Wallet not found in database: ${walletAddress}`);
          continue;
        }
        
        // Check current balance
        const pubkey = new PublicKey(walletAddress);
        const balance = await connection.getBalance(pubkey);
        const solBalance = balance / LAMPORTS_PER_SOL;
        
        console.log(`💰 Current balance: ${solBalance.toFixed(6)} SOL`);
        
        if (solBalance < 0.001) {
          console.log(`⚠️  Insufficient balance to recover`);
          continue;
        }
        
        // Decrypt private key using the correct format
        const encryptionKey = "294f6d574446132dcb92d050612dea7aa8cdfe918f29adc9681e1cdf75ad42bb";
        const decryptedPrivateKey = decryptPrivateKey(walletDoc.privateKey, encryptionKey);
        const sourceKeypair = Keypair.fromSecretKey(decryptedPrivateKey);
        
        console.log(`🔑 Private key decrypted successfully`);
        
        // Calculate transfer amount (leave some for rent exemption)
        const rentExemption = await connection.getMinimumBalanceForRentExemption(0);
        const estimatedFee = 5000; // Base transaction fee
        const maxTransferable = balance - rentExemption - estimatedFee;
        
        if (maxTransferable <= 0) {
          console.log(`⚠️  Insufficient funds for transfer after fees and rent exemption`);
          continue;
        }
        
        console.log(`📤 Transferring ${(maxTransferable / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
        
        // Create transfer transaction
        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: sourceKeypair.publicKey,
            toPubkey: new PublicKey(DESTINATION_WALLET),
            lamports: Math.floor(maxTransferable)
          })
        );
        
        // Get recent blockhash
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = feeFundingWallet.publicKey;
        
        // Sign and send transaction
        transaction.sign(sourceKeypair, feeFundingWallet);
        
        const signature = await connection.sendTransaction(transaction, [sourceKeypair, feeFundingWallet]);
        console.log(`📤 Transaction sent: ${signature}`);
        
        // Wait for confirmation
        const confirmation = await connection.confirmTransaction(signature, 'confirmed');
        
        if (confirmation.value.err) {
          throw new Error(`Transaction failed: ${confirmation.value.err}`);
        }
        
        console.log(`✅ Successfully recovered ${(maxTransferable / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
        totalRecovered += maxTransferable / LAMPORTS_PER_SOL;
        successfulRecoveries++;
        
        // Update wallet status in database
        await walletsCollection.updateOne(
          { publicKey: walletAddress },
          { 
            $set: { 
              status: "available",
              balance: 0
            },
            $push: {
              transactionHistory: {
                signature,
                type: "send",
                amount: maxTransferable,
                timestamp: new Date(),
                toAddress: DESTINATION_WALLET
              }
            }
          }
        );
        
        console.log(`📝 Database updated for ${walletAddress}`);
        
        // Small delay between transactions
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error) {
        console.log(`❌ Failed to recover from ${walletAddress}: ${error.message}`);
      }
    }
    
    console.log(`\n🎉 Recovery Complete!`);
    console.log(`✅ Successful recoveries: ${successfulRecoveries}`);
    console.log(`💰 Total SOL recovered: ${totalRecovered.toFixed(6)} SOL`);
    console.log(`📍 All funds sent to: ${DESTINATION_WALLET}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (client) {
      await client.close();
      console.log('\n🔌 Disconnected from MongoDB');
    }
  }
}

// Decrypt private key function - Fixed to match mixer format
function decryptPrivateKey(encryptedPrivateKey, encryptionKey) {
  try {
    const algorithm = "aes-256-cbc";
    const key = crypto.scryptSync(encryptionKey, "salt", 32);

    const parts = encryptedPrivateKey.split(":");
    if (parts.length !== 2) {
      throw new Error("Invalid encrypted private key format");
    }

    const iv = Buffer.from(parts[0], "hex");
    const encrypted = parts[1];

    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return bs58.decode(decrypted);
  } catch (error) {
    throw new Error(`Failed to decrypt private key: ${error.message}`);
  }
}

// Run the recovery
executeRecovery().catch(console.error); 