// main.js - Main entry point for the Solana Memecoin Trading Bot

require('dotenv').config();
const fs = require('fs').promises;
const chalk = require('chalk');
const Table = require('cli-table3');
const { initializeConnection, initializeWallet, checkWalletBalance, initializeMode } = require('./wallet');
const { MODES } = require('./mode');
const { performTA } = require('./TA');
const trading = require('./trading');
const { DexScreenerService } = require('./src/services/dexscreener');
const { BOT_CONFIG } = require('./config');
const logger = require('./logger');

// Display welcome banner
logger.displayBanner('Solana Memecoin Bot', 'blue');

// Global state
let isRunning = false;
let analysisInterval = null;
const ANALYSIS_INTERVAL = BOT_CONFIG.ANALYSIS_INTERVAL_MINUTES * 60 * 1000; // Convert minutes to milliseconds

/**
 * Initialize all required services and connections
 * @returns {Object} Initialized services and connections
 */
async function initialize() {
  // Start initialization with banner and spinner
  logger.startSpinner('Initializing Solana Memecoin Trading Bot...');

  try {
    // Initialize wallet and connection
    logger.updateSpinner('Connecting to Solana mainnet-beta...');
    const connection = initializeConnection();
    logger.succeedSpinner('✓ Successfully connected to Solana mainnet-beta');

    logger.startSpinner('Initializing wallet...');
    const wallet = initializeWallet();
    logger.succeedSpinner('Wallet initialized successfully');

    logger.startSpinner('Checking wallet balance...');
    const walletInfo = await checkWalletBalance(wallet);
    logger.succeedSpinner(`Wallet public key: ${walletInfo.publicKey}\nWallet balance: ${walletInfo.balance} SOL`);

    // Get buy amount from config
    const buyAmount = BOT_CONFIG.BUY_AMOUNT_SOL;

    // Display wallet status in a box
    const walletStatusMessage = [
      `Public Key: ${walletInfo.publicKey}`,
      `Balance: ${walletInfo.balance} SOL`,
      `Minimum Balance Check: ${walletInfo.hasMinimumBalance ? chalk.green('PASSED') : chalk.red('FAILED')}`,
      `Trading Balance Check: ${walletInfo.balance >= buyAmount ? chalk.green('PASSED') : chalk.red('FAILED')} (min: ${buyAmount} SOL)`
    ].join('\n');

    logger.displayBox(walletStatusMessage, 'Wallet Status', walletInfo.balance >= buyAmount ? 'success' : 'warning');

    // Check if wallet has sufficient balance for transactions
    if (!walletInfo.hasMinimumBalance) {
      logger.warn(`Insufficient wallet balance (${walletInfo.balance} SOL) for any operations.`);
      logger.warn(`Minimum required for transactions: ${BOT_CONFIG.MINIMUM_SOL_BALANCE} SOL`);
      logger.info('You can still run in monitoring mode.');
    }
    // Check if wallet has sufficient balance for trading
    else if (walletInfo.balance < buyAmount) {
      logger.warn(`Insufficient wallet balance (${walletInfo.balance} SOL) for trading.`);
      logger.warn(`Minimum required for trading: ${buyAmount} SOL`);
      logger.info('You can still run in monitoring mode.');
    }

    // Initialize bot mode
    const mode = await initializeMode(walletInfo.balance);

    // Display mode in a box
    const modeColor = mode === MODES.TRADING ? 'success' : 'info';
    logger.displayBox(`Bot is running in ${mode.toUpperCase()} mode`, 'Mode', modeColor);

    // Initialize services
    logger.startSpinner('Initializing services...');
    const dexService = new DexScreenerService();
    logger.succeedSpinner('Services initialized successfully');

    return {
      connection,
      wallet,
      walletInfo,
      mode,
      dexService
    };
  } catch (error) {
    console.error('\nInitialization Error:');
    console.error('-------------------');
    console.error(error.message);
    throw error;
  }
}

/**
 * Run a single analysis and trading cycle
 * @param {Object} services - Initialized services and connections
 */
