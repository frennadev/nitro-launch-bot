import { runMixer } from ".";
import { updateMixerProgress, updateMixerStatus } from "../../bot/loading";

export async function initializeMixer(
  fundingPrivateKey: string,
  feeFundingPrivateKey: string,
  totalAmountSol: number,
  destinationAddresses: string[]
) {
  return runMixer(fundingPrivateKey, feeFundingPrivateKey, totalAmountSol, destinationAddresses);
}

/**
 * Progress-tracked version of mixer initialization for token launches
 * This is a safe wrapper that adds progress tracking without changing core functionality
 */
export async function initializeMixerWithProgress(
  fundingPrivateKey: string,
  feeFundingPrivateKey: string,
  totalAmountSol: number,
  destinationAddresses: string[],
  loadingKey?: string
): Promise<any> {
  const startTime = Date.now();
  
  try {
    // Provide initial status update if loading key is provided
    if (loadingKey) {
      try {
        await updateMixerStatus(
          loadingKey,
          "Initializing secure mixing process...",
          `Mixing ${totalAmountSol} SOL to ${destinationAddresses.length} wallets`
        );
        
        // Estimate time based on amount and wallet count
        const estimatedSeconds = Math.max(15, Math.min(120, destinationAddresses.length * 5 + totalAmountSol * 2));
        
        await updateMixerStatus(
          loadingKey,
          "Reserving intermediate wallets...",
          `ETA: ~${estimatedSeconds} seconds for privacy layer routing`
        );
      } catch (progressError) {
        // If progress updates fail, log but continue with mixer operation
        console.warn("Progress update failed, continuing with mixer operation:", progressError);
      }
    }
    
    // Execute the actual mixer (unchanged core functionality)
    const result = await runMixer(fundingPrivateKey, feeFundingPrivateKey, totalAmountSol, destinationAddresses);
    
    // Final status update (with safety wrapper)
    if (loadingKey) {
      try {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        await updateMixerStatus(
          loadingKey,
          "Mixing completed successfully!",
          `${result.successCount}/${result.totalRoutes} routes successful in ${elapsed}s`,
          false
        );
      } catch (progressError) {
        // Progress update failure doesn't affect mixer success
        console.warn("Final progress update failed:", progressError);
      }
    }
    
    return result;
    
  } catch (error: any) {
    // Error status update (with safety wrapper)
    if (loadingKey) {
      try {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        await updateMixerStatus(
          loadingKey,
          "Mixing operation failed",
          `Error after ${elapsed}s: ${error.message}`,
          false
        );
      } catch (progressError) {
        // Progress update failure doesn't change the original error
        console.warn("Error progress update failed:", progressError);
      }
    }
    
    // Re-throw the original error to maintain existing error handling
    throw error;
  }
}
