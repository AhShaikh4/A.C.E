// logger.js - Enhanced logging utility for the Solana Memecoin Trading Bot

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const winston = require('winston');
const { format } = winston;
const Table = require('cli-table3');
const ora = require('ora').default;
const figlet = require('figlet');
const boxen = require('boxen');
const { BOT_CONFIG } = require('./config');

// Spinner for loading animations
let spinner = null;

// Create a fallback spinner in case ora doesn't work
const fallbackSpinner = {
  start: (text) => {
    console.log(text);
    return fallbackSpinner;
  },
  stop: () => fallbackSpinner,
  succeed: (text) => {
    console.log(`✓ ${text}`);
    return fallbackSpinner;
  },
  fail: (text) => {
    console.log(`✗ ${text}`);
    return fallbackSpinner;
  },
  text: ''
};

// Use ora if available, otherwise use fallback
const createSpinner = (text) => {
  try {
    return ora(text);
  } catch (error) {
    console.log('Warning: ora spinner not available, using fallback');
    return fallbackSpinner;
  }
};

// Ensure log directory exists
const logDir = BOT_CONFIG.LOG_DIR || './logs';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Log levels with colors
const LOG_LEVELS = {
  DEBUG: { value: 0, color: chalk.cyan, icon: '🔍' },
  INFO: { value: 1, color: chalk.blue, icon: 'ℹ️' },
  WARN: { value: 2, color: chalk.yellow, icon: '⚠️' },
  ERROR: { value: 3, color: chalk.red, icon: '❌' },
  TRADE: { value: 1, color: chalk.green, icon: '💰' },
  ANALYSIS: { value: 1, color: chalk.magenta, icon: '📊' },
  SYSTEM: { value: 1, color: chalk.gray, icon: '🔧' },
  USER: { value: 1, color: chalk.blue, icon: '👤' },
  WALLET: { value: 1, color: chalk.yellow, icon: '💼' },
  DETAILED: { value: 0, color: chalk.gray, icon: '🔎' }
};

// Current log level from config
const CURRENT_LOG_LEVEL_VALUE = LOG_LEVELS[BOT_CONFIG.LOG_LEVEL?.toUpperCase()]?.value || LOG_LEVELS.INFO.value;

// Configure Winston format
const logFormat = format.printf(({ timestamp, level, message }) => {
  return `[${timestamp}] [${level}] ${message}`;
});

// Create Winston logger with specific log files
const logger = winston.createLogger({
  format: format.combine(
    format.timestamp({
      format: () => {
        return getESTTimestamp();
      }
    }),
    logFormat
  ),
  transports: [
    // Errors log - All error messages
    new winston.transports.File({
      filename: path.join(logDir, 'errors.log'),
      level: 'error',
      maxsize: 20971520, // 20MB
      maxFiles: 10
    }),
    // Analyzed log - Analysis results for tokens
    new winston.transports.File({
      filename: path.join(logDir, 'analyzed.log'),
      maxsize: 20971520,
      maxFiles: 10
    }),
    // Detailed log - Detailed step-by-step logging
    new winston.transports.File({
      filename: path.join(logDir, 'detailed.log'),
      level: 'debug',
      maxsize: 20971520,
      maxFiles: 5
    }),
    // User log - User-friendly formatted logs
    new winston.transports.File({
      filename: path.join(logDir, 'user.log'),
      maxsize: 20971520,
      maxFiles: 5
    }),
    // Trades log - Trade records
    new winston.transports.File({
      filename: path.join(logDir, 'trades.log'),
      maxsize: 20971520,
      maxFiles: 10
    }),
    // Wallet log - Wallet performance and PnL tracking
    new winston.transports.File({
      filename: path.join(logDir, 'wallet.log'),
      maxsize: 20971520,
      maxFiles: 10
    }),
    // Monitor log - Position monitoring logs
    new winston.transports.File({
      filename: path.join(logDir, 'monitor.log'),
      maxsize: 20971520,
      maxFiles: 10
    })
  ]
});

