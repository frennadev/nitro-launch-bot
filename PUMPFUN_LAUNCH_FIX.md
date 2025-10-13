# PumpFun Launch Failure Fix

## 🐛 **Issue Identified:**

The `launchTokenFromDappWorker` was failing with this error pattern:

```
{"level":"warn","message":"Token address 68ed0602fceb5ef52e09c0e4 conflict detected for user 68492054bc12916bc8cedcb3. Checking if this is the user's own token...","service":"bot","timestamp":"2025-10-13 14:00:57.752"}
{"level":"error","message":"[launchDappToken]: PumpFun token launch submission failed","service":"job","timestamp":"2025-10-13 14:00:58.047"}
```

## 🔍 **Root Cause:**

The worker was receiving a **MongoDB ObjectId** (`68ed0602fceb5ef52e09c0e4`) as the `tokenId` parameter, but was treating it as a **Solana token address**.

### Problems:

1. **Invalid Address Format**: MongoDB ObjectIds are 24 hex characters, while Solana addresses are base58-encoded and 32-44 characters
2. **Address Validation Failure**: The `validateTokenAddressAvailability` function tries to create a `PublicKey` from the ObjectId, which fails
3. **Wrong Parameter Usage**: The worker was passing the database ID directly to blockchain functions expecting a token address

## ✅ **Solution Implemented:**

### 1. **Database Token Lookup**

Added code to fetch the actual token document from MongoDB using the `tokenId`:

```typescript
// --------- GET TOKEN FROM DATABASE ---------
const { TokenModel } = await import("../backend/models");
const tokenDoc = await TokenModel.findById(
  safeObjectId(String(tokenId))
).lean();
if (!tokenDoc) {
  throw new Error(`Token not found with ID: ${tokenId}`);
}

// Use the actual token address from the database
const actualTokenAddress = tokenDoc.tokenAddress;
if (!actualTokenAddress) {
  throw new Error(`Token ${tokenId} does not have a valid token address`);
}
```

### 2. **Updated All References**

Replaced all uses of `tokenId` with `actualTokenAddress` in:

- `enqueuePrepareTokenLaunch()` calls
- `launchBonkToken()` calls
- Result objects
- Logging statements
- Notification functions

### 3. **Improved Error Handling**

- Added proper token validation
- Added scope management for `actualTokenAddress` in error handlers
- Enhanced logging with both database ID and actual token address

## 📋 **Files Modified:**

- **`src/jobs/workers.ts`**: Fixed `launchTokenFromDappWorker` to properly resolve token addresses
- **`src/jobs/queues.ts`**: Updated remaining queue names to use "nitro-" prefix

## 🧪 **Expected Behavior After Fix:**

1. **Successful Token Resolution**: Worker will look up the actual Solana token address using the MongoDB ObjectId
2. **Proper Address Validation**: `validateTokenAddressAvailability` will receive a valid Solana address
3. **Successful Launch Submission**: PumpFun and Bonk launches will proceed with correct token addresses
4. **Better Logging**: Logs will show both the database ID and resolved token address

## 🚀 **Next Steps:**

After deploying this fix:

1. **Monitor Logs**: Watch for successful token address resolution in logs
2. **Test Launches**: Verify both PumpFun and Bonk token launches work correctly
3. **Validate Notifications**: Ensure success/failure notifications use proper token addresses

## 🔧 **Technical Details:**

- **Job Data Structure**: `LaunchDappTokenJob.tokenId` contains a MongoDB ObjectId, NOT a Solana address
- **Database Lookup**: Required to get `tokenDoc.tokenAddress` which contains the actual Solana address
- **Scope Management**: `actualTokenAddress` declared at function level for error handler access
- **Backward Compatibility**: Fallback to `data.tokenId` in error notifications if lookup fails

---

**Status**: ✅ **FIXED** - Ready for deployment and testing
