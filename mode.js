//mode.js

const inquirer = require('inquirer');
const logger = require('./logger');

// Constants
const MODES = {
    TRADING: 'trading',
    MONITORING: 'monitoring'
};

/**
 * Get mode selection from user
 * @param {number} balance - Current wallet balance
 * @param {number} minimumBalance - Minimum required balance for transactions
 * @param {number} buyAmount - Amount of SOL used for each trade
 * @returns {Promise<string>} Selected mode
 */
async function selectMode(balance, minimumBalance, buyAmount) {
    // If balance is below minimum for transactions, force monitoring mode
    if (balance < minimumBalance) {
        logger.warn(`\nInsufficient balance (${balance} SOL) for any operations.`);
        logger.warn(`Minimum required for transactions: ${minimumBalance} SOL`);
        logger.info('Automatically switching to monitoring mode...\n');
        return MODES.MONITORING;
    }

    // If balance is below buy amount, disable trading mode
    if (balance < buyAmount) {
        logger.warn(`\nInsufficient balance (${balance} SOL) for trading mode.`);
        logger.warn(`Minimum required for trading: ${buyAmount} SOL`);
        logger.info('Automatically switching to monitoring mode...\n');
        return MODES.MONITORING;
    }

    // Always ask user for mode selection
    const { mode } = await inquirer.prompt([
        {
            type: 'list',
            name: 'mode',
            message: 'Select operating mode:',
            choices: [
                {
                    name: 'Trading Mode (Buy & Sell tokens automatically)',
                    value: MODES.TRADING
                },
                {
                    name: 'Monitoring Mode (Watch market without trading)',
                    value: MODES.MONITORING
                }
            ]
        }
    ]);

    return mode;
}

module.exports = {
    MODES,
    selectMode
};