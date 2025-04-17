//wallet.js

require('dotenv').config();
const { Connection, PublicKey, Keypair, clusterApiUrl } = require('@solana/web3.js');
const bs58 = require('bs58');
const { selectMode, MODES } = require('./mode');
const logger = require('./logger');

// Constants
const MINIMUM_SOL_BALANCE = 0.001; // Minimum SOL needed for transactions
const NETWORKS = ['mainnet-beta', 'devnet', 'testnet'];
const DEFAULT_NETWORK = 'mainnet-beta';

/**
 * Validates and initializes Solana connection
 * @returns {Connection}
 */
function initializeConnection() {
    // Validate network setting
    const network = process.env.NETWORK || DEFAULT_NETWORK;
    if (!NETWORKS.includes(network)) {
        throw new Error(`Invalid network specified. Must be one of: ${NETWORKS.join(', ')}`);
    }

    try {
        logger.info(`Connecting to Solana ${network}...`);
        const connection = new Connection(clusterApiUrl(network), 'confirmed');
        logger.info(`✓ Successfully connected to Solana ${network}`);
        return connection;
    } catch (error) {
        throw new Error(`Failed to establish Solana connection: ${error.message}`);
    }
}

/**
 * Initialize wallet from private key with enhanced validation
 * @returns {Keypair}
 */
function initializeWallet() {
    // Check if .env file is loaded
    if (!process.env.PRIVATE_KEY && !process.env.NETWORK) {
        throw new Error('Environment variables not loaded. Make sure .env file exists and is properly configured.');
    }

    // Validate private key existence
    if (!process.env.PRIVATE_KEY) {
        throw new Error('PRIVATE_KEY not found in .env file. Please add your private key to continue.');
    }

    try {
        // Validate private key format
        if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(process.env.PRIVATE_KEY)) {
            throw new Error('Invalid private key format. Must be a valid base58 string.');
        }

        // Decode base58 private key
        const privateKey = bs58.default.decode(process.env.PRIVATE_KEY);

        // Validate private key length
        if (privateKey.length !== 64) {
            throw new Error(`Invalid private key length. Expected 64 bytes but got ${privateKey.length}`);
        }

        const wallet = Keypair.fromSecretKey(privateKey);
        logger.info('Wallet initialized successfully');
        return wallet;
    } catch (error) {
        if (error.message.includes('base58')) {
            throw new Error('Failed to decode private key. Please ensure it is a valid base58 string.');
        }
        throw new Error(`Wallet initialization failed: ${error.message}`);
    }
}

/**
 * Check wallet balance with enhanced validation
 * @param {Keypair} wallet - Solana wallet keypair
 * @returns {Promise<{publicKey: string, balance: number, hasMinimumBalance: boolean}>}
 */
async function checkWalletBalance(wallet) {
    // Validate wallet parameter
    if (!wallet || !(wallet instanceof Keypair)) {
        throw new Error('Invalid wallet provided. Must be a valid Solana Keypair.');
    }

    try {
        // Initialize connection for each balance check
        const connection = initializeConnection();

        // Verify connection is responsive
        try {
            await connection.getRecentBlockhash();
        } catch (error) {
            throw new Error('Failed to connect to Solana network. Please check your internet connection.');
        }

        // Get balance with retries
        let balance;
        let retries = 3;
        while (retries > 0) {
            try {
                balance = await connection.getBalance(wallet.publicKey);
                break;
            } catch (error) {
                retries--;
                if (retries === 0) throw error;
                logger.warn(`Retry ${3-retries}/3: Failed to fetch balance, retrying...`);
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second between retries
            }
        }

        const solBalance = (balance / 1000000000).toFixed(8);
        const hasMinimumBalance = parseFloat(solBalance) >= MINIMUM_SOL_BALANCE;

        logger.info('Wallet public key: ' + wallet.publicKey.toString());
        logger.info('Wallet balance: ' + solBalance + ' SOL');

        if (!hasMinimumBalance) {
            logger.warn(`Warning: Wallet balance (${solBalance} SOL) is below minimum recommended balance (${MINIMUM_SOL_BALANCE} SOL)`);
        }

        return {
            publicKey: wallet.publicKey.toString(),
            balance: parseFloat(solBalance),
            hasMinimumBalance
        };
    } catch (error) {
        throw new Error(`Failed to check wallet balance: ${error.message}`);
    }
}

/**
 * Initialize bot mode based on wallet balance
 * @param {number} balance Current wallet balance
 * @returns {Promise<string>} Selected mode
 */
async function initializeMode(balance) {
    // Get the buy amount from config
    const { BOT_CONFIG } = require('./config');
    const buyAmount = BOT_CONFIG.BUY_AMOUNT_SOL;

    return await selectMode(balance, MINIMUM_SOL_BALANCE, buyAmount);
}

async function main() {
    try {
        logger.info('Initializing trading bot...');

        // Initialize wallet
        const wallet = initializeWallet();
        if (!wallet) {
            throw new Error('Wallet initialization failed');
        }

        // Check wallet balance
        const walletInfo = await checkWalletBalance(wallet);
        const { BOT_CONFIG } = require('./config');
        const buyAmount = BOT_CONFIG.BUY_AMOUNT_SOL;

        logger.info('\nWallet Status:');
        logger.info('-------------');
        logger.info(`Public Key: ${walletInfo.publicKey}`);
        logger.info(`Balance: ${walletInfo.balance} SOL`);
        logger.info(`Minimum Balance Check: ${walletInfo.hasMinimumBalance ? 'PASSED' : 'FAILED'}`);
        logger.info(`Trading Balance Check: ${walletInfo.balance >= buyAmount ? 'PASSED' : 'FAILED'} (min: ${buyAmount} SOL)`);

        // Initialize bot mode
        const mode = await initializeMode(walletInfo.balance);
        logger.info(`\nBot Mode: ${mode.toUpperCase()}`);

        if (mode === 'monitoring') {
            logger.info('\nMonitoring mode active - Will watch market without trading');
        } else {
            logger.info('\nTrading mode active - Will execute trades automatically');
        }

    } catch (error) {
        logger.error('\nError Details:');
        logger.error('-------------');
        logger.error(error.message);
        logger.error('\nPlease fix the above error and try again.');
        process.exit(1);
    }
}

// Export functions for use in other parts of the application
module.exports = {
    initializeConnection,
    initializeWallet,
    checkWalletBalance,
    initializeMode,
    main,
    MINIMUM_SOL_BALANCE
};

// Run the main function if this file is run directly
if (require.main === module) {
    main();
}