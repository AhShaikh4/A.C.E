# Solana Memecoin Trading Bot - Live Trading Guide

This document explains how to use the new live trading functionality with the main.js orchestrator.

## New Architecture

The trading bot has been restructured to follow the single responsibility principle:

1. **main.js** - Main orchestrator that coordinates all components
2. **TA.js** - Technical analysis engine (no longer executes trades)
3. **trading.js** - Trading logic and execution
4. **wallet.js** - Wallet management
5. **config.js** - Centralized configuration
6. **logger.js** - Enhanced logging system

## Configuration

All configuration parameters are now centralized in `config.js`. You can adjust:

- Analysis interval
- Trading parameters (buy amount, slippage, etc.)
- Entry/exit criteria
- Technical indicator settings

## Running the Bot

### Prerequisites

1. Make sure you have a `.env` file with:
   ```
   PRIVATE_KEY=your_solana_private_key
   NETWORK=mainnet-beta
   MORALIS_API_KEY=your_moralis_api_key
   ```

2. Install dependencies:
   ```
   npm install
   ```

### Starting Live Trading

To start the bot in live trading mode:

```
node main.js
```

The bot will:
1. Initialize all services
2. Prompt you to select trading or monitoring mode
3. Run an initial analysis cycle
4. Set up recurring analysis at the configured interval
5. Execute trades if in trading mode and conditions are met

### Monitoring Mode

If you want to run the bot without executing trades:

1. Select "Monitoring Mode" when prompted
2. The bot will analyze tokens but not execute trades
3. Potential trades will be logged to `logs/analysis.log`

### Logs

All logs are now stored in the `logs` directory:
- `info.log` - General information
- `error.log` - Errors and warnings
- `trades.log` - Trade execution details
- `analysis.log` - Analysis results

## Advanced Usage

### Programmatic Control

You can import the main.js module to control the bot programmatically:

```javascript
const bot = require('./main');

// Start the bot
bot.startBot().then(result => {
  console.log('Bot started:', result);
});

// Get current status
const status = bot.getBotStatus();
console.log('Bot status:', status);

// Stop the bot
bot.stopBot().then(result => {
  console.log('Bot stopped:', result);
});
```

### Customizing Trading Strategy

To modify the trading strategy:

1. Edit `config.js` to adjust buy/sell criteria
2. Modify `trading.js` functions `meetsBuyCriteria()` and `meetsSellCriteria()`

## Troubleshooting

### Common Issues

1. **Insufficient Balance**
   - Ensure your wallet has enough SOL for trading and gas fees
   - Minimum required: 0.001 SOL + trading amount

2. **API Rate Limits**
   - The bot implements rate limiting, but external APIs may still throttle requests
   - Check error logs for rate limit issues

3. **Network Connectivity**
   - Ensure stable internet connection
   - The bot will retry failed API calls but persistent network issues will cause failures

### Debugging

Set `LOG_LEVEL=debug` in your `.env` file for more detailed logging.

## Safety Features

The bot includes several safety features:

1. Wallet balance validation
2. Trading can be disabled via config
3. Graceful shutdown handling
4. Open position tracking
5. Error recovery mechanisms

## Disclaimer

Trading cryptocurrencies involves significant risk. This bot is provided for educational purposes only. Use at your own risk.
