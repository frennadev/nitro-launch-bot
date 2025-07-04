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
    useConnectionPool: boolean = false
  ) {
    // Disable connection pool for mixer operations to avoid parameter conflicts
    this.useConnectionPool = false;
    this.connection = new Connection(rpcEndpoint, "confirmed");
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
    return await this.connection.getLatestBlockhash("confirmed");
  }

  /**
   * Send transaction (uses connection pool if available)
   */
  async sendTransaction(
    transaction: Transaction,
    signers: Keypair[]
  ): Promise<string> {
    if (this.useConnectionPool && mixerConnectionPool) {
      return await mixerConnectionPool.sendTransaction(transaction, {
        signers,
      });
    }
    return await sendAndConfirmTransaction(
      this.connection,
      transaction,
      signers
    );
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
   * Check if a wallet has sufficient balance for a transfer including fees
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
    return balance >= requiredBalance;
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
   */
  async getMaxTransferableAmount(publicKey: PublicKey): Promise<number> {
    const balance = await this.getBalance(publicKey);
    const estimatedFee = await this.estimateTransactionFee();
    const rentExemption = await this.getMinimumBalanceForRentExemption();

    const maxTransferable = balance - estimatedFee - rentExemption;
    return Math.max(0, maxTransferable);
  }

  /**
   * Wait for transaction confirmation
   */
  async waitForConfirmation(signature: string): Promise<boolean> {
    try {
      const confirmation = await this.connection.confirmTransaction(
        signature,
        "confirmed"
      );
      return !confirmation.value.err;
    } catch (error) {
      console.error("Transaction confirmation error:", error);
      return false;
    }
  }

  /**
   * Get connection instance for advanced operations
   */
  getConnection(): Connection {
    return this.connection;
  }
}
