import { detectTokenPlatform } from './src/service/token-detection-service.ts';
import BonkService from './src/service/bonk-service.ts';
import RaydiumCPMMService from './src/service/raydium-cpmm-service.ts';
import { Keypair, PublicKey } from '@solana/web3.js';
import { connection } from './src/service/config.ts';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import bs58 from 'bs58';

const TOKEN_ADDRESS = 'BmjaULzZoEKnGpwGMfdCSEeTio3giS1qgbGBnU5Gbonk';
const PRIVATE_KEY = '2anwmaACaSFZjraSLe924wdEYApyb2JrZUAdH7Csx2pR2qYBSaxejVg4bzGzaTZaTX9VUn7GRoacvHoUdb1qWuGu';

async function getTokenBalance(tokenMint: PublicKey, owner: PublicKey): Promise<bigint> {
    try {
        const tokenAta = getAssociatedTokenAddressSync(tokenMint, owner);
        const balance = await connection.getTokenAccountBalance(tokenAta);
        return BigInt(balance.value.amount);
    } catch (error) {
        console.log('Token account not found or has zero balance');
        return BigInt(0);
    }
}

async function testSellEntireBalance() {
    try {
        console.log('🔍 Starting sell entire balance test...');
        console.log(`Token: ${TOKEN_ADDRESS}`);
        console.log(`RPC: ${connection.rpcEndpoint}`);
        
        // Create keypair from private key
        const keypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
        console.log(`Wallet: ${keypair.publicKey.toString()}`);
        
        const tokenMint = new PublicKey(TOKEN_ADDRESS);
        
        // Check token balance
        console.log('\n💰 Checking token balance...');
        const tokenBalance = await getTokenBalance(tokenMint, keypair.publicKey);
        console.log(`Token balance: ${tokenBalance.toString()}`);
        
        if (tokenBalance === BigInt(0)) {
            console.log('❌ No tokens to sell');
            return;
        }
        
        // Step 1: Detect platform
        console.log('\n📊 Detecting platform...');
        const platform = await detectTokenPlatform(TOKEN_ADDRESS);
        console.log(`Detected platform: ${platform}`);
        
        // Step 2: Send sell transaction based on platform
        console.log('\n💸 Sending sell transaction for entire balance...');
        let sellResult;
        
        if (platform === 'bonk') {
            console.log('Using Bonk service with fee collection...');
            const bonkService = new BonkService();
            sellResult = await bonkService.sellWithFeeCollection({
                mint: tokenMint,
                amount: tokenBalance, // Sell entire balance
                privateKey: PRIVATE_KEY
            });
            
            console.log('\n✅ Bonk sell transaction completed with fee collection!');
            console.log(`Transaction signature: ${sellResult.signature}`);
            console.log(`Estimated transaction amount: ${sellResult.estimatedTransactionAmountSol} SOL`);
            console.log(`Fee collected: ${sellResult.feeCollected}`);
            console.log(`Status: Confirmed`);
            
        } else if (platform === 'cpmm') {
            console.log('Using Raydium CPMM service with fee collection...');
            const cpmmService = new RaydiumCPMMService();
            sellResult = await cpmmService.sellWithFeeCollection({
                mint: TOKEN_ADDRESS,
                amount_in: tokenBalance, // Sell entire balance
                privateKey: PRIVATE_KEY
            });
            
            console.log('\n✅ CPMM sell transaction completed with fee collection!');
            console.log(`Transaction signature: ${sellResult.signature}`);
            console.log(`Estimated transaction amount: ${sellResult.estimatedTransactionAmountSol} SOL`);
            console.log(`Fee collected: ${sellResult.feeCollected}`);
            console.log(`Status: Confirmed`);
            
        } else {
            throw new Error(`Unsupported platform: ${platform}`);
        }
        
        // Check final balance
        console.log('\n📊 Checking final token balance...');
        const finalBalance = await getTokenBalance(tokenMint, keypair.publicKey);
        console.log(`Final token balance: ${finalBalance.toString()}`);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.logs) {
            console.error('Transaction logs:', error.logs);
        }
    }
}

testSellEntireBalance(); 