/**
 * Clear all log files on startup
 */
function clearLogFiles() {
  const clearSpinner = createSpinner('Clearing log files...').start();
  try {
    // Define all log files to clear
    const logFiles = [
      'errors.log',
      'analyzed.log',
      'detailed.log',
      'user.log',
      'trades.log',
      'wallet.log',
      'monitor.log'
    ];

    // Delete each log file
    logFiles.forEach(file => {
      const filePath = path.join(logDir, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      } else {
        // Create empty file if it doesn't exist
        fs.writeFileSync(filePath, '');
      }
    });

    clearSpinner.succeed('Log files cleared successfully.');
  } catch (error) {
    clearSpinner.fail(`Failed to clear log files: ${error.message}`);
  }
}

// Clear log files on startup
clearLogFiles();

/**
 * Log to the detailed log file
 * @param {string} message - Message to log
 */
function logDetailed(message) {
  if (CURRENT_LOG_LEVEL_VALUE <= LOG_LEVELS.DETAILED.value) {
    // Write directly to detailed.log file
    const formattedMessage = `[${getESTTimestamp()}] DETAILED: ${message}\n`;
    fs.appendFileSync(path.join(logDir, 'detailed.log'), formattedMessage);

    // Only show in console if in debug mode
    if (CURRENT_LOG_LEVEL_VALUE === 0) {
      console.log(formatConsoleMessage('DETAILED', message));
    }
  }
}

/**
 * Log to the user log file with user-friendly formatting
 * @param {string} message - Message to log
 * @param {boolean} logToConsole - Whether to log to console (default: true)
 */
function logUser(message, logToConsole = true) {
  // Write directly to user.log file
  const formattedMessage = `[${getESTTimestamp()}] USER: ${message}\n`;
  fs.appendFileSync(path.join(logDir, 'user.log'), formattedMessage);

  // Only show user messages in console if logToConsole is true
  if (logToConsole) {
    console.log(formatConsoleMessage('USER', message));
  }
}

/**
 * Log analyzed token data to the analyzed log file
 * @param {Object} data - Token analysis data
 */
function logAnalyzed(data) {
  const { tokenCount, topTokens, duration } = data;

  // Format the analyzed token data
  const topTokensStr = topTokens.map((t, i) =>
    `${i+1}. ${t.symbol}: Score ${t.score.toFixed(2)}, Price $${t.priceUsd.toFixed(8)}, ` +
    `Change 1h ${t.priceChange.h1.toFixed(2)}%, 24h ${t.priceChange.h24.toFixed(2)}%`
  ).join('\n  ');

  const logEntry = `[${getESTTimestamp()}] Analysis Results\n` +
                  `  Found ${tokenCount} tokens after analysis\n` +
                  `  Duration: ${duration}ms\n` +
                  `  Top tokens:\n  ${topTokensStr}\n\n`;

  // Log to analyzed.log file
  fs.appendFileSync(path.join(logDir, 'analyzed.log'), logEntry);
}

/**
 * Log trade data to the trades log file
 * @param {Object} tradeDetails - Details of the trade
 */
