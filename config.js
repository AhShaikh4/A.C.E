// config.js - Configuration settings for the Solana Memecoin Trading Bot

require('dotenv').config();

// Bot operation settings
const BOT_CONFIG = {
  // Analysis settings
  ANALYSIS_INTERVAL_MINUTES: 3, // How often to run analysis (in minutes)
  
  // Trading settings
  TRADING_ENABLED: true, // Master switch for trading
  MAX_POSITIONS: 1, // Maximum number of concurrent positions
  POSITION_CHECK_INTERVAL_SECONDS: 5, // How often to check positions (in seconds)
  
  // Token filtering settings
  MIN_LIQUIDITY_USD: 20000, // Minimum liquidity in USD
  MIN_VOLUME_USD: 20000, // Minimum 24h volume in USD
  MIN_SCORE: 60, // Minimum score (0-100) for buy consideration
  
  // Trade execution settings
  BUY_AMOUNT_SOL: 0.01, // Amount of SOL to use per trade
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
  MIN_SCORE: 60,
  MIN_PRICE_CHANGE_5M: 2,
  MIN_PRICE_CHANGE_1H: 0,
  MAX_RSI: 70,
  MIN_BUY_SELL_RATIO_5M: 1.2,
  MIN_HOLDER_CHANGE_24H: 0
};

// Sell criteria
const SELL_CRITERIA = {
  PROFIT_TARGET: 15, // 15%
  STOP_LOSS: -7, // -7%
  MAX_RSI: 80,
  MIN_HOLDER_CHANGE_24H: -5 // Sell if holder decrease > 5%
};

module.exports = {
  BOT_CONFIG,
  TA_CONFIG,
  BUY_CRITERIA,
  SELL_CRITERIA
};
