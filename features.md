# A.C.E. (Augmented Coin Engine)

## Overview

A.C.E. is a sophisticated trading bot designed for automated analysis and trading of Solana memecoins. The system leverages multiple data sources, advanced technical analysis, and optimized execution strategies to identify and capitalize on trading opportunities in the fast-paced Solana memecoin market.

## Features at a Glance

1. **Advanced Token Discovery** - Multi-source identification and sophisticated filtering
2. **Technical Analysis Engine** - Comprehensive indicator suite with multi-timeframe analysis
3. **Trading Execution** - Jupiter Ultra API integration with advanced order types
4. **Risk Management** - Position monitoring and profit protection mechanisms
5. **User Experience** - Interactive CLI interface with comprehensive logging
6. **Performance Optimization** - Efficient API usage and robust error handling
7. **Security Features** - Wallet protection and trade safety measures
8. **Simulation Capabilities** - Virtual trading environment for strategy testing

## Detailed Feature Breakdown

### 1. Advanced Token Discovery

#### Multi-Source Token Identification

A.C.E. employs a multi-layered approach to discover promising memecoin opportunities:

- **DexScreener Integration**: The system connects to DexScreener's API to identify "boosted" tokens that are receiving increased attention. These tokens often represent emerging opportunities with significant momentum.
  - Implementation: The `dexscreener.js` service fetches boosted tokens and applies initial filtering based on volume, liquidity, and transaction patterns.
  - Filtering criteria: Minimum 24h volume of $10,000, minimum liquidity of $5,000, and positive price action in the last hour.

- **GeckoTerminal Integration**: Simultaneously, the system queries GeckoTerminal's API to identify trending pools across multiple Solana DEXes.
  - Implementation: The `gecko.js` service fetches trending pools and new listings, with special attention to tokens less than 7 days old.
  - Data enrichment: For each identified token, comprehensive OHLCV (Open, High, Low, Close, Volume) data is fetched across multiple timeframes.

- **New Listing Detection**: The system specifically targets newly listed tokens, applying age-based filtering to focus on opportunities in their early growth phase.
  - Implementation: Tokens are categorized by age (0-24h, 1-3 days, 3-7 days) with different scoring weights applied to each category.
  - Early detection advantage: By identifying tokens within hours of listing, the system can enter positions before major price movements occur.

- **Blacklist System**: A comprehensive blacklist prevents trading on known scam tokens, honeypots, or tokens with malicious contract behavior.
  - Implementation: The blacklist is stored in a persistent file (`blacklist.txt`) and automatically loaded at startup.
  - Dynamic updates: Tokens that exhibit suspicious behavior during analysis are automatically added to the blacklist.

#### Sophisticated Filtering Process

Raw token data undergoes a multi-tiered filtering process to identify the most promising opportunities:

- **Tiered Filtering Approach**: Rather than applying all filters at once, A.C.E. uses a progressive filtering system that efficiently narrows down the token pool.
  - Stage 1: Basic filtering (age, volume, liquidity)
  - Stage 2: Transaction pattern analysis (buy/sell ratio, whale transactions)
  - Stage 3: Technical indicator calculation and scoring
  - Stage 4: Final ranking and selection

- **Liquidity and Volume Thresholds**: Minimum requirements ensure that selected tokens have sufficient trading activity and liquidity for entry and exit.
  - Liquidity requirements: Minimum $5,000 in liquidity to ensure positions can be exited
  - Volume requirements: Minimum $10,000 in 24h volume to ensure active trading
  - Slippage estimation: Pre-trade analysis of potential slippage based on liquidity depth

- **Transaction Pattern Analysis**: The system analyzes recent transaction patterns to identify healthy trading activity.
  - Buy/sell ratio analysis: Preference for tokens with buy/sell ratios > 1.0
  - Whale transaction filtering: Detection and filtering of manipulation patterns
  - Transaction velocity: Analysis of transaction frequency and size distribution

- **Honeypot Detection**: Sophisticated mechanisms identify potential honeypot tokens that allow buys but restrict sells.
  - Contract analysis: Identification of suspicious contract patterns
  - Transaction history analysis: Detection of one-way transaction patterns
  - Blacklist integration: Automatic blacklisting of detected honeypots

