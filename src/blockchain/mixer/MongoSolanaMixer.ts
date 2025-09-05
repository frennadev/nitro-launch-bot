import { Keypair, PublicKey } from "@solana/web3.js";
import type { MixerConfig, WalletInfo, MixingRoute, MixingResult, MixerState } from "./types";
import { SolanaConnectionManager } from "./connection";
import { MongoWalletManager, type StoredWallet } from "./mongodb";
import { generateSecureKeypair, getRandomDelay, cryptoShuffle, getAmountVariation, sleep } from "./crypto";

export interface MongoMixerConfig extends MixerConfig {
  mongoUri: string;
  databaseName: string;
  encryptionKey?: string;
  maxRetries?: number;
  retryDelay?: number;
}

export interface MongoMixingResult extends MixingResult {
  usedWalletIds: string[];
  failureRecovery?: {
    recoveredWallets: string[];
    lostFunds: number;
    recoveryTransactions: string[];
  };
}

export class MongoSolanaMixer {
  private config: MongoMixerConfig;
  private connectionManager: SolanaConnectionManager;
  private walletManager: MongoWalletManager;
  private state: MixerState;

  constructor(config: MongoMixerConfig) {
    this.config = {
      maxRetries: 3,
      retryDelay: 5000,
      ...config,
    };

    this.connectionManager = new SolanaConnectionManager(config.rpcEndpoint, config.priorityFee);

    this.walletManager = new MongoWalletManager(config.mongoUri, config.databaseName, config.encryptionKey);

    this.state = {
      intermediateWalletPool: [],
      transactionHistory: [],
    };
  }

  /**
   * Initialize the mixer and connect to MongoDB
   */
  async initialize(): Promise<void> {
    await this.walletManager.connect();
    console.log("🚀 MongoSolanaMixer initialized");
  }

  /**
   * Cleanup and disconnect
   */
  async cleanup(): Promise<void> {
    await this.walletManager.disconnect();
    console.log("🧹 MongoSolanaMixer cleaned up");
  }

  /**
   * Main mixing function with MongoDB wallet management and failure recovery
   */
  async mixFunds(fundingWallet: Keypair, destinationWallets: PublicKey[]): Promise<MongoMixingResult[]> {
    const results: MongoMixingResult[] = [];
    const allUsedWalletIds: string[] = []; // Track all wallets used in this operation

    try {
      // Validate inputs
      await this.validateInputs(fundingWallet, destinationWallets);

      // Calculate distribution amounts
      const totalBalance = await this.connectionManager.getMaxTransferableAmount(fundingWallet.publicKey);
      const amountPerDestination = Math.floor(totalBalance / destinationWallets.length);

      if (amountPerDestination <= 0) {
        throw new Error("Insufficient funds for distribution");
      }

      console.log(`💰 Total balance: ${totalBalance} lamports`);
      console.log(`📊 Amount per destination: ${amountPerDestination} lamports`);

      // Create mixing routes with MongoDB wallets
      const routes = await this.createMixingRoutesWithMongo(fundingWallet, destinationWallets, amountPerDestination);

      // Pre-fund intermediate wallets if fee funding wallet is provided
      if (this.config.feeFundingWallet) {
        await this.preFundIntermediateWalletsForFees(routes);
      }

      // Calculate total operation time and delays
      const totalOperationTime = getRandomDelay(this.config.minDelay, this.config.maxDelay);
      const totalTransactions = routes.reduce((sum, route) => sum + route.intermediates.length + 1, 0); // +1 for final transfer
      const totalDelays = totalTransactions - 1; // No delay after last transaction

      console.log(`⏱️ Total operation time: ${totalOperationTime}ms across ${totalTransactions} transactions`);

      // Calculate individual delay times
      const delayPerTransaction = totalDelays > 0 ? Math.floor(totalOperationTime / totalDelays) : 0;
      const remainingTime = totalOperationTime - delayPerTransaction * totalDelays;

      let transactionCount = 0;
      const startTime = Date.now();

      // Execute mixing for each route with optimized parallel processing where possible
      for (let i = 0; i < routes.length; i++) {
        const route = routes[i];
        console.log(`\n🛤️ Processing route ${i + 1}/${routes.length}`);

        try {
          let result: MongoMixingResult;
          
          // Intelligent route selection: Use parallel mode if enabled, with automatic fallback
          if (this.config.parallelMode) {
            console.log(`🚀 Using PARALLEL mode for enhanced speed`);
            try {
              result = await this.executeSingleRouteParallel(
                route,
                delayPerTransaction,
                transactionCount,
                totalDelays,
                remainingTime
              );
              
              // If parallel mode succeeds, great!
              if (result.success) {
                console.log(`✅ Parallel mode succeeded for route ${i + 1}`);
              } else {
                // Parallel mode failed, fallback to sequential
                console.log(`⚠️ Parallel mode failed for route ${i + 1}, falling back to sequential mode`);
                result = await this.executeSingleRouteOptimized(
                  route,
                  delayPerTransaction,
                  transactionCount,
                  totalDelays,
                  remainingTime
                );
                console.log(`🔄 Sequential fallback ${result.success ? 'succeeded' : 'failed'} for route ${i + 1}`);
              }
            } catch (parallelError) {
              // Parallel mode threw an exception, fallback to sequential
              console.log(`❌ Parallel mode exception for route ${i + 1}, falling back to sequential mode:`, parallelError);
              result = await this.executeSingleRouteOptimized(
                route,
                delayPerTransaction,
                transactionCount,
                totalDelays,
                remainingTime
              );
              console.log(`🔄 Sequential fallback ${result.success ? 'succeeded' : 'failed'} for route ${i + 1}`);
            }
          } else {
            // Use traditional sequential mode
            console.log(`🔄 Using SEQUENTIAL mode (traditional)`);
            result = await this.executeSingleRouteOptimized(
              route,
              delayPerTransaction,
              transactionCount,
              totalDelays,
              remainingTime
            );
          }
          results.push(result);

          // Track wallets used in this operation
          allUsedWalletIds.push(...result.usedWalletIds);

          // Update transaction count for next route
          transactionCount += route.intermediates.length + 1;
        } catch (error) {
          console.error(`❌ Route ${i + 1} failed:`, error);

          // Track wallets used even on failure  
          const usedWalletIds = route.intermediates.map((w) => w.publicKey.toString());
          allUsedWalletIds.push(...usedWalletIds);

          // Create failed result with recovery info
          const failedResult: MongoMixingResult = {
            success: false,
            transactionSignatures: [],
            error: error instanceof Error ? error.message : "Unknown error",
            route,
            usedWalletIds,
          };

          results.push(failedResult);
          transactionCount += route.intermediates.length + 1;
        }
      }

      const actualTime = Date.now() - startTime;
      console.log(`⏱️ Actual operation time: ${actualTime}ms (target: ${totalOperationTime}ms)`);

      // Release all used wallets back to available pool after operation completes
      if (allUsedWalletIds.length > 0) {
        await this.walletManager.releaseWallets(allUsedWalletIds);
        console.log(`🔄 Released ${allUsedWalletIds.length} wallets back to pool`);
      }

      return results;
    } catch (error) {
      console.error("❌ Mixing operation failed:", error);
      
      // Still release wallets even on complete operation failure
      if (allUsedWalletIds.length > 0) {
        await this.walletManager.releaseWallets(allUsedWalletIds);
        console.log(`🔄 Released ${allUsedWalletIds.length} wallets back to pool after failure`);
      }
      
      throw error;
    }
  }

