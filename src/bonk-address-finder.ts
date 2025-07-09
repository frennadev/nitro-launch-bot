import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import fs from "fs";
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";
import os from "os";
// import { dbManager } from "../db/db-con";
import { BonkAddressModel } from "./backend/models";
import { connectDB } from "./backend/db";

const SAVE_FOLDER = "./bonk-addresses";
const NUM_WORKERS = Math.max(2, Math.floor(os.cpus().length * 0.75)); // Use 75% of available CPU cores
const REPORT_INTERVAL = 100000; // Report progress every 100,000 attempts
const MAX_ADDRESSES_TO_SAVE = 20; // Save this many 'bonk' addresses
const SAVE_ALL_ADDRESSES = false; // Only save addresses ending with 'bonk'

// Create a function to check if a base58 string ends with 'bonk'
function endsWithBonk(address: string): boolean {
  return address.toLowerCase().endsWith("bonk");
}

// Worker process function
function runWorker(workerId: number) {
  let attempts = 0;
  const startTime = Date.now();
  let addressesSaved = 0;

  while (true) {
    const newKeypair = Keypair.generate();
    attempts++;

    if (attempts % REPORT_INTERVAL === 0) {
      const elapsedSeconds = (Date.now() - startTime) / 1000;
      const attemptsPerSecond = Math.round(attempts / elapsedSeconds);
      parentPort?.postMessage({
        type: "progress",
        workerId,
        attempts,
        attemptsPerSecond,
      });
    }

    const address = newKeypair.publicKey.toString();
    const isBonkAddress = endsWithBonk(address);

    // Only save 'bonk' addresses
    if (isBonkAddress) {
      const keypairData = {
        publicKey: newKeypair.publicKey.toString(),
        secretKey: bs58.encode(newKeypair.secretKey),
        rawSecretKey: Array.from(newKeypair.secretKey),
      };

      parentPort?.postMessage({
        type: "found",
        workerId,
        attempts,
        address,
        keypairData,
        isBonkAddress,
      });

      addressesSaved++;

      // If this worker has saved enough addresses, terminate it
      if (addressesSaved >= Math.ceil(MAX_ADDRESSES_TO_SAVE / NUM_WORKERS)) {
        parentPort?.postMessage({
          type: "complete",
          workerId,
          addressesSaved,
        });
        break; // Exit the worker loop
      }
    }
  }
}

// Main thread function to find addresses ending with 'bonk'
export async function findBonkAddresses() {
  console.log("=== Searching for Solana Addresses Ending with 'bonk' ===");
  console.log(`Using ${NUM_WORKERS} worker threads for parallel search`);
  console.log(`Target: ${MAX_ADDRESSES_TO_SAVE} bonk addresses to save to the database`);

  // Create save folder if it doesn't exist
  if (!fs.existsSync(SAVE_FOLDER)) {
    fs.mkdirSync(SAVE_FOLDER, { recursive: true });
  }

  let totalAttempts = 0;
  let foundAddresses = 0;
  let completedWorkers = 0;
  const startTime = Date.now();
  const workers: Worker[] = [];

  try {
    // Connect to database first
    await connectDB();

    console.log("Searching for addresses ending with 'bonk'...");
    console.log("This may take some time - we'll report progress regularly");

    // Create workers
    for (let i = 0; i < NUM_WORKERS; i++) {
      const worker = new Worker(__filename, {
        workerData: { id: i },
      });

      worker.on("message", async (message) => {
        if (message.type === "progress") {
          totalAttempts += REPORT_INTERVAL;
          const elapsedSeconds = (Date.now() - startTime) / 1000;
          const totalAttemptsPerSecond = Math.round(totalAttempts / elapsedSeconds);
          console.log(
            `Total attempts: ${totalAttempts.toLocaleString()} (${totalAttemptsPerSecond.toLocaleString()}/sec)`
          );
        } else if (message.type === "found") {
          foundAddresses++;
          const elapsedTime = (Date.now() - startTime) / 1000;

          console.log(
            `Found BONK address #${foundAddresses}: ${message.address} (after ~${totalAttempts.toLocaleString()} attempts, ${elapsedTime.toFixed(2)} seconds)`
          );

          // save to DB
          try {
            const newAddress = new BonkAddressModel({
              publicKey: message.keypairData.publicKey,
              secretKey: message.keypairData.secretKey,
              rawSecretKey: message.keypairData.rawSecretKey,
              isBonk: true, // All saved addresses are bonk addresses
            });

            await newAddress.save();

            // Save to file
            // const filename = `${SAVE_FOLDER}/bonk-address-${foundAddresses}.json`;
            // fs.writeFileSync(
            //   filename,
            //   JSON.stringify(message.keypairData, null, 2)
            // );
            // console.log(`Saved bonk keypair to ${filename}`);
          } catch (error) {
            console.error(`Error saving address to database: ${error}`);
          }
        } else if (message.type === "complete") {
          completedWorkers++;
          console.log(`Worker ${message.workerId} completed, saved ${message.addressesSaved} addresses`);

          // If all workers are done, terminate them
          if (completedWorkers >= NUM_WORKERS) {
            console.log(`\nAll workers completed. Stopping process.`);
            workers.forEach((w) => w.terminate());
          }
        }
      });

      worker.on("error", (error) => {
        console.error(`Worker ${i} error:`, error);
      });

      workers.push(worker);
    }

    // Wait for all workers to finish
    await Promise.all(
      workers.map((worker) => {
        return new Promise((resolve) => {
          worker.on("exit", resolve);
        });
      })
    );

    const totalElapsedTime = (Date.now() - startTime) / 1000;
    console.log(`\n=== Search Complete ===`);
    console.log(`Total attempts: ${totalAttempts.toLocaleString()}`);
    console.log(`Elapsed time: ${totalElapsedTime.toFixed(2)} seconds`);
    console.log(`Bonk addresses saved: ${foundAddresses}`);
    console.log(`\nBonk addresses saved to ${SAVE_FOLDER}/`);
    console.log("\nTo use these addresses for token creation:");
    console.log("1. Run npx bun auto-token-from-db.ts to create a token with a bonk address");
  } catch (error) {
    console.error("Error in address finder:", error);
    throw error;
  }
}

// Entry point

if (isMainThread) {
  // This is the main thread - start the address search
  findBonkAddresses().catch((err) => {
    console.error("Error searching for addresses:", err);
    process.exit(1);
  });
} else {
  // This is a worker thread - start generating addresses
  runWorker(workerData.id);
}
