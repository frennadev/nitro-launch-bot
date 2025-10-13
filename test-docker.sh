#!/bin/bash

echo "🐳 Docker Build Test Script"
echo "=========================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check if Docker is installed
if ! command_exists docker; then
    echo -e "${RED}❌ Docker is not installed or not in PATH${NC}"
    exit 1
fi

echo -e "${BLUE}📋 Testing Docker Configuration...${NC}"

# Test 1: Check Dockerfile syntax
echo ""
echo -e "${YELLOW}1. Checking Dockerfile syntax...${NC}"
if docker build --dry-run -f Dockerfile . >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Main Dockerfile syntax is valid${NC}"
else
    echo -e "${RED}❌ Main Dockerfile has syntax errors${NC}"
fi

if docker build --dry-run -f Dockerfile.bot . >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Dockerfile.bot syntax is valid${NC}"
else
    echo -e "${RED}❌ Dockerfile.bot has syntax errors${NC}"
fi

if docker build --dry-run -f Dockerfile.job . >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Dockerfile.job syntax is valid${NC}"
else
    echo -e "${RED}❌ Dockerfile.job has syntax errors${NC}"
fi

# Test 2: Check docker-compose syntax
echo ""
echo -e "${YELLOW}2. Checking docker-compose syntax...${NC}"
if docker compose -f docker-compose.yml config >/dev/null 2>&1; then
    echo -e "${GREEN}✅ docker-compose.yml is valid${NC}"
else
    echo -e "${RED}❌ docker-compose.yml has syntax errors${NC}"
fi

if docker compose -f docker-compose-dev.yml config >/dev/null 2>&1; then
    echo -e "${GREEN}✅ docker-compose-dev.yml is valid${NC}"
else
    echo -e "${RED}❌ docker-compose-dev.yml has syntax errors${NC}"
fi

# Test 3: Check required files
echo ""
echo -e "${YELLOW}3. Checking required files...${NC}"
files=("package.json" "bun.lock" "src/index.ts" "src/jobs/index.ts" ".dockerignore")
for file in "${files[@]}"; do
    if [[ -f "$file" ]]; then
        echo -e "${GREEN}✅ $file exists${NC}"
    else
        echo -e "${RED}❌ $file is missing${NC}"
    fi
done

# Test 4: Check build scripts
echo ""
echo -e "${YELLOW}4. Checking build scripts in package.json...${NC}"
if grep -q "build:bot" package.json; then
    echo -e "${GREEN}✅ build:bot script found${NC}"
else
    echo -e "${RED}❌ build:bot script missing${NC}"
fi

if grep -q "build:job" package.json; then
    echo -e "${GREEN}✅ build:job script found${NC}"
else
    echo -e "${RED}❌ build:job script missing${NC}"
fi

# Test 5: Quick build test (bot only, first stage)
echo ""
echo -e "${YELLOW}5. Testing bot build (dependencies stage only)...${NC}"
echo "This may take a few minutes..."

if docker build --target deps -f Dockerfile.bot -t nitro-bot-test . >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Bot dependencies stage builds successfully${NC}"
    # Clean up test image
    docker rmi nitro-bot-test >/dev/null 2>&1
else
    echo -e "${RED}❌ Bot dependencies stage failed to build${NC}"
    echo "Run manually: docker build --target deps -f Dockerfile.bot -t nitro-bot-test ."
fi

echo ""
echo -e "${BLUE}📋 Docker configuration test complete!${NC}"
echo ""
echo -e "${YELLOW}🚀 To build and run:${NC}"
echo "Development: docker compose -f docker-compose-dev.yml up --build"
echo "Production:  docker compose up --build"
echo ""
echo -e "${YELLOW}🔧 To test individual components:${NC}"
echo "Bot only:    docker build -f Dockerfile.bot -t nitro-bot ."
echo "Jobs only:   docker build -f Dockerfile.job -t nitro-jobs ."
echo "Main:        docker build -f Dockerfile -t nitro-main ."