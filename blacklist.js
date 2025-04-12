// blacklist.js - Token blacklist management for the Solana Memecoin Trading Bot

const fs = require('fs').promises;
const path = require('path');
const { BOT_CONFIG } = require('./config');

// In-memory cache of blacklisted tokens
let blacklistedTokens = [];

/**
 * Initialize the blacklist by loading from the blacklist file
 * Creates the file if it doesn't exist
 */
async function initializeBlacklist() {
  try {
    // Ensure the directory exists
    const dir = path.dirname(BOT_CONFIG.BLACKLIST_FILE);
    await fs.mkdir(dir, { recursive: true });

    // Try to read the blacklist file
    try {
      const data = await fs.readFile(BOT_CONFIG.BLACKLIST_FILE, 'utf8');
      const blacklist = JSON.parse(data);
      blacklistedTokens = blacklist.blacklistedTokens || [];
      console.log(`Loaded ${blacklistedTokens.length} tokens from blacklist`);
    } catch (error) {
      // If file doesn't exist or is invalid, create a new one
      if (error.code === 'ENOENT' || error instanceof SyntaxError) {
        blacklistedTokens = [];
        await saveBlacklist();
        console.log('Created new blacklist file');
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error(`Error initializing blacklist: ${error.message}`);
    // Fall back to empty blacklist
    blacklistedTokens = [];
  }
}

/**
 * Save the current blacklist to the blacklist file
 */
async function saveBlacklist() {
  try {
    const blacklist = {
      blacklistedTokens
    };
    await fs.writeFile(BOT_CONFIG.BLACKLIST_FILE, JSON.stringify(blacklist, null, 2));
  } catch (error) {
    console.error(`Error saving blacklist: ${error.message}`);
  }
}

/**
 * Check if a token is blacklisted
 * @param {string} tokenAddress - The token address to check
 * @returns {boolean} - True if the token is blacklisted
 */
function isBlacklisted(tokenAddress) {
  if (!BOT_CONFIG.BLACKLIST_ENABLED) {
    return false;
  }
  return blacklistedTokens.includes(tokenAddress);
}

/**
 * Add a token to the blacklist
 * @param {string} tokenAddress - The token address to blacklist
 * @param {string} symbol - The token symbol (for logging)
 * @returns {boolean} - True if the token was added
 */
async function addToBlacklist(tokenAddress, symbol = 'Unknown') {
  if (blacklistedTokens.includes(tokenAddress)) {
    console.log(`Token ${symbol} (${tokenAddress}) is already blacklisted`);
    return false;
  }

  blacklistedTokens.push(tokenAddress);
  await saveBlacklist();
  console.log(`Added ${symbol} (${tokenAddress}) to blacklist`);
  return true;
}

/**
 * Remove a token from the blacklist
 * @param {string} tokenAddress - The token address to remove
 * @returns {boolean} - True if the token was removed
 */
async function removeFromBlacklist(tokenAddress) {
  const initialLength = blacklistedTokens.length;
  blacklistedTokens = blacklistedTokens.filter(addr => addr !== tokenAddress);
  
  if (blacklistedTokens.length < initialLength) {
    await saveBlacklist();
    console.log(`Removed ${tokenAddress} from blacklist`);
    return true;
  }
  
  console.log(`Token ${tokenAddress} was not in the blacklist`);
  return false;
}

/**
 * Get the current blacklist
 * @returns {Array} - The current blacklist
 */
function getBlacklist() {
  return [...blacklistedTokens];
}

module.exports = {
  initializeBlacklist,
  isBlacklisted,
  addToBlacklist,
  removeFromBlacklist,
  getBlacklist
};
