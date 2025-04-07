# Solana Memecoin Trading Bot

A sophisticated trading bot designed for automated analysis and trading of Solana memecoins. The system leverages multiple data sources, advanced technical analysis, and optimized execution strategies to identify and capitalize on trading opportunities in the fast-paced Solana memecoin market.

## Features

- Advanced technical analysis with 15+ indicators
- Multi-source data aggregation (DexScreener, GeckoTerminal, Moralis)
- Automated trading with customizable entry/exit conditions
- Position management with trailing stops
- Detailed trade logging
- Risk management controls

## Setup

1. Clone the repository:
```
git clone https://github.com/AhShaikh4/PM.git
cd PM
```

2. Install dependencies:
```
npm install
```

3. Create a `.env` file with your Solana private key:
```
PRIVATE_KEY=your_private_key_here
NETWORK=mainnet-beta
```

4. Run the bot:
```
node TA.js
```

## Trading Strategy

The bot implements a momentum-driven strategy optimized for memecoins:

### Entry Conditions
- Score > 60/100
- Recent positive momentum (5m > 2%, 1h > 0%)
- MACD bullish (MACD > Signal, Histogram > 0)
- RSI < 70 (not overbought)
- Price above upper Bollinger Band OR Tenkan-sen > Kijun-sen
- Recent buy pressure (5m buy/sell ratio > 1.2)
- Positive holder growth

### Exit Conditions
- Profit target: 15%
- Stop loss: -7%
- Trailing stop: Price falls below highest price by 2.5 * ATR
- RSI > 80 (overbought)
- Price below Bollinger middle band
- Significant holder decrease (< -5%)

## Configuration

Key parameters can be adjusted in `trading.js`:

- `BUY_AMOUNT_LAMPORTS`: Amount of SOL to use per trade (default: 0.2 SOL)
- `MAX_POSITIONS`: Maximum number of concurrent positions (default: 1)
- `PRICE_CHECK_INTERVAL`: How often to check prices (default: 30 seconds)
- `SLIPPAGE_BPS`: Slippage tolerance in basis points (default: 100 = 1%)

## Files

- `TA.js`: Technical analysis engine
- `trading.js`: Trading logic implementation
- `wallet.js`: Wallet management
- `mode.js`: Trading/monitoring mode selection
- `src/services/`: API integrations (Jupiter, DexScreener, etc.)

## Logs

- `gecko_analysis.log`: Technical analysis results
- `trades.log`: Trade execution details

## Disclaimer

Trading cryptocurrencies involves significant risk. This bot is provided for educational purposes only. Use at your own risk.
