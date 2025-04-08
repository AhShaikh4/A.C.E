//utils.js

/**
 * Simulation utilities for the Solana memecoin trading bot
 * Contains helper functions for logging and statistics tracking
 */

const fs = require('fs').promises;
const path = require('path');

// Ensure simulation logs directory exists and clear log files
async function ensureLogDirectory() {
  try {
    await fs.mkdir(path.join(__dirname), { recursive: true });

    // Clear log files at the start of a new simulation run
    await fs.writeFile(path.join(__dirname, 'trades.log'), '');
    await fs.writeFile(path.join(__dirname, 'simulation.log'), '');

    console.log('Log files cleared for new simulation run');
  } catch (error) {
    console.error(`Error managing log directory: ${error.message}`);
  }
}

/**
 * Convert date to EST timezone string
 * @param {Date} date - Date to convert
 * @returns {string} - Formatted date string in EST
 */
function getESTTimestamp(date = new Date()) {
  return date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

/**
 * Log trade details to file
 * @param {Object} tradeDetails - Details of the trade
 */
async function logTrade(tradeDetails) {
  // Note: We don't call ensureLogDirectory() here as it's called once at startup

  const timestamp = getESTTimestamp();
  const logEntry = `[${timestamp} EST] ${tradeDetails.action} ${tradeDetails.symbol} | ${tradeDetails.reason || ''}\n` +
                  `  Price: ${tradeDetails.price} | Amount: ${tradeDetails.amount}\n` +
                  `  Profit/Loss: ${tradeDetails.profitLoss ? (tradeDetails.profitLoss > 0 ? '+' : '') + tradeDetails.profitLoss.toFixed(2) + '%' : 'N/A'}\n` +
                  `  Transaction: ${tradeDetails.txSignature || 'N/A'}\n\n`;

  try {
    await fs.appendFile(path.join(__dirname, 'trades.log'), logEntry);
    console.log(`Trade logged: ${tradeDetails.action} ${tradeDetails.symbol}`);
  } catch (error) {
    console.error(`Failed to log trade: ${error.message}`);
  }
}

/**
 * Update trading statistics
 * @param {Object} stats - Statistics object to update
 * @param {number} profitLoss - Profit/loss percentage
 * @param {number} holdTime - Hold time in seconds
 * @returns {Object} - Updated statistics
 */
function updateStats(stats, profitLoss, holdTime) {
  // Increment total trades
  stats.trades++;

  // Add profit/loss to total
  stats.totalProfitLoss += profitLoss;

  // Increment wins if profitable
  if (profitLoss > 0) {
    stats.wins++;
  }

  // Add hold time to array
  stats.holdTimes.push(holdTime);

  // Calculate average hold time
  stats.avgHoldTime = stats.holdTimes.reduce((sum, time) => sum + time, 0) / stats.holdTimes.length;

  // Calculate win rate
  stats.winRate = (stats.wins / stats.trades) * 100;

  return stats;
}

/**
 * Log simulation statistics
 * @param {Object} stats - Statistics object
 * @param {Object} wallet - Wallet state
 */
async function logSimulationStats(stats, wallet) {
  // Note: We don't call ensureLogDirectory() here as it's called once at startup

  const timestamp = getESTTimestamp();
  const solBalance = wallet.solBalance / 1e9; // Convert lamports to SOL

  // Format token balances
  const tokenBalancesStr = Array.from(wallet.tokenBalances.entries())
    .map(([token, amount]) => `${token.slice(0, 8)}...${token.slice(-8)}: ${amount.toFixed(6)}`)
    .join(', ');

  const statsEntry = `[${timestamp} EST] Simulation Stats\n` +
                    `  Trades: ${stats.trades} | Win Rate: ${stats.winRate.toFixed(2)}%\n` +
                    `  Total P/L: ${stats.totalProfitLoss > 0 ? '+' : ''}${stats.totalProfitLoss.toFixed(2)}%\n` +
                    `  Avg Hold Time: ${formatSeconds(stats.avgHoldTime)}\n` +
                    `  Wallet: ${solBalance.toFixed(4)} SOL\n` +
                    `  Token Balances: ${tokenBalancesStr || 'None'}\n\n`;

  try {
    await fs.appendFile(path.join(__dirname, 'simulation.log'), statsEntry);
    console.log(`Simulation stats logged at ${timestamp}`);
  } catch (error) {
    console.error(`Failed to log simulation stats: ${error.message}`);
  }
}

/**
 * Format seconds into a human-readable duration
 * @param {number} seconds - Duration in seconds
 * @returns {string} - Formatted duration
 */
function formatSeconds(seconds) {
  if (!seconds || isNaN(seconds)) return '0s';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  let result = '';
  if (hours > 0) result += `${hours}h `;
  if (minutes > 0) result += `${minutes}m `;
  if (remainingSeconds > 0 || result === '') result += `${remainingSeconds}s`;

  return result.trim();
}

/**
 * Generate a random string for simulated transaction signatures
 * @param {number} length - Length of the random string
 * @returns {string} - Random string
 */
function generateRandomString(length = 8) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

/**
 * Handle API errors with fallback values
 * @param {Function} apiCall - Async function to call
 * @param {any} fallbackValue - Value to return if API call fails
 * @param {string} errorMessage - Message to log on error
 * @returns {Promise<any>} - API result or fallback value
 */
async function withFallback(apiCall, fallbackValue, errorMessage) {
  try {
    return await apiCall();
  } catch (error) {
    console.error(`${errorMessage}: ${error.message}`);
    return fallbackValue;
  }
}

module.exports = {
  logTrade,
  updateStats,
  logSimulationStats,
  generateRandomString,
  withFallback,
  ensureLogDirectory,
  getESTTimestamp
};