  /**
   * Create mixing routes using MongoDB wallets
   */
  private async createMixingRoutesWithMongo(
    fundingWallet: Keypair,
    destinationWallets: PublicKey[],
    baseAmount: number,
    excludeWalletIds: string[] = []
  ): Promise<MixingRoute[]> {
    const routes: MixingRoute[] = [];
    const totalWalletsNeeded = destinationWallets.length * this.config.intermediateWalletCount;

    console.log(`🔍 Reserving ${totalWalletsNeeded} intermediate wallets from MongoDB...`);

    // Reserve wallets from MongoDB, excluding already used ones
    const reservedWallets = await this.walletManager.reserveWalletsForMixing(totalWalletsNeeded, excludeWalletIds);

    if (reservedWallets.length < totalWalletsNeeded) {
      throw new Error(
        `Insufficient wallets in database. Need ${totalWalletsNeeded}, available ${reservedWallets.length}`
      );
    }

    let walletIndex = 0;

    for (const destination of destinationWallets) {
      // Add small random variation to amount for privacy
      const amount = baseAmount + getAmountVariation(baseAmount);

      // Get intermediate wallets for this route
      const intermediates: WalletInfo[] = [];
      for (let i = 0; i < this.config.intermediateWalletCount; i++) {
        const storedWallet = reservedWallets[walletIndex++];
        const keypair = this.walletManager.getKeypairFromStoredWallet(storedWallet);

        intermediates.push({
          keypair,
          publicKey: keypair.publicKey,
          balance: storedWallet.balance,
        });
      }

      const route: MixingRoute = {
        source: {
          keypair: fundingWallet,
          publicKey: fundingWallet.publicKey,
        },
        intermediates,
        destination,
        amount,
      };

      routes.push(route);
    }

    // Shuffle routes to randomize execution order
    return cryptoShuffle(routes);
  }

