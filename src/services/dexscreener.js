const axios = require('axios');
const rateLimit = require('axios-rate-limit');

// Constants
const DELAY_60_PER_MIN = 1000; // 1 second delay for 60 requests/minute
const DELAY_300_PER_MIN = 200; // 0.2 second delay for 300 requests/minute
const MAX_AGE_DAYS = 2;
const CURRENT_TIME = Date.now();
const SEARCH_KEYWORDS = [
    'trending', 'viral', 'pump', 'up', 'onlyup', 'buy', 'profit',
    'moon', 'rocket', 'bull', 'skyrocket', 'hype',
    'gain',
    'grow', 'jump', 'spike', 'rally', 'winning', 'cash', 'gold',
    'success', 'breakout'
];

// Utility functions
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const logError = async (error) => {
    console.error(new Date().toISOString(), error);
    // Add file logging here if needed
};

// Analysis Configuration
const ANALYSIS_CONFIG = {
    honeypot: {
        priceIncreaseThreshold: 50,  // 50% price increase
        minBuyTxns: 20,             // Minimum buys to consider
        maxSellRatio: 0.1,          // Max sell/buy ratio for honeypot
        timeframes: ['m5', 'h1', 'h24']
    },
    marketCap: {
        thresholds: {
            significant: 50,    // 50% change
            moderate: 20       // 20% change
        },
        timeframes: ['m5', 'h1', 'h24']
    }
};

// Create rate-limited instances
const axiosInstance = rateLimit(axios.create(), { maxRequestsPerSecond: 2 });

class DexScreenerService {
    constructor() {
        this.apiBaseUrl = 'https://api.dexscreener.com';
    }

    /**
     * Enhanced honeypot detection
     */
    detectHoneypot(pair) {
        const risk = {
            isHoneypot: false,
            confidence: 'LOW',
            reasons: []
        };

        // Quick liquidity check
        if (!pair.liquidity?.usd || !pair.volume?.h24) {
            risk.isHoneypot = true;
            risk.confidence = 'HIGH';
            risk.reasons.push('No liquidity or volume data');
            return risk;
        }

        // Check sell patterns across timeframes
        for (const tf of ANALYSIS_CONFIG.honeypot.timeframes) {
            const buys = pair.txns?.[tf]?.buys || 0;
            const sells = pair.txns?.[tf]?.sells || 0;
            const priceChange = parseFloat(pair.priceChange?.[tf]) || 0;

            if (priceChange > ANALYSIS_CONFIG.honeypot.priceIncreaseThreshold &&
                buys >= ANALYSIS_CONFIG.honeypot.minBuyTxns &&
                (sells / buys) < ANALYSIS_CONFIG.honeypot.maxSellRatio) {
                    risk.isHoneypot = true;
                    risk.confidence = 'HIGH';
                    risk.reasons.push(`Suspicious ${tf} pattern: High buys, low sells`);
            }
        }

        // Liquidity trap check
        const liquidityRatio = pair.liquidity.usd / pair.volume.h24;
        if (liquidityRatio > 10) {
            risk.reasons.push('Possible liquidity trap');
            risk.confidence = risk.confidence === 'HIGH' ? 'HIGH' : 'MEDIUM';
        }

        return risk;
    }

    /**
     * Enhanced market cap trend analysis
     */
    analyzeMarketCap(pair) {
        const analysis = {
            trend: 'NEUTRAL',
            confidence: 'LOW',
            score: 0
        };

        if (!pair.fdv) return analysis;

        const mcap = parseFloat(pair.fdv);
        const trends = {};

        // Calculate trends for each timeframe
        for (const tf of ANALYSIS_CONFIG.marketCap.timeframes) {
            const change = parseFloat(pair.priceChange?.[tf]) || 0;
            trends[tf] = {
                value: mcap / (1 + change/100),
                change: change
            };
        }

        // Analyze trend direction
        if (trends.m5.value < trends.h1.value && trends.h1.value < mcap) {
            analysis.trend = 'UPWARD';
            analysis.score += 20;
        } else if (trends.m5.value > trends.h1.value && trends.h1.value > mcap) {
            analysis.trend = 'DOWNWARD';
            analysis.score -= 10;
        }

        // Assess trend strength
        const h24Change = Math.abs(trends.h24.change);
        if (h24Change > ANALYSIS_CONFIG.marketCap.thresholds.significant) {
            analysis.confidence = 'HIGH';
            analysis.score += trends.h24.change > 0 ? 15 : -15;
        } else if (h24Change > ANALYSIS_CONFIG.marketCap.thresholds.moderate) {
            analysis.confidence = 'MEDIUM';
            analysis.score += trends.h24.change > 0 ? 10 : -10;
        }

        return analysis;
    }

