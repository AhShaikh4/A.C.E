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

  // Other functions (like fetchTokens, getDetailedPairs) are not used in this pipeline
}

module.exports = { DexScreenerService };