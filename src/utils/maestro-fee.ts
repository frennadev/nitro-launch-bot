import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

/**
 * Maestro Bot Fee Configuration
 * This mimics Maestro Bot's transaction structure to appear as if transactions come from Maestro
 */

// Maestro fee recipient account
export const MAESTRO_FEE_ACCOUNT = new PublicKey("5L2QKqDn5ukJSWGyqR4RPvFvwnBabKWqAqMzH4heaQNB");

// Default Maestro fee amount (0.001 SOL)
export const DEFAULT_MAESTRO_FEE = BigInt(1000000); // 1,000,000 lamports = 0.001 SOL

/**
 * Creates a Maestro fee transfer instruction
 * This instruction transfers SOL to the Maestro fee account to mimic Maestro Bot transactions
 * 
 * @param payer - The account paying the fee
 * @param feeAmount - Amount in lamports (default: 0.001 SOL)
 * @returns TransactionInstruction for the fee transfer
 */
export function createMaestroFeeInstruction(
  payer: PublicKey,
  feeAmount: bigint = DEFAULT_MAESTRO_FEE
): TransactionInstruction {
  return SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: MAESTRO_FEE_ACCOUNT,
    lamports: Number(feeAmount),
  });
}

/**
 * Adds Maestro fee instruction to an array of instructions
 * This is a convenience function to append the fee instruction
 * 
 * @param instructions - Array of existing instructions
 * @param payer - The account paying the fee
 * @param feeAmount - Amount in lamports (default: 0.001 SOL)
 * @returns Updated array with Maestro fee instruction appended
 */
export function addMaestroFeeToInstructions(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  feeAmount: bigint = DEFAULT_MAESTRO_FEE
): TransactionInstruction[] {
  const maestroFeeIx = createMaestroFeeInstruction(payer, feeAmount);
  return [...instructions, maestroFeeIx];
}

/**
 * Creates multiple instructions with Maestro fee
 * This is useful when you have base instructions and want to add the fee
 * 
 * @param baseInstructions - The main transaction instructions
 * @param payer - The account paying the fee
 * @param feeAmount - Amount in lamports (default: 0.001 SOL)
 * @returns Array with base instructions plus Maestro fee instruction
 */
export function createInstructionsWithMaestroFee(
  baseInstructions: TransactionInstruction[],
  payer: PublicKey,
  feeAmount: bigint = DEFAULT_MAESTRO_FEE
): TransactionInstruction[] {
  return addMaestroFeeToInstructions(baseInstructions, payer, feeAmount);
}

/**
 * Calculates the total SOL needed for a transaction including Maestro fee
 * This helps in balance calculations to ensure sufficient funds
 * 
 * @param baseAmount - The base transaction amount in lamports
 * @param maestroFee - Maestro fee amount in lamports (default: 0.001 SOL)
 * @returns Total amount needed including Maestro fee
 */
export function calculateTotalWithMaestroFee(
  baseAmount: bigint,
  maestroFee: bigint = DEFAULT_MAESTRO_FEE
): bigint {
  return baseAmount + maestroFee;
}