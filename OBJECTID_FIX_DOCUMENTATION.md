# 🔧 MongoDB ObjectId Casting Error Fix

## Problem Description

The bot was encountering a MongoDB casting error when trying to create token metadata:

```
Cast to ObjectId failed for value "" (type string) at path "fundingWallet" for model "User"
```

This error occurred in the token creation job worker when trying to find a user by either `_id` or `fundingWallet`, but the `userWalletAddress` parameter was an empty string `""` instead of a valid ObjectId or `null`.

## Root Cause

In the `createTokenMetadataWorker` function in `src/jobs/workers.ts`, the code was performing this query:

```typescript
const user = await UserModel.findOne({
  $or: [{ _id: userId }, { fundingWallet: userWalletAddress }],
}).populate("fundingWallet");
```

When `userWalletAddress` was an empty string `""`, MongoDB tried to cast it to an ObjectId for the `fundingWallet` field, which failed because empty strings are not valid ObjectIds.

## Solution

### 1. Created a Safe ObjectId Utility Function

Added a new utility function in `src/backend/utils.ts`:

```typescript
/**
 * Safely converts a string to ObjectId, returns null if string is empty or invalid
 */
export function safeObjectId(
  value: string | null | undefined
): Types.ObjectId | null {
  if (!value || value.trim() === "") {
    return null;
  }

  try {
    return new Types.ObjectId(value);
  } catch (error) {
    // If the string is not a valid ObjectId, return null
    return null;
  }
}
```

### 2. Updated the Query Logic

Modified the query in `src/jobs/workers.ts` to use the safe conversion:

```typescript
// Build query conditions - only include fundingWallet if userWalletAddress is not empty
const queryConditions: Array<
  { _id?: string } | { fundingWallet?: import("mongoose").Types.ObjectId }
> = [{ _id: userId }];

// Only add fundingWallet condition if userWalletAddress is provided and not empty
const safeWalletId = safeObjectId(userWalletAddress);
if (safeWalletId) {
  queryConditions.push({ fundingWallet: safeWalletId });
}

const user = await UserModel.findOne({
  $or: queryConditions,
}).populate("fundingWallet");
```

## Key Improvements

1. **Safe Conversion**: The `safeObjectId` function handles empty strings, null, undefined, and invalid ObjectId strings gracefully
2. **Conditional Query Building**: Only includes the `fundingWallet` condition in the query if a valid ObjectId can be created
3. **Type Safety**: Properly typed the query conditions array
4. **Error Prevention**: Prevents MongoDB casting errors before they occur

## Testing

Created and ran a comprehensive test (`test-objectid-fix.ts`) that verifies:

- ✅ Empty strings return `null`
- ✅ Whitespace-only strings return `null`
- ✅ `null` and `undefined` values return `null`
- ✅ Valid ObjectId strings are converted properly
- ✅ Invalid ObjectId strings return `null`

## Impact

This fix resolves the token creation failures that were occurring when users didn't have a funding wallet set up (resulting in empty `userWalletAddress` values). The bot can now:

1. Successfully find users by ID even when `userWalletAddress` is empty
2. Gracefully handle invalid wallet addresses
3. Continue token creation process without MongoDB casting errors

## Files Modified

- `src/backend/utils.ts` - Added `safeObjectId` utility function
- `src/jobs/workers.ts` - Updated user query logic to use safe ObjectId conversion
- `test-objectid-fix.ts` - Added comprehensive test suite (can be removed after verification)

The fix is backward compatible and doesn't affect existing functionality for users with valid funding wallets.
