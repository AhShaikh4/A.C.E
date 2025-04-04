# 🚀 Solana Memecoin Trading Bot

<div align="center">

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Platform](https://img.shields.io/badge/platform-Solana-blueviolet)
![License](https://img.shields.io/badge/license-MIT-green)

</div>

## 📋 Overview

A sophisticated trading bot designed for automated analysis and trading of Solana memecoins. The system leverages multiple data sources, advanced technical analysis, and optimized execution strategies to identify and capitalize on trading opportunities in the fast-paced Solana memecoin market.

---

## 🔑 Core Components

### 1. Wallet Management (`wallet.js`)

<details>
<summary><b>Wallet Initialization & Security</b></summary>

- ✅ Secure private key handling with environment variables
- ✅ Robust key validation and bs58 encoding
- ✅ Comprehensive error messaging
- ✅ Multi-network support (mainnet-beta, devnet, testnet)
- ✅ Connection status verification with auto-retry

</details>

<details>
<summary><b>Balance Management</b></summary>

- ✅ Real-time SOL balance retrieval (8 decimal precision)
- ✅ Minimum balance enforcement (0.001 SOL threshold)
- ✅ Trading operation fund validation
- ✅ Balance fetch retry mechanism (3 attempts)
- ✅ Graceful error handling with user feedback

</details>

### 2. Operation Mode (`mode.js`)

<details>
<summary><b>Mode Selection & Control</b></summary>

- ✅ Interactive CLI interface
- ✅ Dual operating modes:
  - 🔄 **Trading Mode**: Automated buying and selling
  - 👁️ **Monitoring Mode**: Market observation only
- ✅ Balance-based mode restrictions
- ✅ Intuitive user prompts and feedback
- ✅ Real-time status display

</details>

### 3. Token Analysis (`dexscreener.js`)

<details>
<summary><b>Token Discovery & Filtering</b></summary>

- ✅ Boosted token detection
- ✅ Trending token identification
- ✅ Keyword-based pair discovery
- ✅ Multi-source aggregation
- ✅ Age-based filtering (2 days)

</details>

<details>
<summary><b>Market Analysis</b></summary>

- ✅ Real-time price monitoring
- ✅ Multi-timeframe analysis (5m, 1h, 24h)
- ✅ Volume and liquidity tracking
- ✅ Market cap trend detection
- ✅ Transaction pattern analysis

</details>

<details>
<summary><b>Risk Management</b></summary>

- ✅ Honeypot detection system
  - Buy/sell ratio analysis
  - Liquidity trap detection
  - Transaction pattern monitoring
- ✅ Market cap trend analysis
  - Trend direction identification
  - Confidence level assessment
  - Score-based evaluation

</details>

### 4. Advanced Technical Analysis (`TA.js`)

<details>
<summary><b>Technical Indicators Suite</b></summary>

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

</details>

<details>
<summary><b>Optimized Token Filtering</b></summary>

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

</details>

<details>
<summary><b>Signal Generation</b></summary>

- ✅ Multi-factor buy signal analysis
- ✅ Combined indicator signals
- ✅ Volume-based confirmation
- ✅ Trend strength assessment
- ✅ Risk level evaluation
- ✅ Entry/exit point detection

</details>

### 5. Market Data Integration (`gecko.js`)

<details>
<summary><b>Data Processing</b></summary>

- ✅ Multi-timeframe OHLCV data analysis
- ✅ Rate-limited API requests with exponential backoff
- ✅ Efficient data caching and parallel processing
- ✅ Error handling and recovery mechanisms
- ✅ Data validation and normalization

</details>

<details>
<summary><b>Output Features</b></summary>

- ✅ Detailed token metrics visualization
- ✅ Technical indicator value reporting
- ✅ Market analysis results
- ✅ Buy/sell signal generation
- ✅ Comprehensive logging system

</details>

### 6. On-Chain Analysis (`moralis.js`)

<details>
<summary><b>Holder Analysis</b></summary>

- ✅ Current holder count retrieval
- ✅ Historical holder data analysis
- ✅ Holder change percentage calculation
- ✅ Holder distribution patterns
- ✅ Growth rate assessment

</details>

<details>
<summary><b>Transaction Analysis</b></summary>

- ✅ Sniper detection and analysis
- ✅ Smart money tracking
- ✅ Whale wallet monitoring
- ✅ Transaction pattern recognition
- ✅ Profit calculation for market participants

</details>

### 7. DEX Integration (`jupiter.js`)

<details>
<summary><b>Trading APIs</b></summary>

- ✅ **Ultra API**: Instant trade execution
- ✅ **Swap API**: Multi-DEX aggregation with optimal routing
- ✅ **Trigger API**: Limit order creation and management
- ✅ **Recurring API**: Time-based and DCA order implementation

</details>

<details>
<summary><b>Transaction Management</b></summary>

- ✅ Transaction building and signature handling
- ✅ Confirmation tracking and error recovery
- ✅ Dynamic compute units and priority fee adjustment
- ✅ Slippage optimization and gas efficiency
- ✅ Transaction validation and balance verification

</details>

<details>
<summary><b>Order Types</b></summary>

- ✅ Market orders
- ✅ Limit orders
- ✅ Recurring orders
- ✅ Stop orders
- ✅ DCA (Dollar Cost Averaging) orders

</details>

---

## 📊 Performance Features

<details>
<summary><b>Optimization Techniques</b></summary>

- ✅ API request batching and rate limiting
- ✅ Concurrent processing with throttling
- ✅ Data caching and reuse
- ✅ Efficient error handling with backoff strategies
- ✅ Resource usage optimization

</details>

<details>
<summary><b>Safety Mechanisms</b></summary>

- ✅ Transaction validation and verification
- ✅ Balance checks and order size limits
- ✅ Slippage protection
- ✅ Failed trade recovery
- ✅ Network error handling

</details>

---

## 🔄 Ongoing Development

- 🔜 Advanced trading strategies implementation
- 🔜 Backtesting framework
- 🔜 Paper trading mode
- 🔜 Machine learning integration
- 🔜 Database and analytics dashboard

---

<div align="center">

*This document is updated regularly as new features are implemented.*

</div>