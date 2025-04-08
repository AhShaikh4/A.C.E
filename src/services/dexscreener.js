//dexscreener.js

const axios = require('axios');
const rateLimit = require('axios-rate-limit');

// DexScreener API settings
const DEX_API_BASE_URL = 'https://api.dexscreener.com';
const http = rateLimit(axios.create(), { maxRequests: 60, perMilliseconds: 60000 }); // 60 req/min

// API call with error handling
const apiCall = async (url) => {
  try {
    const response = await http.get(url);
    return response.data;
  } catch (error) {
    console.error(`DexScreener API call failed: ${url} - ${error.message}`);
    return null;
  }
};

class DexScreenerService {
  async getBoostedSolanaTokens() {
    try {
      const [latestBoosted, topBoosted] = await Promise.all([
        apiCall(`${DEX_API_BASE_URL}/token-boosts/latest/v1`),
        apiCall(`${DEX_API_BASE_URL}/token-boosts/top/v1`)
      ]);
      const solanaBoosted = [
        ...(Array.isArray(latestBoosted) ? latestBoosted.filter(token => token.chainId === 'solana') : []),
        ...(Array.isArray(topBoosted) ? topBoosted.filter(token => token.chainId === 'solana') : [])
      ];
      console.log(`Found ${solanaBoosted.length} unique boosted Solana tokens.`);
      return solanaBoosted;
    } catch (error) {
      console.error(`Error fetching boosted tokens: ${error.message}`);
      return [];
    }
  }

  async getPairsFromBoosted(boostedTokens) {
    const pairs = [];
    for (const token of boostedTokens) {
      try {
        const response = await apiCall(`${DEX_API_BASE_URL}/token-pairs/v1/solana/${token.tokenAddress}`);
        if (response && Array.isArray(response) && response.length > 0) {
          const pair = response[0];
          pairs.push({
            tokenAddress: token.tokenAddress,
            priceChange: pair.priceChange || {},
            pairCreatedAt: pair.pairCreatedAt || 0,
            pairAddress: pair.pairAddress,
            priceUsd: parseFloat(pair.priceUsd || 0),
            volume: pair.volume || {},
            liquidity: pair.liquidity || {},
            fdv: pair.fdv || 0
          });
        }
      } catch (error) {
        console.error(`Error fetching pair for ${token.tokenAddress}: ${error.message}`);
      }
    }
    return pairs;
  }

  /**
   * Get detailed pair data using the DexScreener pairs endpoint
   * @param {string} chainId - Chain ID (e.g., 'solana')
   * @param {string} pairId - Pair address
   * @returns {Object|null} - Normalized pair data or null if not found
   */
  async getPairData(chainId, pairId) {
    try {
      const url = `${DEX_API_BASE_URL}/latest/dex/pairs/${chainId}/${pairId}`;
      const response = await apiCall(url);
      const pair = response?.pairs?.[0] || response?.pair;

      if (!pair) {
        console.warn(`No pair data found for ${chainId}/${pairId}`);
        return null;
      }

      return {
        tokenAddress: pair.baseToken?.address,
        pairAddress: pair.pairAddress,
        symbol: pair.baseToken?.symbol,
        name: pair.baseToken?.name,
        priceUsd: parseFloat(pair.priceUsd || 0),
        priceChange: pair.priceChange || { m5: 0, h1: 0, h6: 0, h24: 0 },
        volume: pair.volume || { m5: 0, h1: 0, h6: 0, h24: 0 },
        txns: pair.txns || {
          m5: { buys: 0, sells: 0 },
          h1: { buys: 0, sells: 0 },
          h6: { buys: 0, sells: 0 },
          h24: { buys: 0, sells: 0 }
        },
        liquidity: pair.liquidity?.usd || 0,
        marketCap: pair.marketCap || pair.fdv || 0,
        pairCreatedAt: pair.pairCreatedAt || 0,
        isBoosted: (pair.boosts?.active || 0) > 0,
        dexId: pair.dexId,
        baseToken: pair.baseToken,
        quoteToken: pair.quoteToken
      };
    } catch (error) {
      console.error(`Failed to fetch pair data for ${chainId}/${pairId}: ${error.message}`);
      return null;
    }
  }

  // Other functions (like fetchTokens, getDetailedPairs) are not used in this pipeline
}

module.exports = { DexScreenerService };