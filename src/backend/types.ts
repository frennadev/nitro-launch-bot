export enum TokenState {
  LISTED = "listed",
  LAUNCHING = "launching",
  LAUNCHED = "launched",
}

export enum LaunchDestination {
  PUMPFUN = "pumpfun",
}

export interface DexscreenerTokenResponse {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: EToken;
  quoteToken: EToken;
  priceNative: string;
  priceUsd: string;
  txns: Txns;
  volume: PriceChange;
  priceChange: PriceChange;
  liquidity?: Liquidity;
  fdv: number;
  marketCap: number;
  pairCreatedAt: number;
  info: Info;
}

export interface EToken {
  address: string;
  name: string;
  symbol: string;
}

export interface Info {
  imageUrl: string;
  header: string;
  openGraph: string;
  websites: Website[];
  socials: Social[];
}

export interface Social {
  type: string;
  url: string;
}

export interface Website {
  label: string;
  url: string;
}

export interface Liquidity {
  usd: number;
  base: number;
  quote: number;
}

export interface PriceChange {
  m5: number;
  h1: number;
  h6: number;
  h24: number;
}

export interface Txns {
  m5: H1;
  h1: H1;
  h6: H1;
  h24: H1;
}

export interface H1 {
  buys: number;
  sells: number;
}
