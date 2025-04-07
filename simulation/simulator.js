/**
 * Solana Memecoin Trading Bot Simulator
 *
 * This module simulates the trading strategy using real token data from TA.js
 * and real price updates from DexScreener, while simulating wallet interactions
 * and trade executions. It fetches new tokens only when there are no open positions.
 */

const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Import from existing codebase without modifying it
const { performTA, fetchOHLCV, calculateIndicators } = require('../TA');
const { getTokenHoldersHistorical } = require('../src/services/morali');
const { DexScreenerService } = require('../src/services/dexscreener');

// Import simulation utilities
const { logTrade, updateStats, logSimulationStats, generateRandomString, withFallback, ensureLogDirectory, getESTTimestamp } = require('./utils');

// Constants (matching trading.js)
const SOL_MINT = 'So11111111111111111111111111111111111111112'; // Native SOL mint address
const BUY_AMOUNT_LAMPORTS = 200000000; // 0.2 SOL in lamports
const MAX_POSITIONS = 1; // Maximum number of concurrent positions
const PRICE_CHECK_INTERVAL = 30000; // 30 seconds for position monitoring
const CHECK_INTERVAL = 60000; // 1 minute for checking positions and fetching tokens
// Slippage tolerance is handled internally in the simulation

// Simulation state
const wallet = {
  solBalance: 10000000000, // 10 SOL in lamports
  tokenBalances: new Map() // Map of tokenAddress -> amount
};

// Position tracking
const positions = new Map(); // Map of tokenAddress -> position object

// Monitoring interval reference for cleanup
let monitoringInterval = null;

// Cache for OHLCV data to reduce API calls
const ohlcvCache = new Map();
const CACHE_TTL = 60000; // 1 minute cache TTL

// Statistics tracking
const stats = {
  trades: 0,
  wins: 0,
  totalProfitLoss: 0,
  holdTimes: [],
  avgHoldTime: 0,
  winRate: 0
};

// Store the latest fetched tokens
let finalTokens = [];

/**
 * Simulate wallet balance check
 * @returns {Object} - Wallet balance info
 */
function simulateWalletBalance() {
  return {
    hasMinimumBalance: wallet.solBalance >= BUY_AMOUNT_LAMPORTS,
    solBalance: wallet.solBalance / 1e9 // Convert to SOL
  };
}

/**
 * Simulate a swap between tokens
 * @param {string} fromMint - Source token mint address
 * @param {string} toMint - Destination token mint address
 * @param {number} amount - Amount to swap
 * @param {number} price - Price of the token (for SOL to token swaps)
 * @returns {string} - Simulated transaction signature
 */
function simulateSwap(fromMint, toMint, amount, price = 0) {
  console.log(`Simulating swap: ${fromMint.slice(0, 8)}... -> ${toMint.slice(0, 8)}..., Amount: ${amount}`);

  // Generate a simulated transaction signature
  const txSignature = `SIMULATED_TX_${Date.now()}_${generateRandomString()}`;

  try {
    if (fromMint === SOL_MINT) {
      // SOL to Token swap
      if (wallet.solBalance < amount) {
        throw new Error(`Insufficient SOL balance: ${wallet.solBalance / 1e9} SOL`);
      }

      // Deduct SOL from wallet
      wallet.solBalance -= amount;

      // Calculate token amount based on price (SOL amount / token price)
      // This is a more accurate simulation of how many tokens would be received
      let tokenAmount;
      if (price > 0) {
        // Convert lamports to SOL and divide by token price
        tokenAmount = (amount / 1e9) / price;
        console.log(`Calculated token amount based on price $${price}: ${tokenAmount}`);
      } else {
        // Fallback if price is not provided
        tokenAmount = amount;
        console.log(`Using direct amount as token amount (no price provided): ${tokenAmount}`);
      }

      // Add tokens to wallet
      const currentTokenAmount = wallet.tokenBalances.get(toMint) || 0;
      wallet.tokenBalances.set(toMint, currentTokenAmount + tokenAmount);

      console.log(`Swapped ${amount / 1e9} SOL for ${tokenAmount.toFixed(6)} tokens of ${toMint.slice(0, 8)}...`);

      // Return the actual token amount received for position tracking
      return { txSignature, tokenAmount };
    } else {
      // Token to SOL swap
      const tokenBalance = wallet.tokenBalances.get(fromMint) || 0;
      if (tokenBalance < amount) {
        throw new Error(`Insufficient token balance: ${tokenBalance} of ${fromMint.slice(0, 8)}...`);
      }

      // Deduct tokens from wallet
      wallet.tokenBalances.set(fromMint, tokenBalance - amount);
      if (wallet.tokenBalances.get(fromMint) === 0) {
        wallet.tokenBalances.delete(fromMint);
      }

      // Calculate SOL amount based on price (token amount * token price * 1e9)
      let solAmount;
      if (price > 0) {
        // Convert token amount to SOL value in lamports
        solAmount = amount * price * 1e9;
        console.log(`Calculated SOL amount based on price $${price}: ${solAmount / 1e9} SOL`);
      } else {
        // Fallback if price is not provided
        solAmount = amount;
        console.log(`Using direct amount as SOL amount (no price provided): ${solAmount / 1e9} SOL`);
      }

      // Add SOL to wallet
      wallet.solBalance += solAmount;

      console.log(`Swapped ${amount.toFixed(6)} tokens of ${fromMint.slice(0, 8)}... for ${solAmount / 1e9} SOL`);

      return { txSignature, solAmount };
    }
  } catch (error) {
    console.error(`Swap simulation failed: ${error.message}`);
    throw error;
  }
}

