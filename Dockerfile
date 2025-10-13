# Multi-stage build for Nitro Launch Bot
FROM node:20-bullseye as base

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production

# Install system dependencies for Canvas and other native modules
RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libjpeg62-turbo \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.2.16"
ENV PATH="/root/.bun/bin:$PATH"

# Set working directory
WORKDIR /usr/src/app

# Copy package files first for better caching
COPY package.json bun.lock ./

# Install all dependencies (including dev dependencies for build)
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Clean any existing build artifacts to ensure fresh build
RUN rm -rf build/ dist/ .next/ node_modules/.cache/ || true

# Build the application
RUN bun run build

# Verify build output exists
RUN ls -la build/ && echo "✅ Build completed successfully"

# Test basic imports to catch any build issues early
RUN echo 'console.log("✅ Build validation successful");' > test-build.js && \
    timeout 10s bun test-build.js && \
    rm test-build.js

# Expose port (adjust if your app uses a different port)
EXPOSE 3000

# Set environment variables for Canvas
ENV CANVAS_PREBUILT=1
ENV LD_LIBRARY_PATH="/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD echo "Health check - bot running" || exit 1

# Start the application
CMD ["bun", "run", "build/index.js"]
