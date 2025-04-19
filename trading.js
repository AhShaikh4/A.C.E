//trading.js

const fs = require('fs').promises;
const { PublicKey, Connection } = require('@solana/web3.js');
const { initializeConnection, initializeWallet, checkWalletBalance } = require('./wallet');
const JupiterService = require('./src/services/jupiter');
const { DexScreenerService } = require('./src/services/dexscreener');
const { getTokenHoldersHistorical } = require('./src/services/morali');

// Import functions from TA.js
const { fetchOHLCV, calculateIndicators } = require('./TA');

// Import blacklist functionality
const { isBlacklisted } = require('./blacklist');

// Import config
const { BOT_CONFIG } = require('./config');

// Import logger
const logger = require('./logger');

// Constants
const SOL_MINT = 'So11111111111111111111111111111111111111112'; // Native SOL mint address
const BUY_AMOUNT_SOL = BOT_CONFIG.BUY_AMOUNT_SOL; // Fixed buy amount in SOL
const BUY_AMOUNT_LAMPORTS = BUY_AMOUNT_SOL * 1000000000; // Convert SOL to lamports
const MAX_POSITIONS = BOT_CONFIG.MAX_POSITIONS || 1; // Maximum number of concurrent positions
const PRICE_CHECK_INTERVAL = 7000; // 30 seconds
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
  logger.debug(`Evaluating buy criteria for ${token.symbol}:`);
  logger.debug(`- Score: ${token.score} (needs > ${BUY_CRITERIA.MIN_SCORE}): ${token.score > BUY_CRITERIA.MIN_SCORE}`);
  logger.debug(`- Price Change 5m: ${token.priceChange.m5}% (needs > ${BUY_CRITERIA.MIN_PRICE_CHANGE_5M}): ${token.priceChange.m5 > BUY_CRITERIA.MIN_PRICE_CHANGE_5M}`);
  logger.debug(`- Price Change 1h: ${token.priceChange.h1}% (needs > ${BUY_CRITERIA.MIN_PRICE_CHANGE_1H}): ${token.priceChange.h1 > BUY_CRITERIA.MIN_PRICE_CHANGE_1H}`);
  logger.debug(`- MACD: ${indicators.macd?.MACD}, Signal: ${indicators.macd?.signal}, Histogram: ${indicators.macd?.histogram}`);
  logger.debug(`- MACD Bullish: ${indicators.macd?.MACD > indicators.macd?.signal && indicators.macd?.histogram > 0}`);
  logger.debug(`- RSI: ${indicators.rsi} (needs < ${BUY_CRITERIA.MAX_RSI}): ${indicators.rsi < BUY_CRITERIA.MAX_RSI}`);
  logger.debug(`- Price vs Bollinger Upper: ${token.priceUsd} vs ${indicators.bollinger?.upper}: ${token.priceUsd > indicators.bollinger?.upper}`);
  logger.debug(`- Tenkan-sen vs Kijun-sen: ${indicators.ichimoku?.tenkanSen} vs ${indicators.ichimoku?.kijunSen}: ${indicators.ichimoku?.tenkanSen > indicators.ichimoku?.kijunSen}`);
  logger.debug(`- Buy/Sell Ratio 5m: ${token.txns?.m5?.buys}/${token.txns?.m5?.sells} = ${token.txns?.m5?.buys / (token.txns?.m5?.sells || 1)} (needs > ${BUY_CRITERIA.MIN_BUY_SELL_RATIO_5M}): ${token.txns?.m5?.buys / (token.txns?.m5?.sells || 1) > BUY_CRITERIA.MIN_BUY_SELL_RATIO_5M}`);
  logger.debug(`- Holder Change 24h: ${token.holderChange24h} (needs >= ${BUY_CRITERIA.MIN_HOLDER_CHANGE_24H}): ${token.holderChange24h === undefined || token.holderChange24h >= BUY_CRITERIA.MIN_HOLDER_CHANGE_24H}`);

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

    logger.debug(`Buy criteria met (traditional): ${result}`);
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
  logger.debug('Scoring breakdown:');
  logger.debug(`- Token Score: ${scoreDetails.tokenScore}/${weights.TOKEN_SCORE}`);
  logger.debug(`- Price Momentum: ${scoreDetails.momentum}/${weights.PRICE_MOMENTUM}`);
  logger.debug(`- MACD: ${scoreDetails.macd}/${weights.MACD}`);
  logger.debug(`- RSI: ${scoreDetails.rsi}/${weights.RSI}`);
  logger.debug(`- Price Breakout: ${scoreDetails.breakout}/${weights.PRICE_BREAKOUT}`);
  logger.debug(`- Buy/Sell Ratio: ${scoreDetails.buySellRatio}/${weights.BUY_SELL_RATIO}`);
  logger.debug(`- Holder Growth: ${scoreDetails.holderGrowth}/${weights.HOLDER_GROWTH}`);
  logger.debug(`Total Score: ${totalScore}/100 (Threshold: ${BUY_CRITERIA.MIN_TOTAL_SCORE})`);

  const result = totalScore >= BUY_CRITERIA.MIN_TOTAL_SCORE;
  logger.debug(`Buy criteria met (scoring): ${result}`);
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
  const profitPercent = ((currentPrice - entryPrice) / entryPrice) * 100; // Convert to percentage
  const highestPrice = position.highestPrice;
  const { SELL_CRITERIA } = BOT_CONFIG;

  // Enhanced trailing stop calculation
  // 1. Dynamic ATR Multiplier based on profit level
  let atrMultiplier = SELL_CRITERIA.TRAILING_STOP?.ATR_MULTIPLIER || 2.5; // Default if not configured

  // Find the appropriate multiplier based on profit level
  if (SELL_CRITERIA.TRAILING_STOP?.DYNAMIC_ATR_MULTIPLIERS) {
    // Sort multipliers by profit percent (highest first)
    const sortedMultipliers = [...SELL_CRITERIA.TRAILING_STOP.DYNAMIC_ATR_MULTIPLIERS]
      .sort((a, b) => b.PROFIT_PERCENT - a.PROFIT_PERCENT);

    // Find the first multiplier where profit is >= the threshold
    for (const level of sortedMultipliers) {
      if (profitPercent >= level.PROFIT_PERCENT) {
        atrMultiplier = level.MULTIPLIER;
        break;
      }
    }
  }

  // 2. Calculate ATR-based trailing stop
  const atrTrailingStop = highestPrice - (atrMultiplier * (indicators.atr || 0));

  // 3. Calculate percentage-based trailing stop
  const trailingStopPercent = SELL_CRITERIA.TRAILING_STOP?.PERCENT || 3.0;
  const percentTrailingStop = highestPrice * (1 - (trailingStopPercent / 100));

  // 4. Use the maximum of the two stops if configured, otherwise use ATR-based
  let trailingStopPrice;
  if (SELL_CRITERIA.TRAILING_STOP?.USE_MAX_STOP) {
    trailingStopPrice = Math.max(atrTrailingStop, percentTrailingStop);
    // Log which stop is being used
    if (atrTrailingStop > percentTrailingStop) {
      logger.debug(`Using ATR-based trailing stop: ${atrTrailingStop.toFixed(8)} (ATR multiplier: ${atrMultiplier})`);
    } else {
      logger.debug(`Using percentage-based trailing stop: ${percentTrailingStop.toFixed(8)} (${trailingStopPercent}% below highest price)`);
    }
  } else {
    trailingStopPrice = atrTrailingStop;
    logger.debug(`Using ATR-based trailing stop: ${atrTrailingStop.toFixed(8)} (ATR multiplier: ${atrMultiplier})`);
  }

  // Initialize tiered profit taking if not already set
  if (!position.tiers) {
    position.tiers = [];
    if (SELL_CRITERIA.TIERED_PROFIT_TAKING && SELL_CRITERIA.TIERED_PROFIT_TAKING.ENABLED) {
      // Copy tiers from config to avoid modifying the original
      position.tiers = SELL_CRITERIA.TIERED_PROFIT_TAKING.TIERS.map(tier => ({
        percent: tier.PERCENT,
        positionPercent: tier.POSITION_PERCENT,
        executed: false
      }));
    }
  }

  // Check for tiered profit taking
  if (SELL_CRITERIA.TIERED_PROFIT_TAKING && SELL_CRITERIA.TIERED_PROFIT_TAKING.ENABLED) {
    // Sort tiers by profit percent (highest first) to check higher tiers first
    const sortedTiers = [...position.tiers].sort((a, b) => b.percent - a.percent);

    for (const tier of sortedTiers) {
      if (!tier.executed && profitPercent >= tier.percent) {
        // Mark this tier as executed
        tier.executed = true;

        // Update the position's tiers
        position.tiers = position.tiers.map(t =>
          t.percent === tier.percent ? tier : t
        );

        return {
          sell: true,
          reason: `Tiered profit taking (${tier.percent}%)`,
          tier: tier,
          sellPercentage: tier.positionPercent
        };
      }
    }
  }

  // Check traditional sell conditions
  if (profitPercent >= SELL_CRITERIA.PROFIT_TARGET) {
    return {
      sell: true,
      reason: `Profit target reached (${SELL_CRITERIA.PROFIT_TARGET}%)`,
      sellPercentage: 100 // Sell all remaining
    };
  }

  if (profitPercent <= SELL_CRITERIA.STOP_LOSS) {
    return {
      sell: true,
      reason: `Stop loss triggered (${SELL_CRITERIA.STOP_LOSS}%)`,
      sellPercentage: 100 // Sell all
    };
  }

  if (currentPrice < trailingStopPrice && highestPrice > entryPrice) {
    // Calculate how much the price dropped from the highest point
    const dropPercent = ((highestPrice - currentPrice) / highestPrice) * 100;

    // Determine which type of trailing stop was triggered
    let stopType = "ATR-based";
    if (SELL_CRITERIA.TRAILING_STOP?.USE_MAX_STOP && percentTrailingStop > atrTrailingStop) {
      stopType = "percentage-based";
    }

    return {
      sell: true,
      reason: `Trailing stop triggered (${stopType}, ${dropPercent.toFixed(2)}% drop from high of $${highestPrice.toFixed(8)})`,
      sellPercentage: 100 // Sell all
    };
  }

  if (indicators.rsi > SELL_CRITERIA.MAX_RSI) {
    return {
      sell: true,
      reason: `RSI overbought (>${SELL_CRITERIA.MAX_RSI})`,
      sellPercentage: 100 // Sell all
    };
  }

  if (currentPrice < indicators.bollinger?.middle) {
    return {
      sell: true,
      reason: 'Price below Bollinger middle band',
      sellPercentage: 100 // Sell all
    };
  }

  if (currentData.holderChange24h < SELL_CRITERIA.MIN_HOLDER_CHANGE_24H) {
    return {
      sell: true,
      reason: 'Significant holder decrease',
      sellPercentage: 100 // Sell all
    };
  }

  return { sell: false };
}