/**
 * Check if a token meets the buy criteria
 * @param {Object} token - Token data from finalTokens
 * @returns {Object} - Result with decision and debug info
 */
function meetsBuyCriteria(token) {
  console.log(`\n=== Evaluating Buy Criteria for ${token.symbol} ===`);
  console.log(`Score: ${token.score}/100`);

  // Extract indicators with fallbacks for missing data
  const indicators = token.indicators.hour || {};

  // Debug log all relevant metrics
  console.log(`Price Change 5m: ${token.priceChange?.m5?.toFixed(2)}%`);
  console.log(`Price Change 1h: ${token.priceChange?.h1?.toFixed(2)}%`);

  // MACD indicators
  const macdValue = indicators.macd?.MACD || 0;
  const macdSignal = indicators.macd?.signal || 0;
  const macdHistogram = indicators.macd?.histogram || 0;
  console.log(`MACD: ${macdValue.toFixed(8)}, Signal: ${macdSignal.toFixed(8)}, Histogram: ${macdHistogram.toFixed(8)}`);

  // RSI
  const rsi = indicators.rsi || 50;
  console.log(`RSI: ${rsi.toFixed(2)}`);

  // Bollinger Bands
  const bUpper = indicators.bollinger?.upper || 0;
  console.log(`Price: $${token.priceUsd}, Bollinger Upper: $${bUpper}`);

  // Ichimoku
  const tenkanSen = indicators.ichimoku?.tenkanSen || 0;
  const kijunSen = indicators.ichimoku?.kijunSen || 0;
  console.log(`Tenkan-sen: ${tenkanSen.toFixed(8)}, Kijun-sen: ${kijunSen.toFixed(8)}`);

  // Transaction metrics
  const buys5m = token.txns?.m5?.buys || 0;
  const sells5m = token.txns?.m5?.sells || 1; // Avoid division by zero
  const buyRatio = buys5m / sells5m;
  console.log(`Txns 5m: Buys: ${buys5m}, Sells: ${sells5m}, Ratio: ${buyRatio.toFixed(2)}`);

  // Holder change
  console.log(`Holder Change 24h: ${token.holderChange24h?.toFixed(2)}%`);

  // RELAXED CRITERIA - Check conditions with more lenient thresholds
  // Each condition is checked separately for better debugging

  // 1. Score check - Keep this strict as it's a good overall indicator
  const scoreCheck = token.score > 60;
  console.log(`Score > 60: ${scoreCheck ? '✅ PASS' : '❌ FAIL'}`);

  // 2. Price momentum - Relaxed to allow for smaller or even slightly negative 5m changes
  const momentumCheck = token.priceChange?.m5 > -5 && token.priceChange?.h1 > -10;
  console.log(`Price momentum check: ${momentumCheck ? '✅ PASS' : '❌ FAIL'}`);

  // 3. MACD check - Relaxed to be optional if other indicators are strong
  const macdCheck = !indicators.macd || // Skip check if MACD is missing
                   (indicators.macd?.MACD > indicators.macd?.signal && indicators.macd?.histogram > 0);
  console.log(`MACD bullish check: ${macdCheck ? '✅ PASS' : '❌ FAIL'}`);

  // 4. RSI check - Keep this to avoid overbought conditions
  const rsiCheck = !indicators.rsi || indicators.rsi < 80; // Relaxed from 70 to 80
  console.log(`RSI < 80 check: ${rsiCheck ? '✅ PASS' : '❌ FAIL'}`);

  // 5. Technical indicator check - Make this optional
  const techCheck = !indicators.bollinger || !indicators.ichimoku || // Skip if indicators missing
                   token.priceUsd > indicators.bollinger?.lower || // Price above lower band (relaxed)
                   indicators.ichimoku?.tenkanSen > indicators.ichimoku?.kijunSen * 0.9; // Relaxed ratio
  console.log(`Technical indicator check: ${techCheck ? '✅ PASS' : '❌ FAIL'}`);

  // 6. Transaction ratio - Relaxed to allow more balanced buy/sell
  const txnCheck = !token.txns?.m5 || // Skip if transaction data missing
                  token.txns?.m5?.buys / (token.txns?.m5?.sells || 1) > 0.8; // Relaxed from 1.2 to 0.8
  console.log(`Transaction ratio check: ${txnCheck ? '✅ PASS' : '❌ FAIL'}`);

  // 7. Holder change - Make this optional since Moralis API often fails
  const holderCheck = token.holderChange24h === undefined || // Skip if holder data missing
                     token.holderChange24h >= -5; // Allow slight decrease
  console.log(`Holder change check: ${holderCheck ? '✅ PASS' : '❌ FAIL'}`);

  // Final decision - Require score check plus at least 4 of the 6 other checks
  const otherChecks = [momentumCheck, macdCheck, rsiCheck, techCheck, txnCheck, holderCheck];
  const passedChecks = otherChecks.filter(check => check).length;

  const decision = scoreCheck && passedChecks >= 4;
  console.log(`FINAL DECISION: ${decision ? '✅ BUY' : '❌ SKIP'} (Passed ${passedChecks}/6 additional checks)`);

  return decision;
}

