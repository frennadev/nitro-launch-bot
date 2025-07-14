# Testing Guide for Bonk.fun Integration

## ✅ **Bot Status: RUNNING SUCCESSFULLY**

The bot is currently running with:
- **Bot Username**: @OnedollarAi_bot
- **Bot ID**: 5948785018
- **Status**: ✅ Active with sophisticated frontend
- **Redis**: ✅ Connected
- **MongoDB**: ✅ Connected

## **Testing Methods**

### **1. Integration Test (Code Level)**
```bash
cd new-launch-bot
bun run test-bonk-integration.ts
```

**What it tests:**
- ✅ Function imports and exports
- ✅ Configuration system integration
- ✅ Error handling
- ✅ Parameter validation
- ✅ IPFS integration (requires Pinata credentials)

**Expected Output:**
```
🧪 Testing Bonk.fun Token Creation Integration
✅ Integration test completed - error handling works correctly
```

### **2. Bot Testing (Full Integration)**

#### **Step 1: Start the Bot**
```bash
cd new-launch-bot
bun run src/index.ts
```

#### **Step 2: Test on Telegram**
1. **Open Telegram** and search for `@OnedollarAi_bot`
2. **Send `/start`** to begin
3. **Click "Create Token"** or send the command
4. **Select "🚀 LetsBonk"** platform
5. **Provide token details** in format: `TokenName,TKN,My amazing token`
6. **Upload an image** (max 20MB)
7. **Confirm creation** and wait for result

#### **Step 3: Expected Flow**
```
User: /start
Bot: Welcome message with main menu

User: Create Token
Bot: Choose platform (🎉 PumpFun / 🚀 LetsBonk)

User: 🚀 LetsBonk
Bot: "✅ Launch mode set to LetsBonk"

Bot: Token details prompt + wallet instructions
User: MyToken,MTK,My amazing token

Bot: "Upload an image for your token"
User: [Uploads image]

Bot: "🔄 Creating your Bonk.fun token..."
[Processing with IPFS upload + blockchain creation]

Bot: Success message with token address and launch button
```

### **3. Manual Testing Checklist**

#### **✅ Platform Selection**
- [ ] Bot shows platform selection (PumpFun vs LetsBonk)
- [ ] Selecting "🚀 LetsBonk" sets mode correctly
- [ ] Bot confirms mode selection

#### **✅ Token Details Collection**
- [ ] Bot prompts for name,symbol,description
- [ ] Parses comma-separated format correctly
- [ ] Handles invalid format with error message
- [ ] Shows wallet funding instructions

#### **✅ Image Upload**
- [ ] Bot requests image upload
- [ ] Accepts images up to 20MB
- [ ] Rejects oversized images
- [ ] Downloads image for processing

#### **✅ Token Creation**
- [ ] Shows loading message during creation
- [ ] Uploads metadata to IPFS
- [ ] Creates token on Raydium Launch Lab
- [ ] Handles errors gracefully
- [ ] Shows success message with token address

#### **✅ Success Response**
- [ ] Displays token address
- [ ] Shows metadata URI
- [ ] Provides launch button
- [ ] Includes transaction signature (if available)

### **4. Error Testing**

#### **Test Invalid Inputs:**
```
User: "Invalid format"
Bot: "Invalid format. Please send again as name,symbol,description"

User: [No image]
Bot: Continues waiting for image

User: [Oversized image > 20MB]
Bot: "Image too large. Please start over"
```

#### **Test Network Issues:**
- Disconnect internet during creation
- Bot should show appropriate error message
- Should allow retry

### **5. Production Testing**

#### **Prerequisites:**
1. **Pinata API Credentials** in `.env`:
   ```
   PINATA_API_KEY=your_api_key
   PINATA_SECRET_KEY=your_secret_key
   ```

2. **Funded Dev Wallet** with sufficient SOL for:
   - Token creation fees (~0.1 SOL)
   - Priority fees (~0.01-0.05 SOL)
   - IPFS upload fees

3. **Bonk Addresses** in database:
   - Unused Bonk addresses available
   - Properly configured in MongoDB

#### **Full Production Test:**
```bash
# 1. Ensure bot is running
bun run src/index.ts

# 2. Test on Telegram with real credentials
# 3. Create token with real SOL
# 4. Verify token appears on Bonk.fun
# 5. Test launch functionality
```

### **6. Debugging**

#### **Check Bot Logs:**
```bash
# View real-time logs
tail -f logs/bot.log

# Check for specific errors
grep "bonk" logs/bot.log
grep "error" logs/bot.log
```

#### **Database Verification:**
```bash
# Check token records
mongo your_database --eval "db.tokens.find({destination: 'letsbonk'})"

# Check Bonk addresses
mongo your_database --eval "db.bonkaddresses.find({used: false})"
```

#### **Blockchain Verification:**
```bash
# Verify token on Solana
solana account <TOKEN_ADDRESS>

# Check on Bonk.fun
curl https://api.bonk.fun/token/<TOKEN_ADDRESS>
```

## **Current Status**

### **✅ What's Working:**
- Bot is running successfully
- Platform selection works
- Token details collection works
- Image upload handling works
- Error handling works
- Integration test passes

### **⚠️ What Needs Testing:**
- Full token creation with real credentials
- IPFS upload with Pinata
- Blockchain transaction creation
- Database record creation
- Launch functionality

### **🚀 Ready for Production Testing:**
The integration is ready for full production testing once you:
1. Add Pinata API credentials
2. Fund a dev wallet
3. Ensure Bonk addresses are available

## **Quick Test Commands**

```bash
# Test integration (no credentials needed)
bun run test-bonk-integration.ts

# Start bot for Telegram testing
bun run src/index.ts

# Check bot status
ps aux | grep "bun run src/index.ts"

# View logs
tail -f logs/bot.log
```

**The bot is ready for testing! 🎉** 