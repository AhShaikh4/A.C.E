require('dotenv').config();
const axios = require('axios');

const MORALIS_API_KEY = process.env.MORALIS_API_KEY;
const BASE_URL = 'https://solana-gateway.moralis.io';
const DEEP_INDEX_URL = 'https://deep-index.moralis.io/api/v2.2';
const HEADERS = { 'accept': 'application/json', 'X-API-Key': MORALIS_API_KEY };

// Moralis Token API Endpoints with error handling
async function apiCall(url, fallback = {}) {
  try {
    const response = await axios.get(url, { headers: HEADERS });
    return response.data || fallback;
  } catch (e) {
    console.error(`API call failed: ${url} - ${e.message}`);
    return fallback;
  }
}

async function getTokenHolders(tokenAddress) {
  return await apiCall(`${BASE_URL}/token/mainnet/holders/${tokenAddress}`, {});
}

async function getTokenHoldersHistorical(tokenAddress, fromDate, toDate) {
    const url = `${BASE_URL}/token/mainnet/holders/${tokenAddress}/historical?fromDate=${fromDate}&toDate=${toDate}&timeFrame=1d`;
    return await apiCall(url, { result: [] });
  }

async function getTokenAnalytics(tokenAddress) {
  return await apiCall(`${DEEP_INDEX_URL}/tokens/${tokenAddress}/analytics?chain=solana`, {});
}

async function getSnipers(pairAddress) {
  return await apiCall(`${BASE_URL}/token/mainnet/pairs/${pairAddress}/snipers?blocksAfterCreation=1000`, { result: [] });
}

module.exports = {
  getTokenHolders,
  getTokenHoldersHistorical,
  getTokenAnalytics,
  getSnipers
};