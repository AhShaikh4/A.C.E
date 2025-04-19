//TA.js

const fs = require('fs').promises;
const axios = require('axios');
const technicalindicators = require('technicalindicators');
const Bottleneck = require('bottleneck');
const { DexScreenerService } = require('./src/services/dexscreener.js');
const { fetchTrendingPools } = require('./src/services/gecko.js');
const { getTokenHolders, getTokenHoldersHistorical, getTokenAnalytics, getSnipers } = require('./src/services/moralis.js');
const { isBlacklisted, initializeBlacklist } = require('./blacklist');
const logger = require('./logger');
const { BOT_CONFIG } = require('./config');

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

const BASE_URL = 'https://api.geckoterminal.com/api/v2';
const HEADERS = { Accept: 'application/json;version=20230302' };
const limiter = new Bottleneck({ minTime: 3000, maxConcurrent: 1 });

const apiCall = async (url, retries = 5) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, { headers: HEADERS });
      return response.data;
    } catch (error) {
      if (error.response?.status === 429) {
        const delay = Math.min(60000, 2000 * Math.pow(2, i));
        logger.error(`Rate limit hit (429). Waiting ${delay / 1000}s before retry ${i + 1}/${retries}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      if (error.response?.status === 404) {
        logger.warn(`Resource not found (404) for ${url}`);
        return null;
      }
      logger.error(`API call failed: ${url} - ${error.response?.status || error.message}`);
      if (i === retries - 1) return null;
      await new Promise(resolve => setTimeout(resolve, 2500 * (i + 1)));
    }
  }
};

const fetchOHLCV = async (network, poolAddress, tokenSymbol, timeframe, aggregate = 1) => {
  const url = `${BASE_URL}/networks/${network}/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=100`;
  const data = await limiter.schedule(() => apiCall(url));
  if (!data?.data?.attributes?.ohlcv_list) {
    logger.warn(`No OHLCV data for ${tokenSymbol} (${timeframe}${aggregate > 1 ? `:${aggregate}m` : ''})`);
    return [];
  }
  const ohlcv = data.data.attributes.ohlcv_list.map(([timestamp, open, high, low, close, volume]) => ({
    timestamp, open, high, low, close, volume
  }));
  logger.debug(`OHLCV data for ${tokenSymbol} (${timeframe}${aggregate > 1 ? `:${aggregate}m` : ''}): ${ohlcv.length} candles`);
  return ohlcv;
};

// Custom TA Implementations (unchanged)
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

// Calculate Ichimoku Cloud components
const calculateIchimoku = (highs, lows, closes) => {
  // Minimum data required for Ichimoku calculation is 52 periods
  if (highs.length < 52 || lows.length < 52 || closes.length < 52) {
    return {
      tenkanSen: 0,
      kijunSen: 0,
      senkouSpanA: 0,
      senkouSpanB: 0,
      chikouSpan: 0
    };
  }

  // Tenkan-sen (Conversion Line): (9-period high + 9-period low) / 2
  const tenkanPeriod = 9;
  const tenkanHighs = highs.slice(-tenkanPeriod);
  const tenkanLows = lows.slice(-tenkanPeriod);
  const tenkanSen = (Math.max(...tenkanHighs) + Math.min(...tenkanLows)) / 2;

  // Kijun-sen (Base Line): (26-period high + 26-period low) / 2
  const kijunPeriod = 26;
  const kijunHighs = highs.slice(-kijunPeriod);
  const kijunLows = lows.slice(-kijunPeriod);
  const kijunSen = (Math.max(...kijunHighs) + Math.min(...kijunLows)) / 2;

  // Senkou Span A (Leading Span A): (Tenkan-sen + Kijun-sen) / 2
  const senkouSpanA = (tenkanSen + kijunSen) / 2;

  // Senkou Span B (Leading Span B): (52-period high + 52-period low) / 2
  const senkouPeriod = 52;
  const senkouHighs = highs.slice(-senkouPeriod);
  const senkouLows = lows.slice(-senkouPeriod);
  const senkouSpanB = (Math.max(...senkouHighs) + Math.min(...senkouLows)) / 2;

  // Chikou Span (Lagging Span): Current closing price time-shifted backwards 26 periods
  const chikouSpan = closes.length >= 26 ? closes[closes.length - 26] : 0;

  return {
    tenkanSen,
    kijunSen,
    senkouSpanA,
    senkouSpanB,
    chikouSpan
  };
};

const calculateIndicators = (ohlcv, options = {}) => {
  // Default options
  const {
    calculateBasic = true,     // Basic indicators (SMA, EMA, RSI)
    calculateIntermediate = true, // Intermediate indicators (MACD, Bollinger)
    calculateAdvanced = true,  // Advanced indicators (Ichimoku, Keltner)
    calculateVolume = true     // Volume-based indicators (OBV, MFI, etc.)
  } = options;

  if (!ohlcv || ohlcv.length < 1) {
    logger.warn(`Insufficient OHLCV data: ${ohlcv?.length || 0} candles`);
    return {};
  }

  // Extract data once to avoid repeated mapping
  const closes = ohlcv.map(c => c.close);
  const highs = ohlcv.map(c => c.high);
  const lows = ohlcv.map(c => c.low);
  const volumes = ohlcv.map(c => c.volume);
  const period = Math.min(20, ohlcv.length);

  // Initialize result object
  const result = {};

  // Calculate basic indicators (always calculated as they're fast and used frequently)
  if (calculateBasic) {
    // Basic indicators - fast to calculate and frequently used in decision making
    result.sma = SMA.calculate({ period, values: closes }).slice(-1)[0] || 0;
    result.ema = EMA.calculate({ period, values: closes }).slice(-1)[0] || 0;
    result.trima = calculateTRIMA(closes, period);

    // These are used in trading decisions frequently
    result.rsi = ohlcv.length >= 14 ? RSI.calculate({ values: closes, period: Math.min(14, period) }).slice(-1)[0] : 0;
    result.trueRange = TrueRange.calculate({ high: highs, low: lows, close: closes }).slice(-1)[0] || 0;
    result.atr = ohlcv.length >= 14 ? ATR.calculate({ high: highs, low: lows, close: closes, period: Math.min(14, period) }).slice(-1)[0] : 0;
  }

  // Calculate intermediate indicators (moderately complex)
  if (calculateIntermediate && ohlcv.length >= 14) {
    // Moving averages and derivatives
    result.dema = ohlcv.length >= period * 2 ? calculateDEMA(closes, period) : 0;
    result.tema = ohlcv.length >= period * 3 ? calculateTEMA(closes, period) : 0;
    result.vwma = calculateVWMA(closes, volumes, period);

    // Momentum indicators
    result.macd = ohlcv.length >= 26 ? MACD.calculate({ values: closes, fastPeriod: Math.min(12, period), slowPeriod: Math.min(26, period), signalPeriod: Math.min(9, period) }).slice(-1)[0] : { MACD: 0, signal: 0, histogram: 0 };
    result.stochastic = ohlcv.length >= 14 ? Stochastic.calculate({ high: highs, low: lows, close: closes, period: Math.min(14, period), signalPeriod: Math.min(3, period) }).slice(-1)[0] : { k: 0, d: 0 };
    result.williamsR = ohlcv.length >= 14 ? WilliamsR.calculate({ high: highs, low: lows, close: closes, period: Math.min(14, period) }).slice(-1)[0] : 0;
    result.roc = ohlcv.length >= 12 ? ROC.calculate({ values: closes, period: Math.min(12, period) }).slice(-1)[0] : 0;

    // Volatility indicators
    result.bollinger = BollingerBands.calculate({ period, stdDev: 2, values: closes }).slice(-1)[0] || { upper: 0, middle: 0, lower: 0 };
  }

  // Calculate advanced indicators (more complex, computationally intensive)
  if (calculateAdvanced && ohlcv.length >= 26) {
    result.psar = PSAR.calculate({ high: highs, low: lows, step: 0.02, max: 0.2 }).slice(-1)[0] || 0;
    result.vortex = ohlcv.length >= 15 ? calculateVortex(highs, lows, closes, Math.min(14, period)) : { VIPlus: 0, VIMinus: 0 };
    result.cci = ohlcv.length >= period ? CCI.calculate({ high: highs, low: lows, close: closes, period }).slice(-1)[0] : 0;
    result.ppo = ohlcv.length >= 26 ? calculatePPO(closes, Math.min(12, period), Math.min(26, period), Math.min(9, period)) : { PPO: 0, signal: 0 };
    result.awesome = ohlcv.length >= 34 ? AwesomeOscillator.calculate({ high: highs, low: lows, fastPeriod: Math.min(5, period), slowPeriod: Math.min(34, period) }).slice(-1)[0] : 0;
    result.keltner = ohlcv.length >= period ? calculateKeltnerChannel(highs, lows, closes, period, 2) : { upper: 0, middle: 0, lower: 0 };

    // Ichimoku is one of the most computationally intensive indicators
    // Only calculate if we have enough data
    if (ohlcv.length >= 52) {
      result.ichimoku = calculateIchimoku(highs, lows, closes);
    } else {
      result.ichimoku = {
        tenkanSen: 0,
        kijunSen: 0,
        senkouSpanA: 0,
        senkouSpanB: 0,
        chikouSpan: 0
      };
    }
  }

  // Calculate volume-based indicators
  if (calculateVolume && volumes.length > 0) {
    result.obv = OBV.calculate({ close: closes, volume: volumes }).slice(-1)[0] || 0;
    result.mfi = ohlcv.length >= 14 ? MFI.calculate({ high: highs, low: lows, close: closes, volume: volumes, period: Math.min(14, period) }).slice(-1)[0] : 0;
    result.ad = calculateAD(highs, lows, closes, volumes);
    result.cmf = ohlcv.length >= period ? calculateCMF(highs, lows, closes, volumes, period) : 0;
    result.vpt = ohlcv.length >= 2 ? calculateVPT(closes, volumes) : 0;
    result.vwap = VWAP.calculate({ high: highs, low: lows, close: closes, volume: volumes }).slice(-1)[0] || 0;
  }

  return result;
};

const normalizeGeckoToken = async (pool, boostedSet, dexService, skipDetailedData = false) => {
  try {
    const attributes = pool.attributes;
    const tokenAddress = pool.relationships.base_token.data.id.split('_')[1];

    const dexPairs = await dexService.getPairsFromBoosted([{ tokenAddress }]);
    const dexData = dexPairs.length > 0 ? dexPairs[0] : null;

    // Initialize with empty objects/arrays for optional data
    let ohlcvData = {};
    let holders = { totalHolders: 0 };
    let historicalHolders = { result: [] };
    let analytics = {};
    let snipers = { result: [] };

    // Only fetch detailed data if not skipping
    if (!skipDetailedData) {
      // Fetch OHLCV data
      const timeframes = [
        { timeframe: 'minute', aggregate: 1 },
        { timeframe: 'minute', aggregate: 15 },
        { timeframe: 'hour', aggregate: 1 }
      ];

      for (const { timeframe, aggregate } of timeframes) {
        const key = `${timeframe}${aggregate > 1 ? `:${aggregate}m` : ''}`;
        ohlcvData[key] = await fetchOHLCV('solana', attributes.address, attributes.name.split(' / ')[0], timeframe, aggregate);
      }

      // Fetch Moralis data if enabled
      if (BOT_CONFIG.MORALIS_ENABLED) {
        const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // YYYY-MM-DD
        const toDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        [holders, historicalHolders, analytics, snipers] = await Promise.all([
          getTokenHolders(tokenAddress).catch(() => ({ totalHolders: 0 })),
          getTokenHoldersHistorical(tokenAddress, fromDate, toDate).catch(() => ({ result: [] })),
          getTokenAnalytics(tokenAddress).catch(() => ({})),
          getSnipers(attributes.address).catch(() => ({ result: [] }))
        ]);
      } else {
        // Use fallback data when Moralis is disabled
        logger.debug(`Moralis API disabled, using fallback data for ${tokenAddress}`);
      }
    }

    return {
      source: 'geckoterminal',
      tokenAddress,
      poolAddress: attributes.address,
      symbol: attributes.name.split(' / ')[0],
      name: attributes.name,
      priceUsd: parseFloat(attributes.base_token_price_usd || 0),
      volume24h: parseFloat(attributes.volume_usd.h24 || 0),
      liquidity: parseFloat(attributes.reserve_in_usd || 0),
      marketCap: parseFloat(attributes.market_cap_usd || 0),
      priceChange: {
        m5: dexData?.priceChange?.m5 || 0,
        h1: dexData?.priceChange?.h1 || 0,
        h6: dexData?.priceChange?.h6 || 0,
        h24: dexData?.priceChange?.h24 || parseFloat(attributes.price_change_percentage.h24 || 0)
      },
      pairAgeDays: attributes.pool_created_at ? (Date.now() - new Date(attributes.pool_created_at).getTime()) / (1000 * 60 * 60 * 24) : 0,
      isBoosted: boostedSet.has(tokenAddress),
      ohlcv: ohlcvData,
      quoteTokenPriceUsd: parseFloat(attributes.quote_token_price_usd || 0),
      holders,
      historicalHolders,
      analytics,
      snipers
    };
  } catch (error) {
    logger.error(`Error normalizing GeckoTerminal token ${pool.attributes.name.split(' / ')[0]}: ${error.message}`);
    return null;
  }
};

const calculateScore = (token) => {
  let score = 0;
  const indicators = token.indicators['hour'] || token.indicators['minute'] || {};

  // Technical indicators scoring
  if (indicators.macd?.MACD > indicators.macd?.signal && indicators.macd?.histogram > 0) score += 10;
  if (token.priceUsd > indicators.psar) score += 5;
  if (indicators.rsi < 30) score += 5;
  if (indicators.stochastic?.k > indicators.stochastic?.d && indicators.stochastic?.k < 80) score += 5;
  if (indicators.awesome > 0) score += 5;
  if (token.priceUsd > indicators.bollinger?.upper) score += 5;
  if (token.priceUsd > indicators.keltner?.upper) score += 5;
  if (indicators.cmf > 0) score += 3;
  if (indicators.mfi < 20) score += 3;

  // Transaction data scoring (if available)
  if (token.txns) {
    // Buy/Sell ratio scoring
    const buySellRatio24h = token.txns.h24.buys / (token.txns.h24.sells || 1);
    const buySellRatio5m = token.txns.m5.buys / (token.txns.m5.sells || 1);

    if (buySellRatio24h > 1.5) score += 15; // Strong buying pressure
    if (buySellRatio5m > 1) score += 10;    // Recent buying surge

    // Buy pressure momentum
    const buyPressure5m = token.txns.m5.buys / (token.txns.m5.buys + token.txns.m5.sells || 1);
    const buyPressure1h = token.txns.h1.buys / (token.txns.h1.buys + token.txns.h1.sells || 1);
    if (buyPressure5m > buyPressure1h && buyPressure5m > 0.6) score += 15; // Increasing buy pressure
  }

  // Volume trends scoring (if detailed volume data available)
  if (token.volume && token.volume.m5 && token.volume.h1 && token.volume.h24) {
    // Volume spike detection
    const volumeSpike1h = (token.volume.h1 / (token.volume.h24 / 24)) || 0;
    if (volumeSpike1h > 2) score += 10; // Recent volume increase

    // Volume acceleration detection
    const volumeAcceleration = (token.volume.m5 / (token.volume.h1 / 12)) -
                             ((token.volume.h1 / 12) / (token.volume.h6 / 72));
    if (volumeAcceleration > 0.5) score += 15; // Strong volume acceleration
  }

  // Include uptrend score if available
  if (token.uptrendScore) {
    score += token.uptrendScore * 0.2; // Add 20% of the uptrend score
  }

  // Ichimoku Cloud scoring
  if (indicators.ichimoku) {
    // Price above the cloud (bullish)
    if (token.priceUsd > Math.max(indicators.ichimoku.senkouSpanA, indicators.ichimoku.senkouSpanB)) {
      score += 10;
    }

    // Tenkan-sen crosses above Kijun-sen (bullish signal)
    if (indicators.ichimoku.tenkanSen > indicators.ichimoku.kijunSen) {
      score += 5;
    }

    // Chikou Span above price (confirmation of uptrend)
    if (indicators.ichimoku.chikouSpan > token.priceUsd) {
      score += 5;
    }
  }

  // Include selected time periods in scoring with appropriate weights
  // Prioritize recent momentum with higher weights for 5M and 1H
  score += (token.priceChange.m5 * 0.3) +    // Short-term (5 minutes) - increased weight
           (token.priceChange.h1 * 0.3) +    // Medium-term (1 hour) - increased weight
           (token.priceChange.h6 * 0.2) +    // Medium-term (6 hours) - decreased weight
           (token.priceChange.h24 * 0.2);    // Long-term (24 hours) - decreased weight

  // Add penalty for negative 5M price change (lack of recent momentum)
  if (token.priceChange.m5 < 0) score -= 10;
  if (token.isBoosted) score += 10;

  const holderChange24h = token.historicalHolders?.result?.length > 1
    ? ((token.historicalHolders.result[token.historicalHolders.result.length - 1].totalHolders -
        token.historicalHolders.result[0].totalHolders) / (token.historicalHolders.result[0].totalHolders || 1) * 100) || 0
    : 0;
  score += holderChange24h * 0.5;

  const sniperProfit = token.snipers?.result?.reduce((sum, s) => sum + (s.realizedProfitUsd || 0), 0) || 0;
  score += Math.min(20, sniperProfit / 1000);

  const volumeLiquidityRatio = token.volume24h / (token.liquidity || 1);
  score += Math.min(10, volumeLiquidityRatio * 2);

  // Normalize score to 0-100 scale
  // Based on analysis of the scoring system, a very good token might score around 150-200 points
  // We'll use a max theoretical score of 200 for normalization
  const MAX_THEORETICAL_SCORE = 200;
  const normalizedScore = Math.min(100, Math.max(0, (score / MAX_THEORETICAL_SCORE) * 100));

  // Store both the raw and normalized scores
  return {
    raw: score,
    normalized: normalizedScore
  };
};

const analyzeGeckoPool = async (pool, _network, boostedSet, dexService, skipDetailedData = false) => {
  try {
    const normalizedToken = await normalizeGeckoToken(pool, boostedSet, dexService, skipDetailedData);
    if (!normalizedToken) {
      logger.warn(`Skipping pool ${pool.attributes.name} due to normalization failure`);
      return null;
    }

    // If we're skipping detailed data, just return the basic token info
    if (skipDetailedData) {
      return normalizedToken;
    }

    // Otherwise, calculate indicators and score
    const indicators = {};
    for (const timeframe in normalizedToken.ohlcv) {
      indicators[timeframe] = calculateIndicators(normalizedToken.ohlcv[timeframe]);
    }

    const score = calculateScore({ ...normalizedToken, indicators });
    return {
      ...normalizedToken,
      indicators,
      score
    };
  } catch (error) {
    logger.error(`Error analyzing pool ${pool.attributes.name}: ${error.message}`);
    return null;
  }
};

async function performTA(dexServiceParam) {
  logger.infoUser('Starting advanced TA-based Solana memecoin analysis with tiered filtering...');
  const network = 'solana';
  const dexService = dexServiceParam || new DexScreenerService();

  // Initialize blacklist
  await initializeBlacklist();
  logger.logUser(`Loaded ${require('./blacklist').getBlacklistSize()} tokens from blacklist`);

  // Step 1: Fetch DexScreener Boosted Tokens
  logger.infoUser('Step 1: Fetching and filtering boosted tokens from DexScreener...');
  const allBoostedTokens = await dexService.getBoostedSolanaTokens();
  logger.infoUser(`Found ${allBoostedTokens.length} unique boosted Solana tokens.`);

  // Fetch pair data for all boosted tokens
  logger.infoUser('Fetching pair data for boosted tokens...');
  const boostedPairs = await dexService.getPairsFromBoosted(allBoostedTokens);
  logger.infoUser(`Fetched pair data for ${boostedPairs.length} boosted tokens`);

  // Enrich token data with pair data
  const enrichedBoostedTokens = allBoostedTokens.map(token => {
    const pair = boostedPairs.find(p => p.tokenAddress === token.tokenAddress) || {};
    return { ...token, pairData: pair };
  });

  // No need to log sample tokens - removed debug output

  // Filter boosted tokens by criteria with looser thresholds
  const boostedTokens = enrichedBoostedTokens
    .filter(token => {
      const pair = token.pairData || {};
      const priceChange24h = pair.priceChange?.h24 || 0;
      const liquidityUsd = pair.liquidity?.usd || 0;
      const volume24h = pair.volume?.h24 || 0;

      // Check if token is blacklisted
      if (isBlacklisted(token.tokenAddress)) {
        logger.debug(`Skipping blacklisted token: ${token.symbol || 'Unknown'} (${token.tokenAddress})`);
        return false;
      }

      // Skip logging individual token filtering
      return (
        priceChange24h > -20 && // Allow more downtrend
        liquidityUsd >= 20000 && // Increased minimum liquidity
        volume24h >= 20000 // Increased minimum volume
      );
    })
    .slice(0, 50); // Cap at 50 tokens

  // Create a set of boosted token addresses for reference
  const boostedSet = new Set(boostedTokens.map(token => token.tokenAddress));
  logger.infoUser(`Filtered to ${boostedTokens.length} boosted tokens`);

  // If no tokens pass the filter, suggest further loosening
  if (boostedTokens.length === 0) {
    logger.warn('WARNING: No tokens passed the initial filter. Consider further loosening criteria:');
    logger.warn('  - priceChange24h > -50 (currently -20)');
    logger.warn('  - liquidityUsd >= 100 (currently 1000)');
    logger.warn('  - volume24h >= 100 (currently 500)');
  }

  // Step 2: Fetch GeckoTerminal Trending Pools
  logger.info('Step 2: Fetching and filtering trending pools from GeckoTerminal...');
  const trendingPools = await fetchTrendingPools(network, ['1h', '6h'], 2, true);

  // Filter trending pools by criteria
  const filteredTrendingPools = trendingPools.filter(pool => {
    const tokenAddress = pool.relationships.base_token.data.id.split('_')[1];

    // Check if token is blacklisted
    if (isBlacklisted(tokenAddress)) {
      logger.debug(`Skipping blacklisted token from trending pools: ${pool.attributes.name || 'Unknown'} (${tokenAddress})`);
      return false;
    }

    return (
      parseFloat(pool.attributes.reserve_in_usd || 0) > 5000 && // Lower minimum liquidity
      parseFloat(pool.attributes.volume_usd?.h6 || 0) > 1000 // Lower minimum volume
    );
  });

  // Combine boosted tokens and trending pools, deduplicate by token address
  const tokenMap = new Map();

  // Add boosted tokens to the map
  for (const token of boostedTokens) {
    if (!token.tokenAddress) continue;
    tokenMap.set(token.tokenAddress, {
      source: 'dexscreener',
      tokenAddress: token.tokenAddress,
      dexData: token.pairData, // Use the enriched pair data
      originalToken: token
    });
  }

  // Add trending pools to the map
  for (const pool of filteredTrendingPools) {
    const tokenAddress = pool.relationships.base_token.data.id.split('_')[1];
    if (!tokenMap.has(tokenAddress)) {
      tokenMap.set(tokenAddress, {
        source: 'geckoterminal',
        tokenAddress,
        geckoPool: pool
      });
    }
  }

  // Convert map to array and cap at 30 tokens
  const uniqueTokens = Array.from(tokenMap.values()).slice(0, 30);
  logger.infoUser(`Combined to ${uniqueTokens.length} unique trending tokens`);

  // Step 3: Enhanced Price Trend & Market Activity Filter
  logger.infoUser('Step 3: Performing enhanced filtering with detailed pair data...');
  const candidates = [];

  // Define function to check if a token has a quality uptrend
  const isQualityUptrend = (pairData) => {
    // Price trend checks
    const priceUptrend = pairData.priceChange.m5 > 0 &&
                       (pairData.priceChange.h1 > 0 || pairData.priceChange.h6 > 0);

    // Transaction sentiment check
    const buySellRatio5m = pairData.txns.m5.buys / (pairData.txns.m5.sells || 1);
    const buySellRatio1h = pairData.txns.h1.buys / (pairData.txns.h1.sells || 1);
    const positiveSentiment = buySellRatio5m > 1 || buySellRatio1h > 1.2;

    // Volume confirmation
    const volumeActivity = pairData.volume.m5 > 100 && pairData.volume.h1 > 1000;

    return priceUptrend && positiveSentiment && volumeActivity;
  };

  // Define function to calculate an uptrend score for a token
  const calculateUptrendScore = (pairData) => {
    let score = 0;

    // Price Change Scoring
    score += pairData.priceChange.m5 * 0.4;  // Strong weight on recent momentum
    score += pairData.priceChange.h1 * 0.3;
    score += pairData.priceChange.h6 * 0.2;
    score += pairData.priceChange.h24 * 0.1;
    if (pairData.priceChange.m5 < 0) score -= 10; // Penalty for recent downturn

    // Transaction Sentiment Scoring
    const buySellRatio24h = pairData.txns.h24.buys / (pairData.txns.h24.sells || 1);
    const buySellRatio5m = pairData.txns.m5.buys / (pairData.txns.m5.sells || 1);
    if (buySellRatio24h > 1.5) score += 15; // Strong buying pressure
    if (buySellRatio5m > 1) score += 10;    // Recent buying surge

    // Volume Trends Scoring
    const volumeSpike1h = (pairData.volume.h1 / (pairData.volume.h24 / 24)) || 0;
    if (volumeSpike1h > 2) score += 10; // Recent volume increase

    // Volume Acceleration Detection
    const volumeAcceleration = (pairData.volume.m5 / (pairData.volume.h1 / 12)) -
                             ((pairData.volume.h1 / 12) / (pairData.volume.h6 / 72));
    if (volumeAcceleration > 0.5) score += 15; // Strong volume acceleration

    // Buy Pressure Momentum
    const buyPressure5m = pairData.txns.m5.buys / (pairData.txns.m5.buys + pairData.txns.m5.sells || 1);
    const buyPressure1h = pairData.txns.h1.buys / (pairData.txns.h1.buys + pairData.txns.h1.sells || 1);
    if (buyPressure5m > buyPressure1h && buyPressure5m > 0.6) score += 15; // Increasing buy pressure

    return score;
  };

  for (const token of uniqueTokens) {
    try {
      // Get basic pair data first (for backward compatibility)
      const dexPairs = await dexService.getPairsFromBoosted([{ tokenAddress: token.tokenAddress }]);
      if (!dexPairs.length) continue;

      const dexData = dexPairs[0];

      // Get detailed pair data using the new endpoint
      const detailedPairData = await dexService.getPairData('solana', dexData.pairAddress);

      if (detailedPairData) {
        // Use enhanced filtering with detailed pair data
        logger.debug(`Analyzing detailed data for ${token.tokenAddress} (${detailedPairData.symbol})`);

        // Calculate uptrend score
        const uptrendScore = calculateUptrendScore(detailedPairData);
        // Normalize uptrend score to 0-100 scale (assuming max theoretical score of 60)
        const normalizedUptrendScore = Math.min(100, Math.max(0, (uptrendScore / 60) * 100));
        logger.debug(`Uptrend score: ${normalizedUptrendScore.toFixed(2)}/100 (Raw: ${uptrendScore.toFixed(2)})`);
        logger.logUser(`Analyzing detailed data for ${token.tokenAddress} (${detailedPairData.symbol})`);
        logger.logUser(`Uptrend score: ${normalizedUptrendScore.toFixed(2)}/100 (Raw: ${uptrendScore.toFixed(2)})`);

        // Check if token meets quality uptrend criteria (15 on normalized scale is equivalent to 30 on raw scale with max of 200)
        if (isQualityUptrend(detailedPairData) || normalizedUptrendScore > 50) {
          logger.infoUser(`Token ${detailedPairData.symbol} passed enhanced filtering`);

          // Add enhanced data to candidates
          candidates.push({
            source: 'dexscreener',
            tokenAddress: detailedPairData.tokenAddress,
            poolAddress: detailedPairData.pairAddress || '',
            symbol: detailedPairData.symbol || '',
            name: detailedPairData.name || '',
            priceUsd: detailedPairData.priceUsd || 0,
            volume24h: detailedPairData.volume?.h24 || 0,
            liquidity: detailedPairData.liquidity || 0,
            marketCap: detailedPairData.marketCap || 0,
            priceChange: {
              m5: detailedPairData.priceChange?.m5 || 0,
              h1: detailedPairData.priceChange?.h1 || 0,
              h6: detailedPairData.priceChange?.h6 || 0,
              h24: detailedPairData.priceChange?.h24 || 0
            },
            txns: detailedPairData.txns || {
              m5: { buys: 0, sells: 0 },
              h1: { buys: 0, sells: 0 },
              h6: { buys: 0, sells: 0 },
              h24: { buys: 0, sells: 0 }
            },
            pairAgeDays: detailedPairData.pairCreatedAt ? (Date.now() - detailedPairData.pairCreatedAt) / (1000 * 60 * 60 * 24) : 0,
            isBoosted: detailedPairData.isBoosted,
            uptrendScore: normalizedUptrendScore,
            rawUptrendScore: uptrendScore
          });
        } else {
          logger.debug(`Token ${detailedPairData.symbol} failed enhanced filtering`);
          logger.logUser(`Token ${detailedPairData.symbol} failed enhanced filtering`);
        }
      } else {
        logger.warn(`No detailed pair data found for ${token.tokenAddress}, using basic data`);
        // Fall back to basic criteria if detailed data is not available
        if ((dexData.priceChange?.h6 > 0 || dexData.priceChange?.h24 > 0) && dexData.priceChange?.m5 > -1) {
          // For GeckoTerminal tokens, normalize the data
          if (token.source === 'geckoterminal') {
            const normalizedToken = await normalizeGeckoToken(token.geckoPool, boostedSet, dexService, true); // Skip detailed data
            if (normalizedToken) {
              candidates.push({
                ...normalizedToken,
                dexData
              });
            }
          } else {
            // For DexScreener tokens, use the data we already have
            candidates.push({
              source: 'dexscreener',
              tokenAddress: token.tokenAddress,
              poolAddress: dexData.pairAddress || '',
              symbol: dexData.baseToken?.symbol || '',
              name: dexData.baseToken?.name || '',
              priceUsd: parseFloat(dexData.priceUsd || 0),
              volume24h: dexData.volume?.h24 || 0,
              liquidity: dexData.liquidity?.usd || 0,
              marketCap: dexData.fdv || 0,
              priceChange: {
                m5: dexData.priceChange?.m5 || 0,
                h1: dexData.priceChange?.h1 || 0,
                h6: dexData.priceChange?.h6 || 0,
                h24: dexData.priceChange?.h24 || 0
              },
              pairAgeDays: dexData.pairCreatedAt ? (Date.now() - dexData.pairCreatedAt) / (1000 * 60 * 60 * 24) : 0,
              isBoosted: boostedSet.has(token.tokenAddress)
            });
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing token ${token.tokenAddress}: ${error.message}`);
    }
  }

  // Cap at 15 candidates
  const topCandidates = candidates.slice(0, 15);
  logger.infoUser(`Filtered to ${topCandidates.length} uptrending candidates`);

  // Step 4: Detailed TA
  logger.infoUser('Step 4: Performing detailed technical analysis...');
  const analyzedTokens = [];

  for (const token of topCandidates) {
    try {
      // Fetch OHLCV data (1h only for efficiency)
      const ohlcvData = await fetchOHLCV(network, token.poolAddress, token.symbol, 'hour', 1);
      logger.logUser(`OHLCV data for ${token.symbol} (hour): ${ohlcvData.length} candles`);

      // For initial scoring, we only need basic and intermediate indicators
      // This significantly reduces computation time
      const indicators = {
        hour: calculateIndicators(ohlcvData, {
          calculateBasic: true,
          calculateIntermediate: true,
          calculateAdvanced: false,  // Skip advanced indicators for initial scoring
          calculateVolume: true      // Volume indicators are important for scoring
        })
      };

      // Calculate score
      const scoreResult = calculateScore({ ...token, indicators });

      // Keep if normalized score > 15 (equivalent to raw score > 30 with MAX_THEORETICAL_SCORE = 200)
      if (scoreResult.normalized > 15) {
        // For tokens that pass initial scoring, calculate the full set of indicators
        // This ensures we have all indicators available for trading decisions
        const fullIndicators = {
          hour: calculateIndicators(ohlcvData, {
            calculateBasic: true,
            calculateIntermediate: true,
            calculateAdvanced: true,
            calculateVolume: true
          })
        };

        analyzedTokens.push({
          ...token,
          indicators: fullIndicators,  // Use the complete set of indicators
          score: scoreResult.normalized,
          rawScore: scoreResult.raw,
          ohlcv: { hour: ohlcvData } // Only keep the hour timeframe data
        });
      }
    } catch (error) {
      logger.error(`Error analyzing token ${token.symbol}: ${error.message}`);
    }
  }

  // Sort by score and take top 7
  const topAnalyzedTokens = analyzedTokens
    .sort((a, b) => b.score - a.score)
    .slice(0, 7);

  logger.infoUser(`Analyzed ${analyzedTokens.length} tokens with TA, found ${topAnalyzedTokens.length} high-scoring tokens`);

  // Step 5: Moralis Validation (with fallback for API failures)
  logger.infoUser('Step 5: Performing Moralis validation...');
  let finalTokens = [];

  // Check if Moralis API is enabled
  if (BOT_CONFIG.MORALIS_ENABLED) {
    for (const token of topAnalyzedTokens) {
      try {
        // Fetch Moralis data
        const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // YYYY-MM-DD
        const toDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        const [holders, historicalHolders, snipers] = await Promise.all([
          getTokenHolders(token.tokenAddress).catch(() => ({ totalHolders: 0 })),
          getTokenHoldersHistorical(token.tokenAddress, fromDate, toDate).catch(() => ({ result: [] })),
          getSnipers(token.poolAddress).catch(() => ({ result: [] }))
        ]);

        // Calculate holder change percentage
        const holderChange24h = historicalHolders?.result?.length > 1
          ? ((historicalHolders.result[historicalHolders.result.length - 1].totalHolders -
              historicalHolders.result[0].totalHolders) / (historicalHolders.result[0].totalHolders || 1) * 100) || 0
          : 0;

        // Keep if holder change is positive and not too many snipers
        if (holderChange24h > 0 && snipers.result.length < 50) {
          finalTokens.push({
            ...token,
            holders,
            historicalHolders,
            snipers,
            holderChange24h
          });
        }
      } catch (error) {
        logger.error(`Error validating token ${token.symbol}: ${error.message}`);
      }
    }
  } else {
    logger.warn('Moralis API is disabled. Skipping Moralis validation step.');
  }

  // Fallback: If Moralis validation fails (API errors), use top tokens from TA
  if (finalTokens.length === 0 && topAnalyzedTokens.length > 0) {
    logger.warn('WARNING: Moralis validation failed. Using top tokens from technical analysis as fallback.');
    logger.logUser('WARNING: Moralis validation failed. Using top tokens from technical analysis as fallback.', false);

    // Take top 3 tokens and ensure they have all necessary indicators
    finalTokens = await Promise.all(topAnalyzedTokens.slice(0, 3).map(async token => {
      // Ensure we have all the indicators needed for trading decisions
      // This is a safety check in case some indicators were skipped during optimization
      const missingAdvancedIndicators = !token.indicators.hour.ichimoku || !token.indicators.hour.keltner;

      if (missingAdvancedIndicators) {
        try {
          // Recalculate with all indicators if any advanced ones are missing
          const ohlcvData = token.ohlcv.hour;
          const fullIndicators = {
            hour: calculateIndicators(ohlcvData, {
              calculateBasic: true,
              calculateIntermediate: true,
              calculateAdvanced: true,
              calculateVolume: true
            })
          };

          return {
            ...token,
            indicators: fullIndicators,
            holders: { totalHolders: 0 },
            historicalHolders: { result: [] },
            snipers: { result: [] },
            holderChange24h: 0
          };
        } catch (error) {
          logger.error(`Error recalculating indicators for ${token.symbol}: ${error.message}`);
          // Return the token as is if recalculation fails
          return {
            ...token,
            holders: { totalHolders: 0 },
            historicalHolders: { result: [] },
            snipers: { result: [] },
            holderChange24h: 0
          };
        }
      } else {
        // All indicators are already present
        return {
          ...token,
          holders: { totalHolders: 0 },
          historicalHolders: { result: [] },
          snipers: { result: [] },
          holderChange24h: 0
        };
      }
    }));
  }

  logger.infoUser(`Final ${finalTokens.length} tokens after Moralis validation`);

  // Step 6: Log and Return
  // Take top 5 tokens for display
  const displayTokens = finalTokens.slice(0, 5);

  let logContent = '\n=== Top Solana Memecoins (Tiered Analysis) ===\n\n';
  if (!displayTokens.length) {
    logContent += 'No tokens found.\n';
  } else {
    displayTokens.forEach((token, index) => {
      logContent += `+${'-'.repeat(50)}+\n`;
      logContent += `| ${index + 1}. ${token.symbol} (${token.name})\n`;
      logContent += `| Token Address: ${token.tokenAddress}\n`;
      logContent += `| Pool Address: ${token.poolAddress}\n`;
      logContent += `| Price (USD): $${token.priceUsd.toFixed(6)}\n`;

      // Volume data with more detail if available
      if (token.volume) {
        logContent += `| Volume: 5m: $${token.volume.m5?.toFixed(2) || '0.00'}, 1h: $${token.volume.h1?.toFixed(2) || '0.00'}, 24h: $${token.volume24h.toFixed(2)}\n`;
      } else {
        logContent += `| 24h Volume: $${token.volume24h.toFixed(2)}\n`;
      }

      // Price changes for selected time periods
      logContent += `| 5m Price Change: ${token.priceChange.m5.toFixed(2)}%\n`;
      logContent += `| 1h Price Change: ${token.priceChange.h1.toFixed(2)}%\n`;
      logContent += `| 6h Price Change: ${token.priceChange.h6.toFixed(2)}%\n`;
      logContent += `| 24h Price Change: ${token.priceChange.h24.toFixed(2)}%\n`;

      // Transaction data if available
      if (token.txns) {
        logContent += `| Txns (5m): Buys: ${token.txns.m5.buys}, Sells: ${token.txns.m5.sells}, Ratio: ${(token.txns.m5.buys / (token.txns.m5.sells || 1)).toFixed(2)}\n`;
        logContent += `| Txns (1h): Buys: ${token.txns.h1.buys}, Sells: ${token.txns.h1.sells}, Ratio: ${(token.txns.h1.buys / (token.txns.h1.sells || 1)).toFixed(2)}\n`;
        logContent += `| Txns (24h): Buys: ${token.txns.h24.buys}, Sells: ${token.txns.h24.sells}, Ratio: ${(token.txns.h24.buys / (token.txns.h24.sells || 1)).toFixed(2)}\n`;
      }

      logContent += `| Liquidity: $${token.liquidity.toFixed(2)}\n`;
      logContent += `| Market Cap: $${token.marketCap.toFixed(2)}\n`;
      logContent += `| Age: ${token.pairAgeDays.toFixed(2)} days\n`;
      logContent += `| Boosted: ${token.isBoosted ? 'Yes' : 'No'}\n`;

      // Add uptrend score if available
      if (token.uptrendScore) {
        logContent += `| Uptrend Score: ${token.uptrendScore.toFixed(2)}/100${token.rawUptrendScore ? ` (Raw: ${token.rawUptrendScore.toFixed(2)})` : ''}\n`;
      }

      logContent += `| Holders: ${token.holders.totalHolders || 0}\n`;
      logContent += `| Holder Change (24h): ${token.historicalHolders?.result?.length > 1 ? (token.historicalHolders.result[token.historicalHolders.result.length - 1].totalHolders - token.historicalHolders.result[0].totalHolders) : 0} (${token.holderChange24h.toFixed(2)}%)\n`;
      logContent += `| Sniper Count: ${token.snipers?.result?.length || 0}\n`;
      logContent += `| Sniper Profit: $${token.snipers?.result?.reduce((sum, s) => sum + (s.realizedProfitUsd || 0), 0).toFixed(2) || 0}\n`;
      logContent += `| Score: ${token.score.toFixed(2)}/100${token.rawScore ? ` (Raw: ${token.rawScore.toFixed(2)})` : ''}\n`;
      logContent += `| Technical Indicators (1h):\n`;
      const indicators = token.indicators['hour'] || {};
      logContent += `|   SMA: ${indicators.sma?.toFixed(8) || 'N/A'}\n`;
      logContent += `|   EMA: ${indicators.ema?.toFixed(8) || 'N/A'}\n`;
      logContent += `|   MACD: ${indicators.macd?.MACD?.toFixed(8) || 'N/A'}, Signal: ${indicators.macd?.signal?.toFixed(8) || 'N/A'}, Histogram: ${indicators.macd?.histogram?.toFixed(8) || 'N/A'}\n`;
      logContent += `|   RSI: ${indicators.rsi?.toFixed(2) || 'N/A'}\n`;
      logContent += `|   Bollinger Bands: Upper: ${indicators.bollinger?.upper?.toFixed(8) || 'N/A'}, Middle: ${indicators.bollinger?.middle?.toFixed(8) || 'N/A'}, Lower: ${indicators.bollinger?.lower?.toFixed(8) || 'N/A'}\n`;
      logContent += `|   Ichimoku Cloud:\n`;
      logContent += `|     Tenkan-sen: ${indicators.ichimoku?.tenkanSen?.toFixed(8) || 'N/A'}\n`;
      logContent += `|     Kijun-sen: ${indicators.ichimoku?.kijunSen?.toFixed(8) || 'N/A'}\n`;
      logContent += `|     Senkou Span A: ${indicators.ichimoku?.senkouSpanA?.toFixed(8) || 'N/A'}\n`;
      logContent += `|     Senkou Span B: ${indicators.ichimoku?.senkouSpanB?.toFixed(8) || 'N/A'}\n`;
      logContent += `|     Chikou Span: ${indicators.ichimoku?.chikouSpan?.toFixed(8) || 'N/A'}\n`;
      logContent += `+${'-'.repeat(50)}+\n\n`;
    });
  }

  logger.info(logContent);
  await fs.writeFile('gecko_analysis.log', logContent);

  logger.info('Technical analysis completed.');
  return finalTokens;
}

async function main() {
  try {
    const finalTokens = await performTA();
    logger.info(`Analysis complete. Found ${finalTokens.length} tokens.`);
    return finalTokens;
  } catch (error) {
    logger.error('Error in TA:', error.message);
    throw error;
  }
}

// Only run main() if this file is executed directly, not when imported
if (require.main === module) {
  main().then(tokens => {
    logger.info('Technical analysis completed. Use main.js to start trading.');
  }).catch(err => {
    logger.error('Fatal error:', err);
    process.exit(1);
  });
}

// Export functions for use in trading.js and simulation
module.exports = { fetchOHLCV, calculateIndicators, performTA };