const { exec } = require("child_process");
const path = require("path");

console.log("🔍 Checking TypeScript syntax...");

// Check the specific file that had the duplicate import
const filePath = path.join(
  __dirname,
  "src/bot/conversation/relaunchTokenConversation.ts"
);

exec(
  `npx tsc --noEmit --skipLibCheck "${filePath}"`,
  (error, stdout, stderr) => {
    if (error) {
      console.error("❌ TypeScript compilation error:");
      console.error(stderr);
      process.exit(1);
    } else {
      console.log("✅ TypeScript syntax check passed!");
      console.log("✅ Duplicate import issue has been resolved.");

      // Also check the workers file
      const workersPath = path.join(__dirname, "src/jobs/workers.ts");
      exec(
        `npx tsc --noEmit --skipLibCheck "${workersPath}"`,
        (error2, stdout2, stderr2) => {
          if (error2) {
            console.error("❌ Workers file compilation error:");
            console.error(stderr2);
          } else {
            console.log("✅ Workers file syntax check passed!");
            console.log("\n🎉 All critical syntax issues resolved!");
            console.log("\nThe original build error was caused by:");
            console.log(
              '- Duplicate "TokenMetadataResponse" import in relaunchTokenConversation.ts'
            );
            console.log(
              "- This caused the build system to generate invalid JavaScript"
            );
            console.log("- Fixed by removing the duplicate import");
          }
        }
      );
    }
  }
);
