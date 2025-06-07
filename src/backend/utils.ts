import * as crypto from "crypto";
import { env } from "../config";
import { ENCRYPTION_ALGORITHM, ENCRYPTION_IV_LENGTH } from "./constants";
import axios from "axios";

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

export async function uploadFileToPinata(file: ArrayBuffer, fileName: string) {
  try {
    const blob = new Blob([file]);
    const fileObj = new File([blob], fileName);
    const formData = new FormData();
    formData.append("file", fileObj);

    const metadata = JSON.stringify({
      name: fileName,
    });
    formData.append("pinataMetadata", metadata);

    const options = JSON.stringify({
      cidVersion: 0,
    });
    formData.append("pinataOptions", options);
    const resp = await fetch(`${env.PINATA_API_URL}/pinFileToIPFS`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.PINATA_JWT}`,
      },
      body: formData,
    });
    if (resp.status != 200) {
      throw Error(`Failed to upload File: ${await resp.text()}`);
    }
    const data = JSON.parse(await resp.text());
    return data.IpfsHash;
  } catch (error) {
    console.error(`Error occurred: ${error}`);
    throw error;
  }
}

export async function uploadJsonToPinata(jsonData: any, name: string) {
  try {
    const data = JSON.stringify({
      pinataOptions: {
        cidVersion: 0,
      },
      pinataMetadata: {
        name,
      },
      pinataContent: jsonData,
    });

    const res = await axios.post(`${env.PINATA_API_URL}/pinJSONToIPFS`, data, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.PINATA_JWT}`,
      },
    });

    return res.data.IpfsHash;
  } catch (error) {
    console.error("Error uploading JSON to Pinata:", error);
    throw error;
  }
}
