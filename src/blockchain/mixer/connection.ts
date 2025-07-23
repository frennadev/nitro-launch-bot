import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  Keypair,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { mixerConnectionPool } from "../common/connection-pool";

export class SolanaConnectionManager {
  private connection: Connection;
  private priorityFee: number;
  private useConnectionPool: boolean;

  constructor(
    rpcEndpoint: string,
    priorityFee: number = 1000,
    useConnectionPool: boolean = true
  ) {
    // Use dedicated mixer connection pool if available, otherwise fallback to direct connection
    if (useConnectionPool && mixerConnectionPool) {
      this.useConnectionPool = true;
      this.connection = new Connection(rpcEndpoint, {
        commitment: "processed", // Use processed for faster confirmation
        confirmTransactionInitialTimeout: 60000, // Increase timeout to 60 seconds for mixer operations
        disableRetryOnRateLimit: false,
      });
    } else {
      this.useConnectionPool = false;
      this.connection = new Connection(rpcEndpoint, {
        commitment: "confirmed",
        confirmTransactionInitialTimeout: 60000, // Increase timeout to 60 seconds for mixer operations
        disableRetryOnRateLimit: false,
      });
    }
    this.priorityFee = priorityFee;
  }

  /**
   * Get balance for a single wallet (uses connection pool if available)
   */
  async getBalance(publicKey: PublicKey): Promise<number> {
    if (this.useConnectionPool && mixerConnectionPool) {
      return await mixerConnectionPool.getBalance(publicKey);
    }
    return await this.connection.getBalance(publicKey);
  }

  /**
   * Batch balance checking for multiple wallets (optimized for mixer operations)
   */
  async getBatchBalances(publicKeys: PublicKey[]): Promise<number[]> {
    if (this.useConnectionPool && mixerConnectionPool) {
      return await mixerConnectionPool.getBatchBalances(publicKeys);
    }

    // Fallback to individual calls if no connection pool
    const chunkSize = 10;
    const results: number[] = [];

    for (let i = 0; i < publicKeys.length; i += chunkSize) {
      const chunk = publicKeys.slice(i, i + chunkSize);
      const chunkPromises = chunk.map((pk) => this.connection.getBalance(pk));
      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);

      // Small delay between chunks to avoid rate limiting
      if (i + chunkSize < publicKeys.length) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    return results;
  }

  /**
   * Get the minimum rent-exempt balance for an account
   */
  async getMinimumBalanceForRentExemption(): Promise<number> {
    return await this.connection.getMinimumBalanceForRentExemption(0);
  }

  /**
   * Estimate transaction fees including priority fees
   */
  async estimateTransactionFee(): Promise<number> {
    // Base transaction fee (typically 5000 lamports)
    const baseFee = 5000;
    return baseFee + this.priorityFee;
  }

