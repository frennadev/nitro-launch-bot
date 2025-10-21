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
    // Primary format: ivHex:encryptedHex
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

    // Fallback: OpenSSL salted format (base64 starting with 'U2FsdGVk')
    if (/^U2FsdGVk/.test(encryptedPrivateKey)) {
      const buf = Buffer.from(encryptedPrivateKey, "base64");
      const marker = buf.slice(0, 8).toString("ascii");
      if (marker !== "Salted__") {
        throw new Error("Invalid OpenSSL salted format");
      }
      const salt = buf.slice(8, 16);
      const ciphertext = buf.slice(16);

      // Derive key and iv using OpenSSL EVP_BytesToKey with MD5
      const derivedBytes = evpBytesToKey(
        Buffer.from(getEncryptionSecret(), "utf8"),
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

    throw new Error("Invalid encrypted data format - unrecognized format");
  } catch (error) {
    console.error("Decryption error:", error);
    throw new Error(`Decryption failed: ${(error as Error).message}`);
  }
}

function evpBytesToKey(
  password: Buffer,
  salt: Buffer | null,
  keyLen: number
): Buffer {
  const md5 = (data: Buffer) => crypto.createHash("md5").update(data).digest();

  const buffers: Buffer[] = [];
  let prev: Buffer | null = null;

  while (Buffer.concat(buffers).length < keyLen) {
    const data = prev
      ? Buffer.concat([prev, password, salt || Buffer.alloc(0)])
      : Buffer.concat([password, salt || Buffer.alloc(0)]);
    prev = md5(data);
    buffers.push(prev);
  }

  return Buffer.concat(buffers).slice(0, keyLen);
}

/**
 * Check if a string looks like an encrypted key (has the iv:data format)
 */
export function isEncryptedFormat(key: string): boolean {
  return key.includes(":") && key.split(":").length === 2;
}