/**
 * Check if a position meets the sell criteria
 * @param {Object} position - Position data
 * @param {Object} currentData - Current token data
 * @returns {Object} - Sell decision with reason
 */
function meetsSellCriteria(position, currentData) {
  const indicators = currentData.indicators.hour || {};
  const currentPrice = currentData.priceUsd;
  const entryPrice = position.entryPrice;
  const profitPercent = (currentPrice - entryPrice) / entryPrice;
  const highestPrice = position.highestPrice;

  // Use ATR from indicators or fallback to a percentage of entry price
  const atr = indicators.atr || (position.entryPrice * 0.025); // Fallback to 2.5% of entry price
  const trailingStopPrice = highestPrice - (2.5 * atr);

  // Check each sell condition
  if (profitPercent >= 0.15) {
    return { sell: true, reason: 'Profit target reached (15%)' };
  }

  if (profitPercent <= -0.07) {
    return { sell: true, reason: 'Stop loss triggered (-7%)' };
  }

  if (currentPrice < trailingStopPrice && highestPrice > entryPrice) {
    return { sell: true, reason: 'Trailing stop triggered' };
  }

  if (indicators.rsi > 80) {
    return { sell: true, reason: 'RSI overbought (>80)' };
  }

  if (currentPrice < indicators.bollinger?.middle) {
    return { sell: true, reason: 'Price below Bollinger middle band' };
  }

  if (currentData.holderChange24h < -5) {
    return { sell: true, reason: 'Significant holder decrease' };
  }

  return { sell: false };
}

/**
 * Execute a simulated buy order
 * @param {Object} token - Token data
 * @returns {Object|null} - Position data or null if buy failed
 */
