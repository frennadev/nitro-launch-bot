#!/bin/bash

echo "🚀 Force Rebuild Script for Render Deployment"
echo "============================================="
echo ""

echo "🧹 Cleaning build artifacts..."
rm -rf build/ dist/ .next/ 2>/dev/null || true

echo "✅ Build artifacts cleaned"
echo ""

echo "📋 Files changed to force clean rebuild:"
echo "1. Updated .dockerignore to exclude build directories"
echo "2. Modified Dockerfile to clean build artifacts before building"
echo "3. This ensures Render gets a completely fresh build"
echo ""

echo "🚨 RENDER DEPLOYMENT INSTRUCTIONS:"
echo "1. Commit and push these changes:"
echo "   git add ."
echo "   git commit -m 'Fix: Force clean build to resolve syntax error'"
echo "   git push origin main"
echo ""
echo "2. In Render dashboard:"
echo "   - Go to your service"
echo "   - Click 'Manual Deploy' > 'Clear build cache & Deploy'"
echo "   - Or trigger a new deployment"
echo ""
echo "3. The build process will now:"
echo "   - Use updated .dockerignore (excludes old build/)"
echo "   - Clean any existing build artifacts in Docker"
echo "   - Build fresh from fixed source code"
echo ""

echo "🎯 Expected Result:"
echo "The 'init_relaunchTokenConversation' syntax error will be resolved"
echo "because the Docker build will use the corrected source code."

echo ""
echo "💡 Alternative: Manual Cache Clear"
echo "If the issue persists, in Render:"
echo "1. Settings > Build Command"
echo "2. Add: 'rm -rf build/ && bun run build'"
echo "3. Or add 'CLEAR_CACHE=true' environment variable"