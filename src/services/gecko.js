const axios = require('axios');
const technicalindicators = require('technicalindicators');
const Bottleneck = require('bottleneck');
const fs = require('fs');

// Use library for available indicators
const SMA = technicalindicators.SMA;
const EMA = technicalindicators.EMA;
const MACD = technicalindicators.MACD;
const PSAR = technicalindicators.PSAR;
const CCI = technicalindicators.CCI;
const RSI = technicalindicators.RSI;
const Stochastic = technicalindicators.Stochastic;
const WilliamsR = technicalindicators.WilliamsR;
const ROC = technicalindicators.ROC;
const AwesomeOscillator = technicalindicators.AwesomeOscillator;
const BollingerBands = technicalindicators.BollingerBands;
const ATR = technicalindicators.ATR;
const TrueRange = technicalindicators.TrueRange;
const OBV = technicalindicators.OBV;
const MFI = technicalindicators.MFI;
const VWAP = technicalindicators.VWAP;

// GeckoTerminal API settings
const BASE_URL = 'https://api.geckoterminal.com/api/v2';
const HEADERS = { Accept: 'application/json;version=20230302' };

// Enhanced API call with rate limiting and exponential backoff
const apiCall = async (url, retries = 5) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, { headers: HEADERS });
      return response.data;
    } catch (error) {
      if (error.response?.status === 429) {
        const delay = Math.min(60000, 2000 * Math.pow(2, i)); // Exponential backoff, max 60s
        console.error(`Rate limit hit (429). Waiting ${delay / 1000}s before retry ${i + 1}/${retries}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      console.error(`API call failed: ${error.response?.status || error.message}`);
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 2500 * (i + 1)));
    }
  }
};

// Fetch new pools from GeckoTerminal
const fetchNewPools = async (network = 'solana', page = 1) => {
  const url = `${BASE_URL}/networks/${network}/new_pools?page=${page}`;
  const data = await apiCall(url);
  return data.data || [];
};

// Fetch trending pools from GeckoTerminal
const fetchTrendingPools = async (network = 'solana', duration = '24h', page = 1) => {
  const url = `${BASE_URL}/networks/${network}/trending_pools?duration=${duration}&page=${page}`;
  const data = await apiCall(url);
  return data.data || [];
};

// Fetch OHLCV data with token symbol display
const fetchOHLCV = async (network, poolAddress, tokenSymbol) => {
  const url = `${BASE_URL}/networks/${network}/pools/${poolAddress}/ohlcv/hour?limit=100`;
  const data = await apiCall(url);
  if (!data?.data?.attributes?.ohlcv_list) {
    console.warn(`No OHLCV data for ${tokenSymbol}`);
    return [];
  }
  const ohlcv = data.data.attributes.ohlcv_list.map(([timestamp, open, high, low, close, volume]) => ({
    timestamp, open, high, low, close, volume
  }));
  console.log(`OHLCV data for ${tokenSymbol}: ${ohlcv.length} candles`);
  return ohlcv;
};

// Custom TA Implementations for unavailable indicators
const calculateDEMA = (closes, period) => {
  if (closes.length < period * 2) return 0;
  const ema1 = EMA.calculate({ period, values: closes });
  const ema2 = EMA.calculate({ period, values: ema1 });
  return 2 * ema1[ema1.length - 1] - ema2[ema2.length - 1];
};

const calculateTEMA = (closes, period) => {
  if (closes.length < period * 3) return 0;
  const ema1 = EMA.calculate({ period, values: closes });
  const ema2 = EMA.calculate({ period, values: ema1 });
  const ema3 = EMA.calculate({ period, values: ema2 });
  return 3 * ema1[ema1.length - 1] - 3 * ema2[ema2.length - 1] + ema3[ema3.length - 1];
};

const calculateTRIMA = (closes, period) => {
  if (closes.length < period) return 0;
  const n = Math.floor((period + 1) / 2);
  const weights = Array.from({ length: period }, (_, i) => i < n ? i + 1 : period - i);
  const sumWeights = weights.reduce((sum, w) => sum + w, 0);
  const slice = closes.slice(-period);
  return slice.reduce((sum, val, i) => sum + val * weights[i], 0) / sumWeights;
};

const calculateVWMA = (closes, volumes, period) => {
  if (closes.length < period) return 0;
  const sliceCloses = closes.slice(-period);
  const sliceVolumes = volumes.slice(-period);
  const weightedSum = sliceCloses.reduce((sum, close, i) => sum + close * sliceVolumes[i], 0);
  const volumeSum = sliceVolumes.reduce((sum, vol) => sum + vol, 0);
  return volumeSum === 0 ? 0 : weightedSum / volumeSum;
};

const calculateVortex = (highs, lows, closes, period) => {
  if (highs.length < period + 1) return { VIPlus: 0, VIMinus: 0 };
  const vmPlus = highs.slice(-period - 1).map((h, i) => i === 0 ? 0 : Math.abs(h - lows[i - 1]));
  const vmMinus = lows.slice(-period - 1).map((l, i) => i === 0 ? 0 : Math.abs(l - highs[i - 1]));
  const tr = highs.slice(-period - 1).map((h, i) => i === 0 ? 0 : Math.max(h - lows[i], Math.abs(h - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  const viPlus = vmPlus.slice(1).reduce((sum, val) => sum + val, 0) / tr.slice(1).reduce((sum, val) => sum + val, 0);
  const viMinus = vmMinus.slice(1).reduce((sum, val) => sum + val, 0) / tr.slice(1).reduce((sum, val) => sum + val, 0);
  return { VIPlus: viPlus || 0, VIMinus: viMinus || 0 };
};

const calculatePPO = (closes, fastPeriod, slowPeriod, signalPeriod) => {
  if (closes.length < slowPeriod) return { PPO: 0, signal: 0 };
  const fastEMA = EMA.calculate({ period: fastPeriod, values: closes });
  const slowEMA = EMA.calculate({ period: slowPeriod, values: closes });
  const ppo = (fastEMA[fastEMA.length - 1] - slowEMA[slowEMA.length - 1]) / slowEMA[slowEMA.length - 1] * 100;
  const signal = EMA.calculate({ period: signalPeriod, values: closes.slice(-signalPeriod).map(() => ppo) })[0];
  return { PPO: ppo, signal };
};

const calculateKeltnerChannel = (highs, lows, closes, period, multiplier) => {
  if (closes.length < period) return { upper: 0, middle: 0, lower: 0 };
  const middle = EMA.calculate({ period, values: closes })[closes.length - 1];
  const atr = ATR.calculate({ high: highs, low: lows, close: closes, period })[closes.length - 1];
  return { upper: middle + multiplier * atr, middle, lower: middle - multiplier * atr };
};

const calculateAD = (highs, lows, closes, volumes) => {
  if (highs.length < 1) return 0;
  let ad = 0;
  for (let i = 0; i < highs.length; i++) {
    const mfm = ((closes[i] - lows[i]) - (highs[i] - closes[i])) / (highs[i] - lows[i] || 1);
    ad += mfm * volumes[i];
  }
  return ad;
};

const calculateCMF = (highs, lows, closes, volumes, period) => {
  if (highs.length < period) return 0;
  const mf = highs.slice(-period).map((h, i) => ((closes[i] - lows[i]) - (h - closes[i])) / (h - lows[i] || 1) * volumes[i]);
  return mf.reduce((sum, val) => sum + val, 0) / volumes.slice(-period).reduce((sum, val) => sum + val, 0);
};

const calculateVPT = (closes, volumes) => {
  if (closes.length < 2) return 0;
  let vpt = 0;
  for (let i = 1; i < closes.length; i++) {
    vpt += volumes[i] * (closes[i] - closes[i - 1]) / closes[i - 1];
  }
  return vpt;
};

// Calculate technical indicators
const calculateIndicators = (ohlcv) => {
  if (!ohlcv || ohlcv.length < 5) {
    console.warn(`Insufficient OHLCV data: ${ohlcv?.length || 0} candles`);
    return {};
  }
  const closes = ohlcv.map(c => c.close);
  const highs = ohlcv.map(c => c.high);
  const lows = ohlcv.map(c => c.low);
  const volumes = ohlcv.map(c => c.volume);
  const period = ohlcv.length >= 20 ? 20 : 5;
  return {
    sma: SMA.calculate({ period, values: closes }).slice(-1)[0] || 0,
    ema: EMA.calculate({ period, values: closes }).slice(-1)[0] || 0,
    dema: calculateDEMA(closes, period),
    tema: calculateTEMA(closes, period),
    trima: calculateTRIMA(closes, period),
    vwma: calculateVWMA(closes, volumes, period),
    macd: MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }).slice(-1)[0] || { MACD: 0, signal: 0, histogram: 0 },
    psar: PSAR.calculate({ high: highs, low: lows, step: 0.02, max: 0.2 }).slice(-1)[0] || 0,
    vortex: calculateVortex(highs, lows, closes, 14),
    cci: CCI.calculate({ high: highs, low: lows, close: closes, period }).slice(-1)[0] || 0,
    rsi: RSI.calculate({ values: closes, period: 14 }).slice(-1)[0] || 0,
    stochastic: Stochastic.calculate({ high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 }).slice(-1)[0] || { k: 0, d: 0 },
    williamsR: WilliamsR.calculate({ high: highs, low: lows, close: closes, period: 14 }).slice(-1)[0] || 0,
    roc: ROC.calculate({ values: closes, period: 12 }).slice(-1)[0] || 0,
    ppo: calculatePPO(closes, 12, 26, 9),
    awesome: AwesomeOscillator.calculate({ high: highs, low: lows, fastPeriod: 5, slowPeriod: 34 }).slice(-1)[0] || 0,
    bollinger: BollingerBands.calculate({ period, stdDev: 2, values: closes }).slice(-1)[0] || { upper: 0, middle: 0, lower: 0 },
    atr: ATR.calculate({ high: highs, low: lows, close: closes, period: 14 }).slice(-1)[0] || 0,
    trueRange: TrueRange.calculate({ high: highs, low: lows, close: closes }).slice(-1)[0] || 0,
    keltner: calculateKeltnerChannel(highs, lows, closes, period, 2),
    obv: OBV.calculate({ close: closes, volume: volumes }).slice(-1)[0] || 0,
    mfi: MFI.calculate({ high: highs, low: lows, close: closes, volume: volumes, period: 14 }).slice(-1)[0] || 0,
    ad: calculateAD(highs, lows, closes, volumes),
    cmf: calculateCMF(highs, lows, closes, volumes, period),
    vpt: calculateVPT(closes, volumes),
    vwap: VWAP.calculate({ high: highs, low: lows, close: closes, volume: volumes }).slice(-1)[0] || 0,
  };
};

// Calculate typical price
const calculateTypicalPrice = (ohlcv) => {
  if (!ohlcv.length) return 0;
  const last = ohlcv[ohlcv.length - 1];
  return (last.high + last.low + last.close) / 3;
};

// Analyze a single pool with USD conversion
const analyzePool = async (pool, network) => {
  const attributes = pool.attributes;
  const poolAddress = attributes.address;
  const tokenAddress = pool.relationships.base_token.data.id.split('_')[1];
  const tokenSymbol = attributes.name.split(' / ')[0]; // Extract token symbol
  const volume24h = parseFloat(attributes.volume_usd.h24 || 0);
  const priceChange24h = parseFloat(attributes.price_change_percentage.h24 || 0);
  const liquidity = parseFloat(attributes.reserve_in_usd);
  const priceUsd = parseFloat(attributes.base_token_price_usd);
  const quoteTokenPriceUsd = parseFloat(attributes.quote_token_price_usd || 0);
  const market_cap_usd = parseFloat(attributes.market_cap_usd || 0); // Market Cap

  if (quoteTokenPriceUsd === 0) {
    console.warn(`No quote token price for ${tokenSymbol}`);
    return null;
  }

  const ohlcv = await fetchOHLCV(network, poolAddress, tokenSymbol);
  const ohlcvUsd = ohlcv.map(candle => ({
    timestamp: candle.timestamp,
    open: candle.open * quoteTokenPriceUsd,
    high: candle.high * quoteTokenPriceUsd,
    low: candle.low * quoteTokenPriceUsd,
    close: candle.close * quoteTokenPriceUsd,
    volume: candle.volume,
  }));

  const indicators = ohlcvUsd.length >= 5 ? calculateIndicators(ohlcvUsd) : {};
  const typicalPrice = calculateTypicalPrice(ohlcvUsd);

  return {
    name: attributes.name,
    tokenAddress,
    poolAddress,
    volume24h,
    priceChange24h,
    liquidity,
    priceUsd,
    market_cap_usd, // Include Market Cap
    indicators,
    typicalPrice,
    hasEnoughData: ohlcvUsd.length >= 5,
    tokenSymbol,
  };
};

// Rate limiting wrapper for pool analysis
const analyzePoolWithRateLimit = async (pool, network, limiter) => {
  return limiter.schedule(() => analyzePool(pool, network));
};

// Filter profitable tokens
const filterProfitableTokens = async (pools, network, limiter) => {
  const profitable = [];
  const poolPromises = pools.map(pool =>
    analyzePoolWithRateLimit(pool, network, limiter)
      .then(metrics => {
        if (!metrics) return;

        const { indicators, priceUsd, hasEnoughData } = metrics;

        const isHighVolume = metrics.volume24h >= 10000;
        const isLowLiquidity = metrics.liquidity > 1000 && metrics.liquidity <= 500000;
        const isVolatile = Math.abs(metrics.priceChange24h) > 20;

        let shouldBuy = false;
        let reasons = [];

        if (!hasEnoughData) {
          if (isHighVolume && isLowLiquidity && isVolatile) {
            shouldBuy = true;
            reasons.push("High volume, low liquidity, and high volatility");
          }
        } else {
          const macdBullish = indicators.macd?.MACD > indicators.macd?.signal && indicators.macd?.histogram > 0;
          const psarBullish = priceUsd > indicators.psar;
          const rsiOversold = indicators.rsi < 30;
          const stochasticBuy = indicators.stochastic?.k > indicators.stochastic?.d && indicators.stochastic?.k < 80;
          const awesomeBullish = indicators.awesome > 0;
          const bbBreakout = priceUsd > indicators.bollinger?.upper;
          const keltnerBreakout = priceUsd > indicators.keltner?.upper;
          const cmfPositive = indicators.cmf > 0;
          const mfiOversold = indicators.mfi < 20;

          if (macdBullish) reasons.push("MACD bullish");
          if (psarBullish) reasons.push("PSAR bullish");
          if (rsiOversold) reasons.push("RSI oversold");
          if (stochasticBuy) reasons.push("Stochastic buy signal");
          if (awesomeBullish) reasons.push("Awesome Oscillator bullish");
          if (bbBreakout) reasons.push("Bollinger Bands breakout");
          if (keltnerBreakout) reasons.push("Keltner Channel breakout");
          if (cmfPositive) reasons.push("CMF positive");
          if (mfiOversold) reasons.push("MFI oversold");

          const meetsBasicCriteria = isHighVolume && isLowLiquidity;

          if (meetsBasicCriteria && (macdBullish || psarBullish || rsiOversold || stochasticBuy || awesomeBullish || bbBreakout || keltnerBreakout || cmfPositive || mfiOversold)) {
            shouldBuy = true;
          }
        }

        if (shouldBuy) {
          metrics.buySignal = {
            shouldBuy,
            reasons: reasons.length > 0 ? reasons.join(", ") : "Meets basic criteria",
          };
          profitable.push(metrics);
        }
      })
      .catch(error => console.error(`Error analyzing pool: ${error.message}`))
  );

  await Promise.all(poolPromises);
  return profitable;
};

// Display results with aesthetic card format and logging
const displayResults = async (tokens, network) => {
  let logContent = '\n=== Potentially Profitable Solana Memecoins ===\n\n';
  if (!tokens.length) {
    logContent += 'No profitable tokens found.\n';
  } else {
    tokens.forEach(token => {
      logContent += `+${'-'.repeat(50)}+\n`;
      logContent += `| Token: ${token.tokenSymbol} (${token.name})\n`;
      logContent += `| Token Address: ${token.tokenAddress}\n`;
      logContent += `| Pool Address: ${token.poolAddress}\n`;
      logContent += `| Price (USD): $${token.priceUsd.toFixed(6)}\n`;
      logContent += `| 24h Volume: $${token.volume24h.toFixed(2)}\n`; // Corrected label
      logContent += `| 24h Price Change: ${token.priceChange24h.toFixed(2)}%\n`;
      logContent += `| Liquidity: $${token.liquidity.toFixed(2)}\n`;
      logContent += `| Market Cap: $${token.market_cap_usd ? token.market_cap_usd.toFixed(2) : 'N/A'}\n`; // Market Cap
      if (token.hasEnoughData) {
        logContent += `| Technical Indicators:\n`;
        logContent += `|   SMA: ${token.indicators.sma.toFixed(8)}\n`;
        logContent += `|   EMA: ${token.indicators.ema.toFixed(8)}\n`;
        logContent += `|   MACD: ${token.indicators.macd.MACD.toFixed(8)}, Signal: ${token.indicators.macd.signal.toFixed(8)}, Histogram: ${token.indicators.macd.histogram.toFixed(8)}\n`;
        logContent += `|   RSI: ${token.indicators.rsi.toFixed(2)}\n`;
        logContent += `|   Bollinger Bands: Upper: ${token.indicators.bollinger.upper.toFixed(8)}, Middle: ${token.indicators.bollinger.middle.toFixed(8)}, Lower: ${token.indicators.bollinger.lower.toFixed(8)}\n`;
      } else {
        logContent += `| Insufficient data for technical analysis.\n`;
      }
      logContent += `| Buy: ${token.buySignal.shouldBuy ? 'Yes' : 'No'}\n`;
      if (token.buySignal.shouldBuy) {
        logContent += `| Reasons: ${token.buySignal.reasons}\n`;
      }
      logContent += `+${'-'.repeat(50)}+\n\n`;
    });
  }
  console.log(logContent);
  fs.appendFileSync('geckoCoin.log', logContent);
};

// Main function with rate limiting
const main = async () => {
  console.log('Starting advanced TA-based Solana memecoin strategy...');
  const network = 'solana';

  // Rate limiter: ~25 calls per minute (staying under free tier's 30/min limit)
  const limiter = new Bottleneck({
    minTime: 2400, // 60000ms / 25 = 2400ms
    maxConcurrent: 1
  });

  const newPools = await fetchNewPools(network);
  console.log(`Fetched ${newPools.length} new Solana pools`);
  const trendingPools = await fetchTrendingPools(network);
  console.log(`Fetched ${trendingPools.length} trending Solana pools`);

  const newProfitable = await filterProfitableTokens(newPools, network, limiter);
  const trendingProfitable = await filterProfitableTokens(trendingPools, network, limiter);

  const allProfitable = [...newProfitable, ...trendingProfitable].reduce((acc, token) => {
    acc[token.tokenAddress] = token;
    return acc;
  }, {});

  await displayResults(Object.values(allProfitable), network);
  console.log('Strategy completed.');
};

// Run the script
main().catch(error => console.error('Error:', error));