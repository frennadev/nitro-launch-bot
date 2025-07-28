# FROM oven/bun:1 as base
# WORKDIR /usr/src/app

# # install dependencies into temp directory
# # this will cache them and speed up future builds
# FROM base AS install
# RUN mkdir -p /temp/dev
# COPY package.json bun.lock /temp/dev/
# RUN cd /temp/dev && bun install --frozen-lockfile

# # install with --production (exclude devDependencies)
# RUN mkdir -p /temp/prod
# COPY package.json bun.lock /temp/prod/
# RUN cd /temp/prod && bun install --frozen-lockfile --production

# # copy node_modules from temp directory
# # then copy all (non-ignored) project files into the image
# FROM base AS prerelease
# COPY --from=install /temp/dev/node_modules node_modules
# COPY . .

# # [optional] tests & build
# ENV NODE_ENV=production
# RUN bun run build:bot

# # copy production dependencies and source code into final image
# FROM base AS release
# COPY --from=install /temp/prod/node_modules node_modules
# COPY --from=prerelease /usr/src/app/build ./build
# COPY --from=prerelease /usr/src/app/package.json .

# # run the app
# USER bun
# EXPOSE 3000/tcp
# ENTRYPOINT [ "bun", "run", "build/index.js" ] 


# Use Node.js as base image
FROM node:20-bullseye as base

# Set environment variables to avoid interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies for Puppeteer and Canvas
RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    # libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libjpeg62 \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.2.16"
ENV PATH="/root/.bun/bin:$PATH"

# Create symlinks for JPEG library compatibility
# Create symlinks for JPEG library compatibility
RUN ldconfig && \
    find /usr/lib -name "libjpeg*" -type f && \
    (ln -sf /usr/lib/x86_64-linux-gnu/libjpeg.so.62 /usr/lib/x86_64-linux-gnu/libjpeg.so.62.3.0 || true)
# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies

RUN bun install --frozen-lockfile --production

# Test Canvas installation and JPEG library
RUN echo 'const { createCanvas, loadImage } = require("canvas"); const canvas = createCanvas(200, 200); const ctx = canvas.getContext("2d"); ctx.fillStyle = "red"; ctx.fillRect(0, 0, 100, 100); console.log("✅ Canvas test successful"); console.log("Canvas buffer length:", canvas.toBuffer().length);' > test-canvas.js && \
    bun test-canvas.js && \
    rm test-canvas.js

# Copy source code
COPY . .

# Build the application
RUN bun run build

# Expose port
EXPOSE 3000

# Set environment variables for Canvas
ENV CANVAS_PREBUILT=1
ENV LD_LIBRARY_PATH="/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"
ENV PKG_CONFIG_PATH="/usr/lib/x86_64-linux-gnu/pkgconfig"

# Start the application
CMD ["bun", "run", "build/index.js"]
