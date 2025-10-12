# PumpFun Token Creation Test Script

A standalone script to test PumpFun token creation with just a name and symbol.

## Usage

```bash
npm run test-token-create <name> <symbol> [creator-private-key]
```

## Examples

```bash
# Create a test token with generated keypair
npm run test-token-create "My Test Token" "MTT"

# Create a token with specific creator wallet
npm run test-token-create "My Token" "MT" "your-base58-private-key-here"
```

## Requirements

- Node.js/Bun installed
- At least 0.01 SOL in creator wallet for transaction fees
- Valid Solana RPC endpoint

## Environment Variables

```bash
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com  # Optional, defaults to mainnet
```

## What the Script Does

1. ✅ Validates token name and symbol
2. ✅ Generates or loads creator keypair
3. ✅ Checks SOL balance
4. ✅ Creates PumpFun token instruction
5. ✅ Sends and confirms transaction
6. ✅ Provides transaction links and keypairs

## Output

On success, you'll get:
- Transaction signature
- Token address
- Bonding curve address
- Solscan links
- Private keys (save these!)

## Troubleshooting

- **Insufficient balance**: Add more SOL to creator wallet
- **Transaction failed**: Check network status, try again
- **RPC errors**: Use different RPC endpoint
- **Invalid private key**: Ensure base58 format

## Notes

- This creates a REAL token on mainnet/devnet
- Save the private keys safely
- Token will have a bonding curve on PumpFun
- Metadata URI is set to a default placeholder