# Solana Memecoin Trading Bot Simulator

A simulation module for testing the Solana memecoin trading strategy with real token data and price updates, while simulating wallet interactions and trade executions.

## Overview

This simulator integrates with the existing trading bot codebase to:

1. Fetch real tokens using `TA.js` only when there are no open positions
2. Use real price updates from DexScreener for monitoring
3. Simulate wallet state, buy/sell actions, and position management
4. Log detailed trade results and statistics for strategy analysis

## Features

- **Real Data Integration**: Uses actual token data from `TA.js` and real-time price updates from DexScreener
- **Conditional Token Fetching**: Only fetches new tokens when all positions are closed
- **Wallet Simulation**: Tracks simulated SOL and token balances
- **Position Management**: Monitors positions with real-time data updates
- **Statistics Tracking**: Records trades, win rate, profit/loss, and hold times
- **Detailed Logging**: Maintains trade logs and simulation statistics

## Files

- `simulator.js`: Main simulation logic
- `utils.js`: Helper functions for logging and statistics
- `trades.log`: Detailed trade logs (generated during simulation)
- `simulation.log`: Overall simulation statistics (generated during simulation)

## Usage

Run the simulator with:

```bash
node simulation/simulator.js
```

The simulator will:
1. Start with 10 SOL in a simulated wallet
2. Fetch real tokens from `TA.js`
3. Execute trades based on the strategy in `trading.js`
4. Monitor positions with real price updates
5. Log results to `trades.log` and `simulation.log`

## Configuration

Key parameters can be adjusted in `simulator.js`:

- `BUY_AMOUNT_LAMPORTS`: Amount of SOL to use per trade (default: 0.2 SOL)
- `MAX_POSITIONS`: Maximum number of concurrent positions (default: 4)
- `PRICE_CHECK_INTERVAL`: How often to check prices (default: 30 seconds)
- `CHECK_INTERVAL`: How often to run the main simulation cycle (default: 1 minute)

## Integration

The simulator integrates with the existing codebase without modifying it:

- Imports `performTA`, `fetchOHLCV`, and `calculateIndicators` from `TA.js`
- Uses `DexScreenerService` for real-time price data
- Uses `getTokenHoldersHistorical` for holder data
- Implements the same trading logic as `trading.js`

## Logs

- `trades.log`: Detailed information about each trade
- `simulation.log`: Overall statistics for each simulation cycle