async function executeBuy(token) {
  try {
    console.log(`Simulating buy for ${token.symbol} (${token.tokenAddress})`);

    if (!token.priceUsd || token.priceUsd <= 0) {
      throw new Error(`Invalid token price: ${token.priceUsd}`);
    }

    const { txSignature, tokenAmount } = simulateSwap(
      SOL_MINT,
      token.tokenAddress,
      BUY_AMOUNT_LAMPORTS,
      token.priceUsd
    );

    const position = {
      tokenAddress: token.tokenAddress,
      symbol: token.symbol,
      entryPrice: token.priceUsd,
      entryTime: Date.now(),
      highestPrice: token.priceUsd,
      amount: tokenAmount,
      poolAddress: token.poolAddress,
      txSignature
    };

    // Explicitly add to positions Map
    positions.set(token.tokenAddress, position);
    console.log(`Position added for ${token.symbol}: ${tokenAmount} tokens at $${token.priceUsd}`);

    await logTrade({
      action: 'BUY',
      symbol: token.symbol,
      price: token.priceUsd,
      amount: position.amount,
      txSignature,
      reason: `Score: ${token.score.toFixed(2)}/100, RSI: ${token.indicators.hour?.rsi?.toFixed(2) || 'N/A'}`
    });

    return position;
  } catch (error) {
    console.error(`Buy simulation failed for ${token.symbol}: ${error.message}`);
    return null;
  }
}

/**
 * Execute a simulated sell order
 * @param {Object} position - Position data
 * @param {Object} currentData - Current token data
 * @param {string} reason - Reason for selling
 * @returns {boolean} - Whether sell was successful
 */
async function executeSell(position, currentData, reason) {
  try {
    console.log(`Simulating sell for ${position.symbol} (${position.tokenAddress}): ${reason}`);

    if (!currentData.priceUsd || currentData.priceUsd <= 0) {
      throw new Error(`Invalid current price: ${currentData.priceUsd}`);
    }

    const { txSignature, solAmount } = simulateSwap(
      position.tokenAddress,
      SOL_MINT,
      position.amount,
      currentData.priceUsd
    );

    const profitLoss = ((currentData.priceUsd - position.entryPrice) / position.entryPrice) * 100;
    const holdTime = (Date.now() - position.entryTime) / 1000;

    await logTrade({
      action: 'SELL',
      symbol: position.symbol,
      price: currentData.priceUsd,
      amount: position.amount,
      profitLoss,
      txSignature,
      reason
    });

    console.log(`Wallet updated: Added ${solAmount / 1e9} SOL from ${position.symbol} sell`);
    updateStats(stats, profitLoss, holdTime);
    return true;
  } catch (error) {
    console.error(`Sell simulation failed for ${position.symbol}: ${error.message}`);
    return false;
  }
}

/**
 * Update position data with current market information
 * @param {Object} position - Position data
 * @param {Object} currentData - Current token data
 * @returns {Object} - Updated position
 */
function updatePosition(position, currentData) {
  // Update highest price for trailing stop
  if (currentData.priceUsd > position.highestPrice) {
    position.highestPrice = currentData.priceUsd;
  }

  return position;
}

/**
 * Get current data for a token with fresh indicators and holder data
 * @param {string} tokenAddress - Token address
 * @param {string} poolAddress - Pool address
 * @param {string} symbol - Token symbol
 * @param {DexScreenerService} dexService - DexScreener service instance
 * @returns {Object|null} - Current token data or null if fetch failed
 */
