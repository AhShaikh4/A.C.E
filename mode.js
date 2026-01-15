//mode.js

const inquirer = require('inquirer');
const logger = require('./logger');
const { BOT_CONFIG } = require('./config');

// Constants
const MODES = {
    TRADING: 'trading',
    MONITORING: 'monitoring',
    PAPER: 'paper'
};

/**
 * Get mode selection from user
 * @param {number} balance - Current wallet balance
 * @param {number} minimumBalance - Minimum required balance for transactions
 * @param {number} buyAmount - Amount of SOL used for each trade
 * @returns {Promise<string>} Selected mode
 */
async function selectMode(balance, minimumBalance, buyAmount, options = {}) {
    const paperEnabled = options.paperEnabled ?? BOT_CONFIG.PAPER_TRADING_ENABLED;

    const tradingDisabledReason = balance < minimumBalance
        ? `Insufficient balance (${balance} SOL). Minimum for transactions: ${minimumBalance} SOL`
        : balance < buyAmount
            ? `Insufficient balance (${balance} SOL). Minimum for trading: ${buyAmount} SOL`
            : null;

    const choices = [
        {
            name: 'Trading Mode (Buy & Sell tokens automatically)',
            value: MODES.TRADING,
            disabled: tradingDisabledReason || false
        },
        {
            name: 'Monitoring Mode (Watch market without trading)',
            value: MODES.MONITORING
        }
    ];

    if (paperEnabled) {
        choices.unshift({
            name: 'Paper Trading Mode (Simulated funds, real market data)',
            value: MODES.PAPER
        });
    }

    const { mode } = await inquirer.prompt([
        {
            type: 'list',
            name: 'mode',
            message: 'Select operating mode:',
            choices
        }
    ]);

    return mode;
}

module.exports = {
    MODES,
    selectMode
};