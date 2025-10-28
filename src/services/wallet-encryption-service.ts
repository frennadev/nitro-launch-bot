/**
 * Wallet Encryption/Decryption Service
 *
 * This service provides comprehensive encryption and decryption functionality for wallet private keys.
 * It supports multiple encryption formats and includes fallback mechanisms for compatibility.
 */

import * as crypto from "crypto";
import * as CryptoJS from "crypto-js";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { env } from "../config";
import {
  ENCRYPTION_ALGORITHM,
  ENCRYPTION_IV_LENGTH,
} from "../backend/constants";

// ==================== ENCRYPTION FUNCTIONS ====================

/**
 * Encrypt a private key using the standard bot format (crypto module)
 * Format: "iv:encryptedData" (hex)
 */
export function encryptPrivateKey(privateKey: string): string {
  const SECRET_KEY = crypto.scryptSync(
    env.ENCRYPTION_SECRET as string,
    "salt",
    ENCRYPTION_IV_LENGTH * 2
  );

  try {
    const iv = crypto.randomBytes(ENCRYPTION_IV_LENGTH);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, SECRET_KEY, iv);

    let encrypted = cipher.update(privateKey, "utf8", "hex");
    encrypted += cipher.final("hex");

    return `${iv.toString("hex")}:${encrypted}`;
  } catch (error) {
    throw new Error(`Encryption failed: ${(error as Error).message}`);
  }
}

/**
 * Encrypt a Solana keypair's secret key using bot format
 */
export function encryptKeypair(keypair: Keypair): string {
  const privateKeyBase58 = bs58.encode(keypair.secretKey);
  return encryptPrivateKey(privateKeyBase58);
}

/**
 * Encrypt private key using CryptoJS (dapp-compatible format)
 * This format is used by dapp wallets
 */
export function encryptPrivateKeyCryptoJS(privateKey: string): string {
  try {
    const encrypted = CryptoJS.AES.encrypt(
      privateKey,
      env.ENCRYPTION_SECRET as string
    ).toString();
    return encrypted;
  } catch (error) {
    throw new Error(`CryptoJS encryption failed: ${(error as Error).message}`);
  }
}

/**
 * Encrypt a Solana keypair using CryptoJS (dapp format)
 */
export function encryptKeypairCryptoJS(keypair: Keypair): string {
  // Convert secret key to base64 (as used in dapp wallets)
  const secretKeyBase64 = Buffer.from(keypair.secretKey).toString("base64");
  return encryptPrivateKeyCryptoJS(secretKeyBase64);
}

// ==================== DECRYPTION FUNCTIONS ====================

/**
 * Decrypt private key with automatic format detection and fallback
 * Supports: bot format (iv:data), CryptoJS format, and OpenSSL format
 */
export function decryptPrivateKey(encryptedPrivateKey: string): string {
  // Input validation
  if (!encryptedPrivateKey) {
    throw new Error("Encrypted private key is null or undefined");
  }

  if (typeof encryptedPrivateKey !== "string") {
    throw new Error(
      `Expected string, got ${typeof encryptedPrivateKey}: ${JSON.stringify(encryptedPrivateKey)}`
    );
  }

  const SECRET_KEY = crypto.scryptSync(
    env.ENCRYPTION_SECRET as string,
    "salt",
    ENCRYPTION_IV_LENGTH * 2
  );

  try {
    // Format 1: Bot format (iv:encryptedData)
    if (encryptedPrivateKey.includes(":")) {
      const [ivHex, encryptedData] = encryptedPrivateKey.split(":");

      if (!ivHex || !encryptedData) {
        throw new Error(
          `Invalid encrypted data format - expected "iv:data", got: "${encryptedPrivateKey}"`
        );
      }

      const iv = Buffer.from(ivHex, "hex");
      const decipher = crypto.createDecipheriv(
        ENCRYPTION_ALGORITHM,
        SECRET_KEY,
        iv
      );

      let decrypted = decipher.update(encryptedData, "hex", "utf8");
      decrypted += decipher.final("utf8");

      return decrypted;
    }

    // Format 2: OpenSSL salted format (base64 starting with 'U2FsdGVk')
    if (/^U2FsdGVk/.test(encryptedPrivateKey)) {
      const buf = Buffer.from(encryptedPrivateKey, "base64");
      const marker = buf.slice(0, 8).toString("ascii");
      if (marker !== "Salted__") {
        throw new Error("Invalid OpenSSL salted format");
      }

      const salt = buf.slice(8, 16);
      const ciphertext = buf.slice(16);

      const derivedBytes = evpBytesToKey(
        Buffer.from(env.ENCRYPTION_SECRET as string, "utf8"),
        salt,
        32 + ENCRYPTION_IV_LENGTH
      );
      const key = derivedBytes.slice(0, 32);
      const iv = derivedBytes.slice(32, 32 + ENCRYPTION_IV_LENGTH);

      const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
      let decrypted = decipher.update(ciphertext, undefined, "utf8");
      decrypted += decipher.final("utf8");

      return decrypted;
    }

    // Format 3: CryptoJS format (fallback)
    return decryptPrivateKeyCryptoJS(encryptedPrivateKey);
  } catch (error) {
    throw new Error(`Decryption failed: ${(error as Error).message}`);
  }
}