async function getCurrentTokenData(tokenAddress, poolAddress, symbol, dexService) {
  try {
    console.log(`Fetching current data for ${symbol} (${tokenAddress})...`);

    // Get pair data from DexScreener for current price and transaction data
    const pairData = await withFallback(
      async () => await dexService.getPairData('solana', poolAddress),
      null,
      `Failed to fetch pair data for ${symbol}`
    );

    if (!pairData) {
      throw new Error(`Failed to fetch pair data for ${symbol}`);
    }

    // Fetch fresh OHLCV data for recalculating indicators
    let ohlcvData;
    const cacheKey = `${poolAddress}_hour_1`;
    const cachedData = ohlcvCache.get(cacheKey);

    // Use cached data if available and not expired
    if (cachedData && (Date.now() - cachedData.timestamp) < CACHE_TTL) {
      ohlcvData = cachedData.data;
      console.log(`Using cached OHLCV data for ${symbol} (${ohlcvData.length} candles)`);
    } else {
      // Fetch fresh OHLCV data
      ohlcvData = await withFallback(
        async () => await fetchOHLCV('solana', poolAddress, symbol, 'hour', 1),
        [],
        `Failed to fetch OHLCV data for ${symbol}`
      );

      // Cache the data with timestamp
      ohlcvCache.set(cacheKey, {
        data: ohlcvData,
        timestamp: Date.now()
      });

      console.log(`Fetched fresh OHLCV data for ${symbol} (${ohlcvData.length} candles)`);
    }

    // Calculate fresh indicators using the OHLCV data
    let indicators = {};
    if (ohlcvData && ohlcvData.length > 0) {
      // Use the last 20 candles (or all available if less) for indicator calculation
      const recentOhlcv = ohlcvData.slice(-20);
      indicators = calculateIndicators(recentOhlcv);
      console.log(`Recalculated indicators for ${symbol}`);
    } else {
      console.warn(`Insufficient OHLCV data for ${symbol}, using fallback indicators`);

      // Create fallback indicators based on current price
      indicators = {
        rsi: 50, // Neutral RSI
        bollinger: {
          upper: pairData.priceUsd * 1.05,
          middle: pairData.priceUsd,
          lower: pairData.priceUsd * 0.95
        },
        atr: pairData.priceUsd * 0.025, // 2.5% of price as ATR
        macd: { MACD: 0, signal: 0, histogram: 0 }
      };
    }

    // Fetch fresh holder data
    const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // YYYY-MM-DD
    const toDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    let historicalHolders;
    let holderChange24h = 0;

    try {
      historicalHolders = await withFallback(
        async () => await getTokenHoldersHistorical(tokenAddress, fromDate, toDate),
        { result: [] },
        `Failed to fetch historical holders for ${symbol}`
      );

      console.log(`Fetched historical holders for ${symbol}: ${historicalHolders?.result?.length || 0} data points`);

      // Calculate holder change percentage
      holderChange24h = historicalHolders?.result?.length > 1
        ? ((historicalHolders.result[historicalHolders.result.length - 1].totalHolders -
            historicalHolders.result[0].totalHolders) / (historicalHolders.result[0].totalHolders || 1) * 100) || 0
        : 0;
    } catch (error) {
      console.error(`Failed to fetch historical holders for ${symbol}: ${error.message}`);
      historicalHolders = { result: [] };
      // For simulation purposes, generate a random holder change between -5 and 10
      holderChange24h = Math.random() * 15 - 5;
      console.log(`Using simulated holder change for ${symbol}: ${holderChange24h.toFixed(2)}%`);
    }

    console.log(`Current holder change for ${symbol}: ${holderChange24h.toFixed(2)}%`);

    // Combine all data
    return {
      ...pairData,
      indicators: { hour: indicators },
      historicalHolders,
      holderChange24h
    };
  } catch (error) {
    console.error(`Failed to get current data for ${tokenAddress}: ${error.message}`);
    return null;
  }
}

/**
 * Monitor and manage open positions
 * @param {DexScreenerService} dexService - DexScreener service instance
 */