### 2. Technical Analysis Engine

#### Comprehensive Indicator Suite

A.C.E. calculates and analyzes over 20 technical indicators across multiple timeframes to generate trading signals:

- **Moving Averages**: Multiple types of moving averages provide trend direction and potential support/resistance levels.
  - Simple Moving Average (SMA): Used for basic trend identification
  - Exponential Moving Average (EMA): Gives more weight to recent price action
  - Double Exponential Moving Average (DEMA): Reduces lag in trending markets
  - Triple Exponential Moving Average (TEMA): Further reduces lag for faster signals
  - Volume Weighted Moving Average (VWMA): Incorporates volume for stronger signals
  - Implementation: Each MA type is calculated across 5m, 1h, and 24h timeframes with periods of 7, 14, 25, 50, and 200

- **Momentum Indicators**: These indicators measure the rate of price change to identify overbought/oversold conditions and potential reversals.
  - MACD (Moving Average Convergence Divergence): Signal line crossovers, histogram analysis
  - RSI (Relative Strength Index): Overbought/oversold conditions, divergence detection
  - Stochastic Oscillator: Momentum and trend reversal signals
  - Awesome Oscillator: Zero-line crossovers and twin peaks patterns
  - Money Flow Index: Volume-weighted RSI for stronger signals
  - Implementation: Customized settings for memecoin volatility, with RSI thresholds at 30/70 instead of traditional 30/70

- **Volatility Indicators**: These measure market volatility to adjust position sizing and stop-loss levels.
  - Bollinger Bands: Dynamic support/resistance based on volatility
  - Average True Range (ATR): Volatility measurement for stop-loss placement
  - Keltner Channels: Alternative volatility-based channels
  - Standard Deviation: Raw volatility measurement
  - Implementation: ATR is particularly important for the dynamic trailing stop system

- **Volume Indicators**: Volume analysis provides confirmation of price movements and potential reversals.
  - On-Balance Volume (OBV): Cumulative indicator of volume flow
  - Money Flow Index (MFI): Volume-weighted RSI
  - Chaikin Money Flow (CMF): Measures buying and selling pressure
  - Volume Price Trend (VPT): Relates volume to price changes
  - Implementation: Volume spike detection for entry/exit signals

- **Trend Indicators**: These identify the current market trend and potential reversal points.
  - Parabolic SAR: Trend direction and potential stop/reverse points
  - Vortex Indicator: Trend strength and direction
  - Percentage Price Oscillator (PPO): Similar to MACD but in percentage terms
  - Ichimoku Cloud (Ichimoku Kinko Hyo): Complete trading system with support/resistance, trend direction, and momentum
  - Implementation: Customized settings for the high-volatility memecoin market

#### Multi-Timeframe Analysis

A.C.E. analyzes price action across multiple timeframes to generate more reliable signals:

- **Timeframe Integration**: Data from 5-minute, 1-hour, and 24-hour charts is analyzed and combined.
  - 5-minute charts: Short-term momentum and immediate entry/exit signals
  - 1-hour charts: Medium-term trend confirmation and primary decision making
  - 24-hour charts: Long-term trend context and overall market direction
  - Implementation: Weighted scoring system that prioritizes 1h signals with context from 5m and 24h

- **Weighted Scoring System**: Different weights are assigned to timeframes and indicators based on their reliability.
  - Recent momentum: Higher weight to recent price action (last 1-3 hours)
  - Volume confirmation: Higher scores for signals confirmed by volume
  - Trend alignment: Higher scores when multiple timeframes show the same signal
  - Implementation: Proprietary scoring algorithm that combines over 50 data points into a single 0-100 score

- **Combined Signal Generation**: Signals from different indicators and timeframes are combined to generate buy/sell decisions.
  - Signal confirmation: Multiple indicators must align for highest confidence
  - Contradiction resolution: Logic to resolve conflicting signals
  - Threshold-based decisions: Minimum score requirements for trade execution
  - Implementation: Final score must exceed 80/100 for buy signals and specific thresholds for different sell signals

### 3. Trading Execution

#### Jupiter Ultra API Integration

A.C.E. leverages Jupiter's Ultra API for fast, efficient, and MEV-protected trading execution:

- **Two-Step Process**: The Ultra API uses a two-step process for creating and executing orders.
  - Step 1: `createOrder()` - Generates a transaction and requestId
  - Step 2: `executeOrder()` - Signs and submits the transaction with the requestId
  - Implementation: This approach allows for better transaction handling and MEV protection

- **Base64 Encoding**: Proper transaction serialization using base64 encoding.
  - Implementation: `Buffer.from(transaction.serialize()).toString('base64')` for proper encoding
  - Error handling: Robust error handling for encoding/decoding issues

- **MEV Protection**: Protection against Maximal Extractable Value attacks that can front-run trades.
  - Implementation: Jupiter's Ultra API includes built-in MEV protection
  - Benefit: Better execution prices and protection against sandwich attacks

- **Performance Optimization**: The Ultra API provides significant performance improvements compared to the Swap API.
  - Execution speed: 95% of swaps execute in under 2 seconds
  - Reliability: Higher success rate for transactions
  - Implementation: Rate limiting with Bottleneck library to prevent API throttling

#### Advanced Order Types

A.C.E. implements sophisticated order types to maximize profit and minimize risk:

- **Market Orders**: Immediate execution at the best available price.
  - Implementation: Uses Jupiter Ultra API for market orders
  - Size management: Fixed buy size of 0.08 SOL per position (configurable)

- **Dynamic Trailing Stops**: Automatically adjusting stop-loss orders that follow the price upward.
  - ATR-based mechanism: Stop distance based on market volatility
  - Profit-level adjustments: Stop distance tightens as profit increases
    - 0-15% profit: 3.0 × ATR distance
    - 15-40% profit: 2.0 × ATR distance
    - 40-100% profit: 1.5 × ATR distance
    - >100% profit: 1.0 × ATR distance
  - Percentage-based backup: Fallback to percentage-based trailing stop if ATR calculation fails
  - Implementation: Continuous price monitoring with stop recalculation every 7 seconds

- **Tiered Profit-Taking Strategy**: Automatically sells portions of a position at predetermined profit levels.
  - First tier: Sell 30% of position at 15% profit
  - Second tier: Sell 30% of remaining position at 40% profit
  - Final tier: Hold remaining 40% with trailing stop for potential larger gains
  - Implementation: Position size tracking and partial sell execution

### 4. Risk Management

#### Position Monitoring

A.C.E. continuously monitors open positions to optimize exit timing:

- **Real-Time Price Tracking**: Constant monitoring of current prices for all open positions.
  - Implementation: Price checks every 7 seconds via DexScreener API
  - Alert system: Notifications for significant price movements
  - Historical tracking: Logging of price history for post-trade analysis

- **Technical Indicator Recalculation**: Indicators are recalculated in real-time as new price data becomes available.
  - Implementation: Indicator updates on each monitoring cycle
  - Dynamic adjustments: Strategy adjustments based on changing market conditions
  - Signal monitoring: Continuous evaluation of exit signals

- **Holder Change Monitoring**: Tracking changes in token holder counts to identify potential trend shifts.
  - Implementation: Periodic checks of holder data via Moralis API
  - Trend analysis: Correlation of holder growth/decline with price action
  - Early warning: Holder decline can signal potential price drops

- **Dynamic Stop Adjustment**: Stop-loss levels are continuously recalculated based on current market conditions.
  - Implementation: ATR recalculation on each monitoring cycle
  - Profit protection: Stops tighten automatically as profit increases
  - Volatility adaptation: Stop distances expand during high volatility

#### Profit Protection

A.C.E. employs multiple mechanisms to protect and maximize profits:

- **Trailing Stops**: Stops that automatically adjust upward as the price increases.
  - Implementation: ATR-based trailing stop with dynamic multiplier
  - Profit-based adjustment: Stop distance decreases as profit increases
  - Execution: Automatic sell order when price drops below trailing stop level

- **Partial Profit Taking**: Automatically selling portions of a position at predetermined profit levels.
  - Implementation: Tiered selling at 15% and 40% profit levels
  - Position sizing: 30% of position at first tier, 30% of remainder at second tier
  - Risk reduction: Securing partial profits reduces overall trade risk

