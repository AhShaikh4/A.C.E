//trading.js

const fs = require('fs').promises;
const { PublicKey, Connection } = require('@solana/web3.js');
const { initializeConnection, initializeWallet, checkWalletBalance } = require('./wallet');
const JupiterService = require('./src/services/jupiter');
const { DexScreenerService } = require('./src/services/dexscreener');
const { getTokenHoldersHistorical } = require('./src/services/morali');

// Import functions from TA.js
const { fetchOHLCV, calculateIndicators } = require('./TA');

// Import config
const { BOT_CONFIG } = require('./config');

// Constants
const SOL_MINT = 'So11111111111111111111111111111111111111112'; // Native SOL mint address
const BUY_AMOUNT_SOL = BOT_CONFIG.BUY_AMOUNT_SOL; // Fixed buy amount in SOL
const BUY_AMOUNT_LAMPORTS = BUY_AMOUNT_SOL * 1000000000; // Convert SOL to lamports
const MAX_POSITIONS = BOT_CONFIG.MAX_POSITIONS || 1; // Maximum number of concurrent positions
const PRICE_CHECK_INTERVAL = 30000; // 30 seconds
const SLIPPAGE_BPS = BOT_CONFIG.SLIPPAGE_BPS || 500; // Slippage tolerance
// const MINIMUM_SOL_RESERVE = 0.001; // Minimum SOL to keep in wallet for transaction fees (not used)

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
  const { BUY_CRITERIA } = BOT_CONFIG;

  // Debug logging for individual criteria
  console.log(`Evaluating buy criteria for ${token.symbol}:`);
  console.log(`- Score: ${token.score} (needs > ${BUY_CRITERIA.MIN_SCORE}): ${token.score > BUY_CRITERIA.MIN_SCORE}`);
  console.log(`- Price Change 5m: ${token.priceChange.m5}% (needs > ${BUY_CRITERIA.MIN_PRICE_CHANGE_5M}): ${token.priceChange.m5 > BUY_CRITERIA.MIN_PRICE_CHANGE_5M}`);
  console.log(`- Price Change 1h: ${token.priceChange.h1}% (needs > ${BUY_CRITERIA.MIN_PRICE_CHANGE_1H}): ${token.priceChange.h1 > BUY_CRITERIA.MIN_PRICE_CHANGE_1H}`);
  console.log(`- MACD: ${indicators.macd?.MACD}, Signal: ${indicators.macd?.signal}, Histogram: ${indicators.macd?.histogram}`);
  console.log(`- MACD Bullish: ${indicators.macd?.MACD > indicators.macd?.signal && indicators.macd?.histogram > 0}`);
  console.log(`- RSI: ${indicators.rsi} (needs < ${BUY_CRITERIA.MAX_RSI}): ${indicators.rsi < BUY_CRITERIA.MAX_RSI}`);
  console.log(`- Price vs Bollinger Upper: ${token.priceUsd} vs ${indicators.bollinger?.upper}: ${token.priceUsd > indicators.bollinger?.upper}`);
  console.log(`- Tenkan-sen vs Kijun-sen: ${indicators.ichimoku?.tenkanSen} vs ${indicators.ichimoku?.kijunSen}: ${indicators.ichimoku?.tenkanSen > indicators.ichimoku?.kijunSen}`);
  console.log(`- Buy/Sell Ratio 5m: ${token.txns?.m5?.buys}/${token.txns?.m5?.sells} = ${token.txns?.m5?.buys / (token.txns?.m5?.sells || 1)} (needs > ${BUY_CRITERIA.MIN_BUY_SELL_RATIO_5M}): ${token.txns?.m5?.buys / (token.txns?.m5?.sells || 1) > BUY_CRITERIA.MIN_BUY_SELL_RATIO_5M}`);
  console.log(`- Holder Change 24h: ${token.holderChange24h} (needs >= ${BUY_CRITERIA.MIN_HOLDER_CHANGE_24H}): ${token.holderChange24h === undefined || token.holderChange24h >= BUY_CRITERIA.MIN_HOLDER_CHANGE_24H}`);

  // If scoring is disabled, use traditional AND-based criteria
  if (!BUY_CRITERIA.SCORING_ENABLED) {
    const result = (
      token.score > BUY_CRITERIA.MIN_SCORE && // Score above minimum
      token.priceChange.m5 > BUY_CRITERIA.MIN_PRICE_CHANGE_5M && token.priceChange.h1 > BUY_CRITERIA.MIN_PRICE_CHANGE_1H && // Recent positive momentum
      indicators.macd?.MACD > indicators.macd?.signal && indicators.macd?.histogram > 0 && // MACD bullish
      indicators.rsi < BUY_CRITERIA.MAX_RSI && // RSI not overbought
      (token.priceUsd > indicators.bollinger?.upper || // Price above upper Bollinger Band
       indicators.ichimoku?.tenkanSen > indicators.ichimoku?.kijunSen) && // Tenkan-sen above Kijun-sen
      token.txns?.m5?.buys / (token.txns?.m5?.sells || 1) > BUY_CRITERIA.MIN_BUY_SELL_RATIO_5M && // Recent buy pressure
      (token.holderChange24h === undefined || token.holderChange24h >= BUY_CRITERIA.MIN_HOLDER_CHANGE_24H) // Positive holder growth or missing data
    );

    console.log(`Buy criteria met (traditional): ${result}`);
    return result;
  }

  // Scoring-based system
  const weights = BUY_CRITERIA.SCORE_WEIGHTS;
  const bonus = BUY_CRITERIA.BONUS;
  let totalScore = 0;
  let scoreDetails = {};

  // 1. Token Score (0-20 points)
  const tokenScorePoints = token.score > BUY_CRITERIA.MIN_SCORE ?
    weights.TOKEN_SCORE : (token.score / BUY_CRITERIA.MIN_SCORE) * weights.TOKEN_SCORE;
  scoreDetails.tokenScore = Math.round(tokenScorePoints * 10) / 10;
  totalScore += tokenScorePoints;

  // 2. Price Momentum (0-15 points)
  let momentumPoints = 0;
  // 5m price change (0-7.5 points)
  if (token.priceChange.m5 > BUY_CRITERIA.MIN_PRICE_CHANGE_5M) {
    momentumPoints += weights.PRICE_MOMENTUM / 2;
    // Bonus for strong 5m momentum
    if (token.priceChange.m5 > bonus.STRONG_MOMENTUM_5M) {
      momentumPoints += bonus.BONUS_POINTS;
    }
  } else if (token.priceChange.m5 > 0) {
    // Partial points for positive but below threshold
    momentumPoints += (token.priceChange.m5 / BUY_CRITERIA.MIN_PRICE_CHANGE_5M) * (weights.PRICE_MOMENTUM / 2);
  }

  // 1h price change (0-7.5 points)
  if (token.priceChange.h1 > BUY_CRITERIA.MIN_PRICE_CHANGE_1H) {
    momentumPoints += weights.PRICE_MOMENTUM / 2;
  } else if (token.priceChange.h1 > -2) { // Allow slightly negative 1h if not too bad
    // Scale from -2% to 0%: -2% = 0 points, 0% = half points
    momentumPoints += ((token.priceChange.h1 + 2) / 2) * (weights.PRICE_MOMENTUM / 4);
  }

  scoreDetails.momentum = Math.round(momentumPoints * 10) / 10;
  totalScore += momentumPoints;

  // 3. MACD (0-15 points)
  let macdPoints = 0;
  if (indicators.macd?.MACD > indicators.macd?.signal && indicators.macd?.histogram > 0) {
    macdPoints = weights.MACD;
    // Bonus for strong histogram
    if (indicators.macd?.histogram > 0.00001) { // Adjust threshold as needed
      macdPoints += bonus.BONUS_POINTS / 2;
    }
  } else if (indicators.macd?.histogram > 0) {
    // Partial points for positive histogram even if MACD < signal
    macdPoints = weights.MACD / 2;
  } else if (indicators.macd?.MACD > indicators.macd?.signal) {
    // Partial points for MACD > signal even if histogram negative
    macdPoints = weights.MACD / 3;
  }
  scoreDetails.macd = Math.round(macdPoints * 10) / 10;
  totalScore += macdPoints;

  // 4. RSI (0-10 points)
  let rsiPoints = 0;
  if (indicators.rsi < BUY_CRITERIA.MAX_RSI) {
    // More points for RSI in the sweet spot (40-60)
    if (indicators.rsi >= 40 && indicators.rsi <= 60) {
      rsiPoints = weights.RSI;
    } else {
      rsiPoints = weights.RSI * 0.8; // 80% of points for non-optimal RSI
    }
  } else if (indicators.rsi < BUY_CRITERIA.MAX_RSI + 10) {
    // Partial points for slightly overbought
    rsiPoints = weights.RSI * (1 - ((indicators.rsi - BUY_CRITERIA.MAX_RSI) / 10));
  }
  scoreDetails.rsi = Math.round(rsiPoints * 10) / 10;
  totalScore += rsiPoints;

  // 5. Price Breakout (0-15 points)
  let breakoutPoints = 0;
  const priceAboveBB = token.priceUsd > indicators.bollinger?.upper;
  const ichimokuBullish = indicators.ichimoku?.tenkanSen > indicators.ichimoku?.kijunSen;

  if (priceAboveBB && ichimokuBullish) {
    // Both signals are bullish
    breakoutPoints = weights.PRICE_BREAKOUT + (bonus.BONUS_POINTS / 2);
  } else if (priceAboveBB) {
    breakoutPoints = weights.PRICE_BREAKOUT * 0.8; // 80% for BB breakout
  } else if (ichimokuBullish) {
    breakoutPoints = weights.PRICE_BREAKOUT * 0.7; // 70% for Ichimoku signal
  } else if (token.priceUsd > indicators.bollinger?.middle) {
    // Partial points for price above middle BB
    breakoutPoints = weights.PRICE_BREAKOUT * 0.4;
  }
  scoreDetails.breakout = Math.round(breakoutPoints * 10) / 10;
  totalScore += breakoutPoints;

  // 6. Buy/Sell Ratio (0-15 points)
  let buySellPoints = 0;
  const buySellRatio = token.txns?.m5?.buys / (token.txns?.m5?.sells || 1);

  if (buySellRatio > BUY_CRITERIA.MIN_BUY_SELL_RATIO_5M) {
    buySellPoints = weights.BUY_SELL_RATIO;
    // Bonus for exceptionally high buy/sell ratio
    if (buySellRatio > bonus.HIGH_BUY_SELL_RATIO) {
      buySellPoints += bonus.BONUS_POINTS;
    }
  } else if (buySellRatio > 1.0) {
    // Partial points for positive but below threshold
    buySellPoints = (buySellRatio - 1) / (BUY_CRITERIA.MIN_BUY_SELL_RATIO_5M - 1) * weights.BUY_SELL_RATIO;
  }
  scoreDetails.buySellRatio = Math.round(buySellPoints * 10) / 10;
  totalScore += buySellPoints;

  // 7. Holder Growth (0-10 points)
  let holderPoints = 0;
  if (token.holderChange24h === undefined) {
    // If holder data is missing, award partial points
    holderPoints = weights.HOLDER_GROWTH * 0.5;
  } else if (token.holderChange24h >= BUY_CRITERIA.MIN_HOLDER_CHANGE_24H) {
    holderPoints = weights.HOLDER_GROWTH;
    // Bonus for strong holder growth
    if (token.holderChange24h > 5) { // 5% growth
      holderPoints += bonus.BONUS_POINTS / 2;
    }
  } else if (token.holderChange24h > -2) {
    // Partial points for slightly negative holder change
    holderPoints = (token.holderChange24h + 2) / 2 * weights.HOLDER_GROWTH * 0.5;
  }
  scoreDetails.holderGrowth = Math.round(holderPoints * 10) / 10;
  totalScore += holderPoints;

  // Round total score to one decimal place
  totalScore = Math.round(totalScore * 10) / 10;

  // Log detailed scoring breakdown
  console.log('Scoring breakdown:');
  console.log(`- Token Score: ${scoreDetails.tokenScore}/${weights.TOKEN_SCORE}`);
  console.log(`- Price Momentum: ${scoreDetails.momentum}/${weights.PRICE_MOMENTUM}`);
  console.log(`- MACD: ${scoreDetails.macd}/${weights.MACD}`);
  console.log(`- RSI: ${scoreDetails.rsi}/${weights.RSI}`);
  console.log(`- Price Breakout: ${scoreDetails.breakout}/${weights.PRICE_BREAKOUT}`);
  console.log(`- Buy/Sell Ratio: ${scoreDetails.buySellRatio}/${weights.BUY_SELL_RATIO}`);
  console.log(`- Holder Growth: ${scoreDetails.holderGrowth}/${weights.HOLDER_GROWTH}`);
  console.log(`Total Score: ${totalScore}/100 (Threshold: ${BUY_CRITERIA.MIN_TOTAL_SCORE})`);

  const result = totalScore >= BUY_CRITERIA.MIN_TOTAL_SCORE;
  console.log(`Buy criteria met (scoring): ${result}`);
  return result;
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

    // Try to get balance directly from wallet first (most reliable)
    try {
      const tokenAccount = await connection.getParsedTokenAccountsByOwner(
        jupiterService.wallet.publicKey,
        { mint: new PublicKey(token.tokenAddress) }
      );

      if (tokenAccount.value.length > 0) {
        const balance = tokenAccount.value[0].account.data.parsed.info.tokenAmount;
        preSwapBalance = parseFloat(balance.uiAmount);
        console.log(`Pre-swap direct wallet balance of ${token.symbol}: ${preSwapBalance}`);
      } else {
        console.log(`No token account found for ${token.symbol}, assuming zero balance`);
        preSwapBalance = 0;
      }
    } catch (walletError) {
      console.warn(`Failed to get direct wallet balance: ${walletError.message}`);

      // Fallback to Jupiter API
      try {
        const balances = await jupiterService.getBalances();
        if (balances && balances.tokens && Array.isArray(balances.tokens)) {
          const tokenBalance = balances.tokens.find(t => t.mint === token.tokenAddress);
          preSwapBalance = tokenBalance ? parseFloat(tokenBalance.uiAmount) : 0;
          console.log(`Pre-swap Jupiter API balance of ${token.symbol}: ${preSwapBalance}`);
        } else {
          console.warn(`Jupiter API returned unexpected data structure: ${JSON.stringify(balances)}`);
          preSwapBalance = 0;
        }
      } catch (jupiterError) {
        console.warn(`Failed to get Jupiter API balance: ${jupiterError.message}`);
        preSwapBalance = 0;
      }
    }

    /* Dynamic buy amount adjustment (commented out as requested)
    // Check wallet SOL balance and adjust buy amount if needed
    let buyAmountSOL = BUY_AMOUNT_SOL;
    let buyAmountLamports;

    try {
      // Get current SOL balance
      const solBalance = await connection.getBalance(jupiterService.wallet.publicKey);
      const solBalanceSOL = solBalance / 1000000000; // Convert lamports to SOL
      console.log(`Current wallet SOL balance: ${solBalanceSOL} SOL`);

      // Calculate available SOL (keeping reserve for fees)
      const availableSOL = solBalanceSOL - MINIMUM_SOL_RESERVE;

      if (availableSOL <= 0) {
        throw new Error(`Insufficient SOL balance for trading. Current: ${solBalanceSOL} SOL, Minimum required: ${MINIMUM_SOL_RESERVE} SOL`);
      }

      // Adjust buy amount if wallet has less than configured amount
      if (availableSOL < BUY_AMOUNT_SOL) {
        buyAmountSOL = availableSOL * 0.95; // Use 95% of available SOL to leave room for fees
        console.log(`Adjusting buy amount to ${buyAmountSOL} SOL based on available balance`);
      }

      // Convert to lamports
      buyAmountLamports = Math.floor(buyAmountSOL * 1000000000);

      if (buyAmountLamports < 1000000) { // Minimum 0.001 SOL
        throw new Error(`Buy amount too small: ${buyAmountSOL} SOL. Minimum required: 0.001 SOL`);
      }

      console.log(`Executing swap with ${buyAmountSOL} SOL (${buyAmountLamports} lamports)`);
    } catch (error) {
      console.error(`Failed to check wallet balance: ${error.message}`);
      return null;
    }
    */

    // Check wallet balance and adjust buy amount if needed
    let buyAmountSOL = BUY_AMOUNT_SOL;
    let buyAmountLamports = BUY_AMOUNT_LAMPORTS;

    try {
      // Get current SOL balance
      const solBalance = await connection.getBalance(jupiterService.wallet.publicKey);
      const solBalanceSOL = solBalance / 1000000000; // Convert lamports to SOL
      console.log(`Current wallet SOL balance: ${solBalanceSOL} SOL`);

      // Reserve some SOL for transaction fees
      const MINIMUM_SOL_RESERVE = 0.0005; // 0.0005 SOL for fees
      const availableSOL = solBalanceSOL - MINIMUM_SOL_RESERVE;

      if (availableSOL <= 0) {
        throw new Error(`Insufficient SOL balance for trading. Current: ${solBalanceSOL} SOL`);
      }

      // If wallet has less than configured amount, use what's available
      if (availableSOL < BUY_AMOUNT_SOL) {
        buyAmountSOL = availableSOL * 0.95; // Use 95% of available SOL
        buyAmountLamports = Math.floor(buyAmountSOL * 1000000000);
        console.log(`Wallet has less than configured amount. Using ${buyAmountSOL} SOL (${buyAmountLamports} lamports) instead`);
      } else {
        console.log(`Executing swap with configured amount: ${BUY_AMOUNT_SOL} SOL (${BUY_AMOUNT_LAMPORTS} lamports)`);
      }

      if (buyAmountLamports < 500000) { // Minimum 0.0005 SOL
        throw new Error(`Buy amount too small: ${buyAmountSOL} SOL. Minimum required: 0.0005 SOL`);
      }
    } catch (error) {
      console.error(`Failed to check wallet balance: ${error.message}`);
      return null;
    }

    // Execute swap from SOL to token with higher priority fee
    const txSignature = await jupiterService.executeSwap(
      SOL_MINT,
      token.tokenAddress,
      buyAmountLamports,
      {
        slippageBps: SLIPPAGE_BPS,
        priorityFee: { priorityLevelWithMaxLamports: { maxLamports: 5000000, priorityLevel: 'high' } },
        timeout: 60000 // Increase timeout to 60 seconds
      }
    );

    // Wait a moment for the transaction to be confirmed and balances to update
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Get actual token amount from updated balance
    let actualAmount;
    try {
      // Try to get balance from Jupiter API first
      const balances = await jupiterService.getBalances();
      const tokenBalance = balances.tokens.find(t => t.mint === token.tokenAddress);
      const postSwapBalance = tokenBalance ? parseFloat(tokenBalance.uiAmount) : 0;
      actualAmount = postSwapBalance - preSwapBalance;
      console.log(`Post-swap balance of ${token.symbol} from Jupiter API: ${postSwapBalance}`);
      console.log(`Calculated amount received: ${actualAmount}`);

      // If Jupiter API gives suspicious results, try direct wallet balance check
      if (actualAmount <= 0 || actualAmount > 1000000000) {
        console.warn(`Suspicious amount received (${actualAmount}), checking direct wallet balance`);

        // Get token balance directly from the wallet
        const tokenAccount = await connection.getParsedTokenAccountsByOwner(
          jupiterService.wallet.publicKey,
          { mint: new PublicKey(token.tokenAddress) }
        );

        if (tokenAccount.value.length > 0) {
          const balance = tokenAccount.value[0].account.data.parsed.info.tokenAmount;
          const directBalance = parseFloat(balance.uiAmount);
          console.log(`Direct wallet balance of ${token.symbol}: ${directBalance}`);

          // Use direct balance as the actual amount
          actualAmount = directBalance;
        } else {
          console.warn(`No token account found for ${token.symbol}, falling back to estimate`);
          // Use a more conservative estimate
          actualAmount = (buyAmountLamports * 0.95) / (token.priceUsd * 1.05); // Account for slippage and fees
        }
      }
    } catch (error) {
      console.warn(`Failed to get post-swap balance: ${error.message}`);

      try {
        // Try direct wallet balance check as fallback
        const tokenAccount = await connection.getParsedTokenAccountsByOwner(
          jupiterService.wallet.publicKey,
          { mint: new PublicKey(token.tokenAddress) }
        );

        if (tokenAccount.value.length > 0) {
          const balance = tokenAccount.value[0].account.data.parsed.info.tokenAmount;
          const directBalance = parseFloat(balance.uiAmount);
          console.log(`Direct wallet balance of ${token.symbol}: ${directBalance}`);
          actualAmount = directBalance;
        } else {
          // Last resort fallback
          actualAmount = (buyAmountLamports * 0.95) / (token.priceUsd * 1.05); // Account for slippage and fees
        }
      } catch (secondError) {
        console.warn(`Failed to get direct wallet balance: ${secondError.message}`);
        // Last resort fallback
        actualAmount = (buyAmountLamports * 0.95) / (token.priceUsd * 1.05); // Account for slippage and fees
      }
    }

    // Sanity check on the amount
    if (actualAmount > 1000000000) {
      console.warn(`Amount suspiciously large (${actualAmount}), capping to reasonable value`);
      // Cap to a reasonable value based on the transaction amount
      actualAmount = (buyAmountLamports * 0.95) / (token.priceUsd * 1.05);
    }

    console.log(`Final amount used for position: ${actualAmount}`);

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

    // Get current token balance to ensure we're selling what we actually have
    let tokenAmount = null;

    // Try to get the actual token balance directly from the wallet first (most reliable)
    try {
      const connection = jupiterService.connection;
      const tokenAccount = await connection.getParsedTokenAccountsByOwner(
        jupiterService.wallet.publicKey,
        { mint: new PublicKey(position.tokenAddress) }
      );

      if (tokenAccount.value.length > 0) {
        const balance = tokenAccount.value[0].account.data.parsed.info.tokenAmount;
        tokenAmount = parseFloat(balance.uiAmount);
        console.log(`Direct wallet balance of ${position.symbol}: ${tokenAmount}`);
      }
    } catch (walletError) {
      console.warn(`Failed to get direct wallet balance: ${walletError.message}`);
    }

    // If direct wallet check failed, try Jupiter API
    if (tokenAmount === null) {
      try {
        const balances = await jupiterService.getBalances();
        const tokenBalance = balances.tokens.find(t => t.mint === position.tokenAddress);
        if (tokenBalance && tokenBalance.uiAmount > 0) {
          tokenAmount = tokenBalance.uiAmount;
          console.log(`Using Jupiter API balance: ${tokenAmount} ${position.symbol}`);
        }
      } catch (jupiterError) {
        console.warn(`Failed to get Jupiter API balance: ${jupiterError.message}`);
      }
    }

    // Last resort: use position amount (but with sanity check)
    if (tokenAmount === null) {
      if (position.amount > 0 && position.amount < 1000000000) {
        tokenAmount = position.amount;
        console.log(`Using position amount as last resort: ${tokenAmount} ${position.symbol}`);
      } else {
        throw new Error(`No valid token amount available for selling`);
      }
    }

    // Sanity check - cap extremely large amounts
    if (tokenAmount > 1000000000) {
      console.warn(`Token amount suspiciously large (${tokenAmount}), capping to 1,000,000`);
      tokenAmount = 1000000; // Cap to a reasonable value
    }

    // Ensure the amount is a valid number
    if (isNaN(tokenAmount) || tokenAmount <= 0) {
      throw new Error(`Invalid token amount: ${tokenAmount}`);
    }

    // Execute swap from token to SOL with detailed error handling
    console.log(`Executing swap: ${tokenAmount} ${position.symbol} to SOL with ${SLIPPAGE_BPS/100}% slippage`);

    try {
      // Get quote first to validate the swap
      const quote = await jupiterService.getSwapQuote(
        position.tokenAddress,
        SOL_MINT,
        tokenAmount,
        { slippageBps: SLIPPAGE_BPS }
      );

      console.log(`Quote received: ${quote.outAmount} lamports (≈${quote.outAmount/1e9} SOL)`);

      // Check if the quote is valid
      if (!quote || !quote.outAmount) {
        throw new Error(`Invalid quote received: ${JSON.stringify(quote)}`);
      }

      // If the amount is very small, increase slippage to ensure the transaction goes through
      let adjustedSlippage = SLIPPAGE_BPS;
      if (tokenAmount < 10) {
        adjustedSlippage = 1000; // 10% slippage for very small amounts
        console.log(`Small token amount detected, increasing slippage to 10% to ensure transaction success`);
      }

      // Execute the swap with higher priority fee for sell transactions
      const txSignature = await jupiterService.executeSwap(
        position.tokenAddress,
        SOL_MINT,
        tokenAmount,
        {
          slippageBps: adjustedSlippage,
          priorityFee: { priorityLevelWithMaxLamports: { maxLamports: 10000000, priorityLevel: 'high' } }
        }
      );

      console.log(`Sell transaction confirmed: ${txSignature}`);

      // Log the trade with transaction signature
      await logTrade({
        action: 'SELL',
        symbol: position.symbol,
        price: currentData.priceUsd,
        amount: tokenAmount,
        profitLoss: ((currentData.priceUsd - position.entryPrice) / position.entryPrice) * 100,
        txSignature,
        reason
      });
    } catch (swapError) {
      // Try with a smaller amount if the full amount fails
      if (tokenAmount > 1) {
        const reducedAmount = tokenAmount * 0.95; // Try with 95% of the tokens
        console.log(`First attempt failed, trying with reduced amount: ${reducedAmount} ${position.symbol}`);

        try {
          // Get quote with higher slippage
          const retryQuote = await jupiterService.getSwapQuote(
            position.tokenAddress,
            SOL_MINT,
            reducedAmount,
            { slippageBps: 1000 } // Higher slippage for second attempt
          );

          if (!retryQuote || !retryQuote.outAmount) {
            throw new Error(`Invalid quote received for retry: ${JSON.stringify(retryQuote)}`);
          }

          console.log(`Retry quote received: ${retryQuote.outAmount} lamports (≈${retryQuote.outAmount/1e9} SOL)`);

          const retryTxSignature = await jupiterService.executeSwap(
            position.tokenAddress,
            SOL_MINT,
            reducedAmount,
            {
              slippageBps: 1000,
              priorityFee: { priorityLevelWithMaxLamports: { maxLamports: 15000000, priorityLevel: 'high' } }
            }
          );

          console.log(`Sell transaction with reduced amount confirmed: ${retryTxSignature}`);

          // Log the trade with transaction signature
          await logTrade({
            action: 'SELL',
            symbol: position.symbol,
            price: currentData.priceUsd,
            amount: reducedAmount,
            profitLoss: ((currentData.priceUsd - position.entryPrice) / position.entryPrice) * 100,
            txSignature: retryTxSignature,
            reason: reason + ' (reduced amount)'
          });
        } catch (retryError) {
          throw new Error(`Failed to sell with reduced amount: ${retryError.message}. Original error: ${swapError.message}`);
        }
      } else {
        throw swapError;
      }
    }

    // Success! Return true
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
/**
 * Execute trading strategy with provided tokens
 * @param {Array} finalTokens - Tokens from TA.js
 * @param {Object} services - Optional pre-initialized services
 * @returns {Object} - Status of trading operations
 */
