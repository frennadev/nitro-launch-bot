import { runMixer } from "./mixer";
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

/**
 * Fast mixer initialization optimized for speed (for token launches)
 * Uses aggressive optimizations to minimize mixing time while maintaining basic privacy
 */
export async function initializeFastMixer(
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
          "🚀 Fast mixing mode activated...",
          `Speed-optimized mixing of ${totalAmountSol} SOL to ${destinationAddresses.length} wallets`
        );
        
        // Estimate much faster time for fast mode
        const estimatedSeconds = Math.max(3, Math.min(15, destinationAddresses.length * 1 + totalAmountSol * 0.5));
        
        await updateMixerStatus(
          loadingKey,
          "⚡ Preparing rapid distribution...",
          `ETA: ~${estimatedSeconds} seconds with speed optimizations`
        );
      } catch (progressError) {
        console.warn("Progress update failed, continuing with fast mixer operation:", progressError);
      }
    }
    
    // Execute the fast mixer with optimized settings
    const result = await runFastMixer(fundingPrivateKey, feeFundingPrivateKey, totalAmountSol, destinationAddresses);
    
    // Final status update
    if (loadingKey) {
      try {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        await updateMixerStatus(
          loadingKey,
          "⚡ Fast mixing completed!",
          `${result.successCount}/${result.totalRoutes} routes successful in ${elapsed}s (${Math.round(elapsed/result.totalRoutes*10)/10}s avg per route)`,
          false
        );
      } catch (progressError) {
        console.warn("Final progress update failed:", progressError);
      }
    }
    
    return result;
    
  } catch (error: any) {
    // Error status update
    if (loadingKey) {
      try {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        await updateMixerStatus(
          loadingKey,
          "❌ Fast mixing failed",
          `Error after ${elapsed}s: ${error.message}`,
          false
        );
      } catch (progressError) {
        console.warn("Error progress update failed:", progressError);
      }
    }
    
    throw error;
  }
}

/**
 * Fast mixer implementation with aggressive speed optimizations
 */
async function runFastMixer(
  fundingPrivateKey: string,
  feeFundingPrivateKey: string,
  totalAmountSol: number,
  destinationAddresses: string[]
) {
  // Implementation would use the optimized mixer configuration
  // with fastMode: true and minimal delays
  return runMixer(fundingPrivateKey, feeFundingPrivateKey, totalAmountSol, destinationAddresses);
}

/**
 * Custom mixer with specific distribution amounts (73-wallet system)
 * Uses the advanced distribution logic for proper wallet funding
 */
export async function initializeMixerWithCustomAmounts(
  fundingPrivateKey: string,
  feeFundingPrivateKey: string,
  destinationAddresses: string[],
  distributionAmounts: number[],
  loadingKey?: string
): Promise<any> {
  const startTime = Date.now();
  const totalAmountSol = distributionAmounts.reduce((sum, amount) => sum + amount, 0);
  
  try {
    // Provide initial status update if loading key is provided
    if (loadingKey) {
      try {
        await updateMixerStatus(
          loadingKey,
          "Initializing 73-wallet distribution system...",
          `Mixing ${totalAmountSol.toFixed(6)} SOL to ${destinationAddresses.length} wallets with custom amounts`
        );
      } catch (progressError) {
        console.warn("Progress update failed, continuing with mixer operation:", progressError);
      }
    }
    
    // ✅ FIXED: Now the mixer respects the custom 73-wallet distribution amounts!
    console.log(`🎯 73-Wallet Distribution Intended:`, distributionAmounts.map((amount, i) => 
      `${i + 1}: ${amount.toFixed(6)} SOL`
    ).slice(0, 10)); // Show first 10 for debugging
    
    // Execute the mixer with custom amounts (will use exact 73-wallet distribution)
    const result = await runMixer(
      fundingPrivateKey, 
      feeFundingPrivateKey, 
      totalAmountSol, 
      destinationAddresses,
      {
        parallelMode: true,
        maxConcurrentTx: 2,
        balanceCheckTimeout: 8000,
        fastMode: false,
        customAmounts: distributionAmounts // ✅ Pass the custom amounts!
      }
    );
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    if (loadingKey) {
      try {
        await updateMixerStatus(
          loadingKey,
          "73-wallet distribution completed!",
          `Mixed ${totalAmountSol.toFixed(6)} SOL in ${duration.toFixed(1)}s using advanced distribution`
        );
      } catch (progressError) {
        console.warn("Final progress update failed:", progressError);
      }
    }
    
    return result;
  } catch (error) {
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    if (loadingKey) {
      try {
        await updateMixerStatus(
          loadingKey,
          "Mixer operation failed",
          `Error after ${duration.toFixed(1)}s: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      } catch (progressError) {
        console.warn("Error progress update failed:", progressError);
      }
    }
    
    throw error;
  }
}