async function runCycle(services) {
  try {
    const startTime = Date.now();
    logger.info(`Starting Analysis Cycle`);

    // Check if we already have open positions
    const hasOpenPositions = trading.hasOpenPositions();

    // If we're in trading mode and have open positions, skip the full analysis
    // and just monitor the existing positions
    if (services.mode === MODES.TRADING && BOT_CONFIG.TRADING_ENABLED && hasOpenPositions) {
      logger.startSpinner('Monitoring open positions...');
      const result = await trading.executeTradingStrategy([], services);

      if (result.success) {
        logger.succeedSpinner(`Position monitoring executed successfully. Positions: ${result.positionsOpened}`);
      } else {
        logger.failSpinner(`Position monitoring failed: ${result.reason}`);
        logger.warn(`Position monitoring failed: ${result.reason}`);
      }

      const duration = Date.now() - startTime;
      logger.info(`Analysis Cycle Completed in ${chalk.cyan(duration + 'ms')}`);
      return [];
    }

    // Perform technical analysis to find trading opportunities
    logger.startSpinner('Performing technical analysis...');
    const analyzedTokens = await performTA(services.dexService);
    logger.succeedSpinner('Technical analysis completed.');

    // Log analysis results with enhanced formatting
    const duration = Date.now() - startTime;
    logger.analysis({
      tokenCount: analyzedTokens.length,
      topTokens: analyzedTokens.slice(0, 5),
      duration
    });

    logger.info(`Analysis Cycle Completed in ${chalk.cyan(duration + 'ms')}`);

    // Execute trading strategy if in trading mode
    if (services.mode === MODES.TRADING && BOT_CONFIG.TRADING_ENABLED) {
      logger.startSpinner('Executing trading strategy...');
      const result = await trading.executeTradingStrategy(analyzedTokens, services);

      if (result.success) {
        logger.succeedSpinner(`Trading strategy executed successfully. Positions opened: ${result.positionsOpened}`);
        if (result.positionsOpened > 0) {
          // Create a table for opened positions
          const posTable = new Table({
            head: ['Symbol', 'Entry Price', 'Amount'],
            style: { head: ['cyan'] }
          });

          result.positions.forEach(pos => {
            posTable.push([chalk.bold(pos.symbol), `$${pos.entryPrice}`, pos.amount]);
          });

          console.log(posTable.toString());
        }
      } else {
        logger.failSpinner(`Trading strategy execution failed: ${result.reason}`);
        logger.warn(`Trading strategy execution failed: ${result.reason}`);
      }
    } else {
      logger.info(`Running in ${services.mode} mode. No trades will be executed.`);

      // Log potential trades that would have been made
      if (analyzedTokens.length > 0) {
        const potentialTrades = analyzedTokens
          .filter(token => token.score > BOT_CONFIG.MIN_SCORE)
          .slice(0, 5);

        if (potentialTrades.length > 0) {
          logger.info(`Found ${potentialTrades.length} potential trading opportunities:`);
          potentialTrades.forEach(token => {
            logger.info(`- ${token.symbol}: Score ${token.score.toFixed(2)}, Price $${token.priceUsd.toFixed(8)}, Change 1h: ${token.priceChange.h1.toFixed(2)}%`);
          });
        }
      }
    }

    logger.info(`Analysis Cycle Completed in ${duration}ms`);
    return analyzedTokens;
  } catch (error) {
    logger.error(`Cycle Error: ${error.message}`, error);
    return [];
  }
}

/**
 * Start the bot's main loop
 */
