import mongoose from "mongoose";
import { TokenModel, PumpAddressModel } from "../src/backend/models";
import { env } from "../src/config";
import { connectDB, disconnectDB } from "../src/backend/db";

const FAILED_TOKEN_ADDRESS = process.argv[2] || "YOUR_TOKEN_ADDRESS_HERE";

if (FAILED_TOKEN_ADDRESS === "YOUR_TOKEN_ADDRESS_HERE") {
  console.error("❌ Please provide a token address as an argument");
  console.log("Usage: npx tsx scripts/remove-failed-token.ts <token_address>");
  process.exit(1);
}

const TOKEN_NAME = "BULK";
const TOKEN_SYMBOL = "$BULK";

async function removeFailedToken() {
  try {
    console.log("🔌 Connecting to MongoDB...");
    await mongoose.connect(env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // Find and remove the token
    console.log(`🔍 Looking for token: ${TOKEN_NAME} (${TOKEN_SYMBOL})`);
    console.log(`📍 Token Address: ${FAILED_TOKEN_ADDRESS}`);
    
    const deletedToken = await TokenModel.findOneAndDelete({
      tokenAddress: FAILED_TOKEN_ADDRESS
    });

    if (deletedToken) {
      console.log("✅ Successfully deleted token from database:");
      console.log(`   - Name: ${deletedToken.name}`);
      console.log(`   - Symbol: ${deletedToken.symbol}`);
      console.log(`   - Address: ${deletedToken.tokenAddress}`);
      console.log(`   - User: ${deletedToken.user}`);
    } else {
      console.log("⚠️  Token not found in database");
    }

    // Mark the pump address as used to prevent reuse
    console.log(`🔒 Marking pump address as used: ${FAILED_TOKEN_ADDRESS}`);
    
    const updatedAddress = await PumpAddressModel.findOneAndUpdate(
      { publicKey: FAILED_TOKEN_ADDRESS },
      { 
        isUsed: true,
        usedAt: new Date(),
        // Don't set usedBy since we're removing the token
      },
      { new: true }
    );

    if (updatedAddress) {
      console.log("✅ Successfully marked pump address as used");
      console.log(`   - Address: ${updatedAddress.publicKey}`);
      console.log(`   - Marked as used: ${updatedAddress.isUsed}`);
      console.log(`   - Used at: ${updatedAddress.usedAt}`);
    } else {
      console.log("⚠️  Pump address not found in address pool");
      console.log("   This is normal if the address was generated outside the pool");
    }

    console.log("\n🎯 Summary:");
    console.log(`✅ Token removed: ${deletedToken ? 'YES' : 'NO'}`);
    console.log(`✅ Address marked as used: ${updatedAddress ? 'YES' : 'NO'}`);
    console.log(`🔒 Address ${FAILED_TOKEN_ADDRESS} will not be reused`);
    
  } catch (error) {
    console.error("❌ Error removing failed token:", error);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB");
  }
}

// Run the script
removeFailedToken().then(() => {
  console.log("🏁 Script completed");
  process.exit(0);
}).catch((error) => {
  console.error("💥 Script failed:", error);
  process.exit(1);
}); 