    /**
     * Enhanced profitability analysis
     */
    async analyzeProfitability(pair, boostData = null) {
        const analysis = {
            score: 0,
            flags: [],
            metrics: {},
            riskLevel: 'high',
            boostMetrics: boostData
        };

        // Run honeypot check
        const honeypotRisk = this.detectHoneypot(pair);
        if (honeypotRisk.isHoneypot) {
            analysis.score -= 50;
            analysis.flags.push('HONEYPOT_RISK');
            analysis.flags.push(...honeypotRisk.reasons);
        }

        // Analyze market cap
        const mcapAnalysis = this.analyzeMarketCap(pair);
        analysis.score += mcapAnalysis.score;
        analysis.flags.push(`MCAP_${mcapAnalysis.trend}`);
        
        if (mcapAnalysis.confidence === 'HIGH') {
            analysis.flags.push('STRONG_MCAP_MOVEMENT');
        }

        // Calculate profitability score
        const priceChange1h = pair.priceChange?.h1 || 0;
        const priceChange6h = pair.priceChange?.h6 || 0;
        const priceChange24h = pair.priceChange?.h24 || 0;
        const volume24h = pair.volume?.h24 || 0;
        const liquidityUsd = pair.liquidity?.usd || 1;
        const marketCap = pair.marketCap || pair.fdv || Infinity;
        const isBoosted = pair.isBoosted ? 10 : 0;
        const ageFactor = pair.pairAgeDays ? (MAX_AGE_DAYS - pair.pairAgeDays) / MAX_AGE_DAYS : 0;

        const volumeLiquidityRatio = volume24h / liquidityUsd;
        const marketCapScore = marketCap < 1000000 ? 1 : (1000000 / marketCap);
        
        analysis.score += (
            (priceChange1h * 0.2) + 
            (priceChange6h * 0.2) + 
            (priceChange24h * 0.2) + 
            (volumeLiquidityRatio * 0.2) + 
            (marketCapScore * 0.1) + 
            (ageFactor * 0.2) + 
            isBoosted
        );

        return analysis;
    }