  /**
   * Create a SOL transfer transaction with priority fee
   */
  async createTransferTransaction(
    from: PublicKey,
    to: PublicKey,
    amount: number
  ): Promise<Transaction> {
    // CRITICAL: Ensure amount is an integer for SystemProgram.transfer
    const lamportsAmount = Math.floor(amount);
    
    if (lamportsAmount <= 0) {
      throw new Error(`Invalid transfer amount: ${amount} (floored to ${lamportsAmount})`);
    }
    
    const transaction = new Transaction();

    // Add priority fee instruction
    if (this.priorityFee > 0) {
      transaction.add(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: this.priorityFee,
        })
      );
    }

    // Add transfer instruction
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: from,
        toPubkey: to,
        lamports: lamportsAmount, // Use the integer amount
      })
    );

    // Get recent blockhash
    const { blockhash } = await this.getRecentBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = from;

    return transaction;
  }

  /**
   * Create a transaction with custom fee payer (for fee funding)
   */
  async createTransferTransactionWithFeePayer(
    from: PublicKey,
    to: PublicKey,
    amount: number,
    feePayer: PublicKey
  ): Promise<Transaction> {
    // CRITICAL: Ensure amount is an integer for SystemProgram.transfer
    const lamportsAmount = Math.floor(amount);
    
    if (lamportsAmount <= 0) {
      throw new Error(`Invalid transfer amount: ${amount} (floored to ${lamportsAmount})`);
    }
    
    const transaction = new Transaction();

    // Add priority fee instruction
    if (this.priorityFee > 0) {
      transaction.add(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: this.priorityFee,
        })
      );
    }

    // Add transfer instruction
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: from,
        toPubkey: to,
        lamports: lamportsAmount, // Use the integer amount
      })
    );

    // Get recent blockhash
    const { blockhash } = await this.getRecentBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = feePayer; // Custom fee payer

    return transaction;
  }

  /**
   * Get recent blockhash (uses connection pool if available)
   */
  async getRecentBlockhash(): Promise<{
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    if (this.useConnectionPool && mixerConnectionPool) {
      return await mixerConnectionPool.getLatestBlockhash("processed");
    }
    return await this.connection.getLatestBlockhash("processed");
  }

  /**
   * Send transaction with retry logic (uses connection pool if available)
   */
  async sendTransaction(
    transaction: Transaction,
    signers: Keypair[]
  ): Promise<string> {
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`📡 Sending transaction (attempt ${attempt}/${maxRetries})...`);
        
        if (this.useConnectionPool && mixerConnectionPool) {
          const signature = await mixerConnectionPool.sendTransaction(transaction, signers);
          console.log(`✅ Transaction sent successfully via pool: ${signature.slice(0, 8)}...`);
          return signature;
        } else {
          const signature = await sendAndConfirmTransaction(
            this.connection,
            transaction,
            signers
          );
          console.log(`✅ Transaction sent successfully via direct connection: ${signature.slice(0, 8)}...`);
          return signature;
        }
        
      } catch (error: any) {
        console.error(`❌ Transaction send error (attempt ${attempt}/${maxRetries}):`, error.message);
        
        // If this is the last attempt, throw the error
        if (attempt === maxRetries) {
          throw new Error(`Failed to send transaction after ${maxRetries} attempts: ${error.message}`);
        }
        
        // Wait before retry (exponential backoff)
        const retryDelay = Math.min(1000 * Math.pow(2, attempt - 1), 3000); // 1s, 2s, max 3s
        console.log(`⏳ Retrying send in ${retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
    
    throw new Error("Failed to send transaction after all retries");
  }

  /**
   * Fund an intermediate wallet with just enough SOL for transaction fees
   */
  async fundIntermediateWalletFees(
    feeFundingWallet: Keypair,
    intermediateWallet: PublicKey,
    numberOfTransactions: number = 1
  ): Promise<string> {
    const feeAmount = await this.estimateTransactionFee();
    const totalFeeAmount = feeAmount * numberOfTransactions;

    const transaction = await this.createTransferTransaction(
      feeFundingWallet.publicKey,
      intermediateWallet,
      totalFeeAmount
    );

    return await this.sendTransaction(transaction, [feeFundingWallet]);
  }

  /**
   * Check if a wallet has sufficient balance for a transfer including fees and rent exemption
   * @param publicKey - The wallet's public key
   * @param transferAmount - The amount to transfer (in lamports)
   * @returns Promise<boolean> - Whether the wallet has sufficient balance
   */
  async hasSufficientBalance(
    publicKey: PublicKey,
    transferAmount: number
  ): Promise<boolean> {
    const balance = await this.getBalance(publicKey);
    const estimatedFee = await this.estimateTransactionFee();
    const rentExemption = await this.getMinimumBalanceForRentExemption();

    // Need balance for transfer + fees + rent exemption
    const requiredBalance = transferAmount + estimatedFee + rentExemption;
    const hasSufficient = balance >= requiredBalance;

    console.log(`💰 Balance check for ${publicKey.toString().slice(0, 8)}...:`);
    console.log(`   Current balance: ${balance} lamports (${(balance / 1e9).toFixed(6)} SOL)`);
    console.log(`   Transfer amount: ${transferAmount} lamports (${(transferAmount / 1e9).toFixed(6)} SOL)`);
    console.log(`   Required total: ${requiredBalance} lamports (${(requiredBalance / 1e9).toFixed(6)} SOL)`);
    console.log(`   Sufficient: ${hasSufficient ? '✅' : '❌'}`);

    return hasSufficient;
  }

  /**
   * Check if a wallet has sufficient balance for fees only (for intermediate wallets)
   */
  async hasSufficientBalanceForFees(
    publicKey: PublicKey,
    numberOfTransactions: number = 1
  ): Promise<boolean> {
    const balance = await this.getBalance(publicKey);
    const estimatedFee = await this.estimateTransactionFee();
    const totalFeeAmount = estimatedFee * numberOfTransactions;

    return balance >= totalFeeAmount;
  }

  /**
   * Calculate the maximum transferable amount from a wallet
   * Accounts for transaction fees and rent exemption that must remain in the account
   */
  async getMaxTransferableAmount(publicKey: PublicKey): Promise<number> {
    const balance = await this.getBalance(publicKey);
    const estimatedFee = await this.estimateTransactionFee();
    const rentExemption = await this.getMinimumBalanceForRentExemption();

    // Calculate required reserves (fees + rent exemption)
    const requiredReserves = estimatedFee + rentExemption;
    const maxTransferable = balance - requiredReserves;

    // Log detailed breakdown for debugging
    console.log(`💰 Transfer calculation for ${publicKey.toString().slice(0, 8)}...:`);
    console.log(`   Balance: ${balance} lamports (${(balance / 1e9).toFixed(6)} SOL)`);
    console.log(`   Estimated fee: ${estimatedFee} lamports (${(estimatedFee / 1e9).toFixed(6)} SOL)`);
    console.log(`   Rent exemption: ${rentExemption} lamports (${(rentExemption / 1e9).toFixed(6)} SOL)`);
    console.log(`   Required reserves: ${requiredReserves} lamports (${(requiredReserves / 1e9).toFixed(6)} SOL)`);
    console.log(`   Max transferable: ${maxTransferable} lamports (${(maxTransferable / 1e9).toFixed(6)} SOL)`);

    return Math.max(0, maxTransferable);
  }

  /**
   * Wait for transaction confirmation with retry logic
   */
  async waitForConfirmation(signature: string, maxRetries: number = 3): Promise<boolean> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 Confirming transaction ${signature.slice(0, 8)}... (attempt ${attempt}/${maxRetries})`);
        
        const confirmation = await this.connection.confirmTransaction(
          signature,
          "processed"
        );
        
        if (confirmation.value.err) {
          console.error(`❌ Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
          return false;
        }
        
        console.log(`✅ Transaction confirmed successfully: ${signature.slice(0, 8)}...`);
        return true;
        
      } catch (error: any) {
        console.error(`❌ Transaction confirmation error (attempt ${attempt}/${maxRetries}):`, error.message);
        
        // If this is the last attempt, return false
        if (attempt === maxRetries) {
          console.error(`❌ All confirmation attempts failed for signature: ${signature}`);
          return false;
        }
        
        // Wait before retry (exponential backoff)
        const retryDelay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // 1s, 2s, 4s, max 5s
        console.log(`⏳ Retrying in ${retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
    
    return false;
  }

  /**
   * Get connection instance for advanced operations
   */
  getConnection(): Connection {
    return this.connection;
  }
}