function logTrade(tradeDetails) {
  const { action, symbol, price, amount, profitLoss, txSignature, reason } = tradeDetails;

  // Calculate PNL in USD and SOL if we have the necessary data
  let pnlUsd = 'N/A';
  let pnlSol = 'N/A';
  let pnlUsdValue = 0;

  if (action === 'SELL' && profitLoss !== undefined) {
    // Calculate the entry value (what we paid)
    const entryValue = amount * (price / (1 + profitLoss / 100));

    // Calculate the exit value (what we received)
    const exitValue = amount * price;

    // Calculate the PNL in USD
    pnlUsdValue = exitValue - entryValue;

    // Format with + sign for positive values and 2 decimal places
    pnlUsd = pnlUsdValue > 0 ? `+$${pnlUsdValue.toFixed(2)}` : `-$${Math.abs(pnlUsdValue).toFixed(2)}`;

    // Calculate SOL value based on current SOL price (approximately $150 per SOL)
    // Note: In a production environment, you would fetch the actual SOL price
    const solPrice = 150; // Approximate SOL price in USD
    const pnlSolValue = pnlUsdValue / solPrice;

    // Format SOL value with + sign for positive values and 6 decimal places (SOL has 9 decimals)
    pnlSol = pnlSolValue > 0 ? `+${pnlSolValue.toFixed(6)} SOL` : `-${Math.abs(pnlSolValue).toFixed(6)} SOL`;
  }

  // Format the trade data
  const logEntry = `[${getESTTimestamp()}] ${action.toUpperCase()} ${symbol}\n` +
                  `  Price: $${price}\n` +
                  `  Amount: ${amount}\n` +
                  `  Profit/Loss: ${profitLoss ? (profitLoss > 0 ? '+' : '') + profitLoss.toFixed(2) + '%' : 'N/A'} (${pnlUsd}) (${pnlSol})\n` +
                  `  Reason: ${reason || 'N/A'}\n` +
                  `  Transaction: ${txSignature || 'N/A'}\n\n`;

  // Log to trades.log file
  fs.appendFileSync(path.join(logDir, 'trades.log'), logEntry);

  // Return the calculated values for use in other functions
  return { pnlUsdValue, pnlSol };
}

/**
 * Log wallet performance data to the wallet log file
 * @param {Object} walletData - Wallet performance data
 */
function logWallet(walletData) {
  const { balance, positions, totalPnl, totalPnlUsd, totalPnlSol, timestamp } = walletData;

  // Format the wallet data
  const positionsStr = positions.length > 0
    ? positions.map(p => {
      // Calculate USD PNL if available
      let pnlUsd = 'N/A';
      let pnlSol = 'N/A';
      if (p.profitLoss !== undefined && p.amount && p.currentPrice) {
        const entryValue = p.amount * p.entryPrice;
        const currentValue = p.amount * p.currentPrice;
        const pnlUsdValue = currentValue - entryValue;
        pnlUsd = pnlUsdValue > 0 ? `+$${pnlUsdValue.toFixed(2)}` : `-$${Math.abs(pnlUsdValue).toFixed(2)}`;

        // Calculate SOL value based on current SOL price (approximately $150 per SOL)
        const solPrice = 150; // Approximate SOL price in USD
        const pnlSolValue = pnlUsdValue / solPrice;
        pnlSol = pnlSolValue > 0 ? `+${pnlSolValue.toFixed(6)} SOL` : `-${Math.abs(pnlSolValue).toFixed(6)} SOL`;
      }

      return `  ${p.symbol}: ${p.amount} tokens at $${p.entryPrice}, ` +
        `Current: $${p.currentPrice}, PnL: ${p.profitLoss > 0 ? '+' : ''}${p.profitLoss.toFixed(2)}% (${pnlUsd}) (${pnlSol})`;
    }).join('\n')
    : '  No open positions';

  // Format USD PNL if available
  const formattedUsdPnl = totalPnlUsd !== undefined && totalPnlUsd !== null
    ? ` (${totalPnlUsd > 0 ? '+' : '-'}$${Math.abs(totalPnlUsd).toFixed(2)})`
    : '';

  // Format SOL PNL if available
  const formattedSolPnl = totalPnlSol !== undefined && totalPnlSol !== null
    ? ` (${totalPnlSol > 0 ? '+' : '-'}${Math.abs(totalPnlSol).toFixed(6)} SOL)`
    : '';

  const logEntry = `[${timestamp || getESTTimestamp()}] Wallet Status\n` +
                  `  Balance: ${balance !== null ? balance + ' SOL' : 'N/A'}\n` +
                  `  Total PnL: ${totalPnl !== null ? (totalPnl > 0 ? '+' : '') + totalPnl.toFixed(2) + '%' : 'N/A'}${formattedUsdPnl}${formattedSolPnl}\n` +
                  `  Positions:\n${positionsStr}\n\n`;

  // Log to wallet.log file
  fs.appendFileSync(path.join(logDir, 'wallet.log'), logEntry);
}

