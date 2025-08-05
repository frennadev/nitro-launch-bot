// launchLabMarketCap.ts

export interface LaunchLabParams {
  /** SOL in the virtual reserve before any buys */
  virtualSolReserve?: number;
  /** Token‐side of the virtual reserve (constant) */
  virtualTokenReserve?: number;
  /** Circulating token supply (constant) */
  totalSupply?: number;
}

/**
 * Calculate the Let’s Bonk/Pump.fun market cap after buying X SOL.
 *
 * Priceₙ = (virtualSolReserve + buySol) / virtualTokenReserve  :contentReference[oaicite:0]{index=0}
 * MarketCapₙ = Priceₙ × totalSupply
 */
export function calculateMarketCapAfterBuy(
  buySol: number,
  { virtualSolReserve = 30, virtualTokenReserve = 1_073_000_191, totalSupply = 1_000_000_000 }: LaunchLabParams = {},
  solPriceUsd?: number
) {
  // 1) New SOL reserve
  const newSolReserve = virtualSolReserve + buySol;

  // 2) New marginal price (SOL per token)
  const priceSol = newSolReserve / virtualTokenReserve;

  // 3) Market cap in SOL
  const marketCapSol = priceSol * totalSupply;

  // 4) Convert to USD if you supply solPriceUsd
  const marketCapUsd = solPriceUsd != null ? marketCapSol * solPriceUsd : undefined;

  return { priceSol, marketCapSol, marketCapUsd };
}

const solPriceUsd = 176.56; // fetched from your favorite API
const result = calculateMarketCapAfterBuy(85, undefined, solPriceUsd);

console.log(result);

console.log(`After buying 10 SOL:`);
console.log(` • Price ≈ ${result.priceSol.toFixed(8)} SOL/token`);
console.log(` • Market cap ≈ ${result.marketCapSol.toFixed(4)} SOL`);
console.log(` • Market cap ≈ $${result.marketCapUsd?.toFixed(2)} USD`);
