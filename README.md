# 🚀 PumpFun & BONK Market Cap Service

Complete market cap calculation service for **PumpFun** and **BONK** tokens (bonded & graduated) using official IDLs and Helius RPC.

## 🎯 Features

### PumpFun Support
- ✅ **Bonded Tokens**: Calculates from bonding curve reserves (25.3 SOL graduation target)
- ✅ **Graduated Tokens**: Uses PumpFun AMM pools (not Raydium!)
- ✅ **Live SOL Price**: Auto-updates from CoinGecko API
- ✅ **Enhanced Metadata**: Helius DAS API integration

### BONK Support
- ✅ **Bonded Tokens**: BONK bonding curve calculations
- ✅ **Graduated Tokens**: Migrated to Raydium/DEX pools
- ✅ **Main BONK Token**: Full support for DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263

### Unified Interface
- ✅ **Auto-Detection**: Automatically detects PumpFun vs BONK tokens
- ✅ **Unified API**: Single interface for both token types
- ✅ **TypeScript**: Full type safety with proper interfaces
- ✅ **Error Handling**: Graceful fallbacks and comprehensive error messages

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/frennadev/market-cap-service-for-pump-and-bonk.git
cd market-cap-service-for-pump-and-bonk

# Install dependencies
bun install

# Copy environment template
cp .env.example .env

# Add your Helius RPC URL to .env
echo "HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY" > .env
```

## 🚀 Quick Start

### PumpFun Tokens
```typescript
import { PumpFunMarketCapService } from './pumpfun-marketcap-service';

const service = new PumpFunMarketCapService('YOUR_HELIUS_RPC_URL');
const result = await service.calculateMarketCap('BrG3G9J3TQ3PU4LbHMhsXP2njfdzymkiWSvCkCHCpump');

if (result.success) {
  console.log(`Market Cap: $${result.data.marketCap.toFixed(2)}`);
  console.log(`Status: ${result.data.isComplete ? 'Graduated' : 'On Curve'}`);
}
```

### BONK Tokens
```typescript
import { BonkMarketCapService } from './bonk-marketcap-service';

const service = new BonkMarketCapService('YOUR_HELIUS_RPC_URL');
const result = await service.calculateMarketCap('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');

if (result.success) {
  console.log(`BONK Market Cap: $${result.data.marketCap.toFixed(2)}`);
}
```

### Unified Service (Recommended)
```typescript
import { UnifiedMarketCapService } from './unified-marketcap-service';

const service = new UnifiedMarketCapService('YOUR_HELIUS_RPC_URL');
const result = await service.calculateMarketCap('ANY_TOKEN_MINT_ADDRESS');

if (result.success) {
  console.log(`Token Type: ${result.data.tokenType}`);
  console.log(`Market Cap: $${result.data.marketCap.toFixed(2)}`);
  console.log(`Detected By: ${result.data.detectedBy}`);
}
```

## 🧪 Test Scripts

```bash
# Test PumpFun tokens
bun run test

# Test BONK tokens  
bun run test:bonk

# Test unified service (both types)
bun run test:unified

# Live monitoring demo
bun run test:live

# Test specific tokens
bun run test:tokens

# Test graduated tokens
bun run test:graduated
```

## 📊 Response Format

### Unified Response
```typescript
interface UnifiedMarketCapResult {
  success: boolean;
  data?: UnifiedTokenInfo & {
    tokenType: 'PUMPFUN' | 'BONK' | 'UNKNOWN';
    detectedBy: string;
  };
  error?: string;
}
```

### Token Info Structure
```typescript
interface TokenInfo {
  mint: string;                // Token mint address
  marketCap: number;           // USD market cap (fully diluted)
  price: number;               // USD per token
  totalSupply: number;         // Total token supply
  circulatingSupply: number;   // Circulating supply
  solReserves: number;         // SOL in reserves
  tokenReserves: number;       // Tokens in reserves
  isComplete: boolean;         // true = graduated from bonding curve
  isMigrated: boolean;         // true = migrated to AMM/DEX
  creator: string;             // Creator wallet address
  name?: string;               // Token name (from metadata)
  symbol?: string;             // Token symbol (from metadata)
  image?: string;              // Token image URL (from metadata)
  description?: string;        // Token description (from metadata)
  bondingCurveData?: object;   // Raw bonding curve data
  // PumpFun specific
  pumpAmmPoolData?: any;       // AMM pool data (for graduated PumpFun tokens)
  // BONK specific  
  raydiumPoolData?: any;       // DEX pool data (for graduated BONK tokens)
}
```

## 🎯 Usage Examples

### Batch Processing
```typescript
const tokens = [
  'BrG3G9J3TQ3PU4LbHMhsXP2njfdzymkiWSvCkCHCpump', // PumpFun
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'  // BONK
];

const service = new UnifiedMarketCapService(heliusRpcUrl);
const results = await Promise.all(
  tokens.map(mint => service.calculateMarketCap(mint))
);

results.forEach((result, index) => {
  if (result.success) {
    console.log(`${result.data.tokenType}: $${result.data.marketCap.toFixed(2)}`);
  }
});
```

### Live Monitoring
```typescript
const service = new UnifiedMarketCapService(heliusRpcUrl);

setInterval(async () => {
  const result = await service.calculateMarketCap('YOUR_TOKEN_MINT');
  if (result.success) {
    console.log(`[${result.data.tokenType}] $${result.data.marketCap.toFixed(2)}`);
  }
}, 10000); // Every 10 seconds
```

## 🔧 Configuration

### Environment Variables

```bash
# Required: Your Helius RPC endpoint
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY

# Optional: Separate Helius API key for enhanced metadata
HELIUS_API_KEY=YOUR_HELIUS_API_KEY
```

### Service Architecture

```typescript
UnifiedMarketCapService
├── PumpFunMarketCapService
│   ├── Bonded tokens (bonding curve)
│   └── Graduated tokens (PumpFun AMM)
└── BonkMarketCapService
    ├── Bonded tokens (bonding curve)  
    └── Graduated tokens (Raydium/DEX)
```

## 📁 Project Structure

```
├── pumpfun-marketcap-service.ts    # 🚀 PumpFun service
├── bonk-marketcap-service.ts       # 🐕 BONK service
├── unified-marketcap-service.ts    # 🎯 Unified service (recommended)
├── helius-pumpfun-service.ts       # 🔗 Enhanced metadata service
├── pumpfun-idl.json                # 📜 Official PumpFun IDL
├── test-pumpfun-marketcap.ts       # 🧪 PumpFun tests
├── test-bonk-marketcap.ts          # 🧪 BONK tests
├── test-unified-marketcap.ts       # 🧪 Unified tests
├── test-live-marketcap-monitor.ts  # 📊 Live monitoring demo
├── test-your-tokens.ts             # 🎯 Specific token testing
├── test-graduated-tokens.ts        # 🎓 Graduated token testing
└── README.md                       # 📚 This file
```

## 🎮 How It Works

### Token Detection
1. **Automatic Detection**: Checks for program-specific bonding curve accounts
2. **PumpFun Detection**: Looks for PumpFun program bonding curves
3. **BONK Detection**: Identifies BONK program structures and main token
4. **Fallback**: Tries both services if detection fails

### Market Cap Calculation

#### Bonded Tokens (On Curve)
- **PumpFun**: Uses virtual/real reserves, 25.3 SOL graduation target
- **BONK**: Uses BONK-specific bonding curve formula

#### Graduated Tokens (Migrated)
- **PumpFun**: Fetches from PumpFun AMM (`pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`)
- **BONK**: Fetches from Raydium/DEX pools

#### Common Features
- **Formula**: `totalSupply × priceUSD` (fully diluted market cap)
- **SOL Price**: Live price from CoinGecko API (cached 60s)
- **Enhanced Metadata**: Token names, symbols, images via Helius DAS API

## 🚨 Important Notes

- **PumpFun Graduated**: Uses PumpFun AMM, **NOT** Raydium
- **BONK Graduated**: Uses Raydium/DEX pools
- **Market Cap**: Fully diluted (total supply × price)
- **Rate Limits**: Respects RPC rate limits with proper error handling
- **Auto-Detection**: Automatically routes to correct service based on token type

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- PumpFun team for the official IDL specification
- BONK community for protocol insights
- Helius for reliable RPC infrastructure
- Solana Web3.js for blockchain interactions

---

**Ready to calculate PumpFun & BONK market caps like a pro!** 🚀🐕
# Required: Your Helius RPC endpoint
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY

# Optional: Separate Helius API key for enhanced metadata
HELIUS_API_KEY=YOUR_HELIUS_API_KEY
```

### Service Architecture

```typescript
UnifiedMarketCapService
├── PumpFunMarketCapService
│   ├── Bonded tokens (bonding curve)
│   └── Graduated tokens (PumpFun AMM)
└── BonkMarketCapService
    ├── Bonded tokens (bonding curve)  
    └── Graduated tokens (Raydium/DEX)
```

## 📁 Project Structure

```
├── pumpfun-marketcap-service.ts    # 🚀 PumpFun service
├── bonk-marketcap-service.ts       # 🐕 BONK service
├── unified-marketcap-service.ts    # 🎯 Unified service (recommended)
├── helius-pumpfun-service.ts       # 🔗 Enhanced metadata service
├── pumpfun-idl.json                # 📜 Official PumpFun IDL
├── test-pumpfun-marketcap.ts       # 🧪 PumpFun tests
├── test-bonk-marketcap.ts          # 🧪 BONK tests
├── test-unified-marketcap.ts       # 🧪 Unified tests
├── test-live-marketcap-monitor.ts  # 📊 Live monitoring demo
├── test-your-tokens.ts             # 🎯 Specific token testing
├── test-graduated-tokens.ts        # 🎓 Graduated token testing
└── README.md                       # 📚 This file
```

## 🎮 How It Works

### Token Detection
1. **Automatic Detection**: Checks for program-specific bonding curve accounts
2. **PumpFun Detection**: Looks for PumpFun program bonding curves
3. **BONK Detection**: Identifies BONK program structures and main token
4. **Fallback**: Tries both services if detection fails

### Market Cap Calculation

#### Bonded Tokens (On Curve)
- **PumpFun**: Uses virtual/real reserves, 25.3 SOL graduation target
- **BONK**: Uses BONK-specific bonding curve formula

#### Graduated Tokens (Migrated)
- **PumpFun**: Fetches from PumpFun AMM (`pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`)
- **BONK**: Fetches from Raydium/DEX pools

#### Common Features
- **Formula**: `totalSupply × priceUSD` (fully diluted market cap)
- **SOL Price**: Live price from CoinGecko API (cached 60s)
- **Enhanced Metadata**: Token names, symbols, images via Helius DAS API

## 🚨 Important Notes

- **PumpFun Graduated**: Uses PumpFun AMM, **NOT** Raydium
- **BONK Graduated**: Uses Raydium/DEX pools
- **Market Cap**: Fully diluted (total supply × price)
- **Rate Limits**: Respects RPC rate limits with proper error handling
- **Auto-Detection**: Automatically routes to correct service based on token type

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- PumpFun team for the official IDL specification
- BONK community for protocol insights
- Helius for reliable RPC infrastructure
- Solana Web3.js for blockchain interactions

---

**Ready to calculate PumpFun & BONK market caps like a pro!** 🚀🐕