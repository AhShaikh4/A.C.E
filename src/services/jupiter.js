//Jupiter.js


const axios = require('axios');
const { Connection, PublicKey, VersionedTransaction } = require('@solana/web3.js');
const Bottleneck = require('bottleneck');
// bs58 and Transaction are no longer needed after removing Trigger and Recurring API methods

// Constants
const JUPITER_API = 'https://api.jup.ag';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const DEFAULT_SLIPPAGE_BPS = 50; // 0.5% slippage
const DEFAULT_PRIORITY_FEE = { priorityLevelWithMaxLamports: { maxLamports: 5000000, priorityLevel: 'high' } };

// Rate limiter: 10 requests/second
const limiter = new Bottleneck({ minTime: 100, maxConcurrent: 1 });

class JupiterService {
  constructor(connection, wallet) {
    /**
     * @param {Connection} connection - Solana RPC connection
     * @param {Keypair} wallet - Solana wallet keypair for signing transactions
     */
    this.connection = connection || new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    this.wallet = wallet;
    this.userPublicKey = wallet ? wallet.publicKey : null;
  }


  // --- Ultra API ---
  async getBalances(address = this.userPublicKey) {
    /**
     * Fetch token balances for an address
     * @param {PublicKey|string} address - Optional address to check (defaults to wallet's public key)
     * @returns {Object} Token balances in format { tokens: [...] }
     */
    if (!address) throw new Error('Address required');

    try {
      const response = await limiter.schedule(() =>
        axios.get(`${JUPITER_API}/ultra/v1/balances/${address.toString()}`)
      );

      // Transform the response into the expected format
      const balanceData = response.data || {};

      // Create a tokens array from the response
      const tokens = [];

      // Known token symbols to mint addresses mapping
      const knownMints = {
        'SOL': SOL_MINT,
        // Add other known tokens here if needed
      };

      // Process each token in the response
      for (const [symbol, data] of Object.entries(balanceData)) {
        if (data && typeof data === 'object') {
          tokens.push({
            symbol: symbol,
            mint: knownMints[symbol] || symbol, // Use known mint or symbol as fallback
            uiAmount: data.uiAmount || 0,
            amount: data.amount || '0',
            slot: data.slot,
            isFrozen: data.isFrozen || false
          });
        }
      }

      return { tokens };
    } catch (error) {
      console.error(`Failed to get balances: ${error.message}`);
      // Return a default structure to prevent undefined errors
      return { tokens: [] };
    }
  }

  async createOrder(inputMint, outputMint, amount) {
    /**
     * Create an unsigned swap order
     * @returns {Object} Order details including transaction and requestId
     */
    const response = await limiter.schedule(() =>
      axios.get(`${JUPITER_API}/ultra/v1/order`, {
        params: {
          inputMint,
          outputMint,
          amount,
          taker: this.userPublicKey.toBase58(),
        },
      })
    );
    return response.data;
  }

  async executeOrder(signedTransaction, requestId) {
    /**
     * Execute a signed order
     * @returns {Object} Execution status
     */
    // Use base64 encoding for Ultra API as per documentation
    // The Ultra API expects the transaction to be base64 encoded, not bs58 encoded
    const serializedTransaction = signedTransaction.serialize();
    const base64Transaction = Buffer.from(serializedTransaction).toString('base64');

    console.log('Executing order with requestId:', requestId);

    const response = await limiter.schedule(() =>
      axios.post(`${JUPITER_API}/ultra/v1/execute`, {
        signedTransaction: base64Transaction,
        requestId,
      })
    );
    return response.data;
  }

  async executeUltraSwap(inputMint, outputMint, amount) {
    /**
     * Execute a swap using Ultra API (two-step process)
     * @param {string} inputMint - Input token mint address
     * @param {string} outputMint - Output token mint address
     * @param {number} amount - Amount to swap in raw units
     * @returns {string} Transaction signature
     */
    try {
      console.log(`Creating Ultra swap order: ${inputMint} → ${outputMint}, amount: ${amount}`);

      // Step 1: Create the order
      const orderResponse = await this.createOrder(inputMint, outputMint, amount);

      if (!orderResponse.transaction) {
        throw new Error(`Failed to create order: No transaction returned. Response: ${JSON.stringify(orderResponse)}`);
      }

      // Step 2: Deserialize and sign the transaction
      const transactionBuffer = Buffer.from(orderResponse.transaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuffer);

      // Step 3: Sign the transaction
      transaction.sign([this.wallet]);

      // Step 4: Execute the order
      // Handle bs58 encoding properly (handle both CommonJS and ES module versions)
      const executeResponse = await this.executeOrder(transaction, orderResponse.requestId);

      // Step 5: Check for success and return the signature
      if (executeResponse.status === 'Success') {
        console.log(`Ultra swap successful: ${executeResponse.signature}`);
        return executeResponse.signature;
      } else {
        throw new Error(`Ultra swap failed: ${executeResponse.error || JSON.stringify(executeResponse)}`);
      }
    } catch (error) {
      console.error(`Ultra swap execution failed: ${error.message}`);
      throw error;
    }
  }


  // --- Price API ---
  async getPrice(mintAddresses, vsToken = null, showExtraInfo = false) {
    /**
     * Fetch token prices
     * @param {string|string[]} mintAddresses - Single mint or comma-separated list
     * @param {string} vsToken - Optional token to denominate prices
     * @returns {Object} Price data
     */
    const ids = Array.isArray(mintAddresses) ? mintAddresses.join(',') : mintAddresses;
    const params = { ids };
    if (vsToken) params.vsToken = vsToken;
    if (showExtraInfo && !vsToken) params.showExtraInfo = true;

    const response = await limiter.schedule(() =>
      axios.get(`${JUPITER_API}/price/v2/`, { params })
    );
    return response.data;
  }
}


module.exports = JupiterService;