async function startBot() {
  if (isRunning) {
    logger.warn('Bot is already running.');
    return { success: false, reason: 'already_running' };
  }

  try {
    // Initialize all services
    logger.info('Initializing bot services...');
    const services = await initialize();
    isRunning = true;

    // Create log directory if it doesn't exist
    const logDir = BOT_CONFIG.LOG_DIR || './logs';
    await fs.mkdir(logDir, { recursive: true }).catch(() => {});

    // Display bot configuration in a box
    const configMessage = [
      `Network: ${chalk.cyan(BOT_CONFIG.NETWORK)}`,
      `Trading Enabled: ${BOT_CONFIG.TRADING_ENABLED ? chalk.green('YES') : chalk.red('NO')}`,
      `Analysis Interval: ${chalk.cyan(BOT_CONFIG.ANALYSIS_INTERVAL_MINUTES + ' minutes')}`,
      `Max Positions: ${chalk.cyan(BOT_CONFIG.MAX_POSITIONS.toString())}`,
      `Buy Amount: ${chalk.cyan(BOT_CONFIG.BUY_AMOUNT_SOL + ' SOL')}`
    ].join('\n');

    logger.displayBox(configMessage, 'Bot Configuration', 'info');

    // Run first cycle immediately
    logger.startSpinner('Running initial analysis cycle...');
    const initialTokens = await runCycle(services);
    logger.succeedSpinner(`Initial analysis found ${chalk.yellow(initialTokens.length)} tokens`);

    // Set up interval for subsequent cycles
    logger.startSpinner(`Setting up recurring analysis...`);
    analysisInterval = setInterval(() => runCycle(services), ANALYSIS_INTERVAL);
    logger.succeedSpinner(`Recurring analysis set up every ${chalk.cyan(BOT_CONFIG.ANALYSIS_INTERVAL_MINUTES + ' minutes')}`);

    // Display success message
    logger.displayBox(`Bot is now running in ${chalk.bold(services.mode.toUpperCase())} mode\nPress Ctrl+C to stop the bot.`, 'Bot Started', 'success');

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Received shutdown signal (Ctrl+C)');
      await stopBot();
      logger.info('Exiting process...');
      process.exit(0);
    });

    return { success: true, message: 'Bot started successfully' };
  } catch (error) {
    logger.failSpinner(`Failed to start bot: ${error.message}`);
    logger.error(`Failed to start bot: ${error.message}`, error);

    // Display error message in a box
    logger.displayBox(`${error.message}\n\nPlease check the logs for more details.`, 'Bot Startup Failed', 'error');

    isRunning = false;
    return { success: false, reason: 'initialization_failed', error: error.message };
  }
}

/**
 * Stop the bot and clean up resources
 */
async function stopBot() {
  if (!isRunning) {
    logger.info('Bot is not running.');
    return { success: true, message: 'Bot was not running' };
  }

  logger.startSpinner('Stopping bot...');

  // Clear the analysis interval
  if (analysisInterval) {
    clearInterval(analysisInterval);
    analysisInterval = null;
    logger.info('Analysis interval cleared.');
  }

  // Stop trading activities
  try {
    logger.updateSpinner('Stopping trading activities...');
    const tradingResult = await trading.stopTrading();
    logger.succeedSpinner(`Trading stopped: ${tradingResult.message || 'Successfully'}`);

    // Get current positions before stopping
    const positions = trading.getCurrentPositions();
    if (positions.length > 0) {
      // Create a table for open positions
      const posTable = new Table({
        head: ['Symbol', 'Entry Price', 'Amount', 'Entry Time'],
        style: { head: ['cyan'] }
      });

      positions.forEach(pos => {
        posTable.push([
          chalk.bold(pos.symbol),
          `$${pos.entryPrice}`,
          pos.amount,
          new Date(pos.entryTime).toLocaleString()
        ]);
      });

      logger.warn(`Bot stopped with ${positions.length} open positions. These will need to be managed manually.`);
      console.log(posTable.toString());
    }
  } catch (error) {
    logger.failSpinner('Error stopping trading activities');
    logger.error('Error stopping trading activities', error);
  }

  isRunning = false;

  // Display goodbye message
  logger.displayBox('Thank you for using the Solana Memecoin Trading Bot!', 'Goodbye', 'info');
  logger.info('Bot stopped successfully.');

  return { success: true, message: 'Bot stopped successfully' };
}

/**
 * Main function to run the bot
 */
async function main() {
  try {
    logger.info('Starting Solana Memecoin Trading Bot...');
    const result = await startBot();

    if (!result.success) {
      logger.error(`Failed to start bot: ${result.reason}`);
      process.exit(1);
    }
  } catch (error) {
    logger.error(`Fatal error: ${error.message}`, error);
    process.exit(1);
  }
}

/**
 * Get bot status
 * @returns {Object} - Bot status information
 */
function getBotStatus() {
  return {
    isRunning,
    uptime: isRunning ? Date.now() - startTime : 0,
    positions: getCurrentPositions(),
    config: {
      network: BOT_CONFIG.NETWORK,
      tradingEnabled: BOT_CONFIG.TRADING_ENABLED,
      analysisInterval: BOT_CONFIG.ANALYSIS_INTERVAL_MINUTES,
      maxPositions: BOT_CONFIG.MAX_POSITIONS
    }
  };
}

// Track bot start time
let startTime = 0;

// Run the bot if this file is executed directly
if (require.main === module) {
  startTime = Date.now();
  main();
}

// Export functions for potential programmatic use
module.exports = {
  startBot,
  stopBot,
  runCycle,
  getBotStatus
};