/**
 * Decrypt private key using CryptoJS (dapp format)
 */
export function decryptPrivateKeyCryptoJS(encryptedPrivateKey: string): string {
  try {
    const bytes = CryptoJS.AES.decrypt(
      encryptedPrivateKey,
      env.ENCRYPTION_SECRET as string
    );
    const decryptedString = bytes.toString(CryptoJS.enc.Utf8);

    if (!decryptedString) {
      throw new Error("CryptoJS decryption returned empty result");
    }

    return decryptedString;
  } catch (error) {
    throw new Error(`CryptoJS decryption failed: ${(error as Error).message}`);
  }
}

/**
 * Decrypt and create Solana Keypair with automatic format detection
 */
export function decryptKeypair(encryptedPrivateKey: string): Keypair {
  try {
    // Try bot format first (iv:encryptedData)
    if (encryptedPrivateKey.includes(":")) {
      const decryptedPrivateKey = decryptPrivateKey(encryptedPrivateKey);
      // Assume it's base58 encoded
      const secretKeyBytes = bs58.decode(decryptedPrivateKey);
      return Keypair.fromSecretKey(secretKeyBytes);
    }

    // Try CryptoJS format (dapp wallets)
    const decryptedBase64String =
      decryptPrivateKeyCryptoJS(encryptedPrivateKey);
    const secretKeyBuffer = Buffer.from(decryptedBase64String, "base64");

    // Ensure correct length for Solana keypair
    let finalSecretKeyBuffer: Buffer;
    if (secretKeyBuffer.length === 64) {
      finalSecretKeyBuffer = secretKeyBuffer;
    } else if (secretKeyBuffer.length === 66) {
      finalSecretKeyBuffer = secretKeyBuffer.slice(0, 64);
    } else if (secretKeyBuffer.length > 64) {
      finalSecretKeyBuffer = secretKeyBuffer.slice(-64);
    } else {
      throw new Error(
        `Secret key buffer too short: ${secretKeyBuffer.length} bytes, expected 64`
      );
    }

    return Keypair.fromSecretKey(finalSecretKeyBuffer);
  } catch (error) {
    throw new Error(`Keypair decryption failed: ${(error as Error).message}`);
  }
}

// ==================== WALLET-SPECIFIC FUNCTIONS ====================

/**
 * Encrypt wallet data for storage
 */
export function encryptWalletPrivateKey(
  privateKey: string,
  format: "bot" | "cryptojs" = "bot"
): string {
  if (format === "cryptojs") {
    return encryptPrivateKeyCryptoJS(privateKey);
  }
  return encryptPrivateKey(privateKey);
}

/**
 * Decrypt wallet private key from storage
 */
export function decryptWalletPrivateKey(encryptedPrivateKey: string): string {
  return decryptPrivateKey(encryptedPrivateKey);
}

/**
 * Create and encrypt a new wallet keypair
 */
export function createEncryptedWallet(format: "bot" | "cryptojs" = "bot"): {
  keypair: Keypair;
  encryptedPrivateKey: string;
  publicKey: string;
} {
  const keypair = Keypair.generate();
  const encryptedPrivateKey =
    format === "cryptojs"
      ? encryptKeypairCryptoJS(keypair)
      : encryptKeypair(keypair);

  return {
    keypair,
    encryptedPrivateKey,
    publicKey: keypair.publicKey.toBase58(),
  };
}

/**
 * Import and encrypt an existing private key
 */
