import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  Keypair,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from "@solana/web3.js";

export class SolanaConnectionManager {
  private connection: Connection;
  private priorityFee: number;

  constructor(rpcEndpoint: string, priorityFee: number = 1000) {
    this.connection = new Connection(rpcEndpoint, "confirmed");
    this.priorityFee = priorityFee;
  }

  /**
   * Get the current balance of a wallet in lamports
   */
  async getBalance(publicKey: PublicKey): Promise<number> {
    return await this.connection.getBalance(publicKey);
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
  async createTransferTransaction(from: PublicKey, to: PublicKey, amount: number): Promise<Transaction> {
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
        lamports: amount,
      })
    );

    // Get recent blockhash
    const { blockhash } = await this.connection.getLatestBlockhash();
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
        lamports: amount,
      })
    );

    // Get recent blockhash
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = feePayer; // Custom fee payer

    return transaction;
  }

  /**
   * Send and confirm a transaction
   */
  async sendTransaction(transaction: Transaction, signers: Keypair[]): Promise<string> {
    return await sendAndConfirmTransaction(this.connection, transaction, signers, {
      commitment: "confirmed",
      maxRetries: 3,
    });
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
  async hasSufficientBalance(publicKey: PublicKey, transferAmount: number): Promise<boolean> {
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
  async hasSufficientBalanceForFees(publicKey: PublicKey, numberOfTransactions: number = 1): Promise<boolean> {
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
      const confirmation = await this.connection.confirmTransaction(signature, "confirmed");
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