/**
 * Log trade details to file
 * @param {Object} tradeDetails - Details of the trade
 */
async function logTrade(tradeDetails) {
  // Use the logger's trade function to log the trade
  // This will log to the ./logs/trades.log file instead of the root directory
  logger.trade(tradeDetails);

  // Log a simple message to the console
  logger.info(`Trade logged: ${tradeDetails.action} ${tradeDetails.symbol}`);
}

// Use the getESTTimestamp function from logger.js instead of duplicating it here

/**
 * Execute a buy order
 * @param {Object} token - Token data
 * @param {JupiterService} jupiterService - Jupiter service instance
 * @param {Connection} connection - Solana connection
 * @returns {Object|null} - Position data or null if buy failed
 */
async function executeBuy(token, jupiterService, connection) {
  try {
    logger.info(`Attempting to buy ${token.symbol} (${token.tokenAddress})`);

    // Double-check if token is blacklisted (safety measure)
    if (isBlacklisted(token.tokenAddress)) {
      logger.warn(`Aborting purchase of blacklisted token: ${token.symbol} (${token.tokenAddress})`);
      return null;
    }

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
        logger.debug(`Pre-swap direct wallet balance of ${token.symbol}: ${preSwapBalance}`);
      } else {
        logger.debug(`No token account found for ${token.symbol}, assuming zero balance`);
        preSwapBalance = 0;
      }
    } catch (walletError) {
      logger.warn(`Failed to get direct wallet balance: ${walletError.message}`);

      // Fallback to Jupiter API
      try {
        const balances = await jupiterService.getBalances();
        if (balances && balances.tokens && Array.isArray(balances.tokens)) {
          const tokenBalance = balances.tokens.find(t => t.mint === token.tokenAddress);
          preSwapBalance = tokenBalance ? parseFloat(tokenBalance.uiAmount) : 0;
          logger.debug(`Pre-swap Jupiter API balance of ${token.symbol}: ${preSwapBalance}`);
        } else {
          logger.warn(`Jupiter API returned unexpected data structure: ${JSON.stringify(balances)}`);
          preSwapBalance = 0;
        }
      } catch (jupiterError) {
        logger.warn(`Failed to get Jupiter API balance: ${jupiterError.message}`);
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

    // Using fixed buy amount as requested
    logger.info(`Executing swap with fixed amount: ${BUY_AMOUNT_SOL} SOL (${BUY_AMOUNT_LAMPORTS} lamports)`);

    // Execute swap from SOL to token using Ultra API
    let txSignature;
    let transactionTimedOut = false;

    try {
      // Use the new executeUltraSwap method which uses Jupiter's Ultra API
      txSignature = await jupiterService.executeUltraSwap(
        SOL_MINT,
        token.tokenAddress,
        BUY_AMOUNT_LAMPORTS
      );
      logger.info(`Transaction confirmed: ${txSignature}`);
    } catch (error) {
      // Check if this is a timeout error but the transaction might have gone through
      if (error.message && error.message.includes('was not confirmed') && error.message.includes('signature')) {
        // Extract the transaction signature from the error message
        const signatureMatch = error.message.match(/signature ([A-Za-z0-9]+)/i);
        if (signatureMatch && signatureMatch[1]) {
          txSignature = signatureMatch[1];
          transactionTimedOut = true;
          logger.warn(`Transaction timed out but may have succeeded. Checking status for: ${txSignature}`);

          // Wait a bit longer for the transaction to potentially confirm
          await new Promise(resolve => setTimeout(resolve, 10000));

          // Check if the transaction was confirmed
          try {
            const connection = jupiterService.connection;
            const status = await connection.getSignatureStatus(txSignature, { searchTransactionHistory: true });

            if (status && status.value && status.value.confirmationStatus === 'confirmed') {
              logger.info(`Transaction ${txSignature} was confirmed after timeout!`);
              // Continue with the process as if the transaction succeeded
            } else if (status && status.value && status.value.confirmationStatus === 'finalized') {
              logger.info(`Transaction ${txSignature} was finalized after timeout!`);
              // Continue with the process as if the transaction succeeded
            } else {
              logger.warn(`Transaction ${txSignature} status after timeout: ${JSON.stringify(status)}`);
              if (!status || !status.value) {
                throw new Error(`Transaction not found after timeout`);
              } else {
                throw new Error(`Transaction not confirmed after timeout: ${status.value.confirmationStatus}`);
              }
            }
          } catch (statusError) {
            logger.error(`Failed to check transaction status: ${statusError.message}`);
            throw new Error(`Transaction timed out and status check failed: ${statusError.message}`);
          }
        } else {
          throw error; // Re-throw if we couldn't extract the signature
        }
      } else {
        throw error; // Re-throw if it's not a timeout error
      }
    }

    // Wait a moment for the transaction to be confirmed and balances to update
    // Wait longer if the transaction timed out but was confirmed later
    const waitTime = transactionTimedOut ? 15000 : 10000;
    logger.debug(`Waiting ${waitTime/1000} seconds for balances to update...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));

    // Get actual token amount from updated balance
    let actualAmount;
    try {
      // Try to get balance from Jupiter API first
      const balances = await jupiterService.getBalances();
      const tokenBalance = balances.tokens.find(t => t.mint === token.tokenAddress);
      const postSwapBalance = tokenBalance ? parseFloat(tokenBalance.uiAmount) : 0;
      actualAmount = postSwapBalance - preSwapBalance;
      logger.debug(`Post-swap balance of ${token.symbol} from Jupiter API: ${postSwapBalance}`);
      logger.debug(`Calculated amount received: ${actualAmount}`);

      // If Jupiter API gives suspicious results, try direct wallet balance check
      if (actualAmount <= 0 || actualAmount > 1000000000) {
        logger.warn(`Suspicious amount received (${actualAmount}), checking direct wallet balance`);

        // Get token balance directly from the wallet
        const tokenAccount = await connection.getParsedTokenAccountsByOwner(
          jupiterService.wallet.publicKey,
          { mint: new PublicKey(token.tokenAddress) }
        );

        if (tokenAccount.value.length > 0) {
          const balance = tokenAccount.value[0].account.data.parsed.info.tokenAmount;
          const directBalance = parseFloat(balance.uiAmount);
          const tokenDecimals = balance.decimals;
          logger.debug(`Direct wallet balance of ${token.symbol}: ${directBalance} (decimals: ${tokenDecimals})`);

          // Use direct balance as the actual amount
          actualAmount = directBalance;

          // Store token decimals for later use
          token.tokenDecimals = tokenDecimals;
        } else {
          logger.warn(`No token account found for ${token.symbol}, falling back to estimate`);
          // Use a more conservative estimate
          actualAmount = (BUY_AMOUNT_LAMPORTS * 0.95) / (token.priceUsd * 1.05); // Account for slippage and fees
        }
      }
    } catch (error) {
      logger.warn(`Failed to get post-swap balance: ${error.message}`);

      try {
        // Try direct wallet balance check as fallback
        const tokenAccount = await connection.getParsedTokenAccountsByOwner(
          jupiterService.wallet.publicKey,
          { mint: new PublicKey(token.tokenAddress) }
        );

        if (tokenAccount.value.length > 0) {
          const balance = tokenAccount.value[0].account.data.parsed.info.tokenAmount;
          const directBalance = parseFloat(balance.uiAmount);
          logger.debug(`Direct wallet balance of ${token.symbol}: ${directBalance}`);
          actualAmount = directBalance;
        } else {
          // Last resort fallback
          actualAmount = (BUY_AMOUNT_LAMPORTS * 0.95) / (token.priceUsd * 1.05); // Account for slippage and fees
        }
      } catch (secondError) {
        logger.warn(`Failed to get direct wallet balance: ${secondError.message}`);
        // Last resort fallback
        actualAmount = (BUY_AMOUNT_LAMPORTS * 0.95) / (token.priceUsd * 1.05); // Account for slippage and fees
      }
    }

    // Sanity check on the amount
    if (actualAmount > 1000000000) {
      logger.warn(`Amount suspiciously large (${actualAmount}), capping to reasonable value`);
      // Cap to a reasonable value based on the transaction amount
      actualAmount = (BUY_AMOUNT_LAMPORTS * 0.95) / (token.priceUsd * 1.05);
    }

    logger.debug(`Final amount used for position: ${actualAmount}`);

    // Create position object
    const position = {
      tokenAddress: token.tokenAddress,
      symbol: token.symbol,
      entryPrice: token.priceUsd,
      entryTime: Date.now(),
      highestPrice: token.priceUsd,
      amount: actualAmount,
      poolAddress: token.poolAddress,
      txSignature,
      tokenDecimals: token.tokenDecimals || 9 // Default to 9 decimals if not available
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
    logger.error(`Buy execution failed for ${token.symbol}: ${error.message}`);
    return null;
  }
}

/**
 * Execute a sell order
 * @param {Object} position - Position data
 * @param {Object} currentData - Current token data
 * @param {JupiterService} jupiterService - Jupiter service instance
 * @param {string} reason - Reason for selling
 * @param {number} sellPercentage - Percentage of position to sell (1-100)
 * @returns {Promise<boolean>} - Whether sell was successful
 */
async function executeSell(position, currentData, jupiterService, reason, sellPercentage = 100) {
  try {
    logger.info(`Attempting to sell ${position.symbol} (${position.tokenAddress}): ${reason}`);

    // Get current token balance to ensure we're selling what we actually have
    let tokenAmount = null;
    let fullTokenAmount = null;

    // Try to get the actual token balance directly from the wallet first (most reliable)
    try {
      const connection = jupiterService.connection;
      const tokenAccount = await connection.getParsedTokenAccountsByOwner(
        jupiterService.wallet.publicKey,
        { mint: new PublicKey(position.tokenAddress) }
      );

      if (tokenAccount.value.length > 0) {
        const balance = tokenAccount.value[0].account.data.parsed.info.tokenAmount;
        // Store both UI amount and decimals for conversion
        fullTokenAmount = parseFloat(balance.uiAmount);
        const tokenDecimals = balance.decimals;
        logger.debug(`Direct wallet balance of ${position.symbol}: ${fullTokenAmount} (decimals: ${tokenDecimals})`);

        // Calculate the amount to sell based on the sellPercentage
        tokenAmount = fullTokenAmount * (sellPercentage / 100);
        logger.debug(`Selling ${sellPercentage}% of position: ${tokenAmount} ${position.symbol}`);

        // Store token decimals in the position for later use
        position.tokenDecimals = tokenDecimals;
      }
    } catch (walletError) {
      logger.warn(`Failed to get direct wallet balance: ${walletError.message}`);
    }

    // If direct wallet check failed, try Jupiter API
    if (tokenAmount === null) {
      try {
        const balances = await jupiterService.getBalances();
        const tokenBalance = balances.tokens.find(t => t.mint === position.tokenAddress);
        if (tokenBalance && tokenBalance.uiAmount > 0) {
          fullTokenAmount = tokenBalance.uiAmount;
          // Calculate the amount to sell based on the sellPercentage
          tokenAmount = fullTokenAmount * (sellPercentage / 100);
          logger.debug(`Using Jupiter API balance: ${fullTokenAmount} ${position.symbol}`);
          logger.debug(`Selling ${sellPercentage}% of position: ${tokenAmount} ${position.symbol}`);
        }
      } catch (jupiterError) {
        logger.warn(`Failed to get Jupiter API balance: ${jupiterError.message}`);
      }
    }

    // Last resort: use position amount (but with sanity check)
    if (tokenAmount === null) {
      if (position.amount > 0 && position.amount < 1000000000) {
        fullTokenAmount = position.amount;
        // Calculate the amount to sell based on the sellPercentage
        tokenAmount = fullTokenAmount * (sellPercentage / 100);
        logger.debug(`Using position amount as last resort: ${fullTokenAmount} ${position.symbol}`);
        logger.debug(`Selling ${sellPercentage}% of position: ${tokenAmount} ${position.symbol}`);
      } else {
        throw new Error(`No valid token amount available for selling`);
      }
    }

    // Sanity check - cap extremely large amounts
    if (tokenAmount > 1000000000) {
      logger.warn(`Token amount suspiciously large (${tokenAmount}), capping to 1,000,000`);
      tokenAmount = 1000000; // Cap to a reasonable value
    }

    // Ensure the amount is a valid number
    if (isNaN(tokenAmount) || tokenAmount <= 0) {
      // IMPROVEMENT #2: If there are no tokens to sell, remove the position from tracking
      if (fullTokenAmount <= 0) {
        logger.info(`No tokens to sell for ${position.symbol}, removing from tracking`);
        positions.delete(position.tokenAddress);
        return true; // Consider the sell "successful" if there are no tokens to sell
      }
      throw new Error(`Invalid token amount: ${tokenAmount}`);
    }

    // Execute swap from token to SOL with detailed error handling
    // Convert UI amount to raw amount based on token decimals
    const tokenDecimals = position.tokenDecimals || 9; // Default to 9 decimals if not available
    const rawTokenAmount = Math.floor(tokenAmount * Math.pow(10, tokenDecimals));

    logger.info(`Executing swap: ${tokenAmount} ${position.symbol} (${rawTokenAmount} raw units) to SOL with ${SLIPPAGE_BPS/100}% slippage`);

    try {
      // If the amount is very small, log a warning
      if (tokenAmount < 10) {
        logger.warn(`Small token amount detected (${tokenAmount}), proceeding with caution`);
      }

      // Execute the swap using Ultra API
      let txSignature;
      let transactionTimedOut = false;

      try {
        // Use the new executeUltraSwap method which uses Jupiter's Ultra API
        logger.debug(`Executing Ultra swap: ${position.tokenAddress} → ${SOL_MINT}, amount: ${rawTokenAmount}`);

        txSignature = await jupiterService.executeUltraSwap(
          position.tokenAddress,
          SOL_MINT,
          rawTokenAmount // Use raw token amount
        );

        logger.info(`Sell transaction confirmed: ${txSignature}`);
      } catch (error) {
        // Check if this is a timeout error but the transaction might have gone through
        if (error.message && error.message.includes('was not confirmed') && error.message.includes('signature')) {
          // Extract the transaction signature from the error message
          const signatureMatch = error.message.match(/signature ([A-Za-z0-9]+)/i);
          if (signatureMatch && signatureMatch[1]) {
            txSignature = signatureMatch[1];
            transactionTimedOut = true;
            logger.warn(`Sell transaction timed out but may have succeeded. Checking status for: ${txSignature}`);

            // Wait a bit longer for the transaction to potentially confirm
            await new Promise(resolve => setTimeout(resolve, 10000));

            // Check if the transaction was confirmed
            try {
              const connection = jupiterService.connection;
              const status = await connection.getSignatureStatus(txSignature, { searchTransactionHistory: true });

              if (status && status.value && (status.value.confirmationStatus === 'confirmed' || status.value.confirmationStatus === 'finalized')) {
                logger.info(`Sell transaction ${txSignature} was confirmed after timeout!`);
                // Continue with the process as if the transaction succeeded
              } else {
                logger.warn(`Sell transaction ${txSignature} status after timeout: ${JSON.stringify(status)}`);
                throw new Error(`Sell transaction not confirmed after timeout`);
              }
            } catch (statusError) {
              logger.error(`Failed to check sell transaction status: ${statusError.message}`);
              throw error; // Re-throw the original error
            }
          } else {
            throw error; // Re-throw if we couldn't extract the signature
          }
        } else {
          throw error; // Re-throw if it's not a timeout error
        }
      }

      // Wait a moment for the transaction to be confirmed and balances to update
      const waitTime = transactionTimedOut ? 15000 : 10000;
      logger.debug(`Waiting ${waitTime/1000} seconds for balances to update...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));

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

      // IMPROVEMENT #1: Explicitly remove position after successful sell
      if (sellPercentage >= 100) {
        logger.info(`Sell transaction successful, removing ${position.symbol} from position tracking`);
        positions.delete(position.tokenAddress);
      }
    } catch (swapError) {
      // Try with a smaller amount if the full amount fails
      if (tokenAmount > 1) {
        // Reduce UI amount by 5%
        const reducedUIAmount = tokenAmount * 0.95;
        // Convert to raw amount
        const reducedRawAmount = Math.floor(reducedUIAmount * Math.pow(10, tokenDecimals));
        logger.warn(`First attempt failed, trying with reduced amount: ${reducedUIAmount} ${position.symbol} (${reducedRawAmount} raw units)`);

        try {
          // Try with even higher slippage for retry
          const retrySlippage = 3000; // 30% slippage for desperate retry
          logger.warn(`Retry attempt with ${retrySlippage/100}% slippage and further reduced amount`);

          // Further reduce amount to 80% of already reduced amount
          const finalUIAmount = reducedUIAmount * 0.8;
          const finalRawAmount = Math.floor(finalUIAmount * Math.pow(10, tokenDecimals));
          logger.debug(`Final retry amount: ${finalUIAmount} ${position.symbol} (${finalRawAmount} raw units)`);

          logger.debug(`Executing Ultra swap with reduced amount: ${position.tokenAddress} → ${SOL_MINT}, amount: ${finalRawAmount}`);

          const retryTxSignature = await jupiterService.executeUltraSwap(
            position.tokenAddress,
            SOL_MINT,
            finalRawAmount // Use raw amount
          );

          logger.info(`Sell transaction with reduced amount confirmed: ${retryTxSignature}`);

          // Log the trade with transaction signature using the final amount that was actually sold
          await logTrade({
            action: 'SELL',
            symbol: position.symbol,
            price: currentData.priceUsd,
            amount: finalUIAmount, // Use the final UI amount that was actually sold
            profitLoss: ((currentData.priceUsd - position.entryPrice) / position.entryPrice) * 100,
            txSignature: retryTxSignature,
            reason: reason + ' (reduced amount)'
          });

          // IMPROVEMENT #1: Explicitly remove position after successful retry sell
          if (sellPercentage >= 100) {
            logger.info(`Retry sell transaction successful, removing ${position.symbol} from position tracking`);
            positions.delete(position.tokenAddress);
          }
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
    logger.error(`Sell execution failed for ${position.symbol}: ${error.message}`);
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
async function getCurrentTokenData(tokenAddress, poolAddress, symbol, dexService) {
  try {
    logger.debug(`Fetching current data for ${symbol} (${tokenAddress})...`);

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
      logger.debug(`Using cached OHLCV data for ${symbol} (${ohlcvData.length} candles)`);
    } else {
      // Fetch fresh OHLCV data
      ohlcvData = await fetchOHLCV('solana', poolAddress, symbol, 'hour', 1);

      // Cache the data with timestamp
      ohlcvCache.set(cacheKey, {
        data: ohlcvData,
        timestamp: Date.now()
      });

      logger.debug(`Fetched fresh OHLCV data for ${symbol} (${ohlcvData.length} candles)`);
    }

    // Calculate fresh indicators using the OHLCV data
    let indicators = {};
    if (ohlcvData && ohlcvData.length > 0) {
      // Use the last 20 candles (or all available if less) for indicator calculation
      const recentOhlcv = ohlcvData.slice(-20);
      indicators = calculateIndicators(recentOhlcv);
      logger.debug(`Recalculated indicators for ${symbol}`);
    } else {
      logger.warn(`Insufficient OHLCV data for ${symbol}, using fallback indicators`);
    }

    // Fetch fresh holder data
    const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // YYYY-MM-DD
    const toDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    let historicalHolders;
    try {
      historicalHolders = await getTokenHoldersHistorical(tokenAddress, fromDate, toDate);
      logger.debug(`Fetched historical holders for ${symbol}: ${historicalHolders?.result?.length || 0} data points`);
    } catch (error) {
      logger.error(`Failed to fetch historical holders for ${symbol}: ${error.message}`);
      historicalHolders = { result: [] };
    }

    // Calculate holder change percentage
    const holderChange24h = historicalHolders?.result?.length > 1
      ? ((historicalHolders.result[historicalHolders.result.length - 1].totalHolders -
          historicalHolders.result[0].totalHolders) / (historicalHolders.result[0].totalHolders || 1) * 100) || 0
      : 0;

    logger.debug(`Current holder change for ${symbol}: ${holderChange24h.toFixed(2)}%`);

    // Combine all data
    return {
      ...pairData,
      indicators: { hour: indicators },
      historicalHolders,
      holderChange24h
    };
  } catch (error) {
    logger.error(`Failed to get current data for ${tokenAddress}: ${error.message}`);
    return null;
  }
}

/**
 * Monitor and manage open positions
 * @param {JupiterService} jupiterService - Jupiter service instance
 * @param {DexScreenerService} dexService - DexScreener service instance
 * @param {Connection} connection - Solana connection
 */
async function monitorPositions(jupiterService, dexService) {
  logger.debug(`Monitoring ${positions.size} open positions...`);

  // If no positions, clear the interval
  if (positions.size === 0 && monitoringInterval) {
    logger.info('No positions to monitor. Stopping monitoring interval.');
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
        dexService
      );

      if (!currentData) {
        logger.warn(`Failed to get current data for ${position.symbol}, skipping this check`);
        continue;
      }

      // Update position with current data
      const updatedPosition = updatePosition(position, currentData);
      positions.set(tokenAddress, updatedPosition);

      // Log current position status
      const currentPrice = currentData.priceUsd;
      const entryPrice = position.entryPrice;
      const profitPercent = ((currentPrice - entryPrice) / entryPrice) * 100;

      // Calculate trailing stop levels for logging
      const { SELL_CRITERIA } = BOT_CONFIG;
      const indicators = currentData.indicators.hour || {};

      // Get ATR multiplier based on profit level
      let atrMultiplier = SELL_CRITERIA.TRAILING_STOP?.ATR_MULTIPLIER || 2.5;
      if (SELL_CRITERIA.TRAILING_STOP?.DYNAMIC_ATR_MULTIPLIERS) {
        const sortedMultipliers = [...SELL_CRITERIA.TRAILING_STOP.DYNAMIC_ATR_MULTIPLIERS]
          .sort((a, b) => b.PROFIT_PERCENT - a.PROFIT_PERCENT);

        for (const level of sortedMultipliers) {
          if (profitPercent >= level.PROFIT_PERCENT) {
            atrMultiplier = level.MULTIPLIER;
            break;
          }
        }
      }

      // Calculate both types of stops
      const atrTrailingStop = position.highestPrice - (atrMultiplier * (indicators.atr || 0));
      const trailingStopPercent = SELL_CRITERIA.TRAILING_STOP?.PERCENT || 3.0;
      const percentTrailingStop = position.highestPrice * (1 - (trailingStopPercent / 100));

      // Determine which stop is active
      let activeStop = atrTrailingStop;
      let stopType = "ATR-based";
      if (SELL_CRITERIA.TRAILING_STOP?.USE_MAX_STOP) {
        if (percentTrailingStop > atrTrailingStop) {
          activeStop = percentTrailingStop;
          stopType = "percentage-based";
        }
      }

      // Calculate distance to stop
      const distanceToStop = ((currentPrice - activeStop) / currentPrice) * 100;

      // Add trailing stop info to position for logging
      position.currentPrice = currentPrice;
      position.profitLoss = profitPercent;
      position.rsi = currentData.indicators.hour?.rsi;
      position.holderChange = currentData.holderChange24h;
      position.trailingStop = {
        price: activeStop,
        type: stopType,
        distance: distanceToStop
      };

      // Log to monitor.log file only
      logger.monitor(position);

      // Log minimal info to console
      logger.info(`Position ${position.symbol}: Current price $${currentPrice.toFixed(8)}, ` +
                  `P/L: ${profitPercent.toFixed(2)}%, ` +
                  `Highest: $${position.highestPrice.toFixed(8)}, ` +
                  `RSI: ${currentData.indicators.hour?.rsi?.toFixed(2) || 'N/A'}, ` +
                  `Holder change: ${currentData.holderChange24h?.toFixed(2) || 'N/A'}%`);

      logger.debug(`Trailing stop: $${activeStop.toFixed(8)} (${stopType}, ${distanceToStop.toFixed(2)}% away)`);

      // Check sell criteria with updated indicators and holder data
      const sellDecision = meetsSellCriteria(updatedPosition, currentData);
      if (sellDecision.sell) {
        logger.info(`Sell criteria met for ${position.symbol}: ${sellDecision.reason}`);

        // Log to user.log
        logger.logUser(`Sell criteria met for ${position.symbol}: ${sellDecision.reason}`);

        // Get the sell percentage (default to 100% if not specified)
        const sellPercentage = sellDecision.sellPercentage || 100;

        // Execute the sell with the specified percentage
        const sellSuccess = await executeSell(
          updatedPosition,
          currentData,
          jupiterService,
          sellDecision.reason,
          sellPercentage
        );

        if (sellSuccess) {
          // If we're selling the entire position or this is a stop loss/emergency exit
          if (sellPercentage >= 100 ||
              sellDecision.reason.includes('Stop loss') ||
              sellDecision.reason.includes('RSI overbought') ||
              sellDecision.reason.includes('Bollinger') ||
              sellDecision.reason.includes('holder decrease')) {
            // Log to monitor.log before removing the position
            logger.monitor(position, 'SELL', sellDecision.reason);

            // Remove the position entirely
            positions.delete(tokenAddress);
            logger.info(`Sold ${position.symbol} completely: ${sellDecision.reason}`);
            logger.logUser(`Sold ${position.symbol} completely for ${sellPercentage}% of position: ${sellDecision.reason}`);
          } else {
            // For partial sells (tiered profit taking), update the position amount
            // The actual amount will be updated on the next monitoring cycle when we fetch the balance again
            logger.monitor(position, 'PARTIAL_SELL', `${sellDecision.reason} (${sellPercentage}%)`);

            logger.info(`Partially sold ${position.symbol} (${sellPercentage}%): ${sellDecision.reason}`);
            logger.info(`Position will be updated on next monitoring cycle`);
            logger.logUser(`Partially sold ${position.symbol} (${sellPercentage}% of position): ${sellDecision.reason}`);
            logger.logUser(`Position will be updated on next monitoring cycle`);
          }
        }
      }
    } catch (error) {
      logger.error(`Error monitoring position for ${position.symbol}: ${error.message}`);
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
async function processTokens(finalTokens, jupiterService) {
  logger.info(`Processing ${finalTokens.length} tokens for potential trades...`);

  // Skip if we already have any positions
  if (positions.size > 0) {
    logger.info(`Already have ${positions.size} open position(s). Not looking for new opportunities.`);
    return;
  }

  // Sort tokens by score (highest first)
  const sortedTokens = [...finalTokens].sort((a, b) => b.score - a.score);

  for (const token of sortedTokens) {
    // Skip if already in a position for this token
    if (positions.has(token.tokenAddress)) {
      continue;
    }

    // Skip if token is blacklisted
    if (isBlacklisted(token.tokenAddress)) {
      logger.debug(`Skipping blacklisted token: ${token.symbol} (${token.tokenAddress})`);
      continue;
    }

    // Check buy criteria
    if (meetsBuyCriteria(token)) {
      logger.info(`Buy criteria met for ${token.symbol} (Score: ${token.score.toFixed(2)}/100)`);

      // Execute buy with connection for token balance checking
      const position = await executeBuy(token, jupiterService, jupiterService.connection);
      if (position) {
        // Add to positions
        positions.set(token.tokenAddress, position);

        logger.info(`Bought ${token.symbol} at $${token.priceUsd}`);

        // Log to user.log
        logger.logUser(`Bought ${token.symbol} at $${token.priceUsd} for ${BOT_CONFIG.BUY_AMOUNT_SOL} SOL, received ${position.amount} tokens`);

        // Exit since we now have a position (only allowing one at a time)
        if (positions.size >= MAX_POSITIONS) {
          logger.info(`Position acquired. Maximum positions (${MAX_POSITIONS}) reached.`);
          logger.logUser(`Position acquired. Maximum positions (${MAX_POSITIONS}) reached.`);
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
    logger.info('Initializing trading strategy...');

    // Use provided services or initialize new ones
    const connection = services.connection || initializeConnection();
    const wallet = services.wallet || initializeWallet();
    const walletInfo = services.walletInfo || await checkWalletBalance(wallet);
    const dexService = services.dexService || new DexScreenerService();

    // Check if wallet has sufficient balance
    if (!walletInfo.hasMinimumBalance) {
      logger.error('Insufficient wallet balance for trading.');
      return { success: false, reason: 'insufficient_balance' };
    }

    // Initialize Jupiter service
    const jupiterService = new JupiterService(connection, wallet);

    // Process tokens for potential trades
    await processTokens(finalTokens, jupiterService);

    // Set up position monitoring only if we have positions
    if (positions.size > 0) {
      logger.info(`Setting up position monitoring (every ${PRICE_CHECK_INTERVAL / 1000} seconds)...`);

      // Clear any existing interval
      if (monitoringInterval) {
        clearInterval(monitoringInterval);
      }

      // Set up new monitoring interval
      monitoringInterval = setInterval(
        () => monitorPositions(jupiterService, dexService),
        PRICE_CHECK_INTERVAL
      );

      logger.info('Position monitoring started.');
    } else {
      logger.info('No positions to monitor. Skipping monitoring setup.');
    }

    logger.info('Trading strategy initialized successfully.');
    return {
      success: true,
      positionsOpened: positions.size,
      positions: Array.from(positions.entries()).map(([_, pos]) => ({
        symbol: pos.symbol,
        entryPrice: pos.entryPrice,
        amount: pos.amount,
        entryTime: new Date(pos.entryTime).toISOString()
      }))
    };
  } catch (error) {
    logger.error(`Trading strategy initialization failed: ${error.message}`);
    return { success: false, reason: 'initialization_failed', error: error.message };
  }
}

/**
 * Stop all trading activities and clean up resources
 */
async function stopTrading() {
  try {
    logger.info('Stopping trading activities...');

    // Clear monitoring interval
    if (monitoringInterval) {
      clearInterval(monitoringInterval);
      monitoringInterval = null;
      logger.info('Position monitoring stopped.');
    }

    // Log current positions for reference
    if (positions.size > 0) {
      logger.warn(`WARNING: ${positions.size} positions are still open:`);
      for (const [_, position] of positions.entries()) {
        logger.warn(`- ${position.symbol}: ${position.amount} tokens at $${position.entryPrice}`);
      }
      logger.warn('These positions will need to be managed manually or when the bot restarts.');
    } else {
      logger.info('No open positions to manage.');
    }

    return { success: true, message: 'Trading stopped successfully' };
  } catch (error) {
    logger.error(`Error stopping trading: ${error.message}`);
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

/**
 * Get the count of open positions
 * @returns {number} - Number of open positions
 */
function getOpenPositionsCount() {
  return positions.size;
}

module.exports = {
  executeTradingStrategy,
  stopTrading,
  getCurrentPositions,
  hasOpenPositions,
  getOpenPositionsCount,
  // Export these for testing/simulation
  meetsBuyCriteria,
  meetsSellCriteria
};
