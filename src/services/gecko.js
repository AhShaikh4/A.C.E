//gecko.js

const axios = require('axios');

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
        const delay = Math.min(60000, 2000 * Math.pow(2, i));
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
const fetchNewPools = async (network = 'solana', pages = 5, applyFilters = false) => {
  const pools = [];
  for (let page = 1; page <= pages; page++) {
    const url = `${BASE_URL}/networks/${network}/new_pools?page=${page}`;
    const data = await apiCall(url);
    if (data?.data) pools.push(...data.data);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit delay
  }

  if (applyFilters) {
    const currentTime = Date.now();
    const maxAgeDays = 2;
    const minLiquidity = 10000;
    const minVolume6h = 5000;
    return pools.filter(pool => {
      const ageDays = pool.attributes.pool_created_at
        ? (currentTime - pool.attributes.pool_created_at) / (1000 * 60 * 60 * 24)
        : Infinity;
      const liquidity = parseFloat(pool.attributes.reserve_in_usd || 0);
      const volume6h = parseFloat(pool.attributes.volume_usd?.h6 || 0);
      return ageDays <= maxAgeDays && liquidity >= minLiquidity && volume6h >= minVolume6h;
    });
  }
  return pools;
};

// Fetch trending pools from GeckoTerminal for multiple durations
const fetchTrendingPools = async (network = 'solana', durations = ['1h', '6h', '24h'], pages = 5, applyFilters = false) => {
  const pools = [];
  for (const duration of durations) {
    for (let page = 1; page <= pages; page++) {
      const url = `${BASE_URL}/networks/${network}/trending_pools?duration=${duration}&page=${page}`;
      const data = await apiCall(url);
      if (data?.data) pools.push(...data.data);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit delay
    }
  }

  if (applyFilters) {
    const currentTime = Date.now();
    const maxAgeDays = 2;
    const minLiquidity = 10000;
    const minVolume6h = 5000;
    return pools.filter(pool => {
      const ageDays = pool.attributes.pool_created_at
        ? (currentTime - pool.attributes.pool_created_at) / (1000 * 60 * 60 * 24)
        : Infinity;
      const liquidity = parseFloat(pool.attributes.reserve_in_usd || 0);
      const volume6h = parseFloat(pool.attributes.volume_usd?.h6 || 0);
      return ageDays <= maxAgeDays && liquidity >= minLiquidity && volume6h >= minVolume6h;
    });
  }
  return pools;
};

/**
 * Fetch 200 deduplicated Solana tokens from GeckoTerminal
 */
async function fetchTokens() {
  console.log('Starting fetch of Solana memecoins from GeckoTerminal...');
  const network = 'solana';

  // Fetch default new and trending pools (no filters)
  const defaultNewPools = await fetchNewPools(network, 5, false);
  console.log(`Fetched ${defaultNewPools.length} default new Solana pools`);
  const defaultTrendingPools = await fetchTrendingPools(network, ['1h', '6h', '24h'], 5, false);
  console.log(`Fetched ${defaultTrendingPools.length} default trending Solana pools`);

  // Fetch filtered new and trending pools
  const filteredNewPools = await fetchNewPools(network, 5, true);
  console.log(`Fetched ${filteredNewPools.length} filtered new Solana pools`);
  const filteredTrendingPools = await fetchTrendingPools(network, ['1h', '6h', '24h'], 5, true);
  console.log(`Fetched ${filteredTrendingPools.length} filtered trending Solana pools`);

  // Combine all pools
  const allPools = [...defaultNewPools, ...defaultTrendingPools, ...filteredNewPools, ...filteredTrendingPools];

  // Deduplicate by token address
  const allUniqueTokens = [...new Map(allPools.map(pool => [
    pool.relationships.base_token.data.id.split('_')[1], pool
  ])).values()];

  // Calculate a preliminary score for each token based on available metrics
  const scoredTokens = allUniqueTokens.map(pool => {
    const liquidity = parseFloat(pool.attributes.reserve_in_usd || 0);
    const volume24h = parseFloat(pool.attributes.volume_usd?.h24 || 0);
    const priceChange24h = parseFloat(pool.attributes.price_change_percentage?.h24 || 0);
    const priceChange1h = parseFloat(pool.attributes.price_change_percentage?.h1 || 0);
    const priceChange6h = parseFloat(pool.attributes.price_change_percentage?.h6 || 0);
    const ageDays = pool.attributes.pool_created_at
      ? (Date.now() - new Date(pool.attributes.pool_created_at).getTime()) / (1000 * 60 * 60 * 24)
      : 0;

    // Calculate a preliminary score based on available metrics
    let prelimScore = 0;

    // Volume and liquidity are important indicators
    prelimScore += (volume24h / 10000) * 5; // 5 points per $10k volume
    prelimScore += (liquidity / 20000) * 3; // 3 points per $20k liquidity

    // Price changes can indicate momentum
    prelimScore += priceChange1h * 0.2;
    prelimScore += priceChange6h * 0.3;
    prelimScore += priceChange24h * 0.5;

    // Newer pools might be more interesting
    if (ageDays < 3) prelimScore += 10;
    else if (ageDays < 7) prelimScore += 5;

    // Volume to liquidity ratio (high ratio = more trading activity)
    const volumeLiquidityRatio = liquidity > 0 ? volume24h / liquidity : 0;
    prelimScore += Math.min(20, volumeLiquidityRatio * 10);

    return {
      pool,
      prelimScore
    };
  });

  // Sort by preliminary score and take top 30 for detailed analysis
  const topTokens = scoredTokens
    .sort((a, b) => b.prelimScore - a.prelimScore)
    .slice(0, 30)
    .map(item => item.pool);

  console.log(`Fetched ${allUniqueTokens.length} unique Solana tokens, selected top 30 for detailed analysis`);
  return topTokens;
}

module.exports = { fetchTokens, fetchTrendingPools };