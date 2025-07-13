import { Connection, Commitment } from "@solana/web3.js";

// Default RPC endpoint - can be overridden via environment variables
const DEFAULT_RPC_ENDPOINT = "https://api.mainnet-beta.solana.com";

// Get RPC endpoint from environment or use default
const RPC_ENDPOINT = process.env['SOLANA_RPC_ENDPOINT'] || DEFAULT_RPC_ENDPOINT;

// Create connection with optimized settings
export const connection = new Connection(RPC_ENDPOINT, {
  commitment: "confirmed" as Commitment,
  confirmTransactionInitialTimeout: 60000, // 60 seconds
  disableRetryOnRateLimit: false,
  httpHeaders: {
    "Content-Type": "application/json",
  },
});

// Export connection pool for multiple endpoints
export class ConnectionPool {
  private connections: Connection[] = [];
  private currentIndex = 0;

  constructor(endpoints: string[] = [RPC_ENDPOINT]) {
    this.connections = endpoints.map(endpoint => 
      new Connection(endpoint, {
        commitment: "confirmed" as Commitment,
        confirmTransactionInitialTimeout: 60000,
        disableRetryOnRateLimit: false,
      })
    );
  }

  getConnection(): Connection {
    const connection = this.connections[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.connections.length;
    return connection!;
  }

  getAllConnections(): Connection[] {
    return this.connections;
  }
}

// Default connection pool instance
export const connectionPool = new ConnectionPool(); 