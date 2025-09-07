#!/usr/bin/env bun
/**
 * Quick test to verify the bot is running and responsive
 */

const BOT_TOKEN = "5948785018:AAFYSklrnkEF0rBoUp8xhnKNaCmFnocSRFA";

async function testBotStatus() {
  console.log("🤖 Testing Bot Status");
  console.log("====================");
  
  try {
    // Test 1: Get bot info
    console.log("1️⃣ Testing bot API access...");
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    const data = await response.json();
    
    if (data.ok) {
      console.log(`✅ Bot API accessible: ${data.result.first_name} (@${data.result.username})`);
    } else {
      console.log("❌ Bot API error:", data);
      return;
    }
    
    // Test 2: Check webhook status
    console.log("2️⃣ Checking webhook status...");
    const webhookResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
    const webhookData = await webhookResponse.json();
    
    if (webhookData.ok) {
      console.log(`✅ Webhook status: ${webhookData.result.url || 'No webhook set (polling mode)'}`);
      console.log(`   - Pending updates: ${webhookData.result.pending_update_count || 0}`);
      if (webhookData.result.last_error_message) {
        console.log(`   - Last error: ${webhookData.result.last_error_message}`);
      }
    }
    
    // Test 3: Check if local processes are running
    console.log("3️⃣ Checking local processes...");
    const { spawn } = require('child_process');
    const ps = spawn('ps', ['aux']);
    let output = '';
    
    ps.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });
    
    ps.on('close', () => {
      const botProcesses = output.split('\n').filter(line => 
        line.includes('bun run src/index.ts') || 
        line.includes('bun run src/jobs/index.ts')
      );
      
      console.log(`✅ Found ${botProcesses.length} local processes running`);
      botProcesses.forEach((process, i) => {
        const parts = process.trim().split(/\s+/);
        const pid = parts[1];
        const command = parts.slice(10).join(' ');
        console.log(`   - Process ${i + 1}: PID ${pid} - ${command}`);
      });
      
      if (botProcesses.length >= 2) {
        console.log("");
        console.log("🎉 SUCCESS! Bot is running locally and ready for testing!");
        console.log("");
        console.log("📱 To test the PumpFun dev buy functionality:");
        console.log("   1. Open Telegram and search for @OnedollarAi_bot");
        console.log("   2. Start a conversation with /start");
        console.log("   3. Try creating a token with dev buy");
        console.log("");
        console.log("🔧 Bot processes are running:");
        console.log("   - Main bot: Handling Telegram messages");
        console.log("   - Job processor: Processing token launches");
      } else {
        console.log("⚠️  Warning: Not all processes are running. Expected 2, found " + botProcesses.length);
      }
    });
    
  } catch (error) {
    console.log("❌ Error testing bot status:", error);
  }
}

testBotStatus();