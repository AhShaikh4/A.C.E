const fs = require('fs').promises;
const axios = require('axios');
const technicalindicators = require('technicalindicators');
const Bottleneck = require('bottleneck');
const { DexScreenerService } = require('./src/services/dexscreener.js');
const { fetchTokens: fetchGeckoTokens } = require('./src/services/gecko.js');
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
  };
};

const normalizeGeckoToken = async (pool, boostedSet, dexService) => {
  try {
    const attributes = pool.attributes;
    const tokenAddress = pool.relationships.base_token.data.id.split('_')[1];

    const dexPairs = await dexService.getPairsFromBoosted([{ tokenAddress }]);
    const dexData = dexPairs.length > 0 ? dexPairs[0] : null;

    const timeframes = [
      { timeframe: 'minute', aggregate: 1 },
      { timeframe: 'minute', aggregate: 15 },
      { timeframe: 'hour', aggregate: 1 }
    ];
    const ohlcvData = {};
    for (const { timeframe, aggregate } of timeframes) {
      const key = `${timeframe}${aggregate > 1 ? `:${aggregate}m` : ''}`;
      ohlcvData[key] = await fetchOHLCV('solana', attributes.address, attributes.name.split(' / ')[0], timeframe, aggregate);
    }

    const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // YYYY-MM-DD
    const toDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const [holders, historicalHolders, analytics, snipers] = await Promise.all([
      getTokenHolders(tokenAddress).catch(() => ({ totalHolders: 0 })),
      getTokenHoldersHistorical(tokenAddress, fromDate, toDate).catch(() => ({ result: [] })),
      getTokenAnalytics(tokenAddress).catch(() => ({})),
      getSnipers(attributes.address).catch(() => ({ result: [] }))
    ]);

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

  score += (token.priceChange.h1 * 0.2) + (token.priceChange.h6 * 0.3) + (token.priceChange.h24 * 0.5);
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

const analyzeGeckoPool = async (pool, network, boostedSet, dexService) => {
  try {
    const normalizedToken = await normalizeGeckoToken(pool, boostedSet, dexService);
    if (!normalizedToken) {
      console.warn(`Skipping pool ${pool.attributes.name} due to normalization failure`);
      return null;
    }

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
  console.log('Starting advanced TA-based Solana memecoin analysis...');
  const network = 'solana';

  const dexService = new DexScreenerService();
  const boostedTokens = await dexService.getBoostedSolanaTokens();
  const boostedSet = new Set(boostedTokens.map(token => token.tokenAddress));

  const geckoTokens = await fetchGeckoTokens();

  const analyzedTokens = [];
  for (const pool of geckoTokens) {
    const metrics = await analyzeGeckoPool(pool, network, boostedSet, dexService);
    if (metrics) analyzedTokens.push(metrics);
  }

  const sortedTokens = analyzedTokens.sort((a, b) => b.score - a.score);

  let logContent = '\n=== Top Solana Memecoins (GeckoTerminal) ===\n\n';
  if (!sortedTokens.length) {
    logContent += 'No tokens found.\n';
  } else {
    sortedTokens.slice(0, 10).forEach((token, index) => {
      logContent += `+${'-'.repeat(50)}+\n`;
      logContent += `| ${index + 1}. ${token.symbol} (${token.name})\n`;
      logContent += `| Token Address: ${token.tokenAddress}\n`;
      logContent += `| Pool Address: ${token.poolAddress}\n`;
      logContent += `| Price (USD): $${token.priceUsd.toFixed(6)}\n`;
      logContent += `| 24h Volume: $${token.volume24h.toFixed(2)}\n`;
      logContent += `| 1h Price Change: ${token.priceChange.h1.toFixed(2)}%\n`;
      logContent += `| 6h Price Change: ${token.priceChange.h6.toFixed(2)}%\n`;
      logContent += `| 24h Price Change: ${token.priceChange.h24.toFixed(2)}%\n`;
      logContent += `| Liquidity: $${token.liquidity.toFixed(2)}\n`;
      logContent += `| Market Cap: $${token.marketCap.toFixed(2)}\n`;
      logContent += `| Age: ${token.pairAgeDays.toFixed(2)} days\n`;
      logContent += `| Boosted: ${token.isBoosted ? 'Yes' : 'No'}\n`;
      logContent += `| Holders: ${token.holders.totalHolders || 0}\n`;
      const holderChange24h = token.historicalHolders?.result?.length > 1
        ? ((token.historicalHolders.result[token.historicalHolders.result.length - 1].totalHolders -
            token.historicalHolders.result[0].totalHolders) / (token.historicalHolders.result[0].totalHolders || 1) * 100) || 0
        : 0;
      logContent += `| Holder Change (24h): ${token.historicalHolders?.result?.length > 1 ? (token.historicalHolders.result[token.historicalHolders.result.length - 1].totalHolders - token.historicalHolders.result[0].totalHolders) : 0} (${holderChange24h.toFixed(2)}%)\n`;
      logContent += `| Sniper Count: ${token.snipers?.result?.length || 0}\n`;
      logContent += `| Sniper Profit: $${token.snipers?.result?.reduce((sum, s) => sum + (s.realizedProfitUsd || 0), 0).toFixed(2) || 0}\n`;
      logContent += `| Score: ${token.score.toFixed(2)}\n`;
      logContent += `| Technical Indicators (1h):\n`;
      const indicators = token.indicators['hour'] || token.indicators['minute'] || {};
      logContent += `|   SMA: ${indicators.sma?.toFixed(8) || 'N/A'}\n`;
      logContent += `|   EMA: ${indicators.ema?.toFixed(8) || 'N/A'}\n`;
      logContent += `|   MACD: ${indicators.macd?.MACD?.toFixed(8) || 'N/A'}, Signal: ${indicators.macd?.signal?.toFixed(8) || 'N/A'}, Histogram: ${indicators.macd?.histogram?.toFixed(8) || 'N/A'}\n`;
      logContent += `|   RSI: ${indicators.rsi?.toFixed(2) || 'N/A'}\n`;
      logContent += `|   Bollinger Bands: Upper: ${indicators.bollinger?.upper?.toFixed(8) || 'N/A'}, Middle: ${indicators.bollinger?.middle?.toFixed(8) || 'N/A'}, Lower: ${indicators.bollinger?.lower?.toFixed(8) || 'N/A'}\n`;
      logContent += `+${'-'.repeat(50)}+\n\n`;
    });
  }
  console.log(logContent);
  await fs.writeFile('gecko_analysis.log', logContent);

  console.log('Technical analysis completed.');
}

async function main() {
  try {
    await performTA();
  } catch (error) {
    console.error('Error in TA:', error.message);
  }
}

main();