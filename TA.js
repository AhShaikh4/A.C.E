const fs = require('fs').promises;
const axios = require('axios');
const technicalindicators = require('technicalindicators');
const Bottleneck = require('bottleneck');
const { DexScreenerService } = require('./src/services/dexscreener.js');
const { fetchTrendingPools } = require('./src/services/gecko.js');
const { getTokenHolders, getTokenHoldersHistorical, getTokenAnalytics, getSnipers } = require('./src/services/morali.js');

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
        console.error(`Rate limit hit (429). Waiting ${delay / 1000}s before retry ${i + 1}/${retries}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      if (error.response?.status === 404) {
        console.warn(`Resource not found (404) for ${url}`);
        return null;
      }
      console.error(`API call failed: ${url} - ${error.response?.status || error.message}`);
      if (i === retries - 1) return null;
      await new Promise(resolve => setTimeout(resolve, 2500 * (i + 1)));
    }
  }
};

const fetchOHLCV = async (network, poolAddress, tokenSymbol, timeframe, aggregate = 1) => {
  const url = `${BASE_URL}/networks/${network}/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=100`;
  const data = await limiter.schedule(() => apiCall(url));
  if (!data?.data?.attributes?.ohlcv_list) {
    console.warn(`No OHLCV data for ${tokenSymbol} (${timeframe}${aggregate > 1 ? `:${aggregate}m` : ''})`);
    return [];
  }
  const ohlcv = data.data.attributes.ohlcv_list.map(([timestamp, open, high, low, close, volume]) => ({
    timestamp, open, high, low, close, volume
  }));
  console.log(`OHLCV data for ${tokenSymbol} (${timeframe}${aggregate > 1 ? `:${aggregate}m` : ''}): ${ohlcv.length} candles`);
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

const calculateIndicators = (ohlcv) => {
  if (!ohlcv || ohlcv.length < 1) {
    console.warn(`Insufficient OHLCV data: ${ohlcv?.length || 0} candles`);
    return {};
  }
  const closes = ohlcv.map(c => c.close);
  const highs = ohlcv.map(c => c.high);
  const lows = ohlcv.map(c => c.low);
  const volumes = ohlcv.map(c => c.volume);
  const period = Math.min(20, ohlcv.length);
  return {
    sma: SMA.calculate({ period, values: closes }).slice(-1)[0] || 0,
    ema: EMA.calculate({ period, values: closes }).slice(-1)[0] || 0,
    dema: ohlcv.length >= period * 2 ? calculateDEMA(closes, period) : 0,
    tema: ohlcv.length >= period * 3 ? calculateTEMA(closes, period) : 0,
    trima: calculateTRIMA(closes, period),
    vwma: calculateVWMA(closes, volumes, period),
    macd: ohlcv.length >= 26 ? MACD.calculate({ values: closes, fastPeriod: Math.min(12, period), slowPeriod: Math.min(26, period), signalPeriod: Math.min(9, period) }).slice(-1)[0] : { MACD: 0, signal: 0, histogram: 0 },
    psar: PSAR.calculate({ high: highs, low: lows, step: 0.02, max: 0.2 }).slice(-1)[0] || 0,
    vortex: ohlcv.length >= 15 ? calculateVortex(highs, lows, closes, Math.min(14, period)) : { VIPlus: 0, VIMinus: 0 },
    cci: ohlcv.length >= period ? CCI.calculate({ high: highs, low: lows, close: closes, period }).slice(-1)[0] : 0,
    rsi: ohlcv.length >= 14 ? RSI.calculate({ values: closes, period: Math.min(14, period) }).slice(-1)[0] : 0,
    stochastic: ohlcv.length >= 14 ? Stochastic.calculate({ high: highs, low: lows, close: closes, period: Math.min(14, period), signalPeriod: Math.min(3, period) }).slice(-1)[0] : { k: 0, d: 0 },
    williamsR: ohlcv.length >= 14 ? WilliamsR.calculate({ high: highs, low: lows, close: closes, period: Math.min(14, period) }).slice(-1)[0] : 0,
    roc: ohlcv.length >= 12 ? ROC.calculate({ values: closes, period: Math.min(12, period) }).slice(-1)[0] : 0,
    ppo: ohlcv.length >= 26 ? calculatePPO(closes, Math.min(12, period), Math.min(26, period), Math.min(9, period)) : { PPO: 0, signal: 0 },
    awesome: ohlcv.length >= 34 ? AwesomeOscillator.calculate({ high: highs, low: lows, fastPeriod: Math.min(5, period), slowPeriod: Math.min(34, period) }).slice(-1)[0] : 0,
    bollinger: BollingerBands.calculate({ period, stdDev: 2, values: closes }).slice(-1)[0] || { upper: 0, middle: 0, lower: 0 },
    atr: ohlcv.length >= 14 ? ATR.calculate({ high: highs, low: lows, close: closes, period: Math.min(14, period) }).slice(-1)[0] : 0,
    trueRange: TrueRange.calculate({ high: highs, low: lows, close: closes }).slice(-1)[0] || 0,
    keltner: ohlcv.length >= period ? calculateKeltnerChannel(highs, lows, closes, period, 2) : { upper: 0, middle: 0, lower: 0 },
    obv: OBV.calculate({ close: closes, volume: volumes }).slice(-1)[0] || 0,
    mfi: ohlcv.length >= 14 ? MFI.calculate({ high: highs, low: lows, close: closes, volume: volumes, period: Math.min(14, period) }).slice(-1)[0] : 0,
    ad: calculateAD(highs, lows, closes, volumes),
    cmf: ohlcv.length >= period ? calculateCMF(highs, lows, closes, volumes, period) : 0,
    vpt: ohlcv.length >= 2 ? calculateVPT(closes, volumes) : 0,
    vwap: VWAP.calculate({ high: highs, low: lows, close: closes, volume: volumes }).slice(-1)[0] || 0,
    ichimoku: calculateIchimoku(highs, lows, closes)
  };
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

      // Fetch Moralis data
      const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // YYYY-MM-DD
      const toDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      [holders, historicalHolders, analytics, snipers] = await Promise.all([
        getTokenHolders(tokenAddress).catch(() => ({ totalHolders: 0 })),
        getTokenHoldersHistorical(tokenAddress, fromDate, toDate).catch(() => ({ result: [] })),
        getTokenAnalytics(tokenAddress).catch(() => ({})),
        getSnipers(attributes.address).catch(() => ({ result: [] }))
      ]);
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
    console.error(`Error normalizing GeckoTerminal token ${pool.attributes.name.split(' / ')[0]}: ${error.message}`);
    return null;
  }
};

const calculateScore = (token) => {
  let score = 0;
  const indicators = token.indicators['hour'] || token.indicators['minute'] || {};
  if (indicators.macd?.MACD > indicators.macd?.signal && indicators.macd?.histogram > 0) score += 10;
  if (token.priceUsd > indicators.psar) score += 5;
  if (indicators.rsi < 30) score += 5;
  if (indicators.stochastic?.k > indicators.stochastic?.d && indicators.stochastic?.k < 80) score += 5;
  if (indicators.awesome > 0) score += 5;
  if (token.priceUsd > indicators.bollinger?.upper) score += 5;
  if (token.priceUsd > indicators.keltner?.upper) score += 5;
  if (indicators.cmf > 0) score += 3;
  if (indicators.mfi < 20) score += 3;

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

  return score;
};

const analyzeGeckoPool = async (pool, _network, boostedSet, dexService, skipDetailedData = false) => {
  try {
    const normalizedToken = await normalizeGeckoToken(pool, boostedSet, dexService, skipDetailedData);
    if (!normalizedToken) {
      console.warn(`Skipping pool ${pool.attributes.name} due to normalization failure`);
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
    console.error(`Error analyzing pool ${pool.attributes.name}: ${error.message}`);
    return null;
  }
};

async function performTA() {
  console.log('Starting advanced TA-based Solana memecoin analysis with tiered filtering...');
  const network = 'solana';
  const dexService = new DexScreenerService();

  // Step 1: Fetch DexScreener Boosted Tokens
  console.log('Step 1: Fetching and filtering boosted tokens from DexScreener...');
  const allBoostedTokens = await dexService.getBoostedSolanaTokens();
  console.log(`Found ${allBoostedTokens.length} unique boosted Solana tokens.`);

  // Fetch pair data for all boosted tokens
  console.log('Fetching pair data for boosted tokens...');
  const boostedPairs = await dexService.getPairsFromBoosted(allBoostedTokens);
  console.log(`Fetched pair data for ${boostedPairs.length} boosted tokens`);

  // Enrich token data with pair data
  const enrichedBoostedTokens = allBoostedTokens.map(token => {
    const pair = boostedPairs.find(p => p.tokenAddress === token.tokenAddress) || {};
    return { ...token, pairData: pair };
  });

  // Debug: Log some sample tokens with their pair data
  if (enrichedBoostedTokens.length > 0) {
    const sample = enrichedBoostedTokens[0];
    console.log(`Sample token: ${sample.tokenAddress}`);
    console.log(`  Pair data available: ${Object.keys(sample.pairData).length > 0 ? 'Yes' : 'No'}`);
    if (Object.keys(sample.pairData).length > 0) {
      console.log(`  Price Change 24h: ${sample.pairData.priceChange?.h24 || 'N/A'}`);
      console.log(`  Liquidity USD: ${sample.pairData.liquidity?.usd || 'N/A'}`);
      console.log(`  Volume 24h: ${sample.pairData.volume?.h24 || 'N/A'}`);
    }
  }

  // Filter boosted tokens by criteria with looser thresholds
  const boostedTokens = enrichedBoostedTokens
    .filter(token => {
      const pair = token.pairData || {};
      const priceChange24h = pair.priceChange?.h24 || 0;
      const liquidityUsd = pair.liquidity?.usd || 0;
      const volume24h = pair.volume?.h24 || 0;

      // Log filtering criteria for debugging
      console.log(`Filtering ${token.tokenAddress}: Price Change 24h: ${priceChange24h}, Liquidity: ${liquidityUsd}, Volume 24h: ${volume24h}`);

      return (
        priceChange24h > -20 && // Allow more downtrend
        liquidityUsd >= 20000 && // Increased minimum liquidity
        volume24h >= 20000 // Increased minimum volume
      );
    })
    .slice(0, 50); // Cap at 50 tokens

  // Create a set of boosted token addresses for reference
  const boostedSet = new Set(boostedTokens.map(token => token.tokenAddress));
  console.log(`Filtered to ${boostedTokens.length} boosted tokens`);

  // If no tokens pass the filter, suggest further loosening
  if (boostedTokens.length === 0) {
    console.log('WARNING: No tokens passed the initial filter. Consider further loosening criteria:');
    console.log('  - priceChange24h > -50 (currently -20)');
    console.log('  - liquidityUsd >= 100 (currently 1000)');
    console.log('  - volume24h >= 100 (currently 500)');
  }

  // Step 2: Fetch GeckoTerminal Trending Pools
  console.log('Step 2: Fetching and filtering trending pools from GeckoTerminal...');
  const trendingPools = await fetchTrendingPools(network, ['1h', '6h'], 2, true);

  // Filter trending pools by criteria
  const filteredTrendingPools = trendingPools.filter(pool => {
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
  console.log(`Combined to ${uniqueTokens.length} unique trending tokens`);

  // Step 3: Price Trend Filter
  console.log('Step 3: Filtering tokens by price trend...');
  const candidates = [];

  for (const token of uniqueTokens) {
    try {
      // Get price data from DexScreener
      const dexPairs = await dexService.getPairsFromBoosted([{ tokenAddress: token.tokenAddress }]);
      if (!dexPairs.length) continue;

      const dexData = dexPairs[0];

      // Check if token meets price trend criteria
      // Require positive or stable 5-minute price change to ensure recent activity
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
    } catch (error) {
      console.error(`Error processing token ${token.tokenAddress}: ${error.message}`);
    }
  }

  // Cap at 15 candidates
  const topCandidates = candidates.slice(0, 15);
  console.log(`Filtered to ${topCandidates.length} uptrending candidates`);

  // Step 4: Detailed TA
  console.log('Step 4: Performing detailed technical analysis...');
  const analyzedTokens = [];

  for (const token of topCandidates) {
    try {
      // Fetch OHLCV data (1h only for efficiency)
      const ohlcvData = await fetchOHLCV(network, token.poolAddress, token.symbol, 'hour', 1);

      // Calculate indicators
      const indicators = { hour: calculateIndicators(ohlcvData) };

      // Calculate score
      const score = calculateScore({ ...token, indicators });

      // Keep if score > 30
      if (score > 30) {
        analyzedTokens.push({
          ...token,
          indicators,
          score,
          ohlcv: { hour: ohlcvData } // Only keep the hour timeframe data
        });
      }
    } catch (error) {
      console.error(`Error analyzing token ${token.symbol}: ${error.message}`);
    }
  }

  // Sort by score and take top 7
  const topAnalyzedTokens = analyzedTokens
    .sort((a, b) => b.score - a.score)
    .slice(0, 7);

  console.log(`Analyzed ${analyzedTokens.length} tokens with TA, found ${topAnalyzedTokens.length} high-scoring tokens`);

  // Step 5: Moralis Validation (with fallback for API failures)
  console.log('Step 5: Performing Moralis validation...');
  let finalTokens = [];

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
      console.error(`Error validating token ${token.symbol}: ${error.message}`);
    }
  }

  // Fallback: If Moralis validation fails (API errors), use top tokens from TA
  if (finalTokens.length === 0 && topAnalyzedTokens.length > 0) {
    console.log('WARNING: Moralis validation failed. Using top tokens from technical analysis as fallback.');
    finalTokens = topAnalyzedTokens.slice(0, 3).map(token => ({
      ...token,
      holders: { totalHolders: 0 },
      historicalHolders: { result: [] },
      snipers: { result: [] },
      holderChange24h: 0
    }));
  }

  console.log(`Final ${finalTokens.length} tokens after Moralis validation`);

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
      logContent += `| 24h Volume: $${token.volume24h.toFixed(2)}\n`;
      // Price changes for selected time periods
      logContent += `| 5m Price Change: ${token.priceChange.m5.toFixed(2)}%\n`;
      logContent += `| 1h Price Change: ${token.priceChange.h1.toFixed(2)}%\n`;
      logContent += `| 6h Price Change: ${token.priceChange.h6.toFixed(2)}%\n`;
      logContent += `| 24h Price Change: ${token.priceChange.h24.toFixed(2)}%\n`;
      logContent += `| Liquidity: $${token.liquidity.toFixed(2)}\n`;
      logContent += `| Market Cap: $${token.marketCap.toFixed(2)}\n`;
      logContent += `| Age: ${token.pairAgeDays.toFixed(2)} days\n`;
      logContent += `| Boosted: ${token.isBoosted ? 'Yes' : 'No'}\n`;
      logContent += `| Holders: ${token.holders.totalHolders || 0}\n`;
      logContent += `| Holder Change (24h): ${token.historicalHolders?.result?.length > 1 ? (token.historicalHolders.result[token.historicalHolders.result.length - 1].totalHolders - token.historicalHolders.result[0].totalHolders) : 0} (${token.holderChange24h.toFixed(2)}%)\n`;
      logContent += `| Sniper Count: ${token.snipers?.result?.length || 0}\n`;
      logContent += `| Sniper Profit: $${token.snipers?.result?.reduce((sum, s) => sum + (s.realizedProfitUsd || 0), 0).toFixed(2) || 0}\n`;
      logContent += `| Score: ${token.score.toFixed(2)}\n`;
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

  console.log(logContent);
  await fs.writeFile('gecko_analysis.log', logContent);

  console.log('Technical analysis completed.');
  return finalTokens;
}

async function main() {
  try {
    const finalTokens = await performTA();
    console.log(`Ready to trade ${finalTokens.length} tokens`);
    // Add Jupiter trading logic here
  } catch (error) {
    console.error('Error in TA:', error.message);
  }
}

main();