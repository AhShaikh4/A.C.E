# Solana Memecoin Trading Bot - Simulation Guide

This document explains how to use the simulation functionality with the new architecture.

## Simulation Overview

The simulation module allows you to test the trading strategy without executing real trades. It uses:

1. Real token data from TA.js
2. Real price updates from DexScreener
3. Simulated wallet interactions and trade executions
4. The same buy/sell criteria as the real trading system

## Simulation Components

The simulation system consists of:

1. **simulator.js** - Core simulation engine
2. **utils.js** - Utility functions for the simulation
3. **simulation-runner.js** - Integration with the main architecture

## Running the Simulation

### Full Simulation

To run a full simulation that continues indefinitely:

```
node simulation-runner.js
```

This will:
1. Initialize the simulation environment
2. Fetch and analyze tokens using the real TA.js
3. Simulate trading based on the analysis
4. Monitor positions and simulate sells when criteria are met
5. Log all trades and statistics

### Quick Simulation Test

To run a quick simulation test (single cycle):

```
node simulation-runner.js --quick
```

This will:
1. Initialize the simulation environment
2. Run a single analysis and trading cycle
3. Log the results

## Simulation Logs

All simulation logs are stored in the `logs/simulation` directory:
- `trades.log` - Simulated trade details
- `stats.log` - Performance statistics
- `debug.log` - Detailed debugging information

## Customizing the Simulation

### Relaxed Criteria

The simulation can use more relaxed buy/sell criteria to generate more trades for testing:

1. Open `simulation/simulator.js`
2. Find the `simulationMeetsBuyCriteria` function
3. Set `useRelaxedCriteria = true` to enable relaxed criteria

### Simulation Parameters

You can adjust simulation parameters in `config.js`:

- `BUY_AMOUNT_SOL` - Amount of SOL to use per trade
- `MAX_POSITIONS` - Maximum number of concurrent positions
- `POSITION_CHECK_INTERVAL_SECONDS` - How often to check positions

## Integration with Main Architecture

The simulation is fully integrated with the new architecture:

1. It uses the same `performTA` function from TA.js
2. It imports the real buy/sell criteria from trading.js
3. It uses the same configuration from config.js
4. It uses the enhanced logging system

This ensures that the simulation accurately reflects how the real trading system would behave.

## Programmatic Usage

You can import the simulation-runner.js module to control the simulation programmatically:

```javascript
const simulator = require('./simulation-runner');

// Run a quick simulation test
simulator.runQuickSimulation().then(result => {
  console.log('Simulation test completed');
});
```

## Disclaimer

The simulation provides a realistic approximation of how the trading system would perform, but it cannot account for all real-world factors such as:

1. Slippage and price impact
2. Transaction failures
3. Network congestion
4. Market manipulation

Always test thoroughly with small amounts before deploying the real trading system.
