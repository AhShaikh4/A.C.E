# Solana Memecoin Trading Bot

## Overview

A sophisticated trading bot designed for automated analysis and trading of Solana memecoins. The system leverages multiple data sources, advanced technical analysis, and optimized execution strategies to identify and capitalize on trading opportunities in the fast-paced Solana memecoin market.

---

## Core Components

### 1. Wallet Management (`wallet.js`)

#### Wallet Initialization & Security

- ✅ Secure private key handling with environment variables
- ✅ Robust key validation and bs58 encoding
- ✅ Comprehensive error messaging
- ✅ Multi-network support (mainnet-beta, devnet, testnet)
- ✅ Connection status verification with auto-retry

#### Balance Management

- ✅ Real-time SOL balance retrieval (8 decimal precision)
- ✅ Minimum balance enforcement (0.001 SOL threshold)
- ✅ Trading operation fund validation
- ✅ Balance fetch retry mechanism (3 attempts)
- ✅ Graceful error handling with user feedback

### 2. Operation Mode (`mode.js`)

#### Mode Selection & Control

- ✅ Interactive CLI interface
- ✅ Dual operating modes:
  - **Trading Mode**: Automated buying and selling
  - **Monitoring Mode**: Market observation only
- ✅ Balance-based mode restrictions
- ✅ Intuitive user prompts and feedback
- ✅ Real-time status display

### 3. Token Analysis (`dexscreener.js`)

#### Token Discovery & Filtering

- ✅ Boosted token detection
- ✅ Trending token identification
- ✅ Keyword-based pair discovery
- ✅ Multi-source aggregation
- ✅ Age-based filtering (2 days)

#### Market Analysis

- ✅ Real-time price monitoring
- ✅ Multi-timeframe analysis (5m, 1h, 24h)
- ✅ Volume and liquidity tracking
- ✅ Market cap trend detection
- ✅ Transaction pattern analysis

#### Risk Management

- ✅ Honeypot detection system
  - Buy/sell ratio analysis
  - Liquidity trap detection
  - Transaction pattern monitoring
- ✅ Market cap trend analysis
  - Trend direction identification
  - Confidence level assessment
  - Score-based evaluation
- ✅ Token blacklist system
  - Persistent blacklist storage
  - Automatic blacklist loading
  - Blacklist size reporting
  - Detailed logging of blacklisted tokens

### 4. Advanced Technical Analysis (`TA.js`)

#### Technical Indicators Suite

- ✅ **Moving Averages**
  - Simple (SMA), Exponential (EMA)
  - Double Exponential (DEMA), Triple Exponential (TEMA)
  - Triangular (TRIMA), Volume Weighted (VWMA)

- ✅ **Momentum Indicators**
  - MACD, RSI, Stochastic Oscillator
  - Awesome Oscillator, Money Flow Index

- ✅ **Volatility Indicators**
  - Bollinger Bands, Average True Range (ATR)
  - Keltner Channels, Standard Deviation

- ✅ **Volume Indicators**
  - On-Balance Volume (OBV), Money Flow Index (MFI)
  - Chaikin Money Flow (CMF), Volume Price Trend (VPT)

- ✅ **Trend Indicators**
  - Parabolic SAR, Vortex Indicator
  - Percentage Price Oscillator (PPO)
  - Ichimoku Cloud (Ichimoku Kinko Hyo)

- ✅ **Custom Calculations**
  - Volume Weighted Average Price (VWAP)
  - Accumulation/Distribution Line (AD)

- ✅ **Enhanced Trailing Stop**
  - Dynamic ATR multiplier based on profit level
    - Adjusts trailing stop distance based on current profit level
    - Tighter stops at higher profit levels (e.g., 1.5x ATR at 50% profit)
    - Medium stops at medium profit levels (e.g., 2.0x ATR at 20% profit)
    - Wider stops at lower profit levels (e.g., 2.5x ATR at 0% profit)
  - Percentage-based trailing stop as backup
    - Simple percentage-based trailing stop (default 3%)
    - Option to use maximum of ATR and percentage stops
    - Provides safety net when ATR value is unusually low
  - Configurable parameters in config.js
    - Customizable ATR multipliers for different profit levels
    - Adjustable percentage for percentage-based stops
    - Toggle for using maximum of both stop types
  - Comprehensive logging of stop levels
    - Shows which stop type is active (ATR-based or percentage-based)
    - Displays distance to stop as percentage
    - Detailed trigger information for post-trade analysis

- ✅ **Tiered Profit Taking**
  - Configurable profit tiers (15%, 40%, 100%)
    - Sells portions of position at different profit levels
    - Secures profits earlier while maintaining upside potential
    - Reduces risk as position becomes profitable
  - Configurable position percentages per tier (30%, 30%, 40%)
    - Customizable allocation for each profit tier
    - Balanced approach between securing profits and maximizing gains
    - Final portion uses main profit target or trailing stop
  - Partial sell execution with position tracking
    - Calculates token amount to sell based on percentage
    - Keeps tracking partially sold positions for future tiers
    - Prevents duplicate sells by marking tiers as executed
  - Benefits:
    - Improved risk management by securing profits at multiple levels
    - Psychological advantage reducing early/late exit temptation
    - Optimized returns balancing security and potential gains
    - Reduced impact of volatility after securing partial profits

#### Optimized Token Filtering

- ✅ **Tiered Filtering Workflow**
  - Initial filtering by liquidity ($20K) and volume ($20K)
  - Secondary filtering by recent price trends
  - Detailed TA only on promising candidates
  - Final validation with on-chain data

- ✅ **Recent Momentum Prioritization**
  - Higher weighting for 5m and 1h price changes
  - Penalty for negative recent price action
  - Minimum thresholds for liquidity and volume