/**
 * Log position monitoring data to the monitor log file
 * @param {Object} monitorData - Position monitoring data
 */
function logMonitor(monitorData) {
  const { position, action, reason, timestamp } = monitorData;

  if (!position) {
    return;
  }

  // Format the position data
  let logEntry = `[${timestamp || getESTTimestamp()}] Monitoring ${position.symbol}\n`;

  // Add position details
  logEntry += `  Current price: $${position.currentPrice}\n`;
  logEntry += `  Entry price: $${position.entryPrice}\n`;
  logEntry += `  P/L: ${position.profitLoss > 0 ? '+' : ''}${position.profitLoss.toFixed(2)}%\n`;

  // Add technical indicators if available
  if (position.rsi !== undefined) {
    logEntry += `  RSI: ${position.rsi.toFixed(2)}\n`;
  }

  if (position.holderChange !== undefined) {
    logEntry += `  Holder change: ${position.holderChange > 0 ? '+' : ''}${position.holderChange.toFixed(2)}%\n`;
  }

  // Add trailing stop information if available
  if (position.trailingStop) {
    logEntry += `  Trailing stop: $${position.trailingStop.price} (${position.trailingStop.type}, ` +
      `${position.trailingStop.distance > 0 ? '+' : ''}${position.trailingStop.distance.toFixed(2)}% away)\n`;
  }

  // Add action if any
  if (action) {
    logEntry += `  Action: ${action.toUpperCase()}\n`;
    logEntry += `  Reason: ${reason || 'N/A'}\n`;
  }

  logEntry += '\n';

  // Log to monitor.log file
  fs.appendFileSync(path.join(logDir, 'monitor.log'), logEntry);
}

/**
 * Get current timestamp in EST timezone
 * @returns {string} - Formatted timestamp in EST
 */
function getESTTimestamp() {
  const date = new Date();

  // Format options for EST timezone
  const options = {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };

  // Format the date in EST
  const estTime = date.toLocaleString('en-US', options);

  // Convert to ISO-like format: YYYY-MM-DD HH:MM:SS EST
  const [datePart, timePart] = estTime.split(', ');
  const [month, day, year] = datePart.split('/');

  return `${year}-${month}-${day} ${timePart} EST`;
}

/**
 * Format a console message with color and icon
 * @param {string} level - Log level
 * @param {string} message - Log message
 * @returns {string} - Formatted and colored log message
 */
function formatConsoleMessage(level, message) {
  const levelInfo = LOG_LEVELS[level];
  const timestamp = chalk.dim(getESTTimestamp());
  const levelText = levelInfo.color(`[${level}]`);
  const icon = levelInfo.icon;

  return `${timestamp} ${levelText} ${icon} ${message}`;
}

/**
 * Start a loading spinner with the given text
 * @param {string} text - Text to display with the spinner
 */
function startSpinner(text) {
  if (spinner) spinner.stop();
  spinner = createSpinner(text).start();
}

/**
 * Update the spinner text
 * @param {string} text - New text for the spinner
 */
function updateSpinner(text) {
  try {
    if (spinner) spinner.text = text;
  } catch (error) {
    console.log(text);
  }
}

/**
 * Stop the spinner with success message
 * @param {string} text - Success message
 */
function succeedSpinner(text) {
  try {
    if (spinner) spinner.succeed(text);
    spinner = null;
  } catch (error) {
    console.log(`✓ ${text}`);
  }
}

/**
 * Stop the spinner with failure message
 * @param {string} text - Failure message
 */
function failSpinner(text) {
  try {
    if (spinner) spinner.fail(text);
    spinner = null;
  } catch (error) {
    console.log(`✗ ${text}`);
  }
}

/**
 * Display a boxed message
 * @param {string} message - Message to display in box
 * @param {string} title - Optional title for the box
 * @param {string} type - Type of box (info, warning, error, success)
 */
