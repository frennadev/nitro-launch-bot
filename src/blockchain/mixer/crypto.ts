import { Keypair } from "@solana/web3.js";
import { randomBytes } from "crypto";

/**
 * Generate a cryptographically secure random delay between min and max milliseconds
 */
export function getRandomDelay(minMs: number, maxMs: number): number {
  const range = maxMs - minMs;
  const randomValue = randomBytes(4).readUInt32BE(0) / 0xffffffff;
  return Math.floor(minMs + randomValue * range);
}

/**
 * Generate a new Solana keypair using cryptographically secure randomness
 */
export function generateSecureKeypair(): Keypair {
  const seed = randomBytes(32);
  return Keypair.fromSeed(seed);
}

/**
 * Create multiple secure keypairs
 */
export function generateMultipleKeypairs(count: number): Keypair[] {
  return Array.from({ length: count }, () => generateSecureKeypair());
}

/**
 * Shuffle an array using Fisher-Yates algorithm with crypto-secure randomness
 */
export function cryptoShuffle<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const randomValue = randomBytes(4).readUInt32BE(0) / 0xffffffff;
    const j = Math.floor(randomValue * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Generate a random amount variation to obfuscate exact amounts
 * Returns a small random variation (±0.1% to ±1%)
 */
export function getAmountVariation(baseAmount: number): number {
  const variationPercent = (randomBytes(2).readUInt16BE(0) / 0xffff) * 0.009 + 0.001; // 0.1% to 1%
  const variation = Math.floor(baseAmount * variationPercent);
  const isNegative = randomBytes(1)[0] % 2 === 0;
  return isNegative ? -variation : variation;
}

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
