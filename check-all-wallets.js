import mongoose from 'mongoose';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

// Configuration
const MONGODB_URI = "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/nitro_launch";
const RPC_ENDPOINT = 'https://mainnet.helius-rpc.com/?api-key=74feaea1-f5ce-4ef6-a124-49dd51e76f67';

// Define wallet pool schema
const walletPoolSchema = new mongoose.Schema({
    publicKey: { type: String, required: true, unique: true },
    privateKey: { type: String, required: true },
    isAllocated: { type: Boolean, default: false },
    allocatedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    allocatedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
}, { timestamps: true });

// Define wallet schema
const walletSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    publicKey: { type: String, required: true },
    privateKey: { type: String, required: true },
    isDev: { type: Boolean, required: true, default: false },
    isBuyer: { type: Boolean, required: true, default: false },
    isFunding: { type: Boolean, required: true, default: false },
    isDefault: { type: Boolean, default: false },
}, { timestamps: true });

const WalletPoolModel = mongoose.model('WalletPool', walletPoolSchema);
const WalletModel = mongoose.model('Wallet', walletSchema);

// Sleep function
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getWalletBalance(connection, publicKey) {
    try {
        const balance = await connection.getBalance(publicKey);
        return balance / LAMPORTS_PER_SOL;
    } catch (error) {
        console.error(`Error getting balance for ${publicKey.toString()}:`, error.message);
        return 0;
    }
}

async function checkAllWallets() {
    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB');
        
        // Check WalletPool
        const poolWallets = await WalletPoolModel.find({}).lean();
        console.log(`Found ${poolWallets.length} wallets in WalletPool`);
        
        // Check Wallet
        const userWallets = await WalletModel.find({}).lean();
        console.log(`Found ${userWallets.length} wallets in Wallet collection`);
        
        if (poolWallets.length > 0) {
            console.log('\nSample WalletPool structure:');
            console.log(JSON.stringify(poolWallets[0], null, 2));
        }
        
        if (userWallets.length > 0) {
            console.log('\nSample Wallet structure:');
            console.log(JSON.stringify(userWallets[0], null, 2));
        }
        
        let totalBalance = 0;
        let walletsWithBalance = 0;
        let processedCount = 0;
        
        console.log('\n=== CHECKING WALLET POOL BALANCES ===');
        
        for (const wallet of poolWallets) {
            try {
                processedCount++;
                if (processedCount % 100 === 0) {
                    console.log(`Processed ${processedCount}/${poolWallets.length} pool wallets...`);
                }
                
                const publicKey = new PublicKey(wallet.publicKey);
                const balance = await getWalletBalance(connection, publicKey);
                
                if (balance > 0) {
                    console.log(`POOL: ${wallet.publicKey}: ${balance.toFixed(6)} SOL (Allocated: ${wallet.isAllocated})`);
                    totalBalance += balance;
                    walletsWithBalance++;
                }
                
                // Add small delay to avoid rate limiting
                await sleep(50);
                
            } catch (error) {
                console.error(`Error checking pool wallet ${wallet.publicKey}:`, error.message);
            }
        }
        
        console.log('\n=== CHECKING USER WALLET BALANCES ===');
        processedCount = 0;
        
        for (const wallet of userWallets) {
            try {
                processedCount++;
                if (processedCount % 100 === 0) {
                    console.log(`Processed ${processedCount}/${userWallets.length} user wallets...`);
                }
                
                const publicKey = new PublicKey(wallet.publicKey);
                const balance = await getWalletBalance(connection, publicKey);
                
                if (balance > 0) {
                    console.log(`USER: ${wallet.publicKey}: ${balance.toFixed(6)} SOL (Dev: ${wallet.isDev}, Buyer: ${wallet.isBuyer}, Funding: ${wallet.isFunding})`);
                    totalBalance += balance;
                    walletsWithBalance++;
                }
                
                // Add small delay to avoid rate limiting
                await sleep(50);
                
            } catch (error) {
                console.error(`Error checking user wallet ${wallet.publicKey}:`, error.message);
            }
        }
        
        console.log('\n=== SUMMARY ===');
        console.log(`Total pool wallets: ${poolWallets.length}`);
        console.log(`Total user wallets: ${userWallets.length}`);
        console.log(`Wallets with balance: ${walletsWithBalance}`);
        console.log(`Total SOL in all wallets: ${totalBalance.toFixed(6)} SOL`);
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

checkAllWallets().catch(console.error); 