async function monitorPositions(dexService) {
  if (positions.size === 0) {
    if (monitoringInterval) {
      console.log('No positions to monitor. Stopping monitoring interval.');
      clearInterval(monitoringInterval);
      monitoringInterval = null;
    }
    return;
  }
  console.log(`Monitoring ${positions.size} open positions at ${getESTTimestamp()}...`);
  for (const [tokenAddress, position] of positions.entries()) {
    try {
      console.log(`Checking position: ${position.symbol} (${tokenAddress})`);
      const currentData = await getCurrentTokenData(
        tokenAddress,
        position.poolAddress,
        position.symbol,
        dexService
      );
      if (!currentData || !currentData.priceUsd) {
        console.warn(`No valid price data for ${position.symbol}, skipping...`);
        continue;
      }
      const updatedPosition = updatePosition(position, currentData);
      positions.set(tokenAddress, updatedPosition);
      const currentPrice = currentData.priceUsd;
      const profitPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
      console.log(`Monitoring ${position.symbol}: Current price $${currentPrice.toFixed(8)}, ` +
                  `P/L: ${profitPercent.toFixed(2)}%, Highest: $${updatedPosition.highestPrice.toFixed(8)}`);
      const sellDecision = meetsSellCriteria(updatedPosition, currentData);
      if (sellDecision.sell) {
        console.log(`Sell triggered for ${position.symbol}: ${sellDecision.reason}`);
        const sellSuccess = await executeSell(updatedPosition, currentData, sellDecision.reason);
        if (sellSuccess) {
          positions.delete(tokenAddress);
          console.log(`Position ${position.symbol} sold successfully`);
        } else {
          console.warn(`Sell failed for ${position.symbol}`);
        }
      }
    } catch (error) {
      console.error(`Monitoring error for ${position.symbol}: ${error.message}`);
    }
  }
}

/**
 * Process tokens for potential trades
 * @param {Array} tokens - Tokens from TA.js
 */
async function processTokens(tokens) {
  console.log(`Processing ${tokens.length} tokens for potential trades...`);

  // Skip if maximum positions reached
  if (positions.size >= MAX_POSITIONS) {
    console.log(`Maximum positions (${MAX_POSITIONS}) reached. Skipping new entries.`);
    return;
  }

  // Sort tokens by score (highest first)
  const sortedTokens = [...tokens].sort((a, b) => b.score - a.score);

  for (const token of sortedTokens) {
    // Skip if already in a position for this token
    if (positions.has(token.tokenAddress)) {
      continue;
    }

    // Check buy criteria
    if (meetsBuyCriteria(token)) {
      console.log(`Buy criteria met for ${token.symbol} (Score: ${token.score.toFixed(2)}/100)`);

      // Execute buy (position is added to positions Map inside executeBuy)
      const position = await executeBuy(token);
      if (position) {
        console.log(`Bought ${token.symbol} at $${token.priceUsd}`);

        // Exit if maximum positions reached
        if (positions.size >= MAX_POSITIONS) {
          console.log(`Maximum positions (${MAX_POSITIONS}) reached.`);
          break;
        }
      }
    }
  }
}

/**
 * Execute trading strategy with simulated wallet
 * @param {Array} tokens - Tokens from TA.js
 * @param {DexScreenerService} dexService - DexScreener service instance needed for monitoring
 */
async function executeTradingStrategy(tokens, dexService) {
  try {
    console.log('Initializing trading strategy simulation...');

    // Check simulated wallet balance
    const walletInfo = simulateWalletBalance();

    // Check if wallet has sufficient balance
    if (!walletInfo.hasMinimumBalance) {
      console.error(`Insufficient wallet balance for trading: ${walletInfo.solBalance} SOL`);
      return;
    }

    // Process tokens for potential trades
    await processTokens(tokens);

    // Set up position monitoring only if we have positions
    if (positions.size > 0 && !monitoringInterval) {
      console.log('Starting position monitoring every 30 seconds...');
      monitoringInterval = setInterval(() => monitorPositions(dexService), PRICE_CHECK_INTERVAL);
    } else if (positions.size === 0) {
      console.log('No positions to monitor. Skipping monitoring setup.');
    }

    console.log('Trading strategy simulation initialized successfully.');
  } catch (error) {
    // Handle specific error messages
    if (error.message.includes('Environment variables not loaded')) {
      console.log('Environment variables error detected. This is expected in simulation mode.');
      console.log('Continuing with simulation using mock wallet...');
    } else {
      console.error(`Trading strategy simulation failed: ${error.message}`);
    }
  }
}

/**
 * Helper function to sleep for a specified duration
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} - Promise that resolves after the specified time
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch and analyze tokens with retry logic
 * @param {DexScreenerService} dexService - DexScreener service instance
 * @returns {Array} - Analyzed tokens
 */
