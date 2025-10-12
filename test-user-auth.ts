#!/usr/bin/env node

/**
 * Test User Authentication System
 *
 * This script tests the user authentication whitelist functionality
 */

import { isUserAuthorized } from "./src/bot/utils";

// Test cases for authentication
const testCases = [
  // Authorized users (should return true)
  {
    username: "saintlessteel",
    expected: true,
    description: "Authorized user 1",
  },
  { username: "dyingangels", expected: true, description: "Authorized user 2" },
  {
    username: "SuperDevBack",
    expected: true,
    description: "Authorized user 3",
  },
  {
    username: "@saintlessteel",
    expected: true,
    description: "Authorized user with @ symbol",
  },
  {
    username: "SAINTLESSTEEL",
    expected: true,
    description: "Authorized user uppercase",
  },

  // Unauthorized users (should return false)
  {
    username: "unauthorized_user",
    expected: false,
    description: "Unauthorized user",
  },
  {
    username: "hacker",
    expected: false,
    description: "Random unauthorized user",
  },
  { username: "", expected: false, description: "Empty username" },
  { username: undefined, expected: false, description: "Undefined username" },
  {
    username: "saintlssteel",
    expected: false,
    description: "Typo in username",
  },
];

function runTests() {
  console.log("🔒 Testing User Authentication System\n");

  let passedTests = 0;
  const totalTests = testCases.length;

  for (const testCase of testCases) {
    const result = isUserAuthorized(testCase.username);
    const passed = result === testCase.expected;

    console.log(`${passed ? "✅" : "❌"} ${testCase.description}`);
    console.log(`   Username: "${testCase.username}"`);
    console.log(`   Expected: ${testCase.expected}, Got: ${result}`);

    if (passed) {
      passedTests++;
    }

    console.log();
  }

  console.log(`📊 Test Results: ${passedTests}/${totalTests} tests passed`);

  if (passedTests === totalTests) {
    console.log(
      "🎉 All tests passed! User authentication is working correctly."
    );
    process.exit(0);
  } else {
    console.log("❌ Some tests failed. Please check the authentication logic.");
    process.exit(1);
  }
}

// Run the tests
runTests();
