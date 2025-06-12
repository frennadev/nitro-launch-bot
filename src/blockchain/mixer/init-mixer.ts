import { runMixer } from ".";

export async function initializeMixer(
  fundingPrivateKey: string,
  feeFundingPrivateKey: string,
  totalAmountSol: number,
  destinationAddresses: string[]
) {
  return runMixer(fundingPrivateKey, feeFundingPrivateKey, totalAmountSol, destinationAddresses);
}
