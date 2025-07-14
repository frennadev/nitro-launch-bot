# Docker Setup for New Launch Bot

This directory contains Docker configuration files for running the new-launch-bot in both production and development environments.

## Files Overview

- `Dockerfile` - Production Docker image for the bot
- `docker-compose.yml` - Production setup with Redis
- `docker-compose.dev.yml` - Development setup with hot reloading
- `.dockerignore` - Files to exclude from Docker build context

## Quick Start

### Production Setup

1. **Create your `.env` file** with all required environment variables:
```bash
TELEGRAM_BOT_TOKEN=your_bot_token_here
MONGODB_URI=your_mongodb_uri_here
REDIS_URI=redis://redis:6379
MIXER_HELIUS_RPC=your_mixer_rpc_here
ENCRYPTION_SECRET=your_encryption_secret_here
# ... other required variables
```

2. **Build and run the production setup**:
```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f new-launch-bot

# Stop services
docker-compose down
```

### Development Setup

1. **Start development environment**:
```bash
# Build and start development services
docker-compose -f docker-compose.dev.yml up -d

# View logs
docker-compose -f docker-compose.dev.yml logs -f new-launch-bot-dev

# Stop development services
docker-compose -f docker-compose.dev.yml down
```

## Docker Commands

### Production

```bash
# Build the production image
docker build -t new-launch-bot .

# Run the production container
docker run -d \
  --name new-launch-bot \
  --env-file .env \
  new-launch-bot

# View logs
docker logs -f new-launch-bot

# Stop and remove container
docker stop new-launch-bot && docker rm new-launch-bot
```

### Development

```bash
# Build development image (stops at deps stage)
docker build --target deps -t new-launch-bot-dev .

# Run with volume mounts for hot reloading
docker run -d \
  --name new-launch-bot-dev \
  --env-file .env \
  -v $(pwd)/src:/app/src \
  -v $(pwd)/package.json:/app/package.json \
  -v $(pwd)/tsconfig.json:/app/tsconfig.json \
  -p 3000:3000 \
  new-launch-bot-dev \
  bun run src/index.ts
```

## Environment Variables

The following environment variables are required:

| Variable | Description | Required |
|----------|-------------|----------|
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token | ✅ |
| `MONGODB_URI` | MongoDB connection string | ✅ |
| `REDIS_URI` | Redis connection string | ✅ |
| `MIXER_HELIUS_RPC` | Helius RPC for mixer operations | ✅ |
| `ENCRYPTION_SECRET` | Secret for encrypting sensitive data | ✅ |
| `HELIUS_RPC_URL` | Main Helius RPC endpoint | ✅ |
| `PINATA_API_KEY` | Pinata API key for IPFS | ✅ |
| `PINATA_SECRET_KEY` | Pinata secret key | ✅ |

## Health Checks

The production Docker setup includes health checks:

- **Bot Health Check**: Runs every 30s, checks if the bot is responding
- **Redis Health Check**: Runs every 30s, checks Redis connectivity

## Security Features

- **Non-root user**: The bot runs as user `bot` (UID 1001) instead of root
- **Alpine Linux**: Uses lightweight Alpine Linux base image
- **Multi-stage build**: Separates build and runtime stages for smaller images
- **Environment isolation**: Uses Docker networks to isolate services

## Troubleshooting

### Common Issues

1. **Environment variables not loaded**:
   - Ensure your `.env` file exists and has correct format
   - Check that all required variables are set

2. **Redis connection issues**:
   - Verify Redis container is running: `docker-compose ps`
   - Check Redis logs: `docker-compose logs redis`

3. **Build failures**:
   - Clear Docker cache: `docker system prune -a`
   - Rebuild without cache: `docker-compose build --no-cache`

4. **Permission issues**:
   - The container runs as non-root user, ensure proper file permissions

### Logs and Debugging

```bash
# View all logs
docker-compose logs

# View specific service logs
docker-compose logs new-launch-bot

# Follow logs in real-time
docker-compose logs -f new-launch-bot

# View container status
docker-compose ps

# Execute commands in running container
docker-compose exec new-launch-bot sh
```

## Performance Optimization

- **Production mode**: Uses optimized build with `NODE_ENV=production`
- **Background preloading**: Enabled for better performance
- **Lightweight mode**: Disabled for full functionality
- **Connection pooling**: Optimized for high-throughput operations

## Scaling

For production deployments, consider:

- Using Docker Swarm or Kubernetes for orchestration
- Setting up proper monitoring and logging
- Implementing load balancing if needed
- Using external Redis and MongoDB instances 