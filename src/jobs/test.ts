import { walletSellQueue } from "./queues";

const dummyJobData = {
  userId: "user123",
  userChatId: 1382191888,
  tokenAddress: "7meEF77NUPiXeTuNUd8Y1bVjkxwbUwLaeF2w5Kyebonk", // Example token address
  devWallet:
    "suwzBJ4EaG5WDXEJphhuK3AuzjDbaQjNctvx4wYggyJEV7t61dx6otwjRJxAoa6SqsCM6LoxvrYYm89WTGyCG3Z", // Dummy dev wallet
  sellPercent: 50, // Sell 50% of tokens
  buyerWallets: [
    "suwzBJ4EaG5WDXEJphhuK3AuzjDbaQjNctvx4wYggyJEV7t61dx6otwjRJxAoa6SqsCM6LoxvrYYm89WTGyCG3Z", // Dummy private key
  ],
};

// Add the job to the queue
async function addTestSellWalletJob() {
  try {
    const job = await walletSellQueue.add("test-sell-wallet", dummyJobData);
    console.log("Test sell wallet job added successfully:", job.id);
  } catch (error) {
    console.error("Error adding test job:", error);
  }
}

// Execute the test
addTestSellWalletJob();