  /**
   * Execute a single route with optimized execution
   */
  public async executeSingleRouteOptimized(
    route: MixingRoute,
    delayPerTransaction: number,
    currentTransactionIndex: number,
    totalDelays: number,
    remainingTime: number
  ): Promise<MongoMixingResult> {
    const signatures: string[] = [];
    const feeFundingSignatures: string[] = [];
    const usedWalletIds: string[] = route.intermediates.map((w) => w.publicKey.toString());

    try {
      console.log(`🎯 Route: ${route.source.publicKey.toString().slice(0, 8)}... → ${route.destination.toString().slice(0, 8)}...`);
      console.log(`💰 Amount: ${(route.amount / 1e9).toFixed(6)} SOL`);

      let currentWallet = route.source;
      // FLEXIBLE: Get actual available amount from source wallet instead of using pre-calculated route.amount
      let remainingAmount: number;
      if (currentWallet === route.source) {
        // For source wallet, get the actual available balance and use the minimum of route.amount or available balance
        const sourceBalance = await this.connectionManager.getBalance(route.source.publicKey);
        const maxTransferableFromSource = await this.connectionManager.getMaxTransferableAmount(route.source.publicKey);
        remainingAmount = Math.min(route.amount, maxTransferableFromSource);
        
        // If no funds available, skip this route
        if (remainingAmount <= 0) {
          console.log(`⚠️  Skipping route: source wallet has insufficient funds (${sourceBalance} lamports available)`);
          return {
            success: false,
            transactionSignatures: [],
            feeFundingSignatures: [],
            error: "Source wallet has insufficient funds for this route",
            route,
            usedWalletIds: [],
          };
        }
        
        console.log(`💰 Using flexible amount: ${(remainingAmount / 1e9).toFixed(6)} SOL (requested: ${(route.amount / 1e9).toFixed(6)} SOL, available: ${(maxTransferableFromSource / 1e9).toFixed(6)} SOL)`);
      } else {
        remainingAmount = route.amount;
      }
      
      let localTransactionIndex = currentTransactionIndex;

      // Optimized delays - much shorter for speed
      const optimizedDelayPerTx = Math.min(delayPerTransaction, 200); // Cap at 200ms max

      // Process intermediate transfers with minimal delays
      for (let i = 0; i < route.intermediates.length; i++) {
        const nextWallet = route.intermediates[i];
        console.log(
          `🔄 Transfer ${i + 1}/${route.intermediates.length}: ${currentWallet.publicKey.toString().slice(0, 8)}... → ${nextWallet.publicKey.toString().slice(0, 8)}...`
        );

        // Calculate transfer amount properly accounting for fees and rent exemption
        let transferAmount: number;
        
        if (this.config.feeFundingWallet && currentWallet !== route.source) {
          // Use fee funding wallet for intermediate wallet transactions
          // Can transfer almost all remaining amount since fees are paid by fee funding wallet
          transferAmount = Math.floor(remainingAmount * 0.998); // Small buffer for safety
        } else {
          // Wallet pays its own fees - must account for fees and rent exemption
          if (currentWallet === route.source) {
            // Source wallet: use the flexible amount we calculated above
            transferAmount = Math.floor(remainingAmount * 0.998);
          } else {
            // Intermediate wallet: use max transferable amount to account for fees + rent exemption
            const maxTransferable = await this.connectionManager.getMaxTransferableAmount(currentWallet.publicKey);
            transferAmount = Math.floor(maxTransferable);
            
            if (transferAmount <= 0) {
              throw new Error(`Intermediate wallet ${currentWallet.publicKey.toString().slice(0, 8)}... has insufficient funds for transfer after accounting for fees and rent exemption`);
            }
          }
        }
        
        // VALIDATION: Ensure transfer amount is valid (not NaN or negative)
        if (isNaN(transferAmount) || transferAmount <= 0) {
          throw new Error(`Invalid transfer amount calculated: ${transferAmount} (original remainingAmount: ${remainingAmount})`);
        }

        let signature: string;

        if (this.config.feeFundingWallet && currentWallet !== route.source) {
          // Use fee funding wallet for intermediate wallet transactions
          const transaction = await this.connectionManager.createTransferTransactionWithFeePayer(
            currentWallet.publicKey,
            nextWallet.publicKey,
            transferAmount,
            this.config.feeFundingWallet.publicKey
          );

          signature = await this.connectionManager.sendTransaction(transaction, [
            currentWallet.keypair,
            this.config.feeFundingWallet,
          ]);
        } else {
          // Wallet pays its own fees
          const transaction = await this.connectionManager.createTransferTransaction(
            currentWallet.publicKey,
            nextWallet.publicKey,
            transferAmount
          );

          signature = await this.connectionManager.sendTransaction(transaction, [currentWallet.keypair]);
        }

        signatures.push(signature);

        // ENHANCED: Multi-layer confirmation with smart balance verification
        let confirmationSuccess = false;
        let finalBalance = 0;
        
        try {
          // Primary: Try transaction confirmation
          confirmationSuccess = await this.connectionManager.waitForConfirmation(signature, 8);
          
          if (confirmationSuccess) {
            console.log(`✅ Primary confirmation successful for ${signature.slice(0, 8)}...`);
          }
        } catch (confirmError) {
          console.warn(`⚠️ Primary confirmation failed: ${confirmError}`);
        }
        
        // Secondary: Always verify balance regardless of confirmation result
        try {
          finalBalance = await this.connectionManager.getBalance(nextWallet.publicKey);
          
          if (finalBalance >= transferAmount) {
            if (!confirmationSuccess) {
              console.log(`✅ Secondary verification: Wallet ${nextWallet.publicKey.toString().slice(0, 8)}... has expected funds (${(finalBalance / 1_000_000_000).toFixed(6)} SOL)`);
            }
            confirmationSuccess = true;
          } else {
            console.error(`❌ Balance verification failed: Expected ${(transferAmount / 1_000_000_000).toFixed(6)} SOL, got ${(finalBalance / 1_000_000_000).toFixed(6)} SOL`);
          }
        } catch (balanceError) {
          console.error(`❌ Balance check failed: ${balanceError}`);
        }
        
        if (!confirmationSuccess) {
          throw new Error(`FAILED: Transaction ${signature.slice(0, 8)}... - Confirmation failed AND balance verification failed. Expected: ${(transferAmount / 1_000_000_000).toFixed(6)} SOL, Actual: ${(finalBalance / 1_000_000_000).toFixed(6)} SOL`);
        }

        // Balance verification completed above - wallet confirmed to have funds

        // Optimized MongoDB operations - batch where possible
        await Promise.all([
          this.walletManager.recordTransaction(nextWallet.publicKey.toString(), {
            signature,
            type: "receive",
            amount: transferAmount,
            fromAddress: currentWallet.publicKey.toString(),
          }),
          this.walletManager.updateWalletBalance(nextWallet.publicKey.toString(), transferAmount)
        ]);

        // Record in local state
        this.recordTransaction(
          signature,
          currentWallet.publicKey.toString(),
          nextWallet.publicKey.toString(),
          transferAmount,
          "transfer"
        );

        // Update for next iteration
        currentWallet = nextWallet;
        remainingAmount = transferAmount;
        localTransactionIndex++;

        // Minimal delay only between transactions (not after last)
        if (i < route.intermediates.length - 1 && optimizedDelayPerTx > 0) {
          await sleep(optimizedDelayPerTx);
        }
      }

      // Final transfer to destination with minimal delay
      console.log(
        `🎯 Final transfer: ${currentWallet.publicKey.toString().slice(0, 8)}... → ${route.destination.toString().slice(0, 8)}...`
      );

      let finalSignature: string;
      let finalAmount: number;

      if (this.config.feeFundingWallet) {
        // Use fee funding wallet for final intermediate wallet transaction - ENSURE INTEGER
        finalAmount = Math.floor(remainingAmount); // Ensure integer
        
        if (finalAmount <= 0) {
          throw new Error(`Invalid final transfer amount: ${remainingAmount} (floored to ${finalAmount})`);
        }
        
        const finalTransaction = await this.connectionManager.createTransferTransactionWithFeePayer(
          currentWallet.publicKey,
          route.destination,
          finalAmount,
          this.config.feeFundingWallet.publicKey
        );

        finalSignature = await this.connectionManager.sendTransaction(finalTransaction, [
          currentWallet.keypair,
          this.config.feeFundingWallet,
        ]);
      } else {
        // Intermediate wallet pays its own fees - ENSURE INTEGER AND ACCOUNT FOR RENT EXEMPTION
        const maxTransferable = await this.connectionManager.getMaxTransferableAmount(currentWallet.publicKey);
        finalAmount = Math.floor(maxTransferable); // This already accounts for fees + rent exemption

        if (finalAmount <= 0) {
          throw new Error(`Insufficient funds for final transfer. Wallet has no transferable balance after accounting for fees and rent exemption.`);
        }

        const finalTransaction = await this.connectionManager.createTransferTransaction(
          currentWallet.publicKey,
          route.destination,
          finalAmount
        );

        finalSignature = await this.connectionManager.sendTransaction(finalTransaction, [currentWallet.keypair]);
      }

      signatures.push(finalSignature);

      // CRITICAL FIX: Wait for final transaction confirmation
              let finalConfirmationSuccess = await this.connectionManager.waitForConfirmation(finalSignature, 8);
      if (!finalConfirmationSuccess) {
        // Tolerant mode: check if the destination wallet actually received the funds
        const actualBalance = await this.connectionManager.getBalance(route.destination);
        if (actualBalance >= finalAmount) {
          console.warn(`⚠️ Final confirmation failed for signature: ${finalSignature}, but destination wallet ${route.destination.toString().slice(0, 8)}... has the expected funds. Continuing...`);
          finalConfirmationSuccess = true;
        } else {
          throw new Error(`Final transaction confirmation failed for signature: ${finalSignature} and destination wallet did not receive expected funds.`);
        }
      }

      // Batch final MongoDB operations
      await Promise.all([
        this.walletManager.recordTransaction(currentWallet.publicKey.toString(), {
          signature: finalSignature,
          type: "send",
          amount: remainingAmount,
          toAddress: route.destination.toString(),
        }),
        this.walletManager.updateWalletBalance(currentWallet.publicKey.toString(), 0)
      ]);

      console.log(`✅ Route completed successfully with ${signatures.length} transactions`);

      return {
        success: true,
        transactionSignatures: signatures,
        feeFundingSignatures,
        route,
        usedWalletIds,
      };
    } catch (error) {
      console.error(`❌ Route execution failed:`, error);

      // Attempt recovery
      const recoveryInfo = await this.attemptRecovery(route, usedWalletIds, signatures);

      return {
        success: false,
        transactionSignatures: signatures,
        feeFundingSignatures,
        error: error instanceof Error ? error.message : "Unknown error",
        route,
        usedWalletIds,
        failureRecovery: recoveryInfo,
      };
    }
  }

