import * as crypto from "crypto";

const ENCRYPTION_ALGORITHM = "aes-256-cbc";
const ENCRYPTION_IV_LENGTH = 16;

/**
 * Get the encryption secret from environment
 */
function getEncryptionSecret(): string {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error("ENCRYPTION_SECRET environment variable is required");
  }
  return secret;
}

/**
 * Decrypt a private key
 */
export function decryptWalletKey(encryptedPrivateKey: string): string {
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
    getEncryptionSecret(),
    "salt",
    ENCRYPTION_IV_LENGTH * 2
  );

  try {
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
  } catch (error) {
    console.error("Decryption error:", error);
    throw new Error(`Decryption failed: ${(error as Error).message}`);
  }
}

/**
 * Check if a string looks like an encrypted key (has the iv:data format)
 */
export function isEncryptedFormat(key: string): boolean {
  return key.includes(":") && key.split(":").length === 2;
}
