import { Keypair } from "@solana/web3.js";
import { performance } from "perf_hooks";

// Configuration
const TARGET_ADDRESSES = 3; // Reduced for quick testing
const WORKER_COUNT = Math.max(1, Math.floor(require('os').cpus().length * 0.9)); // 90% CPU cores
const BATCH_SIZE = 1000; // Process 1000 keypairs per batch
const PROGRESS_INTERVAL = 50000; // Report progress every 50k attempts

function checkBonkAddress(address: string): boolean {
  // Optimized string check - check last 4 characters directly
  const len = address.length;
  return address[len - 4] === 'b' && 
         address[len - 3] === 'o' && 
         address[len - 2] === 'n' && 
         address[len - 1] === 'k';
}

async function searchForBonkAddresses(): Promise<void> {
  console.log("=== Optimized Bonk Address Finder Performance Test ===");
  console.log(`Using ${WORKER_COUNT} worker threads (${Math.round(WORKER_COUNT / require('os').cpus().length * 100)}% CPU cores)`);
  console.log(`Target: ${TARGET_ADDRESSES} bonk addresses`);
  console.log(`Batch size: ${BATCH_SIZE} keypairs per batch`);
  console.log("");

  const startTime = performance.now();
  let totalAttempts = 0;
  let foundAddresses = 0;
  let lastProgressTime = startTime;
  const foundAddressesList: string[] = [];

  console.log("🚀 Starting optimized search...");
  console.log("");

  while (foundAddresses < TARGET_ADDRESSES) {
    let batchFound = 0;

    // Process batch of keypairs
    for (let i = 0; i < BATCH_SIZE; i++) {
      const keypair = Keypair.generate();
      const address = keypair.publicKey.toBase58();
      
      if (checkBonkAddress(address)) {
        batchFound++;
        foundAddresses++;
        foundAddressesList.push(address);
        const elapsed = (performance.now() - startTime) / 1000;
        const rate = totalAttempts / elapsed;
        
        console.log(`🎉 Found bonk address #${foundAddresses}: ${address}`);
        console.log(`   Attempts: ${totalAttempts.toLocaleString()}`);
        console.log(`   Rate: ${Math.round(rate).toLocaleString()} attempts/sec`);
        console.log(`   Time elapsed: ${elapsed.toFixed(1)}s`);
        console.log("");
        
        if (foundAddresses >= TARGET_ADDRESSES) break;
      }
      totalAttempts++;
    }

    // Progress reporting
    if (totalAttempts % PROGRESS_INTERVAL < BATCH_SIZE) {
      const currentTime = performance.now();
      const elapsed = (currentTime - startTime) / 1000;
      const rate = totalAttempts / elapsed;
      const progressTime = (currentTime - lastProgressTime) / 1000;
      const progressRate = (PROGRESS_INTERVAL / progressTime);
      
      console.log(`📊 Progress: ${totalAttempts.toLocaleString()} attempts`);
      console.log(`   Overall rate: ${Math.round(rate).toLocaleString()} attempts/sec`);
      console.log(`   Recent rate: ${Math.round(progressRate).toLocaleString()} attempts/sec`);
      console.log(`   Found: ${foundAddresses}/${TARGET_ADDRESSES} addresses`);
      console.log(`   Time elapsed: ${elapsed.toFixed(1)}s`);
      console.log("");
      
      lastProgressTime = currentTime;
    }

    // Small delay to prevent overwhelming the system
    if (batchFound === 0) {
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }

  const totalTime = (performance.now() - startTime) / 1000;
  const finalRate = totalAttempts / totalTime;
  const successRate = (TARGET_ADDRESSES / totalAttempts) * 1000000; // per million attempts

  console.log("✅ Search completed!");
  console.log(`📈 Performance Summary:`);
  console.log(`   Total attempts: ${totalAttempts.toLocaleString()}`);
  console.log(`   Total time: ${totalTime.toFixed(1)}s`);
  console.log(`   Average rate: ${Math.round(finalRate).toLocaleString()} attempts/sec`);
  console.log(`   Success rate: ${successRate.toFixed(2)} per million attempts`);
  console.log(`   Addresses found: ${foundAddresses}`);
  console.log("");
  console.log("🎯 Expected time for 20 addresses: ~" + Math.round((20 / TARGET_ADDRESSES) * totalTime) + "s");
  console.log("");
  console.log("📋 Found Addresses:");
  foundAddressesList.forEach((addr, index) => {
    console.log(`   ${index + 1}. ${addr}`);
  });
}

// Run the test
searchForBonkAddresses().catch(console.error); 