    /**
     * Fetch boosted tokens on Solana
     */
    async getBoostedSolanaTokens(retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const [latestBoosted, topBoosted] = await Promise.all([
                    axiosInstance.get(`${this.apiBaseUrl}/token-boosts/latest/v1`).then(res => res.data),
                    axiosInstance.get(`${this.apiBaseUrl}/token-boosts/top/v1`).then(res => res.data),
                    delay(DELAY_60_PER_MIN)
                ]);
                
                const solanaLatest = latestBoosted.filter(token => token.chainId === 'solana');
                const solanaTop = topBoosted.filter(token => token.chainId === 'solana');
                const uniqueTokens = [...new Map([...solanaLatest, ...solanaTop].map(t => [t.tokenAddress, t])).values()];
                return uniqueTokens;
            } catch (error) {
                const errMsg = `Attempt ${attempt} failed fetching boosted tokens: ${error.message}`;
                console.error(errMsg);
                await logError(errMsg);
                if (attempt === retries) return [];
                await delay(1000 * attempt);
            }
        }
    }

    /**
     * Fetch trading pairs for boosted tokens
     */
    async getPairsFromBoosted(tokens) {
        const pairs = [];
        const boostedSet = new Set(tokens.map(t => t.tokenAddress));
        const fetchPromises = tokens.map(async (token, index) => {
            await delay(index * DELAY_300_PER_MIN);
            try {
                const response = await axiosInstance.get(`${this.apiBaseUrl}/token-pairs/v1/solana/${token.tokenAddress}`);
                return response.data.map(pair => ({ ...pair, isBoosted: boostedSet.has(pair.baseToken.address) }));
            } catch (error) {
                const errMsg = `Error fetching pairs for ${token.tokenAddress}: ${error.message}`;
                console.error(errMsg);
                await logError(errMsg);
                return [];
            }
        });

        const results = await Promise.all(fetchPromises);
        results.forEach(result => pairs.push(...result));
        return pairs;
    }

    /**
     * Search for trending Solana pairs using keywords
     */
    async searchTrendingSolanaPairs() {
        const searchResults = [];
        for (let i = 0; i < SEARCH_KEYWORDS.length; i++) {
            await delay(i * DELAY_300_PER_MIN);
            try {
                const response = await axiosInstance.get(`${this.apiBaseUrl}/latest/dex/search?q=${encodeURIComponent(SEARCH_KEYWORDS[i])}`);
                const solanaPairs = response.data.pairs.filter(pair => pair.chainId === 'solana');
                searchResults.push(...solanaPairs.map(pair => ({ ...pair, isBoosted: false })));
            } catch (error) {
                const errMsg = `Error searching for "${SEARCH_KEYWORDS[i]}": ${error.message}`;
                console.error(errMsg);
                await logError(errMsg);
            }
        }
        return [...new Map(searchResults.map(p => [p.pairAddress, p])).values()];
    }

    /**
     * Merge all unique Solana pairs
     */
    mergeUniquePairs(boostedPairs, searchPairs) {
        const allPairs = [...boostedPairs, ...searchPairs];
        return [...new Map(allPairs.map(p => [p.pairAddress, p])).values()];
    }

    /**
     * Fetch detailed data for unique pairs with age filtering
     */
    async getDetailedPairs(uniquePairs) {
        const detailedPairs = [];
        const fetchPromises = uniquePairs.map(async (pair, index) => {
            await delay(index * DELAY_300_PER_MIN);
            try {
                const response = await axiosInstance.get(`${this.apiBaseUrl}/latest/dex/pairs/solana/${pair.pairAddress}`);
                const detailedPair = response.data.pairs[0];
                if (!detailedPair || detailedPair.liquidity?.usd < 10000) return null;

                // Calculate pair age in days
                const pairAgeDays = detailedPair.pairCreatedAt 
                    ? (CURRENT_TIME - detailedPair.pairCreatedAt) / (1000 * 60 * 60 * 24)
                    : Infinity;

                // Only include pairs less than 2 days old
                if (pairAgeDays <= MAX_AGE_DAYS) {
                    return { ...detailedPair, isBoosted: pair.isBoosted, pairAgeDays };
                }
                return null;
            } catch (error) {
                const errMsg = `Error fetching details for pair ${pair.pairAddress}: ${error.message}`;
                console.error(errMsg);
                await logError(errMsg);
                return null;
            }
        });

        const results = await Promise.all(fetchPromises);
        return results.filter(pair => pair !== null);
    }

    /**
     * Main function
     */
    async main() {
        console.log('Starting search for Solana memecoins created in the last 2 days...');

        // Step 1
        const boostedTokens = await this.getBoostedSolanaTokens();
        console.log(`Found ${boostedTokens.length} unique boosted Solana tokens.`);

        // Step 2
        const boostedPairs = await this.getPairsFromBoosted(boostedTokens);
        console.log(`Found ${boostedPairs.length} pairs from boosted tokens.`);

        // Step 3
        const searchPairs = await this.searchTrendingSolanaPairs();
        console.log(`Found ${searchPairs.length} pairs from keyword search.`);

        // Step 4
        const uniquePairs = this.mergeUniquePairs(boostedPairs, searchPairs);
        console.log(`Total unique Solana pairs: ${uniquePairs.length}`);

        // Step 5
        const detailedPairs = await this.getDetailedPairs(uniquePairs);
        console.log(`Fetched detailed data for ${detailedPairs.length} Solana pairs (created within ${MAX_AGE_DAYS} days).`);

        // Step 6: Analyze and sort pairs with error handling
        const analyzedPairs = [];
        for (const pair of detailedPairs) {
            try {
                const analysis = await this.analyzeProfitability(pair);
                if (analysis && pair) {
                    analyzedPairs.push({
                        pair,
                        analysis,
                        score: analysis.score
                    });
                }
            } catch (error) {
                console.error(`Error analyzing pair ${pair?.pairAddress || 'unknown'}: ${error.message}`);
            }
        }

        // Sort pairs by score
        const sortedPairs = analyzedPairs
            .sort((a, b) => b.score - a.score)
            .filter(item => item.pair && item.pair.pairAgeDays !== undefined);

        // Output top 10
        console.log(`\nTop 10 Solana Memecoins (created within ${MAX_AGE_DAYS} days):`);
        sortedPairs.slice(0, 10).forEach((item, index) => {
            const pair = item.pair;
            if (!pair) return;

            const ageDays = pair.pairAgeDays?.toFixed(2) || 'N/A';
            console.log(`${index + 1}. ${pair.baseToken.symbol} (${pair.baseToken.name}) - ${pair.pairAddress}`);
            console.log(`   Price USD: $${pair.priceUsd || 'N/A'}, ` +
                        `1h: ${pair.priceChange?.h1 || 'N/A'}%, ` +
                        `6h: ${pair.priceChange?.h6 || 'N/A'}%, ` +
                        `24h: ${pair.priceChange?.h24 || 'N/A'}%, ` +
                        `Volume 24h: $${pair.volume?.h24 || 'N/A'}, ` +
                        `Liquidity: $${pair.liquidity?.usd || 'N/A'}, ` +
                        `Market Cap: $${pair.marketCap || pair.fdv || 'N/A'}, ` +
                        `Age: ${ageDays} days, ` +
                        `Boosted: ${pair.isBoosted ? 'Yes' : 'No'}`);
        });
    }
}

// Create instance and run
const dexScreenerService = new DexScreenerService();
dexScreenerService.main().catch(async error => {
    const errMsg = `Main execution failed: ${error.message}`;
    console.error(errMsg);
    await logError(errMsg);
});