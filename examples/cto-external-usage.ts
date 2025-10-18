/**
 * Example: Using CTO Queue from External Applications
 *
 * This example demonstrates how to use the CTO (Call To Others) queue
 * from external applications to perform token buying operations.
 */

import {
  enqueueCTOOperation,
  getCTOJobStatus,
  cancelCTOJob,
} from "../src/jobs/cto-external";

// Example 1: Standard CTO Operation (uses mixer)
export const runStandardCTOExample = async () => {
  try {
    console.log("🎯 Enqueuing Standard CTO Operation...");

    const job = await enqueueCTOOperation({
      userId: "user123",
      userChatId: 12345,
      tokenAddress: "So11111111111111111111111111111111111111112", // Example token address
      buyAmount: 1.5, // 1.5 SOL
      mode: "standard", // Uses mixer for anonymous transactions
      platform: "pumpfun", // Platform detected or specified
      socketUserId: "socket123", // Optional for real-time progress tracking
    });

    console.log("✅ CTO Job Enqueued:", job);

    // Monitor job progress
    const jobId = job.jobId as string;
    let status = await getCTOJobStatus(jobId);

    while (status.status === "waiting" || status.status === "active") {
      console.log(
        `⏳ Job Status: ${status.status}, Progress: ${status.progress}%`
      );

      // Wait 2 seconds before checking again
      await new Promise((resolve) => setTimeout(resolve, 2000));
      status = await getCTOJobStatus(jobId);
    }

    console.log("🏁 Final Status:", status);

    return job;
  } catch (error) {
    console.error("❌ Standard CTO Error:", error);
    throw error;
  }
};

// Example 2: Prefunded CTO Operation (uses pre-funded buyer wallets)
export const runPrefundedCTOExample = async () => {
  try {
    console.log("⚡ Enqueuing Prefunded CTO Operation...");

    const job = await enqueueCTOOperation({
      userId: "user456",
      userChatId: 67890,
      tokenAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC example
      buyAmount: 2.0, // 2.0 SOL (will use full balance from buyer wallets)
      mode: "prefunded", // Direct execution from buyer wallets
      platform: "bonk", // Bonk platform
    });

    console.log("✅ Prefunded CTO Job Enqueued:", job);
    return job;
  } catch (error) {
    console.error("❌ Prefunded CTO Error:", error);
    throw error;
  }
};

// Example 3: Job Management Operations
export const jobManagementExample = async () => {
  try {
    // Create a job
    const job = await enqueueCTOOperation({
      userId: "user789",
      userChatId: 11111,
      tokenAddress: "So11111111111111111111111111111111111111112",
      buyAmount: 0.5,
      mode: "standard",
      platform: "pumpswap",
    });

    const jobId = job.jobId as string;
    console.log("📝 Created job:", jobId);

    // Check initial status
    let status = await getCTOJobStatus(jobId);
    console.log("📊 Initial Status:", status);

    // Cancel the job if it's still pending (example)
    if (status.status === "waiting") {
      const cancelResult = await cancelCTOJob(jobId);
      console.log("🚫 Cancel Result:", cancelResult);
    }

    return { job, status };
  } catch (error) {
    console.error("❌ Job Management Error:", error);
    throw error;
  }
};

// Example 4: Batch CTO Operations
export const batchCTOExample = async () => {
  try {
    console.log("🚀 Running Batch CTO Operations...");

    const tokens = [
      "So11111111111111111111111111111111111111112",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    ];

    const jobs = await Promise.all(
      tokens.map((tokenAddress, index) =>
        enqueueCTOOperation({
          userId: `batch_user_${index}`,
          userChatId: 20000 + index,
          tokenAddress,
          buyAmount: 1.0,
          mode: "standard",
          platform: "pumpfun",
        })
      )
    );

    console.log("✅ Batch Jobs Created:", jobs.length);

    // Monitor all jobs
    const jobIds = jobs.map((job) => job.jobId as string);
    const finalStatuses = await Promise.all(
      jobIds.map((id) => getCTOJobStatus(id))
    );

    console.log("📊 All Job Statuses:", finalStatuses);
    return { jobs, finalStatuses };
  } catch (error) {
    console.error("❌ Batch CTO Error:", error);
    throw error;
  }
};

// Example 5: Platform-Specific Operations
export const platformSpecificExamples = async () => {
  const examples = [
    {
      name: "PumpFun Bonding Curve",
      params: {
        userId: "pf_user",
        userChatId: 30001,
        tokenAddress: "PumpFunToken1111111111111111111111111111",
        buyAmount: 1.0,
        mode: "standard" as const,
        platform: "pumpfun",
      },
    },
    {
      name: "Bonk Launch Lab",
      params: {
        userId: "bonk_user",
        userChatId: 30002,
        tokenAddress: "BonkToken1111111111111111111111111111111",
        buyAmount: 2.0,
        mode: "prefunded" as const,
        platform: "bonk",
      },
    },
    {
      name: "Multi-Platform Fallback",
      params: {
        userId: "multi_user",
        userChatId: 30003,
        tokenAddress: "UnknownToken111111111111111111111111111",
        buyAmount: 0.5,
        mode: "standard" as const,
        platform: "unknown", // Will trigger fallback routing
      },
    },
  ];

  const results = [];

  for (const example of examples) {
    try {
      console.log(`🎯 Running ${example.name} example...`);
      const job = await enqueueCTOOperation(example.params);
      console.log(`✅ ${example.name} job created:`, job.jobId);
      results.push({ name: example.name, job, success: true });
    } catch (error) {
      console.error(`❌ ${example.name} failed:`, error);
      results.push({ name: example.name, error, success: false });
    }
  }

  return results;
};

// Export all examples for external use
export const CTOExamples = {
  runStandardCTOExample,
  runPrefundedCTOExample,
  jobManagementExample,
  batchCTOExample,
  platformSpecificExamples,
};

// Quick start function for testing
export const quickStart = async () => {
  console.log("🚀 CTO Queue Quick Start Example");
  console.log("================================");

  try {
    // Run a simple standard CTO operation
    const result = await runStandardCTOExample();
    console.log("✅ Quick start completed successfully!", result);
    return result;
  } catch (error) {
    console.error("❌ Quick start failed:", error);
    throw error;
  }
};

// Run quick start if this file is executed directly
if (require.main === module) {
  quickStart()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
