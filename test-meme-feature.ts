/**
 * Test script for AI Meme Token Feature
 * Quick validation of core components
 */

import { TwitterContentFetcher } from "./src/service/twitter-content-fetcher";
import { AIMemeableAnalysisService } from "./src/service/ai-memeable-analysis";
import { MemeTokenGeneratorService } from "./src/service/meme-token-generator";

async function testMemeTokenFeature() {
  console.log("🧪 Testing AI Meme Token Feature Components\n");

  // Test 1: Twitter URL Validation
  console.log("1️⃣ Testing Twitter URL Validation...");
  const validUrls = [
    "https://twitter.com/elonmusk/status/1234567890",
    "https://x.com/dogecoin/status/1234567890",
  ];

  const invalidUrls = [
    "https://facebook.com/post/123",
    "not-a-url",
    "https://twitter.com/user",
  ];

  for (const url of validUrls) {
    const isValid = TwitterContentFetcher.isValidTwitterUrl(url);
    console.log(`   ${isValid ? "✅" : "❌"} ${url}`);
  }

  for (const url of invalidUrls) {
    const isValid = TwitterContentFetcher.isValidTwitterUrl(url);
    console.log(`   ${isValid ? "❌" : "✅"} ${url} (should be invalid)`);
  }

  // Test 2: URL Normalization
  console.log("\n2️⃣ Testing URL Normalization...");
  const twitterUrl = "https://twitter.com/user/status/123";
  const normalized = TwitterContentFetcher.normalizeTwitterUrl(twitterUrl);
  console.log(`   Original: ${twitterUrl}`);
  console.log(`   Normalized: ${normalized}`);
  console.log(
    `   ${normalized.includes("x.com") ? "✅" : "❌"} Converted to x.com`
  );

  // Test 3: Tweet ID Extraction
  console.log("\n3️⃣ Testing Tweet ID Extraction...");
  const testUrl = "https://x.com/testuser/status/1234567890123456789";
  const tweetId = TwitterContentFetcher.extractTweetId(testUrl);
  const author = TwitterContentFetcher.extractAuthorHandle(testUrl);
  console.log(`   URL: ${testUrl}`);
  console.log(`   Tweet ID: ${tweetId}`);
  console.log(`   Author: ${author}`);
  console.log(
    `   ${tweetId === "1234567890123456789" ? "✅" : "❌"} Tweet ID correct`
  );
  console.log(`   ${author === "testuser" ? "✅" : "❌"} Author correct`);

  // Test 4: OpenAI Configuration Check
  console.log("\n4️⃣ Testing OpenAI Configuration...");
  const isConfigured = AIMemeableAnalysisService.isConfigured();
  console.log(
    `   ${isConfigured ? "✅" : "❌"} OpenAI API configured: ${isConfigured}`
  );
  if (!isConfigured) {
    console.log(
      "   ⚠️  Set OPENAI_API_KEY environment variable to test AI features"
    );
  }

  // Test 5: Token Data Validation
  console.log("\n5️⃣ Testing Token Data Validation...");
  const validTokenData = {
    name: "Test Meme Token",
    symbol: "TEST",
    description: "A test token for meme analysis validation",
    narrative: "Test narrative",
    hashtags: ["#test", "#meme"],
    marketingAngle: "Test marketing",
    targetAudience: "Test audience",
    launchStrategy: ["Test strategy"],
  };

  const invalidTokenData = {
    name: "X", // Too short
    symbol: "TOOLONGFORSYMBOL", // Too long
    description: "Short", // Too short
    narrative: "",
    hashtags: [],
    marketingAngle: "",
    targetAudience: "",
    launchStrategy: [],
  };

  const validResult =
    MemeTokenGeneratorService.validateTokenData(validTokenData);
  const invalidResult =
    MemeTokenGeneratorService.validateTokenData(invalidTokenData);

  console.log(
    `   Valid data: ${validResult.valid ? "✅" : "❌"} (errors: ${validResult.errors.length})`
  );
  console.log(
    `   Invalid data: ${invalidResult.valid ? "❌" : "✅"} (errors: ${invalidResult.errors.length})`
  );

  if (invalidResult.errors.length > 0) {
    console.log("   Error messages:");
    invalidResult.errors.forEach((error) => console.log(`     - ${error}`));
  }

  // Test 6: Fallback Token Generation
  console.log("\n6️⃣ Testing Fallback Token Generation...");
  const mockTwitterContent = {
    text: "This is a test tweet about crypto and memes!",
    author: "testuser",
    url: "https://x.com/testuser/status/123",
  };

  const fallbackData =
    MemeTokenGeneratorService.generateFallbackTokenData(mockTwitterContent);
  console.log(`   Generated name: ${fallbackData.name}`);
  console.log(`   Generated symbol: ${fallbackData.symbol}`);
  console.log(`   Generated description: ${fallbackData.description}`);
  console.log(
    `   ${fallbackData.name.length >= 3 ? "✅" : "❌"} Name length valid`
  );
  console.log(
    `   ${fallbackData.symbol.length >= 3 ? "✅" : "❌"} Symbol length valid`
  );

  console.log("\n🎉 Component Testing Complete!");
  console.log("\n📋 Next Steps:");
  console.log("1. Set OPENAI_API_KEY environment variable");
  console.log("2. Test with real Twitter URLs using /meme command");
  console.log("3. Verify token creation and launch integration");
  console.log("4. Monitor AI analysis quality and adjust prompts if needed");
}

// Run tests if this file is executed directly
if (require.main === module) {
  testMemeTokenFeature().catch(console.error);
}

export { testMemeTokenFeature };
