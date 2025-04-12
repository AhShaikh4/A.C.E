// test-blacklist.js - Test script for the token blacklist feature

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { DexScreenerService } = require('./src/services/dexscreener');
const { initializeBlacklist, isBlacklisted } = require('./blacklist');
const { simulateTrading } = require('./simulation/simulator');

// Create sample tokens for testing, including blacklisted ones
async function createTestTokens() {
  // Get the blacklisted tokens from the blacklist.json file
  const blacklistFile = './data/blacklist.json';
  const blacklistData = JSON.parse(await fs.readFile(blacklistFile, 'utf8'));
  const blacklistedTokens = blacklistData.blacklistedTokens;
  
  console.log(`Found ${blacklistedTokens.length} blacklisted tokens in the blacklist.json file`);
  
  // Create sample tokens, including the blacklisted ones
  const sampleTokens = [
    // This is a blacklisted token (DEAL)
    {
      tokenAddress: 'EZ27wXe1jFYdgDY6bH428TqETrxix1e2FpGDERrbPjNd',
      poolAddress: 'FC4AHcBF8zeRNNZdqqx4dn583qKrWDHNyrqTtEUYQWu',
      symbol: 'DEAL',
      priceUsd: 0.000164,
      score: 85.5,
      rawScore: 171,
      priceChange: { m5: 2.25, h1: 3.41, h6: 272.00, h24: 272.00 },
      txns: {
        m5: { buys: 3732, sells: 40 },
        h1: { buys: 46526, sells: 595 },
        h24: { buys: 97052, sells: 1818 }
      },
      indicators: {
        hour: {
          macd: { MACD: 0.00000002, signal: 0.00000001, histogram: 0.00000001 },
          rsi: 65,
          bollinger: { upper: 0.00017472, middle: 0.00014942, lower: 0.00012413 },
          atr: 0.00000500,
          ichimoku: {
            tenkanSen: 0.00015000,
            kijunSen: 0.00014000,
            senkouSpanA: 0.00014500,
            senkouSpanB: 0.00013500,
            chikouSpan: 0.00016000
          }
        }
      },
      holderChange24h: 5.2,
      liquidity: 36234.06,
      volume24h: 469044.77
    },
    // This is a non-blacklisted token
    {
      tokenAddress: '6D8iXmyX2WXPm4kaKLmdDphSKo8rR8x1ggNM7hDnUwmZ',
      poolAddress: 'GbeKJAuVA3qahwjFvNQvubacMkt1wBdZVsAvsxykykkF',
      symbol: 'REXY',
      priceUsd: 0.000038,
      score: 78.2,
      rawScore: 156.4,
      priceChange: { m5: 3.06, h1: 17.25, h6: 10.80, h24: 653.00 },
      txns: {
        m5: { buys: 22, sells: 11 },
        h1: { buys: 92, sells: 33 },
        h24: { buys: 88523, sells: 806 }
      },
      indicators: {
        hour: {
          macd: { MACD: 0.00000003, signal: 0.00000001, histogram: 0.00000002 },
          rsi: 62,
          bollinger: { upper: 0.00006349, middle: 0.00004223, lower: 0.00002097 },
          atr: 0.00000200,
          ichimoku: {
            tenkanSen: 0.00004500,
            kijunSen: 0.00004000,
            senkouSpanA: 0.00004250,
            senkouSpanB: 0.00003750,
            chikouSpan: 0.00004800
          }
        }
      },
      holderChange24h: 8.7,
      liquidity: 23341.78,
      volume24h: 116190.68
    }
  ];
  
  return sampleTokens;
}

async function testBlacklist() {
  console.log('Starting blacklist test...');
  
  // Initialize blacklist
  await initializeBlacklist();
  
  // Create test tokens
  const testTokens = await createTestTokens();
  
  console.log(`Created ${testTokens.length} test tokens`);
  
  // Check each token against the blacklist
  for (const token of testTokens) {
    const isTokenBlacklisted = isBlacklisted(token.tokenAddress);
    console.log(`Token ${token.symbol} (${token.tokenAddress}) is ${isTokenBlacklisted ? 'BLACKLISTED' : 'NOT blacklisted'}`);
  }
  
  // Initialize DexScreener service
  const dexService = new DexScreenerService();
  
  // Run simulation with test tokens
  console.log('\nRunning simulation with test tokens...');
  const result = await simulateTrading(testTokens, dexService);
  
  console.log(`\nSimulation result: ${result.success ? 'Success' : 'Failed'}`);
  console.log(`Positions opened: ${result.positionsOpened || 0}`);
  
  if (result.positions && result.positions.length > 0) {
    console.log('\nPositions opened:');
    for (const position of result.positions) {
      console.log(`- ${position.symbol} at $${position.entryPrice}`);
    }
  }
  
  // Verify that no blacklisted tokens were purchased
  console.log('\nVerifying that no blacklisted tokens were purchased...');
  const blacklistedTokensPurchased = result.positions?.filter(pos => 
    testTokens.find(token => token.symbol === pos.symbol && isBlacklisted(token.tokenAddress))
  ) || [];
  
  if (blacklistedTokensPurchased.length === 0) {
    console.log('✅ TEST PASSED: No blacklisted tokens were purchased');
  } else {
    console.log('❌ TEST FAILED: Blacklisted tokens were purchased:');
    for (const position of blacklistedTokensPurchased) {
      console.log(`- ${position.symbol}`);
    }
  }
}

// Run the test
testBlacklist().catch(error => {
  console.error(`Test failed: ${error.message}`);
  process.exit(1);
});
