import { detectTokenPlatform } from './src/service/token-detection-service.ts';
import BonkService from './src/service/bonk-service.ts';
import RaydiumCPMMService from './src/service/raydium-cpmm-service.ts';
import { Keypair, PublicKey } from '@solana/web3.js';
import { connection } from './src/service/config.ts';
import bs58 from 'bs58';

const TOKEN_ADDRESS = 'BmjaULzZoEKnGpwGMfdCSEeTio3giS1qgbGBnU5Gbonk';
const PRIVATE_KEY = '2anwmaACaSFZjraSLe924wdEYApyb2JrZUAdH7Csx2pR2qYBSaxejVg4bzGzaTZaTX9VUn7GRoacvHoUdb1qWuGu';
const BUY_AMOUNT_SOL = 0.01;

async function testPlatformDetectionAndBuy() {
    try {
        console.log('🔍 Starting platform detection and buy test...');
        console.log(`Token: ${TOKEN_ADDRESS}`);
        console.log(`Buy amount: ${BUY_AMOUNT_SOL} SOL`);
        console.log(`RPC: ${connection.rpcEndpoint}`);
        
        // Create keypair from private key
        const keypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
        console.log(`Wallet: ${keypair.publicKey.toString()}`);
        
        // Step 1: Detect platform
        console.log('\n📊 Detecting platform...');
        const platform = await detectTokenPlatform(TOKEN_ADDRESS);
        console.log(`Detected platform: ${platform}`);
        
        // Step 2: Send buy transaction based on platform
        console.log('\n💰 Sending buy transaction...');
        let buyResult;
        
        if (platform === 'bonk') {
            console.log('Using Bonk service with fee collection...');
            const bonkService = new BonkService();
            buyResult = await bonkService.buyWithFeeCollection({
                mint: new PublicKey(TOKEN_ADDRESS),
                amount: BigInt(Math.floor(BUY_AMOUNT_SOL * 1e9)),
                privateKey: PRIVATE_KEY
            });
            
            console.log('\n✅ Bonk buy transaction completed with fee collection!');
            console.log(`Transaction signature: ${buyResult.signature}`);
            console.log(`Transaction amount: ${buyResult.transactionAmountSol} SOL`);
            console.log(`Fee collected: ${buyResult.feeCollected}`);
            console.log(`Status: Confirmed`);
            
        } else if (platform === 'cpmm') {
            console.log('Using Raydium CPMM service with fee collection...');
            const cpmmService = new RaydiumCPMMService();
            buyResult = await cpmmService.buyWithFeeCollection({
                mint: TOKEN_ADDRESS,
                amount_in: BigInt(Math.floor(BUY_AMOUNT_SOL * 1e9)),
                privateKey: PRIVATE_KEY
            });
            
            console.log('\n✅ CPMM buy transaction completed with fee collection!');
            console.log(`Transaction signature: ${buyResult.signature}`);
            console.log(`Transaction amount: ${buyResult.transactionAmountSol} SOL`);
            console.log(`Fee collected: ${buyResult.feeCollected}`);
            console.log(`Status: Confirmed`);
            
        } else {
            throw new Error(`Unsupported platform: ${platform}`);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.logs) {
            console.error('Transaction logs:', error.logs);
        }
    }
}

testPlatformDetectionAndBuy(); 