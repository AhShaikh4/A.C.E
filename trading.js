const fs = require('fs').promises;
const { PublicKey, Connection } = require('@solana/web3.js');
const { initializeConnection, initializeWallet, checkWalletBalance } = require('./wallet');
const JupiterService = require('./src/services/jupiter');
const { DexScreenerService } = require('./src/services/dexscreener');
const { getTokenHoldersHistorical } = require('./src/services/morali');

// Import functions from TA.js
const { fetchOHLCV, calculateIndicators } = require('./TA');

// Constants
const SOL_MINT = 'So11111111111111111111111111111111111111112'; // Native SOL mint address
const BUY_AMOUNT_LAMPORTS = 200000000; // 0.2 SOL in lamports
const MAX_POSITIONS = 1; // Maximum number of concurrent positions (limited to 1)
const PRICE_CHECK_INTERVAL = 30000; // 30 seconds
const SLIPPAGE_BPS = 500; // 5% slippage tolerance

// Position tracking
const positions = new Map();

// Monitoring interval reference for cleanup
let monitoringInterval = null;

// Cache for OHLCV data to reduce API calls
const ohlcvCache = new Map();
const CACHE_TTL = 60000; // 1 minute cache TTL

/**
 * Check if a token meets the buy criteria
 * @param {Object} token - Token data from finalTokens
 * @returns {boolean} - Whether the token meets buy criteria
 */