- **Comprehensive Profit/Loss Tracking**: Detailed tracking of performance metrics for all trades.
  - Percentage tracking: Profit/loss as percentage of initial investment
  - USD value tracking: Profit/loss converted to USD value
  - SOL value tracking: Profit/loss in terms of SOL (accounting for SOL price changes)
  - Implementation: Detailed logging of all metrics for performance analysis

### 5. User Experience

#### Interactive CLI Interface

A.C.E. provides a user-friendly command-line interface for control and monitoring:

- **Operating Modes**: Different modes for different user needs.
  - Trading Mode: Fully automated buying and selling
  - Monitoring Mode: Analysis and alerts without actual trading
  - Implementation: Mode selection via interactive prompt at startup

- **Real-Time Status Updates**: Continuous feedback on system operations.
  - Progress indicators: Animated spinners during processing
  - Status messages: Clear indications of current activities
  - Alert highlighting: Color-coded messages for important information
  - Implementation: Uses ora and chalk libraries for enhanced CLI visuals

- **Colorized Output with Icons**: Visual enhancements for better readability.
  - Color coding: Different colors for different message types (info, warning, error, success)
  - Icons: Intuitive icons for different message categories
  - Formatting: Structured output with tables and sections
  - Implementation: Custom logger with color and icon support

#### Comprehensive Logging

A.C.E. maintains detailed logs of all activities for analysis and troubleshooting:

- **EST Timezone Timestamps**: All logs use Eastern Standard Time for consistency.
  - Implementation: Custom date formatting with EST timezone
  - Format: YYYY-MM-DD HH:MM:SS EST
  - Consistency: All logs and displays use the same timezone

- **Detailed Trade Information**: Complete records of all trading activities.
  - Entry details: Price, amount, transaction ID, reason for entry
  - Exit details: Price, amount, profit/loss, reason for exit
  - Performance metrics: ROI in percentage, USD, and SOL
  - Implementation: Structured JSON logging with human-readable formatting

- **Performance Metrics**: Tracking of system and trading performance.
  - Trade metrics: Win/loss ratio, average profit, maximum drawdown
  - System metrics: Analysis time, API response times, error rates
  - Implementation: Periodic performance summaries and detailed trade logs

- **Separate Log Files**: Different log files for different aspects of operation.
  - main.log: General system operation logs
  - user.log: User-friendly information and alerts
  - error.log: Detailed error information for troubleshooting
  - trades.log: Comprehensive trade records
  - Implementation: Rotating log files with size limits to prevent excessive growth

### 6. Performance Optimization

#### Efficient API Usage

A.C.E. optimizes API interactions to maximize performance and reliability:

- **Rate Limiting with Exponential Backoff**: Prevents API throttling while maintaining responsiveness.
  - Implementation: Bottleneck library for rate limiting
  - Configuration: Customized limits for each API (DexScreener, GeckoTerminal, Jupiter, Moralis)
  - Backoff strategy: Exponential delays with jitter for failed requests

- **Data Caching**: Reduces redundant API calls by storing frequently accessed data.
  - Implementation: In-memory caching with TTL (Time To Live)
  - Scope: OHLCV data, token metadata, pair information
  - Invalidation: Automatic cache clearing based on age or market events

- **Batch Processing**: Efficient handling of multiple data items in single operations.
  - Implementation: Batch requests for token data
  - Parallelization: Concurrent processing where appropriate
  - Prioritization: Critical path optimization for core functionality

#### Error Handling

A.C.E. implements robust error handling to maintain operation even under adverse conditions:

- **Comprehensive Error Catching**: All operations are wrapped in appropriate error handling.
  - Implementation: Try/catch blocks with specific error type handling
  - Logging: Detailed error information for troubleshooting
  - Recovery: Automatic retry for transient errors

- **Fallback Mechanisms**: Alternative approaches when primary methods fail.
  - Implementation: Multiple data sources with fallback options
  - Degraded operation: Continued functionality with reduced capabilities when needed
  - User notification: Clear communication of fallback status

- **Transaction Retry Logic**: Automatic retry of failed transactions with intelligent backoff.
  - Implementation: Configurable retry attempts for transactions
  - Confirmation tracking: Manual verification of transaction status when confirmation times out
  - Recovery procedures: Handling of various failure scenarios

### 7. Security Features

#### Wallet Protection

A.C.E. implements multiple layers of protection for wallet security:

