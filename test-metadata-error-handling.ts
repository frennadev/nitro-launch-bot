// Direct test of fetchTokenMetadata without initializing the full job system
import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";

// Token Metadata Program ID from Metaplex
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

const parseTokenMetadata = (data: Buffer) => {
  try {
    const NAME_LENGTH_OFFSET = 69;
    const SYMBOL_LENGTH_OFFSET = 101;
    const URI_LENGTH_OFFSET = 115;

    const nameLength = data.readUInt32LE(NAME_LENGTH_OFFSET);
    const symbolLength = data.readUInt32LE(SYMBOL_LENGTH_OFFSET);
    const uriLength = data.readUInt32LE(URI_LENGTH_OFFSET);

    const name = data
      .subarray(73, 73 + nameLength)
      .toString("utf8")
      .replace(/\0/g, "");
    const symbol = data
      .subarray(105, 105 + symbolLength)
      .toString("utf8")
      .replace(/\0/g, "");
    const uri = data
      .subarray(119, 119 + uriLength)
      .toString("utf8")
      .replace(/\0/g, "");

    return { name, symbol, uri };
  } catch (error) {
    console.error("Error parsing metadata:", error);
    return null;
  }
};

async function fetchTokenMetadata(mint: PublicKey) {
  const connection = new Connection(
    process.env.RPC_URL || "https://api.mainnet-beta.solana.com"
  );

  try {
    console.log(`\nFetching metadata for mint: ${mint.toString()}`);

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
      let mintInfo;

      try {
        mintInfo = await getMint(connection, mint);
      } catch (error) {
        console.error(
          "Error fetching mint info:",
          error instanceof Error ? error.message : String(error)
        );
        // If we can't get mint info, return metadata without supply/decimals
        if (metadata && metadata.uri) {
          try {
            const response = await fetch(metadata.uri);
            const jsonMetadata = (await response.json()) as {
              image?: string;
              description?: string;
              createdOn?: string;
            };

            return {
              metaDataPda: metadataPDA.toString(),
              name: metadata.name,
              symbol: metadata.symbol,
              uri: metadata.uri,
              image: jsonMetadata?.image || "",
              supply: 0,
              decimals: 9, // Default decimals
              description: jsonMetadata?.description || "",
              createdOn: jsonMetadata?.createdOn || "",
            };
          } catch (fetchError) {
            console.error(
              "Error fetching JSON metadata:",
              fetchError instanceof Error
                ? fetchError.message
                : String(fetchError)
            );
          }
        }

        return {
          metaDataPda: metadataPDA.toString(),
          name: metadata?.name || "Unknown",
          symbol: metadata?.symbol || "UNK",
          uri: metadata?.uri || "",
          image: "",
          supply: 0,
          decimals: 9, // Default decimals
          description: "",
          createdOn: "",
        };
      }

      if (metadata) {
        console.log("\n=== TOKEN METADATA ===");
        console.log("Name:", metadata.name);
        console.log("Symbol:", metadata.symbol);
        console.log("URI:", metadata.uri);

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

async function testMetadataErrorHandling() {
  console.log("Testing metadata error handling...\n");

  // Test 1: Random public key that's not a token
  try {
    console.log("1. Testing with a random public key...");
    const randomKey = new PublicKey(
      "92M6JrV1TZYxmW85zin2g2q9fuNaXxsS5YQYfEeyx777"
    );
    const metadata1 = await fetchTokenMetadata(randomKey);
    console.log(
      "✅ Random key handled gracefully:",
      metadata1?.name || "No metadata found"
    );
  } catch (error) {
    console.log(
      "❌ Error with random key:",
      error instanceof Error ? error.message : String(error)
    );
  }

  // Test 2: Invalid/non-existent token address
  try {
    console.log("\n2. Testing with an invalid token address...");
    const invalidToken = new PublicKey(
      "11111111111111111111111111111111111111111"
    ); // Invalid token
    const metadata2 = await fetchTokenMetadata(invalidToken);
    console.log(
      "✅ Invalid token handled gracefully:",
      metadata2?.name || "No metadata found"
    );
  } catch (error) {
    console.log(
      "❌ Error with invalid token:",
      error instanceof Error ? error.message : String(error)
    );
  }

  console.log("\n✅ Metadata error handling test completed!");
}

testMetadataErrorHandling().catch(console.error);
