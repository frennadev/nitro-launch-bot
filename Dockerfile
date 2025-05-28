FROM oven/bun:latest

WORKDIR /app

COPY bun.lock package.json tsconfig.json ./
RUN bun install --frozen-lockfile

COPY . .

CMD ["bun", "run", "--hot", "src/index.ts"]