- **Secure Private Key Handling**: Private keys are never exposed in logs or stored insecurely.
  - Implementation: Environment variable storage for private key
  - Memory management: Minimized exposure of key in memory
  - No persistence: Keys are never written to disk

- **Balance Verification**: Ensures sufficient funds before attempting transactions.
  - Implementation: Pre-trade balance checks
  - Minimum balance enforcement: Maintains reserve for network fees
  - Error prevention: Prevents failed transactions due to insufficient funds

- **Transaction Validation**: Verification of transaction parameters before signing.
  - Implementation: Parameter validation before transaction creation
  - Sanity checks: Verification of reasonable values for amounts and prices
  - Simulation: Pre-flight simulation of transactions where supported

#### Trade Safety

A.C.E. includes multiple safeguards to protect against trading risks:

- **Slippage Protection**: Prevents execution at unexpectedly poor prices.
  - Implementation: Configurable slippage tolerance (default 5%)
  - Dynamic adjustment: Tighter slippage for higher liquidity tokens
  - Abort mechanism: Cancellation of trades with excessive expected slippage

- **Failed Transaction Recovery**: Automatic handling of transaction failures.
  - Implementation: Status checking and retry logic
  - State reconciliation: Correction of internal state after failed transactions
  - Logging: Detailed records of failure reasons and recovery actions

- **Minimum Balance Enforcement**: Ensures sufficient funds remain for network operations.
  - Implementation: Reserve of 0.01 SOL maintained at all times
  - Trading limits: Maximum position size calculations based on available balance
  - Safety margin: Additional buffer for unexpected fee increases

### 8. Simulation Capabilities

#### Virtual Trading Environment

A.C.E. includes a comprehensive simulation mode for strategy testing without real funds:

- **Realistic Market Simulation**: Accurate modeling of market behavior including slippage and fees.
  - Implementation: Simulation module that mirrors real trading logic
  - Market data: Uses real-time market data for realistic conditions
  - Execution modeling: Simulates slippage based on liquidity depth

- **Virtual Balance Tracking**: Maintains simulated portfolio without actual transactions.
  - Implementation: Virtual wallet with position tracking
  - Performance metrics: Same metrics as real trading
  - What-if analysis: Testing of different parameters and strategies

- **Performance Statistics**: Comprehensive reporting of simulation results.
  - Implementation: Detailed performance reports
  - Metrics: Win rate, profit factor, maximum drawdown, Sharpe ratio
  - Comparison: Benchmarking against different strategies or parameters

## Upcoming Features

### SOL Price Improvements

- **Dynamic SOL Price Updates**: Real-time SOL price fetching for accurate USD calculations.
  - Implementation plan: Replace hardcoded SOL price with Jupiter Price API data
  - Update frequency: Regular price updates (every 15 minutes)
  - Fallback mechanism: Default price when API unavailable

- **Accurate Profit/Loss Calculations**: Improved P/L tracking accounting for SOL price changes.
  - Implementation plan: Track SOL price at entry and exit for each trade
  - Dual reporting: Both SOL-denominated and USD-denominated performance
  - Historical analysis: Performance tracking against SOL and USD benchmarks

### Enhanced Analytics

- **Historical Performance Analysis**: Tools for analyzing past trading performance.
  - Implementation plan: Database storage of all trade data
  - Reporting: Customizable reports with filtering and aggregation
  - Visualization: Graphical representation of performance metrics

- **Strategy Optimization Tools**: Frameworks for testing and improving trading strategies.
  - Implementation plan: Parameter optimization through backtesting
  - Sensitivity analysis: Testing strategy robustness across market conditions
  - Automated tuning: Machine learning for parameter optimization

### AI Integration

- **Machine Learning for Token Selection**: AI-powered identification of promising tokens.
  - Implementation plan: Feature engineering from technical and on-chain data
  - Model development: Supervised learning for token classification
  - Continuous improvement: Feedback loop from trading results

- **Adaptive Trading Strategies**: Strategies that evolve based on market conditions.
  - Implementation plan: Market regime detection and strategy switching
  - Reinforcement learning: Adaptive parameter adjustment
  - Performance monitoring: Continuous evaluation and adjustment

---

*A.C.E. is continuously evolving with new features and improvements.*