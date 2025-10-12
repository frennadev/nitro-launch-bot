#!/usr/bin/env node

/**
 * Test script for the ObjectId casting fix
 */

import { safeObjectId } from "./src/backend/utils";

console.log("🧪 Testing safeObjectId function...\n");

// Test cases
const testCases = [
  { input: "", expected: null, description: "Empty string" },
  { input: "   ", expected: null, description: "Whitespace only" },
  { input: null, expected: null, description: "Null value" },
  { input: undefined, expected: null, description: "Undefined value" },
  {
    input: "68492054bc12916bc8cedcb3",
    expected: "ObjectId",
    description: "Valid ObjectId string",
  },
  {
    input: "invalid-objectid",
    expected: null,
    description: "Invalid ObjectId string",
  },
];

console.log("Test Results:");
console.log("=============");

for (const testCase of testCases) {
  try {
    const result = safeObjectId(testCase.input);
    const success =
      (testCase.expected === null && result === null) ||
      (testCase.expected === "ObjectId" && result !== null);

    console.log(`${success ? "✅" : "❌"} ${testCase.description}`);
    console.log(`   Input: ${JSON.stringify(testCase.input)}`);
    console.log(
      `   Result: ${result ? `ObjectId(${result.toString()})` : "null"}`
    );
    console.log("");
  } catch (error) {
    console.log(`❌ ${testCase.description} - Error: ${error}`);
    console.log("");
  }
}

console.log(
  "🎯 Test completed! The safeObjectId function should prevent ObjectId casting errors."
);