async function fetchAndAnalyzeTokens(dexService) {
  const MAX_RETRIES = 3;
  let attempt = 1;

  while (attempt <= MAX_RETRIES) {
    try {
      console.log(`Attempt ${attempt}/${MAX_RETRIES}: Fetching token data...`);
      const tokens = await performTA(dexService);
      console.log(`Found ${tokens.length} tokens after analysis`);
      return tokens.slice(0, Math.min(tokens.length, 3));
    } catch (error) {
      console.error(`Attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`);
      if (attempt === MAX_RETRIES) {
        console.log('Max retries reached. Falling back to sample tokens.');
        return generateSampleTokensInternal();
      }
      attempt++;
      await sleep(5000); // Wait 5 seconds before retrying
    }
  }
}

/**
 * Generate sample tokens for simulation when performTA is not available
 * @returns {Array} - Sample tokens for simulation
 */
function generateSampleTokensInternal() {
  // Create a few sample tokens with realistic data
  const sampleTokens = [
    {
      tokenAddress: 'C1gTFJF9WJ5Bxm42fLLdHgHLxuHhvvH7ENYhQKv5pump',
      poolAddress: 'FC4AHcBF8zeRNNZdqqx4dn583qKrWDHNyrqTtEUYQWu',
      symbol: 'ENDGAME',
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
    },
    {
      tokenAddress: 'FS3JQSNLmg16miqdcKrDrVGihA8CXmg8cfx7psTipump',
      poolAddress: '67Rs1DSgZrUKAdfmRTDUJobMbB9phoPKEvNikRc7bePN',
      symbol: 'POOR',
      priceUsd: 0.000112,
      score: 72.6,
      rawScore: 145.2,
      priceChange: { m5: 21.61, h1: 27.00, h6: 52.00, h24: 152.00 },
      txns: {
        m5: { buys: 279, sells: 199 },
        h1: { buys: 1218, sells: 1135 },
        h24: { buys: 14343, sells: 13114 }
      },
      indicators: {
        hour: {
          macd: { MACD: 0.00000005, signal: 0.00000002, histogram: 0.00000003 },
          rsi: 58,
          bollinger: { upper: 0.00012778, middle: 0.00006244, lower: 0.00000290 },
          atr: 0.00000300,
          ichimoku: {
            tenkanSen: 0.00007000,
            kijunSen: 0.00006000,
            senkouSpanA: 0.00006500,
            senkouSpanB: 0.00005500,
            chikouSpan: 0.00008000
          }
        }
      },
      holderChange24h: 6.3,
      liquidity: 31375.71,
      volume24h: 851228.80
    }
  ];

  return sampleTokens;
}

/**
 * Run the simulation in a continuous loop
 * Fetches new tokens only when there are no open positions
 */
async function runSimulation() {
  console.log('Starting Solana memecoin trading bot simulation...');

  // Clear log files at the start of the simulation
  await ensureLogDirectory();
  console.log(`Simulation started at ${getESTTimestamp()} EST`);

  // Initialize DexScreener service
  const dexService = new DexScreenerService();

  // Main simulation loop
  while (true) {
    try {
      console.log('\n--- Simulation Cycle ---');
      console.log(`Current wallet: ${wallet.solBalance / 1e9} SOL, ${wallet.tokenBalances.size} tokens`);
      console.log(`Open positions: ${positions.size}`);

      // Only fetch new tokens when there are no open positions
      if (positions.size === 0) {
        console.log('No open positions. Fetching new tokens...');

        // Fetch real tokens with retry logic
        finalTokens = await fetchAndAnalyzeTokens(dexService);
        console.log(`Using ${finalTokens.length} tokens for simulation`);

        // Execute trading strategy with tokens
        await executeTradingStrategy(finalTokens, dexService);
      } else {
        console.log(`${positions.size} open positions. Continuing monitoring...`);
        // Monitoring is handled by the monitoringInterval
      }

      // Log simulation stats
      await logSimulationStats(stats, wallet);

      // Wait before next cycle
      console.log(`Waiting ${CHECK_INTERVAL / 1000} seconds before next cycle...`);
      await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL));
    } catch (error) {
      console.error(`Simulation cycle error: ${error.message}`);
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL));
    }
  }
}

// Start the simulation
console.log('Initializing simulation...');
runSimulation().catch(error => {
  console.error(`Simulation failed: ${error.message}`);
});
