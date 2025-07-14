import type {
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";

export type TransactionSetup = {
  instructions: TransactionInstruction[];
  payer: PublicKey;
  signers: Keypair[];
};

export enum PumpLaunchStage {
  START = 1,
  FUNDING = 2,
  LAUNCH = 3,
  SNIPE = 4,
  COMPLETE = 5,
}
