import crypto from "crypto";
import { env } from "../config";
import { ENCRYPTION_ALGORITHM, ENCRYPTION_IV_LENGTH } from "./constants";

export function encryptPrivateKey(privateKey: string): string {
  const SECRET_KEY = crypto.scryptSync(
    env.ENCRYPTION_SECRET,
    "salt",
    ENCRYPTION_IV_LENGTH * 2,
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

export function decryptPrivateKey(encryptedPrivateKey: string): string {
  const SECRET_KEY = crypto.scryptSync(
    env.ENCRYPTION_SECRET,
    "salt",
    ENCRYPTION_IV_LENGTH * 2,
  );

  try {
    const [ivHex, encryptedData] = encryptedPrivateKey.split(":");

    if (!ivHex || !encryptedData) {
      throw new Error("Invalid encrypted data format");
    }
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv(
      ENCRYPTION_ALGORITHM,
      SECRET_KEY,
      iv,
    );
    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    console.error("Decryption error:", error);
    throw new Error(`Decryption failed: ${(error as Error).message}`);
  }
}
