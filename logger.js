// logger.js - Logging utility for the Solana Memecoin Trading Bot

const fs = require('fs');
const path = require('path');
const { BOT_CONFIG } = require('./config');

// Ensure log directory exists
const logDir = BOT_CONFIG.LOG_DIR || './logs';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Log file paths
const LOG_FILES = {
  INFO: path.join(logDir, 'info.log'),
  ERROR: path.join(logDir, 'error.log'),
  TRADE: path.join(logDir, 'trades.log'),
  ANALYSIS: path.join(logDir, 'analysis.log'),
  DEBUG: path.join(logDir, 'debug.log')
};

// Log levels
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

// Current log level from config
const CURRENT_LOG_LEVEL = LOG_LEVELS[BOT_CONFIG.LOG_LEVEL?.toUpperCase()] || LOG_LEVELS.INFO;

/**
 * Format a log message with timestamp
 * @param {string} level - Log level
 * @param {string} message - Log message
 * @returns {string} - Formatted log message
 */
function formatLogMessage(level, message) {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level}] ${message}`;
}

/**
 * Write to log file
 * @param {string} filePath - Path to log file
 * @param {string} message - Message to log
 */
function writeToLogFile(filePath, message) {
  if (BOT_CONFIG.LOG_TO_FILE) {
    fs.appendFileSync(filePath, message + '\n');
  }
}

/**
 * Log a debug message
 * @param {string} message - Message to log
 */
function debug(message) {
  if (CURRENT_LOG_LEVEL <= LOG_LEVELS.DEBUG) {
    const formattedMessage = formatLogMessage('DEBUG', message);
    console.debug(formattedMessage);
    writeToLogFile(LOG_FILES.DEBUG, formattedMessage);
  }
}

/**
 * Log an info message
 * @param {string} message - Message to log
 */
function info(message) {
  if (CURRENT_LOG_LEVEL <= LOG_LEVELS.INFO) {
    const formattedMessage = formatLogMessage('INFO', message);
    console.log(formattedMessage);
    writeToLogFile(LOG_FILES.INFO, formattedMessage);
  }
}

/**
 * Log a warning message
 * @param {string} message - Message to log
 */
function warn(message) {
  if (CURRENT_LOG_LEVEL <= LOG_LEVELS.WARN) {
    const formattedMessage = formatLogMessage('WARN', message);
    console.warn(formattedMessage);
    writeToLogFile(LOG_FILES.INFO, formattedMessage);
  }
}

/**
 * Log an error message
 * @param {string} message - Message to log
 * @param {Error} [error] - Optional error object
 */
function error(message, error) {
  if (CURRENT_LOG_LEVEL <= LOG_LEVELS.ERROR) {
    const errorDetails = error ? `\n${error.stack || error.message || error}` : '';
    const formattedMessage = formatLogMessage('ERROR', message + errorDetails);
    console.error(formattedMessage);
    writeToLogFile(LOG_FILES.ERROR, formattedMessage);
  }
}

/**
 * Log a trade
 * @param {Object} tradeDetails - Details of the trade
 */
function trade(tradeDetails) {
  const { action, symbol, price, amount, profitLoss, txSignature, reason } = tradeDetails;
  const timestamp = new Date().toISOString();
  
  const logEntry = `[${timestamp}] ${action} ${symbol} | ${reason || ''}\n` +
                  `  Price: ${price} | Amount: ${amount}\n` +
                  `  Profit/Loss: ${profitLoss ? (profitLoss > 0 ? '+' : '') + profitLoss.toFixed(2) + '%' : 'N/A'}\n` +
                  `  Transaction: ${txSignature || 'N/A'}\n\n`;
  
  // Log to console
  console.log(`Trade: ${action} ${symbol} at $${price} (${profitLoss ? (profitLoss > 0 ? '+' : '') + profitLoss.toFixed(2) + '%' : 'N/A'})`);
  
  // Log to trade file
  writeToLogFile(LOG_FILES.TRADE, logEntry);
  
  // Also log to info file
  writeToLogFile(LOG_FILES.INFO, formatLogMessage('TRADE', `${action} ${symbol} at $${price}`));
}

/**
 * Log analysis results
 * @param {Object} analysisDetails - Details of the analysis
 */
function analysis(analysisDetails) {
  const { tokenCount, topTokens, duration } = analysisDetails;
  const timestamp = new Date().toISOString();
  
  const topTokensStr = topTokens.map(t => 
    `${t.symbol}: Score ${t.score.toFixed(2)}, Price $${t.priceUsd.toFixed(8)}, Change 1h ${t.priceChange.h1.toFixed(2)}%`
  ).join('\n  ');
  
  const logEntry = `[${timestamp}] Analysis Results\n` +
                  `  Found ${tokenCount} tokens after analysis\n` +
                  `  Duration: ${duration}ms\n` +
                  `  Top tokens:\n  ${topTokensStr}\n\n`;
  
  // Log to console (abbreviated)
  console.log(`Analysis complete: Found ${tokenCount} tokens in ${duration}ms`);
  
  // Log to analysis file
  writeToLogFile(LOG_FILES.ANALYSIS, logEntry);
  
  // Also log to info file (abbreviated)
  writeToLogFile(LOG_FILES.INFO, formatLogMessage('ANALYSIS', `Found ${tokenCount} tokens, top: ${topTokens.map(t => t.symbol).join(', ')}`));
}

module.exports = {
  debug,
  info,
  warn,
  error,
  trade,
  analysis
};