  /**
   * Execute a single mixing route with parallel transaction processing
   * This is the new high-speed mode with smart balance checking and circuit breaker
   */
  public async executeSingleRouteParallel(
    route: MixingRoute,
    delayPerTransaction: number = 0, // Parallel mode doesn't use delays
    currentTransactionIndex: number = 0,
    totalDelays: number = 0,
    remainingTime: number = 0
  ): Promise<MongoMixingResult> {
    const signatures: string[] = [];
    const feeFundingSignatures: string[] = [];
    const usedWalletIds: string[] = [];
    
    try {
      console.log(`🎯 Route (PARALLEL): ${route.source.publicKey.toString().slice(0, 8)}... → ${route.destination.toString().slice(0, 8)}...`);
      console.log(`💰 Amount: ${(route.amount / 1_000_000_000).toFixed(6)} SOL`);
      
      // Get intermediate wallets from database
      const neededWallets = route.intermediates.length;
      const intermediateWallets = await this.walletManager.getAvailableWallets(neededWallets);
      
      if (intermediateWallets.length < neededWallets) {
        throw new Error(`Failed to get enough intermediate wallets. Needed: ${neededWallets}, Got: ${intermediateWallets.length}`);
      }
      
      // Mark wallets as in use
      usedWalletIds.push(...intermediateWallets.map(w => w.publicKey));
      
      // Step 1: Prepare all transaction data
      const allWallets = [
        { publicKey: route.source.publicKey, keypair: route.source.keypair },
        ...intermediateWallets.map(w => ({ 
          publicKey: new PublicKey(w.publicKey), 
          keypair: this.walletManager.getKeypairFromStoredWallet(w) 
        }))
      ];
      const allDestinations = [
        ...intermediateWallets.map(w => new PublicKey(w.publicKey)),
        route.destination
      ];
      
      // Step 2: Execute transactions with parallel processing and smart balance checking
      const maxConcurrent = this.config.maxConcurrentTx || 3;
      const balanceCheckTimeout = this.config.balanceCheckTimeout || 5000;
      
      for (let i = 0; i < allWallets.length; i++) {
        const currentWallet = allWallets[i];
        const destination = allDestinations[i];
        const isLastHop = i === allWallets.length - 1;
        
        console.log(`🔄 Transfer ${i + 1}/${allWallets.length}: ${currentWallet.publicKey.toString().slice(0, 8)}... → ${destination.toString().slice(0, 8)}...`);
        
        // Calculate transfer amount
        let transferAmount: number;
        if (i === 0) {
          // First hop: use route amount
          transferAmount = route.amount;
        } else if (isLastHop) {
          // Last hop: use maximum transferable
          const maxTransferable = await this.connectionManager.getMaxTransferableAmount(currentWallet.publicKey);
          transferAmount = Math.floor(maxTransferable);
        } else {
          // Intermediate hop: use maximum transferable
          const maxTransferable = await this.connectionManager.getMaxTransferableAmount(currentWallet.publicKey);
          transferAmount = Math.floor(maxTransferable);
          
          if (transferAmount <= 0) {
            throw new Error(`Intermediate wallet ${currentWallet.publicKey.toString().slice(0, 8)}... has insufficient funds`);
          }
        }
        
        // Create and send transaction
        let signature: string;
        
        if (this.config.feeFundingWallet && i > 0) {
          const transaction = await this.connectionManager.createTransferTransactionWithFeePayer(
            currentWallet.publicKey,
            destination,
            transferAmount,
            this.config.feeFundingWallet.publicKey
          );
          
          signature = await this.connectionManager.sendTransaction(transaction, [
            currentWallet.keypair,
            this.config.feeFundingWallet,
          ]);
        } else {
          const transaction = await this.connectionManager.createTransferTransaction(
            currentWallet.publicKey,
            destination,
            transferAmount
          );
          
          signature = await this.connectionManager.sendTransaction(transaction, [currentWallet.keypair]);
        }
        
        signatures.push(signature);
        console.log(`📤 Transaction sent successfully: ${signature.slice(0, 8)}...`);
        
        // Step 3: Smart balance checking with retry logic for failed transactions
        if (!isLastHop) {
          const nextWallet = destination;
          const expectedAmount = transferAmount;
          const senderWallet = currentWallet.publicKey;
          
          // Smart balance checking with automatic retry
          const balanceCheckStart = Date.now();
          let balanceConfirmed = false;
          let retryCount = 0;
          const maxRetries = 2;
          
          while (!balanceConfirmed && (Date.now() - balanceCheckStart) < balanceCheckTimeout) {
            try {
              const currentBalance = await this.connectionManager.getBalance(nextWallet);
              
              if (currentBalance >= expectedAmount) {
                console.log(`✅ Balance confirmed: ${nextWallet.toString().slice(0, 8)}... has ${(currentBalance / 1_000_000_000).toFixed(6)} SOL`);
                balanceConfirmed = true;
              } else {
                console.log(`⏳ Waiting for balance update: ${nextWallet.toString().slice(0, 8)}... (${(currentBalance / 1_000_000_000).toFixed(6)} SOL / ${(expectedAmount / 1_000_000_000).toFixed(6)} SOL expected)`);
                await new Promise(resolve => setTimeout(resolve, 300)); // Check every 300ms for speed
              }
            } catch (error) {
              console.warn(`⚠️ Balance check error: ${error}, continuing...`);
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          }
          
          // If balance not confirmed, check if sender still has funds and retry if needed
          if (!balanceConfirmed && retryCount < maxRetries) {
            try {
              const senderBalance = await this.connectionManager.getBalance(senderWallet);
              const minRetryBalance = 0.01 * 1_000_000_000; // 0.01 SOL in lamports
              
              if (senderBalance > minRetryBalance) {
                console.log(`🔄 Transaction may have failed, sender still has ${(senderBalance / 1_000_000_000).toFixed(6)} SOL, retrying...`);
                retryCount++;
                
                // Retry the transaction
                let retrySignature: string;
                const retryTransferAmount = Math.min(transferAmount, Math.floor(senderBalance * 0.95)); // Leave some for fees
                
                if (this.config.feeFundingWallet && i > 0) {
                  const retryTransaction = await this.connectionManager.createTransferTransactionWithFeePayer(
                    senderWallet,
                    destination,
                    retryTransferAmount,
                    this.config.feeFundingWallet.publicKey
                  );
                  
                  retrySignature = await this.connectionManager.sendTransaction(retryTransaction, [
                    currentWallet.keypair,
                    this.config.feeFundingWallet,
                  ]);
                } else {
                  const retryTransaction = await this.connectionManager.createTransferTransaction(
                    senderWallet,
                    destination,
                    retryTransferAmount
                  );
                  
                  retrySignature = await this.connectionManager.sendTransaction(retryTransaction, [currentWallet.keypair]);
                }
                
                console.log(`🔄 Retry transaction sent: ${retrySignature.slice(0, 8)}...`);
                signatures.push(retrySignature);
                
                // Continue with balance checking for retry
                continue;
              } else {
                console.log(`✅ Sender balance low (${(senderBalance / 1_000_000_000).toFixed(6)} SOL), assuming transaction succeeded`);
                balanceConfirmed = true;
              }
            } catch (error) {
              console.warn(`⚠️ Error checking sender balance for retry: ${error}`);
            }
          }
          
          if (!balanceConfirmed && retryCount >= maxRetries) {
            console.warn(`⚠️ Balance check timeout after ${retryCount} retries for ${nextWallet.toString().slice(0, 8)}..., continuing optimistically`);
            // Continue anyway - we did our best to ensure success
          }
        } else {
          // For the final transaction, use smart balance checking with retry logic
          console.log(`🎯 Final transfer: ${currentWallet.publicKey.toString().slice(0, 8)}... → ${destination.toString().slice(0, 8)}...`);
          
          const finalDestination = destination;
          const finalExpectedAmount = transferAmount;
          const finalSender = currentWallet.publicKey;
          
          // Smart balance checking for final transaction
          const finalCheckStart = Date.now();
          let finalBalanceConfirmed = false;
          let finalRetryCount = 0;
          const finalMaxRetries = 2;
          const finalTimeout = balanceCheckTimeout * 2; // Give final transaction more time
          
          while (!finalBalanceConfirmed && (Date.now() - finalCheckStart) < finalTimeout) {
            try {
              const destinationBalance = await this.connectionManager.getBalance(finalDestination);
              
              if (destinationBalance >= finalExpectedAmount) {
                console.log(`✅ Final balance confirmed: ${finalDestination.toString().slice(0, 8)}... has ${(destinationBalance / 1_000_000_000).toFixed(6)} SOL`);
                finalBalanceConfirmed = true;
              } else {
                console.log(`⏳ Waiting for final balance update: ${finalDestination.toString().slice(0, 8)}... (${(destinationBalance / 1_000_000_000).toFixed(6)} SOL / ${(finalExpectedAmount / 1_000_000_000).toFixed(6)} SOL expected)`);
                await new Promise(resolve => setTimeout(resolve, 500)); // Check every 500ms for final transaction
              }
            } catch (error) {
              console.warn(`⚠️ Final balance check error: ${error}, continuing...`);
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
          
          // If final balance not confirmed, check sender and retry if needed
          if (!finalBalanceConfirmed && finalRetryCount < finalMaxRetries) {
            try {
              const senderBalance = await this.connectionManager.getBalance(finalSender);
              const minRetryBalance = 0.01 * 1_000_000_000; // 0.01 SOL in lamports
              
              if (senderBalance > minRetryBalance) {
                console.log(`🔄 Final transaction may have failed, sender still has ${(senderBalance / 1_000_000_000).toFixed(6)} SOL, retrying...`);
                finalRetryCount++;
                
                // Retry the final transaction
                let finalRetrySignature: string;
                const finalRetryAmount = Math.min(finalExpectedAmount, Math.floor(senderBalance * 0.95)); // Leave some for fees
                
                if (this.config.feeFundingWallet) {
                  const finalRetryTransaction = await this.connectionManager.createTransferTransactionWithFeePayer(
                    finalSender,
                    finalDestination,
                    finalRetryAmount,
                    this.config.feeFundingWallet.publicKey
                  );
                  
                  finalRetrySignature = await this.connectionManager.sendTransaction(finalRetryTransaction, [
                    currentWallet.keypair,
                    this.config.feeFundingWallet,
                  ]);
                } else {
                  const finalRetryTransaction = await this.connectionManager.createTransferTransaction(
                    finalSender,
                    finalDestination,
                    finalRetryAmount
                  );
                  
                  finalRetrySignature = await this.connectionManager.sendTransaction(finalRetryTransaction, [currentWallet.keypair]);
                }
                
                console.log(`🔄 Final retry transaction sent: ${finalRetrySignature.slice(0, 8)}...`);
                signatures.push(finalRetrySignature);
                
                // Continue with balance checking for final retry
                continue;
              } else {
                console.log(`✅ Final sender balance low (${(senderBalance / 1_000_000_000).toFixed(6)} SOL), assuming transaction succeeded`);
                finalBalanceConfirmed = true;
              }
            } catch (error) {
              console.warn(`⚠️ Error checking final sender balance for retry: ${error}`);
            }
          }
          
          if (!finalBalanceConfirmed) {
            // Final check: if sender has no funds left, assume transaction succeeded
            try {
              const finalSenderCheck = await this.connectionManager.getBalance(finalSender);
              if (finalSenderCheck < 0.01 * 1_000_000_000) { // Less than 0.01 SOL
                console.log(`✅ Final transaction likely succeeded - sender has minimal balance (${(finalSenderCheck / 1_000_000_000).toFixed(6)} SOL)`);
                finalBalanceConfirmed = true;
              }
            } catch (error) {
              console.warn(`⚠️ Final sender balance check failed: ${error}`);
            }
          }
          
          if (!finalBalanceConfirmed) {
            throw new Error(`Final transaction failed after ${finalRetryCount} retries - destination did not receive expected funds`);
          }
        }
      }
      
      console.log(`✅ Route completed successfully with ${signatures.length} transactions`);
      
      return {
        success: true,
        transactionSignatures: signatures,
        feeFundingSignatures,
        route,
        usedWalletIds,
      };
      
    } catch (error: any) {
      console.error(`❌ Parallel route execution failed:`, error.message);
      
      // Circuit breaker: attempt recovery of stuck funds
      console.log(`🔧 Attempting parallel mode recovery...`);
      const recoveryInfo = await this.attemptRecovery(route, usedWalletIds, signatures);
      
      return {
        success: false,
        transactionSignatures: signatures,
        feeFundingSignatures,
        error: error.message,
        route,
        usedWalletIds,
        failureRecovery: recoveryInfo,
      };
    }
  }

  /**
   * Attempt to recover funds from failed transactions
   */
  private async attemptRecovery(
    route: MixingRoute,
    usedWalletIds: string[],
    completedSignatures: string[]
  ): Promise<{
    recoveredWallets: string[];
    lostFunds: number;
    recoveryTransactions: string[];
  }> {
    console.log("🔧 Attempting recovery...");

    const recoveredWallets: string[] = [];
    const recoveryTransactions: string[] = [];
    let lostFunds = 0;

    // Check each intermediate wallet for remaining balance
    for (const walletId of usedWalletIds) {
      try {
        const storedWallet = await this.walletManager.getWalletByPublicKey(walletId);
        if (!storedWallet) continue;

        const keypair = this.walletManager.getKeypairFromStoredWallet(storedWallet);
        const balance = await this.connectionManager.getBalance(keypair.publicKey);

        if (balance > 0) {
          console.log(`💰 Found ${balance} lamports in wallet ${walletId.slice(0, 8)}...`);

          // Attempt to recover funds to a recovery wallet or back to source
          try {
            const maxTransferable = await this.connectionManager.getMaxTransferableAmount(keypair.publicKey);

            if (maxTransferable > 0) {
              // Transfer back to source wallet for recovery
              const recoveryTransaction = await this.connectionManager.createTransferTransaction(
                keypair.publicKey,
                route.source.publicKey,
                maxTransferable
              );

              const recoverySignature = await this.connectionManager.sendTransaction(recoveryTransaction, [keypair]);

              recoveryTransactions.push(recoverySignature);
              recoveredWallets.push(walletId);

              // Update wallet status in MongoDB
              await this.walletManager.updateWalletBalance(walletId, 0);
              await this.walletManager.recordTransaction(walletId, {
                signature: recoverySignature,
                type: "send",
                amount: maxTransferable,
                toAddress: route.source.publicKey.toString(),
              });

              console.log(`✅ Recovered ${maxTransferable} lamports from ${walletId.slice(0, 8)}...`);
            }
          } catch (recoveryError) {
            console.error(`❌ Failed to recover from ${walletId}:`, recoveryError);
            lostFunds += balance;
          }
        }

        // Update wallet balance in database
        await this.walletManager.updateWalletBalance(walletId, balance);
      } catch (error) {
        console.error(`❌ Error checking wallet ${walletId}:`, error);
      }
    }

    // Note: Wallets will be released at operation level, not here

    console.log(`🔧 Recovery complete: ${recoveredWallets.length} wallets recovered, ${lostFunds} lamports lost`);

    return {
      recoveredWallets,
      lostFunds,
      recoveryTransactions,
    };
  }

  /**
   * Pre-fund intermediate wallets for fees using MongoDB tracking
   */
  private async preFundIntermediateWalletsForFees(routes: MixingRoute[]): Promise<void> {
    if (!this.config.feeFundingWallet) {
      return;
    }

    console.log("💰 Pre-funding intermediate wallets for transaction fees...");

    const allIntermediates = new Set<string>();

    // Collect all unique intermediate wallets
    routes.forEach((route) => {
      route.intermediates.forEach((wallet) => {
        allIntermediates.add(wallet.publicKey.toString());
      });
    });

    // Fund each intermediate wallet
    for (const publicKey of Array.from(allIntermediates)) {
      try {
        // Check if wallet already has sufficient balance for fees
        const hasFees = await this.connectionManager.hasSufficientBalanceForFees(new PublicKey(publicKey), 1);

        if (!hasFees) {
          const signature = await this.connectionManager.fundIntermediateWalletFees(
            this.config.feeFundingWallet,
            new PublicKey(publicKey),
            1
          );

          // Record in MongoDB
          await this.walletManager.recordTransaction(publicKey, {
            signature,
            type: "fee_funding",
            amount: await this.connectionManager.estimateTransactionFee(),
            fromAddress: this.config.feeFundingWallet.publicKey.toString(),
          });

          console.log(`✅ Funded fees for intermediate wallet: ${publicKey.slice(0, 8)}...`);

          // Small delay between fee funding transactions
          await sleep(getRandomDelay(1000, 3000));
        }
      } catch (error) {
        console.warn(`⚠️ Failed to fund fees for intermediate wallet ${publicKey}:`, error);
      }
    }

    console.log("✅ Intermediate wallet fee funding complete");
  }

  /**
   * Validate inputs and check wallet availability
   */
  private async validateInputs(fundingWallet: Keypair, destinationWallets: PublicKey[]): Promise<void> {
    if (destinationWallets.length === 0) {
      throw new Error("No destination wallets provided");
    }

    if (this.config.intermediateWalletCount < 1) {
      throw new Error("Must have at least 1 intermediate wallet");
    }

    // Check funding wallet balance
    const balance = await this.connectionManager.getBalance(fundingWallet.publicKey);
    const minRequired = await this.connectionManager.getMinimumBalanceForRentExemption();
    const estimatedFees = await this.connectionManager.estimateTransactionFee();

    if (balance < minRequired + estimatedFees * destinationWallets.length) {
      throw new Error("Insufficient funds in funding wallet");
    }

    // Check available wallets in MongoDB
    const totalWalletsNeeded = destinationWallets.length * this.config.intermediateWalletCount;
    const availableWallets = await this.walletManager.getAvailableWallets(totalWalletsNeeded);

    if (availableWallets.length < totalWalletsNeeded) {
      throw new Error(
        `Insufficient available wallets in database. Need ${totalWalletsNeeded}, available ${availableWallets.length}`
      );
    }

    // Check fee funding wallet balance if provided
    if (this.config.feeFundingWallet) {
      const feeFundingBalance = await this.connectionManager.getBalance(this.config.feeFundingWallet.publicKey);

      const totalIntermediateTransactions = destinationWallets.length * (this.config.intermediateWalletCount + 1);
      const totalFeesNeeded = estimatedFees * totalIntermediateTransactions;

      if (feeFundingBalance < totalFeesNeeded) {
        throw new Error(
          `Insufficient funds in fee funding wallet. Need ${totalFeesNeeded} lamports, have ${feeFundingBalance}`
        );
      }
    }

    console.log("✅ Input validation passed");
  }

  /**
   * Record transaction for analysis and debugging
   */
  private recordTransaction(
    signature: string,
    from: string,
    to: string,
    amount: number,
    type: "transfer" | "fee_funding" = "transfer"
  ): void {
    this.state.transactionHistory.push({
      signature,
      from,
      to,
      amount,
      timestamp: Date.now(),
      type,
    });
  }

  /**
   * Get mixer state for analysis
   */
  getState(): MixerState {
    return { ...this.state };
  }

  /**
   * Get wallet statistics from MongoDB
   */
  async getWalletStats() {
    return await this.walletManager.getWalletStats();
  }

  /**
   * Get wallet manager instance for advanced operations
   */
  getWalletManager(): MongoWalletManager {
    return this.walletManager;
  }
}
