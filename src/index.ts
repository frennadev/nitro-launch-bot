import { connectDB, disconnectDB } from "./backend/db";
import bot from "./bot";

// -------------- PROJECT SPECIFICATION ----------------
// 1. Launch Token on Pumpfun (With or Without dev buy)
// 2. Buy from x wallets where x <= number of wallets the user has on the system (Organic Snipe Style)
// 3. Sell from each wallet
// 4. Sell from all wallets
// 5. Withdraw from all wallets into another single wallet

// -------------- DATA MODELS ----------------
// All Models will have created at and updated at
// 1. User (telegram_id, username, first_name, last_name)
// 2. Token/Launch (user: User, name, image, description, devWallet/deployer, buy_wallets: Wallet)
// 3. Wallet (user, public_key, private_key)

// ------------ FUNCTIONAL REQUIREMENTS -----------
// 1. create a launch
// 2. view all your launches/Tokens
// 3. view all wallets associated with a launch (+ the token and sol balance)
// 4. sell from a particular wallet holding tokens
// 5. sell from all wallets in a launch
// 6. withdraw from all wallets in a launch

const viperLaunchRunner = async () => {
  console.log("Establishing db connection...");
  await connectDB();
  console.log("Starting Telegram bot...");
  bot
    .start()
    .catch((e) =>
      console.error(`Error occurred while starting bot: ${e.message}`),
    );
};

viperLaunchRunner().catch((err) => {
  console.log(`Start failed: ${err.message}`);
  throw err;
});

const onCloseSignal = async () => {
  console.log("Closing mongo db connection...");
  await disconnectDB();
  console.log("Stopping bot...");
  bot.stop().then(() => console.log("🚦 Telegram Bot stopped"));
};
process.on("SIGINT", onCloseSignal);
process.on("SIGTERM", onCloseSignal);