function meetsBuyCriteria(token) {
  const indicators = token.indicators.hour || {};

  // Check all required buy conditions
  return (
    token.score > 60 && // Score above 60 (out of 100)
    token.priceChange.m5 > 2 && token.priceChange.h1 > 0 && // Recent positive momentum
    indicators.macd?.MACD > indicators.macd?.signal && indicators.macd?.histogram > 0 && // MACD bullish
    indicators.rsi < 70 && // RSI not overbought
    (token.priceUsd > indicators.bollinger?.upper || // Price above upper Bollinger Band
     indicators.ichimoku?.tenkanSen > indicators.ichimoku?.kijunSen) && // Tenkan-sen above Kijun-sen
    token.txns?.m5?.buys / (token.txns?.m5?.sells || 1) > 1.2 && // Recent buy pressure
    token.holderChange24h > 0 // Positive holder growth
  );
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
  const trailingStopPrice = highestPrice - (2.5 * (indicators.atr || 0));

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
 * Log trade details to file
 * @param {Object} tradeDetails - Details of the trade
 */
async function logTrade(tradeDetails) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${tradeDetails.action} ${tradeDetails.symbol} | ${tradeDetails.reason || ''}\n` +
                  `  Price: ${tradeDetails.price} | Amount: ${tradeDetails.amount}\n` +
                  `  Profit/Loss: ${tradeDetails.profitLoss ? (tradeDetails.profitLoss > 0 ? '+' : '') + tradeDetails.profitLoss.toFixed(2) + '%' : 'N/A'}\n` +
                  `  Transaction: ${tradeDetails.txSignature || 'N/A'}\n\n`;

  try {
    await fs.appendFile('trades.log', logEntry);
    console.log(`Trade logged: ${tradeDetails.action} ${tradeDetails.symbol}`);
  } catch (error) {
    console.error(`Failed to log trade: ${error.message}`);
  }
}

/**
 * Execute a buy order
 * @param {Object} token - Token data
 * @param {JupiterService} jupiterService - Jupiter service instance
 * @param {Connection} connection - Solana connection
 * @returns {Object|null} - Position data or null if buy failed
 */
async function executeBuy(token, jupiterService, connection) {
  try {
    console.log(`Attempting to buy ${token.symbol} (${token.tokenAddress})`);

    // Get pre-swap balance to compare later
    let preSwapBalance = 0;
    try {
      const balances = await jupiterService.getBalances();
      const tokenBalance = balances.tokens.find(t => t.mint === token.tokenAddress);
      preSwapBalance = tokenBalance ? parseFloat(tokenBalance.uiAmount) : 0;
      console.log(`Pre-swap balance of ${token.symbol}: ${preSwapBalance}`);
    } catch (error) {
      console.warn(`Failed to get pre-swap balance: ${error.message}`);
    }

    // Execute swap from SOL to token
    const txSignature = await jupiterService.executeSwap(
      SOL_MINT,
      token.tokenAddress,
      BUY_AMOUNT_LAMPORTS,
      { slippageBps: SLIPPAGE_BPS }
    );

    // Wait a moment for the transaction to be confirmed and balances to update
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Get actual token amount from updated balance
    let actualAmount;
    try {
      const balances = await jupiterService.getBalances();
      const tokenBalance = balances.tokens.find(t => t.mint === token.tokenAddress);
      const postSwapBalance = tokenBalance ? parseFloat(tokenBalance.uiAmount) : 0;
      actualAmount = postSwapBalance - preSwapBalance;
      console.log(`Post-swap balance of ${token.symbol}: ${postSwapBalance}`);
      console.log(`Actual amount received: ${actualAmount}`);

      if (actualAmount <= 0) {
        console.warn(`Suspicious amount received (${actualAmount}), falling back to estimate`);
        actualAmount = BUY_AMOUNT_LAMPORTS / token.priceUsd;
      }
    } catch (error) {
      console.warn(`Failed to get post-swap balance: ${error.message}`);
      // Fallback to approximate amount
      actualAmount = BUY_AMOUNT_LAMPORTS / token.priceUsd;
    }

    // Create position object
    const position = {
      tokenAddress: token.tokenAddress,
      symbol: token.symbol,
      entryPrice: token.priceUsd,
      entryTime: Date.now(),
      highestPrice: token.priceUsd,
      amount: actualAmount,
      poolAddress: token.poolAddress,
      txSignature
    };

    // Log the trade
    await logTrade({
      action: 'BUY',
      symbol: token.symbol,
      price: token.priceUsd,
      amount: position.amount,
      txSignature,
      reason: `Score: ${token.score.toFixed(2)}/100, RSI: ${token.indicators.hour?.rsi?.toFixed(2)}`
    });

    return position;
  } catch (error) {
    console.error(`Buy execution failed for ${token.symbol}: ${error.message}`);
    return null;
  }
}

/**
 * Execute a sell order
 * @param {Object} position - Position data
 * @param {Object} currentData - Current token data
 * @param {JupiterService} jupiterService - Jupiter service instance
 * @param {string} reason - Reason for selling
 * @returns {boolean} - Whether sell was successful
 */
async function executeSell(position, currentData, jupiterService, reason) {
  try {
    console.log(`Attempting to sell ${position.symbol} (${position.tokenAddress}): ${reason}`);

    // Execute swap from token to SOL
    const txSignature = await jupiterService.executeSwap(
      position.tokenAddress,
      SOL_MINT,
      position.amount, // Sell entire position
      { slippageBps: SLIPPAGE_BPS }
    );

    // Calculate profit/loss
    const profitLoss = ((currentData.priceUsd - position.entryPrice) / position.entryPrice) * 100;

    // Log the trade
    await logTrade({
      action: 'SELL',
      symbol: position.symbol,
      price: currentData.priceUsd,
      amount: position.amount,
      profitLoss,
      txSignature,
      reason
    });

    return true;
  } catch (error) {
    console.error(`Sell execution failed for ${position.symbol}: ${error.message}`);
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
 * @param {Connection} connection - Solana connection
 * @returns {Object|null} - Current token data or null if fetch failed
 */
async function getCurrentTokenData(tokenAddress, poolAddress, symbol, dexService, connection) {
  try {
    console.log(`Fetching current data for ${symbol} (${tokenAddress})...`);

    // Get pair data from DexScreener for current price and transaction data
    const pairData = await dexService.getPairData('solana', poolAddress);
    if (!pairData) {
      throw new Error('Failed to fetch pair data');
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
      ohlcvData = await fetchOHLCV('solana', poolAddress, symbol, 'hour', 1);

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
    }

    // Fetch fresh holder data
    const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // YYYY-MM-DD
    const toDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    let historicalHolders;
    try {
      historicalHolders = await getTokenHoldersHistorical(tokenAddress, fromDate, toDate);
      console.log(`Fetched historical holders for ${symbol}: ${historicalHolders?.result?.length || 0} data points`);
    } catch (error) {
      console.error(`Failed to fetch historical holders for ${symbol}: ${error.message}`);
      historicalHolders = { result: [] };
    }

    // Calculate holder change percentage
    const holderChange24h = historicalHolders?.result?.length > 1
      ? ((historicalHolders.result[historicalHolders.result.length - 1].totalHolders -
          historicalHolders.result[0].totalHolders) / (historicalHolders.result[0].totalHolders || 1) * 100) || 0
      : 0;

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
 * @param {JupiterService} jupiterService - Jupiter service instance
 * @param {DexScreenerService} dexService - DexScreener service instance
 * @param {Connection} connection - Solana connection
 */
async function monitorPositions(jupiterService, dexService, connection) {
  console.log(`Monitoring ${positions.size} open positions...`);

  // If no positions, clear the interval
  if (positions.size === 0 && monitoringInterval) {
    console.log('No positions to monitor. Stopping monitoring interval.');
    clearInterval(monitoringInterval);
    monitoringInterval = null;
    return;
  }

  for (const [tokenAddress, position] of positions.entries()) {
    try {
      // Get current token data with fresh indicators and holder data
      const currentData = await getCurrentTokenData(
        tokenAddress,
        position.poolAddress,
        position.symbol,
        dexService,
        connection
      );

      if (!currentData) {
        console.warn(`Failed to get current data for ${position.symbol}, skipping this check`);
        continue;
      }

      // Update position with current data
      const updatedPosition = updatePosition(position, currentData);
      positions.set(tokenAddress, updatedPosition);

      // Log current position status
      const currentPrice = currentData.priceUsd;
      const entryPrice = position.entryPrice;
      const profitPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
      console.log(`Position ${position.symbol}: Current price $${currentPrice.toFixed(8)}, ` +
                  `P/L: ${profitPercent.toFixed(2)}%, ` +
                  `Highest: $${position.highestPrice.toFixed(8)}, ` +
                  `RSI: ${currentData.indicators.hour?.rsi?.toFixed(2) || 'N/A'}, ` +
                  `Holder change: ${currentData.holderChange24h?.toFixed(2) || 'N/A'}%`);

      // Check sell criteria with updated indicators and holder data
      const sellDecision = meetsSellCriteria(updatedPosition, currentData);
      if (sellDecision.sell) {
        console.log(`Sell criteria met for ${position.symbol}: ${sellDecision.reason}`);
        const sellSuccess = await executeSell(updatedPosition, currentData, jupiterService, sellDecision.reason);
        if (sellSuccess) {
          positions.delete(tokenAddress);
          console.log(`Sold ${position.symbol}: ${sellDecision.reason}`);
        }
      }
    } catch (error) {
      console.error(`Error monitoring position for ${position.symbol}: ${error.message}`);
    }
  }
}

/**
 * Process tokens for potential trades
 * @param {Array} finalTokens - Tokens from TA.js
 * @param {JupiterService} jupiterService - Jupiter service instance
 * @param {DexScreenerService} dexService - DexScreener service instance
 * @param {Connection} connection - Solana connection
 */
async function processTokens(finalTokens, jupiterService, dexService, connection) {
  console.log(`Processing ${finalTokens.length} tokens for potential trades...`);

  // Skip if we already have a position (only allowing one at a time)
  if (positions.size >= MAX_POSITIONS) {
    console.log(`Already have a position. Only one position allowed at a time.`);
    return;
  }

  // Sort tokens by score (highest first)
  const sortedTokens = [...finalTokens].sort((a, b) => b.score - a.score);

  for (const token of sortedTokens) {
    // Skip if already in a position for this token
    if (positions.has(token.tokenAddress)) {
      continue;
    }

    // Check buy criteria
    if (meetsBuyCriteria(token)) {
      console.log(`Buy criteria met for ${token.symbol} (Score: ${token.score.toFixed(2)}/100)`);

      // Execute buy with connection for token balance checking
      const position = await executeBuy(token, jupiterService, connection);
      if (position) {
        // Add to positions
        positions.set(token.tokenAddress, position);

        console.log(`Bought ${token.symbol} at $${token.priceUsd}`);

        // Exit since we now have a position (only allowing one at a time)
        if (positions.size >= MAX_POSITIONS) {
          console.log(`Position acquired. Only one position allowed at a time.`);
          break;
        }
      }
    }
  }
}

/**
 * Main trading function to be integrated with TA.js
 * @param {Array} finalTokens - Tokens from TA.js
 */
async function executeTradingStrategy(finalTokens) {
  try {
    console.log('Initializing trading strategy...');

    // Initialize services
    const connection = initializeConnection();
    const wallet = initializeWallet();
    const walletInfo = await checkWalletBalance(wallet);

    // Check if wallet has sufficient balance
    if (!walletInfo.hasMinimumBalance) {
      console.error('Insufficient wallet balance for trading.');
      return;
    }

    // Initialize services
    const jupiterService = new JupiterService(connection, wallet);
    const dexService = new DexScreenerService();

    // Process tokens for potential trades
    await processTokens(finalTokens, jupiterService, dexService, connection);

    // Set up position monitoring only if we have positions
    if (positions.size > 0) {
      console.log(`Setting up position monitoring (every ${PRICE_CHECK_INTERVAL / 1000} seconds)...`);

      // Clear any existing interval
      if (monitoringInterval) {
        clearInterval(monitoringInterval);
      }

      // Set up new monitoring interval
      monitoringInterval = setInterval(
        () => monitorPositions(jupiterService, dexService, connection),
        PRICE_CHECK_INTERVAL
      );

      console.log('Position monitoring started.');
    } else {
      console.log('No positions to monitor. Skipping monitoring setup.');
    }

    console.log('Trading strategy initialized successfully.');
  } catch (error) {
    console.error(`Trading strategy initialization failed: ${error.message}`);
  }
}

module.exports = { executeTradingStrategy };