export function importAndEncryptWallet(
  privateKey: string,
  inputFormat: "base58" | "hex" | "array" = "base58",
  encryptionFormat: "bot" | "cryptojs" = "bot"
): {
  keypair: Keypair;
  encryptedPrivateKey: string;
  publicKey: string;
} {
  let secretKeyBytes: Uint8Array;

  // Parse private key based on input format
  switch (inputFormat) {
    case "base58":
      secretKeyBytes = bs58.decode(privateKey);
      break;
    case "hex":
      secretKeyBytes = new Uint8Array(Buffer.from(privateKey, "hex"));
      break;
    case "array":
      secretKeyBytes = new Uint8Array(JSON.parse(privateKey));
      break;
    default:
      throw new Error(`Unsupported input format: ${inputFormat}`);
  }

  const keypair = Keypair.fromSecretKey(secretKeyBytes);
  const encryptedPrivateKey =
    encryptionFormat === "cryptojs"
      ? encryptKeypairCryptoJS(keypair)
      : encryptKeypair(keypair);

  return {
    keypair,
    encryptedPrivateKey,
    publicKey: keypair.publicKey.toBase58(),
  };
}

// ==================== UTILITY FUNCTIONS ====================

/**
 * Check if encrypted data is in bot format
 */
export function isBotFormat(encryptedData: string): boolean {
  return encryptedData.includes(":") && encryptedData.split(":").length === 2;
}

/**
 * Check if encrypted data is in CryptoJS format
 */
export function isCryptoJSFormat(encryptedData: string): boolean {
  // CryptoJS format doesn't contain colons and is typically longer
  return !encryptedData.includes(":") && encryptedData.length > 50;
}

/**
 * Detect encryption format
 */
export function detectEncryptionFormat(
  encryptedData: string
): "bot" | "cryptojs" | "openssl" | "unknown" {
  if (isBotFormat(encryptedData)) {
    return "bot";
  }
  if (/^U2FsdGVk/.test(encryptedData)) {
    return "openssl";
  }
  if (isCryptoJSFormat(encryptedData)) {
    return "cryptojs";
  }
  return "unknown";
}

/**
 * Validate that a decrypted private key can create a valid Solana keypair
 */
export function validatePrivateKey(
  privateKey: string,
  format: "base58" | "hex" = "base58"
): boolean {
  try {
    let secretKeyBytes: Uint8Array;

    if (format === "base58") {
      secretKeyBytes = bs58.decode(privateKey);
    } else {
      secretKeyBytes = new Uint8Array(Buffer.from(privateKey, "hex"));
    }

    const keypair = Keypair.fromSecretKey(secretKeyBytes);
    return keypair.publicKey.toBase58().length === 44; // Valid Solana public key length
  } catch {
    return false;
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * EVP_BytesToKey equivalent for OpenSSL compatibility
 */
function evpBytesToKey(
  password: Buffer,
  salt: Buffer,
  keyIvLen: number
): Buffer {
  const md5Hashes: Buffer[] = [];
  let digest = Buffer.concat([password, salt]);

  for (let i = 0; i < keyIvLen; i += 16) {
    digest = Buffer.from(crypto.createHash("md5").update(digest).digest());
    md5Hashes.push(digest);
    digest = Buffer.concat([digest, password, salt]);
  }

  return Buffer.concat(md5Hashes).slice(0, keyIvLen);
}

// ==================== EXPORTED TYPES ====================

export interface EncryptedWalletData {
  encryptedPrivateKey: string;
  publicKey: string;
  format: "bot" | "cryptojs";
  createdAt: Date;
}

export interface WalletEncryptionOptions {
  format: "bot" | "cryptojs";
  validateAfterEncryption: boolean;
}

// ==================== USAGE EXAMPLES ====================

/*
Example Usage:

// Create new encrypted wallet
const newWallet = createEncryptedWallet('bot');
console.log('Public Key:', newWallet.publicKey);
console.log('Encrypted Private Key:', newWallet.encryptedPrivateKey);

// Decrypt and use wallet
const keypair = decryptKeypair(newWallet.encryptedPrivateKey);
console.log('Decrypted Public Key:', keypair.publicKey.toBase58());

// Import existing private key
const imported = importAndEncryptWallet(
  'your-base58-private-key-here',
  'base58',
  'bot'
);

// Validate private key before using
const isValid = validatePrivateKey('your-private-key', 'base58');
console.log('Private key is valid:', isValid);

// Detect format of encrypted data
const format = detectEncryptionFormat(encryptedData);
console.log('Encryption format:', format);
*/
