# 🐳 Docker Deployment Guide for Nitro Launch Bot

## Prerequisites

- Docker and Docker Compose installed
- At least 2GB RAM available
- 5GB free disk space

## Quick Start

### 1. Clone and Setup

```bash
git clone <your-repo>
cd nitro-launch-bot
```

### 2. Environment Configuration

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your actual values
nano .env
```

### 3. Run Development Environment

```bash
# Includes MongoDB, Redis, Bot, and Jobs
docker compose -f docker-compose-dev.yml up --build -d
```

### 4. Run Production Environment

```bash
# Uses external MongoDB, includes Redis
docker compose up --build -d
```

## Docker Images

### Main Components

1. **`Dockerfile`** - Complete application (bot + jobs)
2. **`Dockerfile.bot`** - Telegram bot only
3. **`Dockerfile.job`** - Job processor only

### Build Commands

```bash
# Build all images
docker compose build

# Build specific components
docker build -f Dockerfile.bot -t nitro-bot .
docker build -f Dockerfile.job -t nitro-jobs .
docker build -f Dockerfile -t nitro-main .
```

## Deployment Options

### Option 1: Development (Full Stack)

```bash
# Includes local MongoDB + Redis
docker compose -f docker-compose-dev.yml up --build
```

**Services:**

- `database` (MongoDB)
- `redis` (Redis)
- `bot` (Telegram Bot)
- `jobs` (Job Processor)

### Option 2: Production (External DB)

```bash
# Uses external MongoDB, local Redis
docker compose up --build
```

**Services:**

- `redis` (Redis)
- `bot` (Telegram Bot)
- `jobs` (Job Processor)

### Option 3: Single Container

```bash
# All-in-one container (requires external Redis)
docker build -f Dockerfile -t nitro-launch .
docker run -d --name nitro-launch \
  --env-file .env \
  -p 3000:3000 \
  nitro-launch
```

## Environment Variables

### Required Variables

```bash
# Bot Token from @BotFather
BOT_TOKEN=your_bot_token

# MongoDB connection
MONGODB_URI=mongodb+srv://...

# Redis connection
REDIS_URL=redis://redis:6379

# Wallet encryption
WALLET_ENCRYPTION_KEY=your_32_char_key
```

### Performance Variables

```bash
NODE_ENV=production
LIGHTWEIGHT_MODE=true
ENABLE_BACKGROUND_PRELOADING=false
MAX_POOL_CACHE_SIZE=1000
```

## Health Checks

All containers include health checks:

```bash
# Check container health
docker compose ps

# View health check logs
docker compose logs bot
docker compose logs jobs
```

## Troubleshooting

### Build Issues

1. **Canvas/Native Module Errors**

   ```bash
   # Clear build cache
   docker builder prune -a

   # Rebuild without cache
   docker compose build --no-cache
   ```

2. **Memory Issues**

   ```bash
   # Increase Docker memory limit to 4GB
   # In Docker Desktop: Settings > Resources > Memory
   ```

3. **Permission Issues**
   ```bash
   # Fix file permissions
   sudo chown -R $USER:$USER .
   chmod +x test-docker.sh
   ```

### Runtime Issues

1. **Bot Not Starting**

   ```bash
   # Check logs
   docker compose logs -f bot

   # Check environment variables
   docker compose exec bot env | grep BOT_TOKEN
   ```

2. **Jobs Not Processing**

   ```bash
   # Check Redis connection
   docker compose exec redis redis-cli ping

   # Check job logs
   docker compose logs -f jobs
   ```

3. **Database Connection**
   ```bash
   # Test MongoDB connection
   docker compose exec bot sh -c 'echo "db.adminCommand(\"ping\")" | mongosh $MONGODB_URI'
   ```

## Monitoring

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f bot
docker compose logs -f jobs
```

### Resource Usage

```bash
# Container stats
docker stats

# Disk usage
docker system df
```

## Maintenance

### Updates

```bash
# Pull latest code
git pull

# Rebuild and restart
docker compose down
docker compose up --build -d
```

### Cleanup

```bash
# Remove unused images
docker image prune -a

# Clean build cache
docker builder prune

# Remove all stopped containers
docker container prune
```

### Backup

```bash
# Backup volumes
docker compose exec database mongodump --out /backup
docker cp nitro-db:/backup ./mongodb-backup

# Backup Redis
docker compose exec redis redis-cli BGSAVE
```

## Performance Optimization

### Production Settings

```yaml
# docker-compose.yml
services:
  bot:
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: "0.5"
        reservations:
          memory: 512M
          cpus: "0.25"
```

### Redis Optimization

```bash
# Persistent Redis data
volumes:
  - redis_data:/data

# Redis memory management
command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
```

## Security

### Network Security

```yaml
networks:
  internal:
    driver: bridge
    internal: true
```

### Environment Security

```bash
# Never commit .env files
echo ".env" >> .gitignore

# Use secrets in production
docker secret create bot_token bot_token.txt
```

## Scaling

### Horizontal Scaling

```yaml
# Scale job processors
docker compose up --scale jobs=3

# Load balance bot instances
docker compose up --scale bot=2
```

### Resource Limits

```yaml
deploy:
  resources:
    limits:
      memory: 2G
      cpus: "1.0"
```

---

## Test Your Setup

Run the Docker test script:

```bash
./test-docker.sh
```

This will validate your Docker configuration before deployment!
