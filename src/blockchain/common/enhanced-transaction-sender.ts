import { 
  Connection, 
  VersionedTransaction, 
  TransactionSignature, 
  PublicKey, 
  TransactionMessage,
  Keypair,
  TransactionInstruction
} from "@solana/web3.js";
import { logger } from "./logger";
import { zeroSlotRPC } from "./zero-slot-rpc";
import { connectionPool } from "./connection-pool";

export interface TransactionSetup {
  instructions: TransactionInstruction[];
  payer: PublicKey;
  signers: Keypair[];
}

export enum TransactionType {
  BUY = "buy",
  SELL = "sell",
  TRANSFER = "transfer",
  OTHER = "other"
}

export interface SendTransactionOptions {
  skipPreflight?: boolean;
  preflightCommitment?: string;
  maxRetries?: number;
  useZeroSlot?: boolean;
  transactionType?: TransactionType;
}

export class EnhancedTransactionSender {
  private static instance: EnhancedTransactionSender;
  
  public static getInstance(): EnhancedTransactionSender {
    if (!EnhancedTransactionSender.instance) {
      EnhancedTransactionSender.instance = new EnhancedTransactionSender();
    }
    return EnhancedTransactionSender.instance;
  }

  private constructor() {
    logger.info("Enhanced Transaction Sender initialized with Zero Slot integration");
  }

  /**
   * Determines if a transaction should use Zero Slot based on transaction type
   */
  private shouldUseZeroSlot(transactionType?: TransactionType, useZeroSlot?: boolean): boolean {
    // Explicit override
    if (useZeroSlot !== undefined) {
      return useZeroSlot;
    }

    // Use Zero Slot only for buy/sell transactions
    return transactionType === TransactionType.BUY || transactionType === TransactionType.SELL;
  }

  /**
   * Adds Zero Slot payment instruction to transaction if needed
   */
  private addZeroSlotPaymentIfNeeded(
    transaction: VersionedTransaction,
    payerPublicKey: PublicKey,
    useZeroSlot: boolean
  ): VersionedTransaction {
    if (!useZeroSlot) {
      return transaction;
    }

    try {
      // Deserialize the transaction to get the message
      const message = TransactionMessage.decompile(transaction.message);
      
      // Add payment instruction at the beginning
      const paymentInstruction = zeroSlotRPC.addPaymentInstruction(transaction, payerPublicKey);
      const newInstructions = [paymentInstruction, ...message.instructions];
      
      // Create new transaction with payment instruction
      const newMessage = new TransactionMessage({
        instructions: newInstructions,
        payerKey: message.payerKey,
        recentBlockhash: message.recentBlockhash,
      }).compileToV0Message();
      
      const newTransaction = new VersionedTransaction(newMessage);
      
      // Copy signatures from original transaction
      if (transaction.signatures) {
        newTransaction.signatures = [...transaction.signatures];
      }
      
      logger.info("Added Zero Slot payment instruction to transaction");
      return newTransaction;
      
    } catch (error: any) {
      logger.warn(`Failed to add Zero Slot payment instruction: ${error.message}`);
      return transaction;
    }
  }

