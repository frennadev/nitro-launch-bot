# Nitro Launch Bot

A Telegram bot specialized in token creation and launch functionality on Solana blockchain using Pump.fun protocol.

## Features

- **Token Creation**: Launch new tokens on Pump.fun
- **Dev Wallets**: Manage developer wallets for token operations
- **Buyer Wallets**: Set up and manage buyer wallets for initial token purchases
- **Mixer Integration**: Privacy-focused wallet mixing for enhanced anonymity
- **Token Viewing**: View detailed information about launched tokens
- **Referral System**: Built-in referral tracking and rewards

## Core Functionality

### Token Launch
- Create new tokens with custom metadata
- Automatic initial buy setup
- Dev wallet configuration
- Launch monitoring and reporting

### Wallet Management
- Developer wallet setup and management
- Buyer wallet configuration
- Wallet fund distribution
- Secure key management

### Privacy Features
- Integrated mixer for transaction privacy
- Multiple wallet coordination
- Anonymous transaction routing

## Installation

1. Clone the repository:
```bash
git clone https://github.com/Tee-py/nitro-launch-bot
cd nitro-launch-bot
```

2. Install dependencies:
```bash
bun install
```

3. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Build and run:
```bash
bun run build:bot
bun run build/index.js
```

## Docker Deployment

```bash
docker build -t nitro-launch-bot .
docker run -d --env-file .env nitro-launch-bot
```

## Environment Variables

- `BOT_TOKEN`: Telegram bot token
- `MONGODB_URI`: MongoDB connection string
- `SOLANA_RPC_URL`: Solana RPC endpoint
- `REDIS_URL`: Redis connection string
- Additional configuration variables as needed

## Usage

1. Start the bot in Telegram
2. Use `/start` to begin
3. Follow the menu options to:
   - Create new tokens
   - Manage dev wallets
   - Configure buyer wallets
   - Launch tokens with mixing

## Architecture

- **Backend**: Node.js/Bun with TypeScript
- **Database**: MongoDB for data persistence
- **Blockchain**: Solana web3.js integration
- **Bot Framework**: Grammy (Telegram Bot API)
- **Queue System**: BullMQ with Redis

## Security

- Private keys are encrypted
- Mixer integration for transaction privacy
- Secure wallet generation
- Environment-based configuration

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

This project is licensed under the MIT License. 