- ✅ **Resilient Processing**
  - Fallback mechanisms for API failures
  - Graceful degradation of analysis
  - Detailed logging for debugging

#### Signal Generation

- ✅ Multi-factor buy signal analysis
- ✅ Combined indicator signals
- ✅ Volume-based confirmation
- ✅ Trend strength assessment
- ✅ Risk level evaluation
- ✅ Entry/exit point detection

### 5. Market Data Integration (`gecko.js`)

#### Data Processing

- ✅ Multi-timeframe OHLCV data analysis
- ✅ Rate-limited API requests with exponential backoff
- ✅ Efficient data caching and parallel processing
- ✅ Error handling and recovery mechanisms
- ✅ Data validation and normalization

#### Output Features

- ✅ Detailed token metrics visualization
- ✅ Technical indicator value reporting
- ✅ Market analysis results
- ✅ Buy/sell signal generation
- ✅ Comprehensive logging system
  - ✅ EST timezone timestamps for all logs
  - ✅ Detailed user.log with wallet connection and balance information
  - ✅ Complete token filtration process logging
  - ✅ Buy/sell operations with detailed information
  - ✅ Profit/loss tracking in percentage, USD, and SOL values

### 6. On-Chain Analysis (`moralis.js`)

#### Holder Analysis

- ✅ Current holder count retrieval
- ✅ Historical holder data analysis
- ✅ Holder change percentage calculation
- ✅ Holder distribution patterns
- ✅ Growth rate assessment

#### Transaction Analysis

- ✅ Sniper detection and analysis
- ✅ Smart money tracking
- ✅ Whale wallet monitoring
- ✅ Transaction pattern recognition
- ✅ Profit calculation for market participants

### 7. DEX Integration (`jupiter.js`)

#### Trading APIs

- ✅ **Ultra API**: Instant trade execution
- ✅ **Swap API**: Multi-DEX aggregation with optimal routing
- ✅ **Trigger API**: Limit order creation and management
- ✅ **Recurring API**: Time-based and DCA order implementation

#### Transaction Management

- ✅ Transaction building and signature handling
- ✅ Confirmation tracking and error recovery
- ✅ Dynamic compute units and priority fee adjustment
- ✅ Slippage optimization and gas efficiency
- ✅ Transaction validation and balance verification

#### Order Types

- ✅ Market orders
- ✅ Limit orders
- ✅ Recurring orders
- ✅ Stop orders
  - ✅ Enhanced trailing stop with dynamic ATR multiplier
    - Adjusts trailing stop distance based on current profit level
    - Tighter stops at higher profit levels (e.g., 1.5x ATR at 50% profit)
    - Medium stops at medium profit levels (e.g., 2.0x ATR at 20% profit)
    - Wider stops at lower profit levels (e.g., 2.5x ATR at 0% profit)
  - ✅ Percentage-based trailing stop as backup
    - Simple percentage-based trailing stop (default 3%)
    - Option to use maximum of ATR and percentage stops
    - Provides safety net when ATR value is unusually low
  - ✅ Configurable parameters in config.js
    - Customizable ATR multipliers for different profit levels
    - Adjustable percentage for percentage-based stops
    - Toggle for using maximum of both stop types
- ✅ DCA (Dollar Cost Averaging) orders
- ✅ Tiered profit taking orders
  - ✅ Configurable profit tiers (15%, 40%, 100%)
    - Sells portions of position at different profit levels
    - Secures profits earlier while maintaining upside potential
    - Reduces risk as position becomes profitable
  - ✅ Configurable position percentages per tier (30%, 30%, 40%)
    - Customizable allocation for each profit tier
    - Balanced approach between securing profits and maximizing gains
    - Final portion uses main profit target or trailing stop
  - ✅ Sophisticated position management
    - Tracks partially sold positions for future profit tiers
    - Prevents duplicate sells with tier execution tracking
    - Handles position updates after partial sells

---

## Performance Features

#### Optimization Techniques

- ✅ API request batching and rate limiting
- ✅ Concurrent processing with throttling
- ✅ Data caching and reuse
- ✅ Efficient error handling with backoff strategies
- ✅ Resource usage optimization

#### Safety Mechanisms

- ✅ Transaction validation and verification
- ✅ Balance checks and order size limits
- ✅ Slippage protection
- ✅ Failed trade recovery
- ✅ Network error handling
- ✅ Enhanced risk management
  - ✅ Dynamic trailing stop based on profit level
    - Adaptive risk management that adjusts based on profit level
    - Becomes more conservative as profits grow
    - Dual protection using both ATR and percentage-based stops
  - ✅ Tiered profit taking to secure gains
    - Locks in profits at predetermined levels
    - Reduces risk while maintaining upside potential
    - Configurable tiers and percentages
  - ✅ Comprehensive profit/loss tracking in multiple units (%, USD, SOL)
    - Clear visibility into performance metrics
    - Multiple measurement units for complete perspective
    - Real-time P&L updates during position monitoring
  - ✅ Detailed logging for post-trade analysis
    - Captures exact reason for trade exits
    - Logs which stop type was triggered
    - Records distance from highest price
    - Enables continuous strategy improvement

---

## Ongoing Development

- ✅ Advanced trading strategies implementation
  - ✅ Tiered profit taking strategy
  - ✅ Enhanced trailing stop with dynamic ATR multiplier
  - ✅ Comprehensive profit/loss tracking
- ✅ Enhanced logging system
  - ✅ EST timezone timestamps
  - ✅ Detailed user.log with comprehensive information
  - ✅ Profit/loss tracking in percentage, USD, and SOL values
- Backtesting framework
- Paper trading mode
- Machine learning integration
- Database and analytics dashboard

---

*This document is updated regularly as new features are implemented.*