function displayBox(message, title = '', type = 'info') {
  try {
    let boxColor = 'blue';
    let textColor = chalk.blue;

    switch (type) {
      case 'warning':
        boxColor = 'yellow';
        textColor = chalk.yellow;
        break;
      case 'error':
        boxColor = 'red';
        textColor = chalk.red;
        break;
      case 'success':
        boxColor = 'green';
        textColor = chalk.green;
        break;
    }

    const boxTitle = title ? `${textColor(title)}\n\n` : '';
    const boxedMessage = boxen(`${boxTitle}${message}`, {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: boxColor,
      align: 'center'
    });

    console.log(boxedMessage);
  } catch (error) {
    // Fallback if boxen fails
    const separator = '='.repeat(50);
    console.log(separator);
    if (title) console.log(`${title.toUpperCase()}:`);
    console.log(message);
    console.log(separator);
  }
}

/**
 * Display a figlet banner
 * @param {string} text - Text to display as banner
 * @param {string} color - Color for the banner
 */
function displayBanner(text, color = 'blue') {
  try {
    const colorFn = chalk[color] || chalk.blue;
    const banner = figlet.textSync(text, {
      font: 'Standard',
      horizontalLayout: 'default',
      verticalLayout: 'default'
    });

    console.log('\n' + colorFn(banner) + '\n');
  } catch (error) {
    // Fallback if figlet fails
    const separator = '*'.repeat(50);
    console.log(separator);
    console.log(`*${' '.repeat(Math.floor((48 - text.length) / 2))}${text.toUpperCase()}${' '.repeat(Math.ceil((48 - text.length) / 2))}*`);
    console.log(separator);
  }
}

/**
 * Log a debug message
 * @param {string} message - Message to log
 */
function debug(message) {
  if (CURRENT_LOG_LEVEL_VALUE <= LOG_LEVELS.DEBUG.value) {
    // Log to console
    console.log(formatConsoleMessage('DEBUG', message));

    // Log to detailed.log
    logDetailed(message);
  }
}

/**
 * Log an info message
 * @param {string} message - Message to log
 */
function info(message) {
  if (CURRENT_LOG_LEVEL_VALUE <= LOG_LEVELS.INFO.value) {
    // Log to console
    console.log(formatConsoleMessage('INFO', message));

    // Log to user.log for important info, but don't log to console again
    logUser(message, false);
  }
}

/**
 * Log a warning message
 * @param {string} message - Message to log
 */
function warn(message) {
  if (CURRENT_LOG_LEVEL_VALUE <= LOG_LEVELS.WARN.value) {
    // Log to console
    console.log(formatConsoleMessage('WARN', message));

    // Log to user.log for important warnings, but don't log to console again
    logUser(`WARNING: ${message}`, false);
  }
}

/**
 * Log an error message
 * @param {string} message - Message to log
 * @param {Error} [error] - Optional error object
 */
function error(message, error) {
  if (CURRENT_LOG_LEVEL_VALUE <= LOG_LEVELS.ERROR.value) {
    const errorDetails = error ? `\n${error.stack || error.message || error}` : '';

    // Log to console
    console.log(formatConsoleMessage('ERROR', message));
    if (errorDetails) {
      console.log(chalk.red(errorDetails));
    }

    // Log to errors.log
    const errorEntry = `[${getESTTimestamp()}] ERROR: ${message}${errorDetails}\n`;
    fs.appendFileSync(path.join(logDir, 'errors.log'), errorEntry);

    // Also log to user.log for important errors, but don't log to console again
    logUser(`ERROR: ${message}`, false);
  }
}

/**
 * Log a trade with enhanced formatting
 * @param {Object} tradeDetails - Details of the trade
 */
