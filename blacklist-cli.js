// blacklist-cli.js - Command-line utility to manage the token blacklist

const fs = require('fs').promises;
const path = require('path');
const { BOT_CONFIG } = require('./config');
const { initializeBlacklist, addToBlacklist, removeFromBlacklist, getBlacklist } = require('./blacklist');

// Parse command-line arguments
const args = process.argv.slice(2);
const command = args[0]?.toLowerCase();
const tokenAddress = args[1];
const tokenSymbol = args[2] || 'Unknown';

async function main() {
  try {
    // Initialize blacklist
    await initializeBlacklist();

    // Process command
    switch (command) {
      case 'add':
        if (!tokenAddress) {
          console.error('Error: Token address is required');
          showUsage();
          process.exit(1);
        }
        await addToBlacklist(tokenAddress, tokenSymbol);
        console.log(`Added ${tokenSymbol} (${tokenAddress}) to blacklist`);
        break;

      case 'remove':
        if (!tokenAddress) {
          console.error('Error: Token address is required');
          showUsage();
          process.exit(1);
        }
        const removed = await removeFromBlacklist(tokenAddress);
        if (removed) {
          console.log(`Removed ${tokenAddress} from blacklist`);
        } else {
          console.log(`Token ${tokenAddress} was not in the blacklist`);
        }
        break;

      case 'list':
        const blacklist = getBlacklist();
        console.log('\nBlacklisted Tokens:');
        console.log('-------------------');
        if (blacklist.length === 0) {
          console.log('No tokens in blacklist');
        } else {
          blacklist.forEach((address, index) => {
            console.log(`${index + 1}. ${address}`);
          });
        }
        console.log(`\nTotal: ${blacklist.length} tokens`);
        break;

      default:
        showUsage();
        break;
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

function showUsage() {
  console.log('\nToken Blacklist Manager');
  console.log('---------------------');
  console.log('Usage:');
  console.log('  node blacklist-cli.js add <token-address> [token-symbol]');
  console.log('  node blacklist-cli.js remove <token-address>');
  console.log('  node blacklist-cli.js list');
  console.log('\nExamples:');
  console.log('  node blacklist-cli.js add 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU SAMO');
  console.log('  node blacklist-cli.js remove 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
  console.log('  node blacklist-cli.js list');
}

// Run the main function
main().catch(error => {
  console.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
