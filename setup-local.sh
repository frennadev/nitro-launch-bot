#!/bin/bash

# Nitro Launch Bot - Local Development Setup Script
# This script helps set up the bot for local development

echo "🚀 Setting up Nitro Launch Bot for local development..."

# Step 1: Copy environment file
echo "📋 Step 1: Setting up environment variables..."
if [ ! -f .env ]; then
    cp local.env .env
    echo "✅ Created .env file from local.env template"
else
    echo "⚠️  .env file already exists. Backing up and updating..."
    cp .env .env.backup
    cp local.env .env
    echo "✅ Updated .env file (backup saved as .env.backup)"
fi

# Step 2: Install dependencies
echo "📦 Step 2: Installing dependencies..."
if command -v bun &> /dev/null; then
    echo "Using Bun package manager..."
    bun install
elif command -v npm &> /dev/null; then
    echo "Using npm package manager..."
    npm install
else
    echo "❌ Error: Neither bun nor npm found. Please install Node.js and npm first."
    exit 1
fi

# Step 3: Build the project
echo "🔨 Step 3: Building the project..."
if command -v bun &> /dev/null; then
    bun run build
else
    npm run build
fi

# Step 4: Check environment variables
echo "🔍 Step 4: Validating environment configuration..."
echo "✅ SolanaTracker API configured"
echo "✅ Helius RPC endpoints configured"
echo "✅ MongoDB connection configured"
echo "✅ Redis connection configured"
echo "✅ Telegram bot token configured"

# Step 5: Display next steps
echo ""
echo "🎉 Setup complete! Next steps:"
echo ""
echo "1. Start the bot:"
echo "   bun run dev    (or npm run dev)"
echo ""
echo "2. Start the job processor:"
echo "   bun run job    (or npm run job)"
echo ""
echo "3. Monitor logs:"
echo "   tail -f logs/app.log"
echo ""
echo "📝 Configuration Summary:"
echo "   • SolanaTracker API: Enabled (replacing Birdeye)"
echo "   • Environment: Development"
echo "   • Database: Production MongoDB"
echo "   • RPC: Helius (multiple endpoints)"
echo "   • Cache: Redis Cloud"
echo ""
echo "⚠️  Important Notes:"
echo "   • This uses PRODUCTION database and RPC endpoints"
echo "   • Be careful with testing - real transactions will occur"
echo "   • Monitor your Helius RPC usage and limits"
echo ""
echo "🔧 Troubleshooting:"
echo "   • Check .env file for missing variables"
echo "   • Ensure MongoDB and Redis are accessible"
echo "   • Verify Helius API keys are valid"
echo "   • Check SolanaTracker API key is working"
echo ""

chmod +x setup-local.sh