async function executeTradingStrategy(finalTokens, services = {}) {
  try {
    console.log('Initializing trading strategy...');

    // Use provided services or initialize new ones
    const connection = services.connection || initializeConnection();
    const wallet = services.wallet || initializeWallet();
    const walletInfo = services.walletInfo || await checkWalletBalance(wallet);
    const dexService = services.dexService || new DexScreenerService();

    // Check if wallet has sufficient balance
    if (!walletInfo.hasMinimumBalance) {
      console.error('Insufficient wallet balance for trading.');
      return { success: false, reason: 'insufficient_balance' };
    }

    // Initialize Jupiter service
    const jupiterService = new JupiterService(connection, wallet);

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
    return {
      success: true,
      positionsOpened: positions.size,
      positions: Array.from(positions.entries()).map(([address, pos]) => ({
        symbol: pos.symbol,
        entryPrice: pos.entryPrice,
        amount: pos.amount,
        entryTime: new Date(pos.entryTime).toISOString()
      }))
    };
  } catch (error) {
    console.error(`Trading strategy initialization failed: ${error.message}`);
    return { success: false, reason: 'initialization_failed', error: error.message };
  }
}

/**
 * Stop all trading activities and clean up resources
 */
async function stopTrading() {
  try {
    console.log('Stopping trading activities...');

    // Clear monitoring interval
    if (monitoringInterval) {
      clearInterval(monitoringInterval);
      monitoringInterval = null;
      console.log('Position monitoring stopped.');
    }

    // Log current positions for reference
    if (positions.size > 0) {
      console.log(`WARNING: ${positions.size} positions are still open:`);
      for (const [address, position] of positions.entries()) {
        console.log(`- ${position.symbol}: ${position.amount} tokens at $${position.entryPrice}`);
      }
      console.log('These positions will need to be managed manually or when the bot restarts.');
    } else {
      console.log('No open positions to manage.');
    }

    return { success: true, message: 'Trading stopped successfully' };
  } catch (error) {
    console.error(`Error stopping trading: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Get current positions
 * @returns {Array} - Current positions
 */
function getCurrentPositions() {
  return Array.from(positions.entries()).map(([address, pos]) => ({
    tokenAddress: address,
    symbol: pos.symbol,
    entryPrice: pos.entryPrice,
    currentPrice: pos.currentPrice || pos.entryPrice,
    amount: pos.amount,
    entryTime: new Date(pos.entryTime).toISOString(),
    profitLoss: pos.currentPrice ? ((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100 : 0
  }));
}

/**
 * Check if there are any open positions
 * @returns {boolean} - Whether there are open positions
 */
function hasOpenPositions() {
  return positions.size > 0;
}

module.exports = {
  executeTradingStrategy,
  stopTrading,
  getCurrentPositions,
  hasOpenPositions,
  // Export these for testing/simulation
  meetsBuyCriteria,
  meetsSellCriteria
};
