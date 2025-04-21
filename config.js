// config.js - Configuration settings for the Solana Memecoin Trading Bot

require('dotenv').config();

// Bot operation settings
const BOT_CONFIG = {
  // Analysis settings
  ANALYSIS_INTERVAL_MINUTES: 1, // How often to run analysis (in minutes)

  // Trading settings
  TRADING_ENABLED: true, // Master switch for trading
  MAX_POSITIONS: 1, // Maximum number of concurrent positions
  POSITION_CHECK_INTERVAL_SECONDS: 7, // How often to check positions (in seconds)

  // Token filtering settings
  MIN_LIQUIDITY_USD: 20000, // Minimum liquidity in USD
  MIN_VOLUME_USD: 20000, // Minimum 24h volume in USD
  MIN_SCORE: 60, // Minimum score (0-100) for buy consideration

  // Blacklist settings
  BLACKLIST_ENABLED: true, // Enable token blacklist feature
  BLACKLIST_FILE: './data/blacklist.json', // File to store blacklisted tokens

  // Trade execution settings
  BUY_AMOUNT_SOL: 0.08, // Amount of SOL to use per trade
  SLIPPAGE_BPS: 500, // Slippage tolerance in basis points (5%)

  // Exit settings
  PROFIT_TARGET_PERCENT: 15, // Take profit at 15% gain
  STOP_LOSS_PERCENT: 7, // Stop loss at 7% loss
  TRAILING_STOP_ATR_MULTIPLIER: 2.5, // Trailing stop at 2.5 * ATR

  // Wallet settings
  MINIMUM_SOL_BALANCE: 0.001, // Minimum SOL needed for transactions

  // Network settings
  NETWORK: process.env.NETWORK || 'mainnet-beta', // Solana network

  // API keys
  MORALIS_API_KEY: process.env.MORALIS_API_KEY,
  MORALIS_ENABLED: false, // Set to false to disable Moralis API calls

  // Logging settings
  LOG_LEVEL: process.env.LOG_LEVEL || 'info', // debug, info, warn, error
  LOG_TO_FILE: true,
  LOG_DIR: './logs'
};

// Technical analysis settings
const TA_CONFIG = {
  // Indicator settings
  RSI_PERIOD: 14,
  RSI_OVERBOUGHT: 80,
  RSI_OVERSOLD: 30,

  MACD_FAST_PERIOD: 12,
  MACD_SLOW_PERIOD: 26,
  MACD_SIGNAL_PERIOD: 9,

  BOLLINGER_PERIOD: 20,
  BOLLINGER_STD_DEV: 2,

  // Timeframes to analyze
  TIMEFRAMES: ['minute', 'hour'],

  // Token scoring weights
  SCORE_WEIGHTS: {
    TECHNICAL_INDICATORS: 0.4,
    PRICE_MOMENTUM: 0.3,
    VOLUME_METRICS: 0.2,
    HOLDER_METRICS: 0.1
  }
};

// Buy criteria
const BUY_CRITERIA = {
  // Traditional criteria (used for individual checks)
  MIN_SCORE: 60,
  MIN_PRICE_CHANGE_5M: 2,
  MIN_PRICE_CHANGE_1H: 0,
  MAX_RSI: 70,
  MIN_BUY_SELL_RATIO_5M: 1.2,
  MIN_HOLDER_CHANGE_24H: 0,

  // Scoring system parameters
  SCORING_ENABLED: true,         // Enable scoring-based system
  MIN_TOTAL_SCORE: 60,           // Minimum total score required to buy (out of 100)

  // Scoring weights for each criterion (total: 100)
  SCORE_WEIGHTS: {
    TOKEN_SCORE: 20,             // Token's overall score
    PRICE_MOMENTUM: 15,          // Recent price changes
    MACD: 15,                    // MACD indicator
    RSI: 10,                     // RSI indicator
    PRICE_BREAKOUT: 15,          // Price above BB or Ichimoku signal
    BUY_SELL_RATIO: 15,          // Buy/sell transaction ratio
    HOLDER_GROWTH: 10            // Holder change percentage
  },

  // Bonus thresholds for exceptional signals
  BONUS: {
    HIGH_BUY_SELL_RATIO: 2.0,    // Threshold for high buy/sell ratio
    STRONG_MOMENTUM_5M: 5.0,      // Threshold for strong 5m momentum
    BONUS_POINTS: 5               // Extra points awarded for exceptional signals
  }
};

// Sell criteria
const SELL_CRITERIA = {
  // Traditional single profit target (used as final tier)
  PROFIT_TARGET: 100, // 100%

  // Tiered profit taking
  TIERED_PROFIT_TAKING: {
    ENABLED: true,
    TIERS: [
      { PERCENT: 15, POSITION_PERCENT: 30 },  // Sell 30% when profit reaches 15%
      { PERCENT: 30, POSITION_PERCENT: 30 }, // Sell another 30% when profit reaches 30%
      // Final 40% uses the PROFIT_TARGET (100%) or trailing stop
    ]
  },

  // Enhanced trailing stop settings
  TRAILING_STOP: {
    // ATR-based trailing stop
    ATR_MULTIPLIER: 2.5, // Default ATR multiplier
    // Dynamic ATR multipliers based on profit levels
    DYNAMIC_ATR_MULTIPLIERS: [
      { PROFIT_PERCENT: 50, MULTIPLIER: 1.5 }, // Tighter stop for large profits
      { PROFIT_PERCENT: 20, MULTIPLIER: 2.0 }, // Medium stop for medium profits
      { PROFIT_PERCENT: 0, MULTIPLIER: 2.5 }   // Wider stop for smaller profits
    ],
    // Percentage-based trailing stop
    PERCENT: 3.0, // Default trailing stop percentage (3%)
    // Whether to use the maximum of ATR and percentage stops
    USE_MAX_STOP: true
  },

  STOP_LOSS: -7, // -7%
  MAX_RSI: 80,
  MIN_HOLDER_CHANGE_24H: -5 // Sell if holder decrease > 5%
};

// Add criteria to BOT_CONFIG
BOT_CONFIG.BUY_CRITERIA = BUY_CRITERIA;
BOT_CONFIG.SELL_CRITERIA = SELL_CRITERIA;

module.exports = {
  BOT_CONFIG,
  TA_CONFIG,
  BUY_CRITERIA,
  SELL_CRITERIA
};
