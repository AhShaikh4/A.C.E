const inquirer = require('inquirer');

// Constants
const MODES = {
    TRADING: 'trading',
    MONITORING: 'monitoring'
};

/**
 * Get mode selection from user
 * @param {number} balance - Current wallet balance
 * @param {number} minimumBalance - Minimum required balance for trading
 * @returns {Promise<string>} Selected mode
 */
async function selectMode(balance, minimumBalance) {
    // If balance is below minimum, force monitoring mode
    if (balance < minimumBalance) {
        console.log(`\nInsufficient balance (${balance} SOL) for trading mode.`);
        console.log(`Minimum required: ${minimumBalance} SOL`);
        console.log('Automatically switching to monitoring mode...\n');
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