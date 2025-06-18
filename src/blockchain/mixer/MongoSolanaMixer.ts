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
          // Use optimized execution with reduced delays
          const result = await this.executeSingleRouteOptimized(
            route,
            delayPerTransaction,
            transactionCount,
            totalDelays,
            remainingTime
          );
          results.push(result);

          // Update transaction count for next route
          transactionCount += route.intermediates.length + 1;
        } catch (error) {
          console.error(`❌ Route ${i + 1} failed:`, error);

          // Create failed result with recovery info
          const failedResult: MongoMixingResult = {
            success: false,
            transactionSignatures: [],
            error: error instanceof Error ? error.message : "Unknown error",
            route,
            usedWalletIds: route.intermediates.map((w) => w.publicKey.toString()),
          };

          results.push(failedResult);
          transactionCount += route.intermediates.length + 1;
        }
      }

      const actualTime = Date.now() - startTime;
      console.log(`⏱️ Actual operation time: ${actualTime}ms (target: ${totalOperationTime}ms)`);

      return results;
    } catch (error) {
      console.error("❌ Mixing operation failed:", error);
      throw error;
    }
  }

  /**
   * Create mixing routes using MongoDB wallets
   */
  private async createMixingRoutesWithMongo(
    fundingWallet: Keypair,
    destinationWallets: PublicKey[],
    baseAmount: number
  ): Promise<MixingRoute[]> {
    const routes: MixingRoute[] = [];
    const totalWalletsNeeded = destinationWallets.length * this.config.intermediateWalletCount;

    console.log(`🔍 Reserving ${totalWalletsNeeded} intermediate wallets from MongoDB...`);

    // Reserve wallets from MongoDB
    const reservedWallets = await this.walletManager.reserveWalletsForMixing(totalWalletsNeeded);

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
      let remainingAmount = route.amount;
      let localTransactionIndex = currentTransactionIndex;

      // Optimized delays - much shorter for speed
      const optimizedDelayPerTx = Math.min(delayPerTransaction, 200); // Cap at 200ms max

      // Process intermediate transfers with minimal delays
      for (let i = 0; i < route.intermediates.length; i++) {
        const nextWallet = route.intermediates[i];
        console.log(
          `🔄 Transfer ${i + 1}/${route.intermediates.length}: ${currentWallet.publicKey.toString().slice(0, 8)}... → ${nextWallet.publicKey.toString().slice(0, 8)}...`
        );

        // Calculate transfer amount with minimal fee deduction
        const transferAmount = Math.floor(remainingAmount * 0.998); // 0.2% buffer for fees

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
          // Initial wallet pays its own fees
          const transaction = await this.connectionManager.createTransferTransaction(
            currentWallet.publicKey,
            nextWallet.publicKey,
            transferAmount
          );

          signature = await this.connectionManager.sendTransaction(transaction, [currentWallet.keypair]);
        }

        signatures.push(signature);

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

      if (this.config.feeFundingWallet) {
        // Use fee funding wallet for final intermediate wallet transaction
        const finalTransaction = await this.connectionManager.createTransferTransactionWithFeePayer(
          currentWallet.publicKey,
          route.destination,
          remainingAmount,
          this.config.feeFundingWallet.publicKey
        );

        finalSignature = await this.connectionManager.sendTransaction(finalTransaction, [
          currentWallet.keypair,
          this.config.feeFundingWallet,
        ]);
      } else {
        // Intermediate wallet pays its own fees
        const estimatedFee = await this.connectionManager.estimateTransactionFee();
        const finalAmount = remainingAmount - estimatedFee;

        const finalTransaction = await this.connectionManager.createTransferTransaction(
          currentWallet.publicKey,
          route.destination,
          finalAmount
        );

        finalSignature = await this.connectionManager.sendTransaction(finalTransaction, [currentWallet.keypair]);
      }

      signatures.push(finalSignature);

      // Batch final MongoDB operations
      await Promise.all([
        this.walletManager.recordTransaction(currentWallet.publicKey.toString(), {
          signature: finalSignature,
          type: "send",
          amount: remainingAmount,
          toAddress: route.destination.toString(),
        }),
        this.walletManager.updateWalletBalance(currentWallet.publicKey.toString(), 0),
        this.walletManager.releaseWallets(usedWalletIds)
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

    // Release all wallets back to available pool
    await this.walletManager.releaseWallets(usedWalletIds);

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
    for (const publicKey of allIntermediates) {
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
