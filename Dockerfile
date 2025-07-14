FROM oven/bun:alpine AS base

# Dependencies
FROM base AS deps
WORKDIR /app
COPY bun.lock package.json ./
RUN bun install --frozen-lockfile

# Build
FROM deps AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# Runtime
FROM base AS runtime
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S bot -u 1001

# Change ownership of the app directory
RUN chown -R bot:nodejs /app
USER bot

# Expose port (if needed for health checks)
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV LIGHTWEIGHT_MODE=false
ENV ENABLE_BACKGROUND_PRELOADING=true

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun run build/index.js --health-check || exit 1

# Start the bot
CMD ["bun", "run", "build/index.js"] 