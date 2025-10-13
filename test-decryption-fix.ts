import { decryptPrivateKey } from "./src/backend/utils";

async function testDecryptionIssue() {
  console.log("🔧 Testing decryption issue fix...\n");

  // Test 1: Valid encrypted private key (should work)
  console.log("--- Test 1: Valid Encrypted Private Key ---");
  const validEncryptedKey =
    "c148675f2555d8741f1f90fd5932e844:4de1dc7a7343de09b1bba566e57ab40e98d42fba93c50d73872fa430c7e1cc859d2a3b14d43df972e0874a1f8270dfa030a2732374b704ee716b5c02d65c5d4f3c4b44930e74bb05711b45468cf45bef93afcbf7b8aa072805e9d4bdbcdf3f9c";

  try {
    const decrypted = decryptPrivateKey(validEncryptedKey);
    console.log("✅ Valid encrypted key decrypted successfully");
    console.log(`   Result length: ${decrypted.length}`);
  } catch (error) {
    console.log(
      "❌ Valid encrypted key failed:",
      error instanceof Error ? error.message : String(error)
    );
  }

  // Test 2: Solana public key (should fail gracefully)
  console.log("\n--- Test 2: Solana Public Key (Should Fail) ---");
  const publicKey =
    "3jw4bDEPUNXwfjR6tG1MDouPCcRBRtH8vsfKzMYX2LBHpTPPh9rQR7CHW1FAsHAP9tHUHmZHfJGLV9MjXX1JHe8W";

  try {
    const decrypted = decryptPrivateKey(publicKey);
    console.log("❌ Public key should NOT have been decrypted!");
    console.log(`   Unexpected result: ${decrypted}`);
  } catch (error) {
    console.log(
      "✅ Public key properly rejected:",
      error instanceof Error ? error.message : String(error)
    );
  }

  // Test 3: Invalid format (should fail gracefully)
  console.log("\n--- Test 3: Invalid Format (Should Fail) ---");
  const invalidFormat = "not-a-valid-encrypted-key";

  try {
    const decrypted = decryptPrivateKey(invalidFormat);
    console.log("❌ Invalid format should NOT have been decrypted!");
    console.log(`   Unexpected result: ${decrypted}`);
  } catch (error) {
    console.log(
      "✅ Invalid format properly rejected:",
      error instanceof Error ? error.message : String(error)
    );
  }

  console.log("\n🎯 Summary:");
  console.log(
    "The issue was that the enqueuePrepareTokenLaunch function was trying to"
  );
  console.log(
    "decrypt parameters that were already plain-text private keys from the worker."
  );
  console.log("");
  console.log(
    "Fixed by removing decryptPrivateKey() calls from parameters that are"
  );
  console.log("already decrypted private keys passed from the worker.");
}

testDecryptionIssue().catch(console.error);