  /**
   * Sends a signed transaction using the appropriate RPC (Zero Slot or Helius)
   */
  public async sendSignedTransaction(
    transaction: VersionedTransaction,
    options?: SendTransactionOptions
  ): Promise<TransactionSignature> {
    const logId = `enhanced-send-${Date.now()}`;
    const useZeroSlot = this.shouldUseZeroSlot(options?.transactionType, options?.useZeroSlot);
    
    logger.info(`[${logId}]: Sending transaction via ${useZeroSlot ? 'Zero Slot' : 'Helius'} (type: ${options?.transactionType || 'unknown'})`);

    try {
      if (useZeroSlot) {
        // Use Zero Slot for buy/sell transactions
        return await zeroSlotRPC.sendTransaction(transaction, {
          skipPreflight: options?.skipPreflight ?? false,
          preflightCommitment: options?.preflightCommitment ?? "processed",
          maxRetries: options?.maxRetries ?? 0,
        });
      } else {
        // Use Helius connection pool for other transactions
        return await connectionPool.sendTransaction(transaction, {
          skipPreflight: options?.skipPreflight ?? false,
          preflightCommitment: options?.preflightCommitment ?? "processed",
          maxRetries: options?.maxRetries ?? 3,
        });
      }
    } catch (error: any) {
      logger.error(`[${logId}]: Transaction failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Creates and sends a transaction from setup
   */
  public async sendTransaction(
    setup: TransactionSetup,
    options?: SendTransactionOptions
  ): Promise<TransactionSignature> {
    const logId = `enhanced-create-send-${Date.now()}`;
    const useZeroSlot = this.shouldUseZeroSlot(options?.transactionType, options?.useZeroSlot);
    
    try {
      // Get latest blockhash
      const connection = useZeroSlot ? zeroSlotRPC.getFallbackConnection() : connectionPool;
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      
      // Prepare instructions
      let instructions = [...setup.instructions];
      
      // Add Zero Slot payment instruction if using Zero Slot
      if (useZeroSlot) {
        const paymentInstruction = zeroSlotRPC.addPaymentInstruction(
          {} as VersionedTransaction, // Not used in this context
          setup.payer
        );
        instructions.unshift(paymentInstruction);
      }
      
      // Create transaction message
      const message = new TransactionMessage({
        instructions,
        payerKey: setup.payer,
        recentBlockhash: blockhash,
      }).compileToV0Message();
      
      // Create and sign transaction
      const transaction = new VersionedTransaction(message);
      transaction.sign(setup.signers);
      
      // Send transaction
      return await this.sendSignedTransaction(transaction, options);
      
    } catch (error: any) {
      logger.error(`[${logId}]: Failed to create and send transaction: ${error.message}`);
      throw error;
    }
  }

  /**
   * Retries a transaction with fresh blockhash
   */
  public async retryTransaction(
    setup: TransactionSetup,
    options?: SendTransactionOptions
  ): Promise<TransactionSignature> {
    const logId = `enhanced-retry-${Date.now()}`;
    logger.info(`[${logId}]: Retrying transaction with fresh blockhash`);
    
    return await this.sendTransaction(setup, {
      ...options,
      maxRetries: (options?.maxRetries ?? 3) - 1, // Reduce retries for retry attempts
    });
  }

  /**
   * Health check for both Zero Slot and Helius
   */
  public async healthCheck(): Promise<{
    zeroSlot: { endpoint: string; healthy: boolean; responseTime?: number }[];
    helius: boolean;
  }> {
    try {
      const [zeroSlotHealth, heliusHealth] = await Promise.allSettled([
        zeroSlotRPC.healthCheck(),
        connectionPool.getLatestBlockhash("confirmed").then(() => true).catch(() => false)
      ]);

      return {
        zeroSlot: zeroSlotHealth.status === 'fulfilled' ? zeroSlotHealth.value : [],
        helius: heliusHealth.status === 'fulfilled' ? heliusHealth.value : false,
      };
    } catch (error) {
      logger.error("Health check failed:", error);
      return {
        zeroSlot: [],
        helius: false,
      };
    }
  }
}

// Export singleton instance
export const enhancedTransactionSender = EnhancedTransactionSender.getInstance();

// Backward compatibility exports
export const sendSignedTransaction = (
  transaction: VersionedTransaction,
  transactionType?: TransactionType
) => enhancedTransactionSender.sendSignedTransaction(transaction, { transactionType });

export const sendTransaction = (
  setup: TransactionSetup,
  transactionType?: TransactionType,
  isRetry: boolean = false
) => {
  if (isRetry) {
    return enhancedTransactionSender.retryTransaction(setup, { transactionType });
  }
  return enhancedTransactionSender.sendTransaction(setup, { transactionType });
};