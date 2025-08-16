import { getMint } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { config } from "dotenv";
import { env } from "../config";

export interface TokenMetadataResponse {
  metaDataPda: string;
  name: string;
  symbol: string;
  uri: string;
  image: string;
  description: string;
  supply: number;
  decimals: number;
  createdOn: string;
}

config();

const connection = new Connection(env.HELIUS_RPC_URL!);
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

// Function to parse metadata from account data
function parseTokenMetadata(data: Buffer) {
  try {
    let offset = 0;
    offset += 1;
    offset += 32;
    offset += 32;

    const nameLength = data.readUInt32LE(offset);
    offset += 4;
    const name = data
      .slice(offset, offset + nameLength)
      .toString("utf8")
      .replace(/\0/g, "");
    offset += nameLength;

    const symbolLength = data.readUInt32LE(offset);
    offset += 4;
    const symbol = data
      .slice(offset, offset + symbolLength)
      .toString("utf8")
      .replace(/\0/g, "");
    offset += symbolLength;

    const uriLength = data.readUInt32LE(offset);
    offset += 4;
    const uri = data
      .slice(offset, offset + uriLength)
      .toString("utf8")
      .replace(/\0/g, "");

    return {
      name: name.trim(),
      symbol: symbol.trim(),
      uri: uri.trim(),
    };
  } catch (error) {
    console.error("Error parsing metadata:", error);
    return null;
  }
}

export async function fetchTokenMetadata(
  mint: PublicKey
): Promise<TokenMetadataResponse | null> {
  try {
    const [metadataPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );

    console.log("Metadata PDA:", metadataPDA.toString());

    const accountInfo = await connection.getAccountInfo(metadataPDA);

    if (accountInfo) {
      const metadata = parseTokenMetadata(accountInfo.data);
      const mintInfo = await getMint(connection, mint);

      if (metadata) {
        console.log("\n=== TOKEN METADATA ===");
        console.log("Name:", metadata.name);
        console.log("Symbol:", metadata.symbol);
        console.log("URI:", metadata.uri);

        // If URI exists, fetch the JSON metadata
        if (metadata.uri) {
          console.log("\n=== FETCHING JSON METADATA ===");
          try {
            const response = await fetch(metadata.uri);
            const jsonMetadata = await response.json();
            console.log(
              "JSON Metadata:",
              JSON.stringify(jsonMetadata, null, 2)
            );

            return {
              metaDataPda: metadataPDA.toString(),
              name: metadata.name,
              symbol: metadata.symbol,
              uri: metadata.uri,
              image: jsonMetadata.image || "",
              supply: Number(mintInfo.supply),
              decimals: Number(mintInfo.decimals),
              description: jsonMetadata.description || "",
              createdOn: jsonMetadata.createdOn || "",
            };
          } catch (error) {
            throw new Error("Error fetching JSON metadata: " + error);
          }
        }

        return {
          metaDataPda: metadataPDA.toString(),
          name: metadata.name,
          symbol: metadata.symbol,
          uri: metadata.uri,
          image: "",
          supply: Number(mintInfo.supply),
          decimals: Number(mintInfo.decimals),
          description: "",
          createdOn: "",
        };
      } else {
        console.log("Could not parse metadata from account data");
        return null;
      }
    } else {
      console.log("No metadata account found for this mint");
      return null;
    }
  } catch (error) {
    console.error("Error fetching metadata:", error);
    return null;
  }
}