function trade(tradeDetails) {
  const { action, symbol, price, amount, profitLoss, txSignature, reason } = tradeDetails;

  // Calculate PNL in USD and SOL if we have the necessary data
  let pnlUsd = 'N/A';
  let pnlSol = 'N/A';
  let pnlUsdValue = 0;
  let pnlSolValue = 0;

  if (action === 'SELL' && profitLoss !== undefined) {
    // Calculate the entry value (what we paid)
    const entryValue = amount * (price / (1 + profitLoss / 100));

    // Calculate the exit value (what we received)
    const exitValue = amount * price;

    // Calculate the PNL in USD
    pnlUsdValue = exitValue - entryValue;

    // Format with + sign for positive values and 2 decimal places
    pnlUsd = pnlUsdValue > 0 ? `+$${pnlUsdValue.toFixed(2)}` : `-$${Math.abs(pnlUsdValue).toFixed(2)}`;

    // Calculate SOL value based on current SOL price (approximately $150 per SOL)
    // Note: In a production environment, you would fetch the actual SOL price
    const solPrice = 150; // Approximate SOL price in USD
    pnlSolValue = pnlUsdValue / solPrice;

    // Format SOL value with + sign for positive values and 6 decimal places (SOL has 9 decimals)
    pnlSol = pnlSolValue > 0 ? `+${pnlSolValue.toFixed(6)} SOL` : `-${Math.abs(pnlSolValue).toFixed(6)} SOL`;
  }

  // Create a table for trade details
  const table = new Table({
    chars: {
      'top': '═', 'top-mid': '╤', 'top-left': '╔', 'top-right': '╗',
      'bottom': '═', 'bottom-mid': '╧', 'bottom-left': '╚', 'bottom-right': '╝',
      'left': '║', 'left-mid': '╟', 'right': '║', 'right-mid': '╢',
      'mid': '─', 'mid-mid': '┼', 'middle': '│'
    },
    style: { head: ['cyan'], border: ['grey'] }
  });

  // Format profit/loss with color
  const plText = profitLoss
    ? (profitLoss > 0
        ? chalk.green(`+${profitLoss.toFixed(2)}%`)
        : chalk.red(`${profitLoss.toFixed(2)}%`))
    : chalk.grey('N/A');

  // Format USD profit/loss with color
  const plUsdText = action === 'SELL' && profitLoss !== undefined
    ? (pnlUsdValue > 0
        ? chalk.green(pnlUsd)
        : chalk.red(pnlUsd))
    : chalk.grey('N/A');

  // Format SOL profit/loss with color
  const plSolText = action === 'SELL' && profitLoss !== undefined
    ? (pnlSolValue > 0
        ? chalk.green(pnlSol)
        : chalk.red(pnlSol))
    : chalk.grey('N/A');

  // Action color based on buy/sell
  const actionColor = action.toUpperCase() === 'BUY' ? chalk.green : chalk.red;

  // Add rows to the table
  table.push(
    [{ content: actionColor(`${action.toUpperCase()} ${symbol}`), colSpan: 2, hAlign: 'center' }],
    ['Price', `$${price}`],
    ['Amount', amount],
    ['Profit/Loss %', plText],
    ['Profit/Loss $', plUsdText],
    ['Profit/Loss SOL', plSolText],
    ['Reason', reason || 'N/A'],
    ['Transaction', txSignature ? chalk.blue(txSignature) : chalk.grey('N/A')]
  );

  // Log to console with enhanced formatting
  console.log('\n' + formatConsoleMessage('TRADE', `${action.toUpperCase()} ${symbol} at $${price}`));
  console.log(table.toString());

  // Use our specialized logTrade function for file logging
  logTrade(tradeDetails);

  // Also log to user.log for important trade info
  logUser(`${action.toUpperCase()} ${symbol} at $${price} | ${profitLoss ? (profitLoss > 0 ? '+' : '') + profitLoss.toFixed(2) + '%' : 'N/A'} (${pnlUsd}) (${pnlSol})`);

  // Log to wallet log if it's a completed trade with P/L
  if (profitLoss) {
    logWallet({
      balance: null, // Will be updated elsewhere
      positions: [],
      totalPnl: profitLoss,
      totalPnlUsd: pnlUsdValue,
      totalPnlSol: pnlSolValue,
      timestamp: getESTTimestamp()
    });
  }
}

