# A.C.E. (Augmented Coin Engine)

![A.C.E. Logo](logo.png)

## Overview

A.C.E. is a sophisticated trading bot designed for automated analysis and trading of Solana memecoins. The system leverages multiple data sources, advanced technical analysis, and optimized execution strategies to identify and capitalize on trading opportunities in the fast-paced Solana memecoin market.

PS: Augment AI was used to create this bot. 

## Key Features

- **Advanced Token Discovery** - Multi-source identification and sophisticated filtering
- **Technical Analysis Engine** - Comprehensive indicator suite with multi-timeframe analysis
- **Trading Execution** - Jupiter Ultra API integration with advanced order types
- **Risk Management** - Position monitoring and profit protection mechanisms
- **User Experience** - Interactive CLI interface with comprehensive logging
- **Performance Optimization** - Efficient API usage and robust error handling
- **Security Features** - Wallet protection and trade safety measures
- **Simulation Capabilities** - Virtual trading environment for strategy testing

For a detailed breakdown of all features, see [features.md](features.md).

## Getting Started

### Prerequisites

- Node.js (v16+)
- npm or yarn
- Solana wallet with private key
- API keys for various services (Moralis, etc.)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/AhShaikh4/A.C.E.git
   cd A.C.E
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   - Create a .env file locally and add the necessary variables. See [env-variables.md](env-variables.md) for a detailed guide. Also never

**Important:** Never share your private keys or `.env` file.


### Usage

#### Trading Mode

Run the bot in trading mode to automatically analyze the market and execute trades:

```bash
node main.js
```

When prompted, select "Trading Mode" to enable automated buying and selling.

#### Monitoring Mode

Run the bot in monitoring mode to analyze the market without executing trades:

```bash
node main.js
```

When prompted, select "Monitoring Mode" to disable trading and only observe the market.

#### Simulation Mode

Test strategies without using real funds:

```bash
node simulation-runner.js
```

For more information on simulation capabilities, see [simulation/README.md](simulation/README.md).

## Project Structure

```
A.C.E/
├── data/                  # Data storage directory
├── simulation/            # Simulation framework
├── src/                   # Source code
│   └── services/          # API service integrations
├── .env                   # Environment variables (create from .env.example)
├── blacklist.js           # Token blacklist management
├── config.js              # Configuration settings
├── logger.js              # Logging system
├── main.js                # Main application entry point
├── mode.js                # Trading/monitoring mode selection
├── TA.js                  # Technical analysis engine
├── trading.js             # Trading execution logic
└── wallet.js              # Wallet connection and management
```

## Documentation

- [features.md](features.md) - Detailed feature documentation
- [todo.md](todo.md) - Project roadmap and task tracking
- [env-variables.md](env-variables.md) - Environment variable configuration
- [simulation/README.md](simulation/README.md) - Simulation mode documentation

## Trading Strategies

A.C.E. implements sophisticated trading strategies including:

- **Tiered Profit-Taking** - Automatically sells portions of a position at predetermined profit levels:
  - First tier: Sell 30% of position at 15% profit
  - Second tier: Sell 30% of remaining position at 40% profit
  - Final tier: Hold remaining 40% with trailing stop for potential larger gains

- **Dynamic Trailing Stops** - Stop distance adjusts based on profit level and market volatility:
  - 0-15% profit: 3.0 × ATR distance
  - 15-40% profit: 2.0 × ATR distance
  - 40-100% profit: 1.5 × ATR distance
  - >100% profit: 1.0 × ATR distance

## Development Roadmap

Current development is focused on:

1. **SOL Price Improvements** - Dynamic SOL price updates for accurate calculations
2. **Bug Fixes** - Resolving edge cases in transaction handling
3. **Advanced Trading Strategies** - Implementing additional strategy options

For a complete list of planned features and improvements, see [todo.md](todo.md).

## Security

A.C.E. implements several security measures:

- Private keys are stored in environment variables, never in code
- Balance verification before transactions
- Slippage protection to prevent unexpected execution prices
- Transaction validation before signing



## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.


## Acknowledgments

- [Augment AI](https://www.augmentcode.com/) - Agentic AI assistant that helped code this entire bot with its amazing context understanding and coding capabilities
- [Jupiter](https://jup.ag/) - Solana's liquidity aggregator
- [DexScreener](https://dexscreener.com/) - DEX market data
- [GeckoTerminal](https://geckoterminal.com/) - Market data and analytics
- [Moralis](https://moralis.io/) - Blockchain data provider

---

*A.C.E. is continuously evolving with new features and improvements.*