/**
 * Log analysis results with enhanced formatting
 * @param {Object} analysisDetails - Details of the analysis
 */
function analysis(analysisDetails) {
  const { tokenCount, topTokens, duration } = analysisDetails;

  // Create a table for top tokens
  const table = new Table({
    head: ['Rank', 'Symbol', 'Score', 'Price (USD)', '1h Change', '24h Change'],
    chars: {
      'top': '═', 'top-mid': '╤', 'top-left': '╔', 'top-right': '╗',
      'bottom': '═', 'bottom-mid': '╧', 'bottom-left': '╚', 'bottom-right': '╝',
      'left': '║', 'left-mid': '╟', 'right': '║', 'right-mid': '╢',
      'mid': '─', 'mid-mid': '┼', 'middle': '│'
    },
    style: { head: ['cyan'], border: ['grey'] }
  });

  // Add rows for each top token
  topTokens.forEach((token, index) => {
    const priceChange1h = token.priceChange.h1;
    const priceChange24h = token.priceChange.h24;

    // Color the price changes
    const change1hText = priceChange1h > 0
      ? chalk.green(`+${priceChange1h.toFixed(2)}%`)
      : chalk.red(`${priceChange1h.toFixed(2)}%`);

    const change24hText = priceChange24h > 0
      ? chalk.green(`+${priceChange24h.toFixed(2)}%`)
      : chalk.red(`${priceChange24h.toFixed(2)}%`);

    table.push([
      index + 1,
      chalk.bold(token.symbol),
      token.score.toFixed(2),
      `$${token.priceUsd.toFixed(8)}`,
      change1hText,
      change24hText
    ]);
  });

  // Log to console with enhanced formatting
  console.log('\n' + formatConsoleMessage('ANALYSIS', `Completed in ${duration}ms`));
  console.log(chalk.cyan(`Found ${tokenCount} tokens after analysis`));
  console.log(table.toString() + '\n');

  // Use our specialized logAnalyzed function for file logging
  logAnalyzed(analysisDetails);

  // Also log to user.log for important analysis info
  logUser(`Analysis completed in ${duration}ms. Found ${tokenCount} tokens, top: ${topTokens.map(t => t.symbol).join(', ')}`);
}

/**
 * Log a system message (startup, shutdown, etc.)
 * @param {string} message - System message to log
 */
function system(message) {
  // Log to console
  console.log(formatConsoleMessage('SYSTEM', message));

  // Also log to user.log for important system messages, but don't log to console again
  logUser(`SYSTEM: ${message}`, false);
}

/**
 * Log position monitoring information
 * @param {Object} position - Position data
 * @param {string} [action] - Optional action taken
 * @param {string} [reason] - Optional reason for action
 */
function monitor(position, action, reason) {
  // Log to monitor.log file only, not to console
  logMonitor({
    position,
    action,
    reason,
    timestamp: getESTTimestamp()
  });
}

/**
 * Log an info message and also log it to the user.log file
 * @param {string} message - Message to log
 */
function infoUser(message) {
  if (CURRENT_LOG_LEVEL_VALUE <= LOG_LEVELS.INFO.value) {
    // Log to console
    console.log(formatConsoleMessage('INFO', message));

    // Log to user.log for important info, but don't log to console again
    logUser(message, false);
  }
}

module.exports = {
  // Standard logging functions
  debug,
  info,
  warn,
  error,
  trade,
  analysis,
  system,
  monitor,
  infoUser, // Add the new function

  // Specialized logging functions
  logDetailed,
  logUser,
  logAnalyzed,
  logTrade,
  logWallet,
  logMonitor,

  // UI helpers
  startSpinner,
  updateSpinner,
  succeedSpinner,
  failSpinner,
  displayBox,
  displayBanner,
  clearLogFiles
};
