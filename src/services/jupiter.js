//jupiter.js

const axios = require('axios');
const { Connection, PublicKey, Transaction, VersionedTransaction } = require('@solana/web3.js');
const Bottleneck = require('bottleneck');
const bs58 = require('bs58');

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

  // --- Utility Methods ---
  async signAndSendTransaction(transaction) {
    if (!this.wallet) throw new Error('Wallet not provided');

    // Handle different transaction types (VersionedTransaction vs Transaction)
    if (transaction instanceof VersionedTransaction) {
      // For VersionedTransaction
      transaction.sign([this.wallet]);
    } else {
      // For regular Transaction
      transaction.sign(this.wallet);
    }

    const signature = await this.connection.sendRawTransaction(transaction.serialize());
    const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');
    if (confirmation.value.err) throw new Error(`Transaction failed: ${signature}`);
    console.log(`Transaction confirmed: ${signature}`);
    return signature;
  }

  // --- Ultra API ---
  async getBalances(address = this.userPublicKey) {
    /**
     * Fetch token balances for an address
     * @param {PublicKey|string} address - Optional address to check (defaults to wallet's public key)
     * @returns {Object} Token balances
     */
    if (!address) throw new Error('Address required');

    try {
      const response = await limiter.schedule(() =>
        axios.get(`${JUPITER_API}/ultra/v1/balances/${address.toString()}`)
      );
      return response.data;
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
    const response = await limiter.schedule(() =>
      axios.post(`${JUPITER_API}/ultra/v1/execute`, {
        signedTransaction: bs58.encode(signedTransaction.serialize()),
        requestId,
      })
    );
    return response.data;
  }

  // --- Swap API ---
  async getSwapQuote(inputMint, outputMint, amount, options = {}) {
    /**
     * Fetch a swap quote
     * @param {Object} options - slippageBps, swapMode, dexes, etc.
     * @returns {Object} Quote details
     */
    const params = {
      inputMint,
      outputMint,
      amount,
      slippageBps: options.slippageBps || DEFAULT_SLIPPAGE_BPS,
      swapMode: options.swapMode || 'ExactIn',
      ...options,
    };
    const response = await limiter.schedule(() =>
      axios.get(`${JUPITER_API}/swap/v1/quote`, { params })
    );
    return response.data;
  }

  async executeSwap(inputMint, outputMint, amount, options = {}) {
    /**
     * Execute a swap transaction
     * @param {Object} options - slippageBps, priorityFee, etc.
     * @returns {string} Transaction signature
     */
    const quote = await this.getSwapQuote(inputMint, outputMint, amount, options);
    const swapResponse = await limiter.schedule(() =>
      axios.post(`${JUPITER_API}/swap/v1/swap`, {
        userPublicKey: this.userPublicKey.toBase58(),
        quoteResponse: quote,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: options.priorityFee || DEFAULT_PRIORITY_FEE,
        ...options,
      })
    );

    const swapTxBuf = Buffer.from(swapResponse.data.swapTransaction, 'base64');
    let transaction = VersionedTransaction.deserialize(swapTxBuf);
    return await this.signAndSendTransaction(transaction);
  }

  async getSwapInstructions(inputMint, outputMint, amount, options = {}) {
    /**
     * Get swap instructions for manual transaction building
     * @returns {Object} Swap instructions
     */
    const quote = await this.getSwapQuote(inputMint, outputMint, amount, options);
    const response = await limiter.schedule(() =>
      axios.post(`${JUPITER_API}/swap/v1/swap-instructions`, {
        userPublicKey: this.userPublicKey.toBase58(),
        quoteResponse: quote,
        wrapAndUnwrapSol: true,
        ...options,
      })
    );
    return response.data;
  }

  async getProgramIdToLabel() {
    /**
     * Get mapping of program IDs to labels
     * @returns {Object} Program ID mappings
     */
    const response = await limiter.schedule(() =>
      axios.get(`${JUPITER_API}/swap/v1/program-id-to-label`)
    );
    return response.data;
  }

  // --- Trigger API ---
  async createTriggerOrder(inputMint, outputMint, makingAmount, takingAmount, options = {}) {
    /**
     * Create a trigger order
     * @returns {string} Order address
     */
    const response = await limiter.schedule(() =>
      axios.post(`${JUPITER_API}/trigger/v1/createOrder`, {
        inputMint,
        outputMint,
        maker: this.userPublicKey.toBase58(),
        payer: this.userPublicKey.toBase58(),
        params: { makingAmount, takingAmount },
        computeUnitPrice: options.computeUnitPrice || 'auto',
        ...options,
      })
    );

    const txBuf = Buffer.from(response.data.transaction, 'base64');
    let transaction = Transaction.from(txBuf);
    await this.signAndSendTransaction(transaction);

    await limiter.schedule(() =>
      axios.post(`${JUPITER_API}/trigger/v1/execute`, {
        requestId: response.data.requestId,
        signedTransaction: bs58.encode(transaction.serialize()),
      })
    );
    return response.data.order;
  }

  async cancelTriggerOrder(order, options = {}) {
    /**
     * Cancel a trigger order
     * @param {string} order - Order address
     */
    const response = await limiter.schedule(() =>
      axios.post(`${JUPITER_API}/trigger/v1/cancelOrder`, {
        maker: this.userPublicKey.toBase58(),
        order,
        computeUnitPrice: options.computeUnitPrice || 'auto',
        ...options,
      })
    );

    const txBuf = Buffer.from(response.data.transaction, 'base64');
    let transaction = Transaction.from(txBuf);
    await this.signAndSendTransaction(transaction);

    await limiter.schedule(() =>
      axios.post(`${JUPITER_API}/trigger/v1/execute`, {
        requestId: response.data.requestId,
        signedTransaction: bs58.encode(transaction.serialize()),
      })
    );
    console.log(`Trigger order canceled: ${order}`);
  }

  async getTriggerOrders(orderStatus = 'active', options = {}) {
    /**
     * Fetch trigger orders
     * @param {string} orderStatus - 'active' or 'history'
     * @returns {Object} Orders and pagination info
     */
    const params = {
      user: this.userPublicKey.toBase58(),
      orderStatus,
      page: options.page || 1,
      ...options,
    };
    const response = await limiter.schedule(() =>
      axios.get(`${JUPITER_API}/trigger/v1/getTriggerOrders`, { params })
    );
    return response.data;
  }

  // --- Recurring API ---
  async createRecurringOrder(inputMint, outputMint, params, options = {}) {
    /**
     * Create a recurring order (time or price-based)
     * @param {Object} params - { time: { inAmount, numberOfOrders, interval } } or { price: {...} }
     */
    const response = await limiter.schedule(() =>
      axios.post(`${JUPITER_API}/recurring/v1/createOrder`, {
        user: this.userPublicKey.toBase58(),
        inputMint,
        outputMint,
        params,
        ...options,
      })
    );

    const txBuf = Buffer.from(response.data.transaction, 'base64');
    let transaction = Transaction.from(txBuf);
    await this.signAndSendTransaction(transaction);

    await limiter.schedule(() =>
      axios.post(`${JUPITER_API}/recurring/v1/execute`, {
        requestId: response.data.requestId,
        signedTransaction: bs58.encode(transaction.serialize()),
      })
    );
    console.log(`Recurring order created`);
  }

  async cancelRecurringOrder(order, recurringType, options = {}) {
    /**
     * Cancel a recurring order
     * @param {string} recurringType - 'time' or 'price'
     */
    const response = await limiter.schedule(() =>
      axios.post(`${JUPITER_API}/recurring/v1/cancelOrder`, {
        order,
        recurringType,
        user: this.userPublicKey.toBase58(),
        ...options,
      })
    );

    const txBuf = Buffer.from(response.data.transaction, 'base64');
    let transaction = Transaction.from(txBuf);
    await this.signAndSendTransaction(transaction);

    await limiter.schedule(() =>
      axios.post(`${JUPITER_API}/recurring/v1/execute`, {
        requestId: response.data.requestId,
        signedTransaction: bs58.encode(transaction.serialize()),
      })
    );
    console.log(`Recurring order canceled: ${order}`);
  }

  async priceDeposit(order, amount, options = {}) {
    /**
     * Deposit into a price-based recurring order
     */
    const response = await limiter.schedule(() =>
      axios.post(`${JUPITER_API}/recurring/v1/priceDeposit`, {
        amount,
        order,
        user: this.userPublicKey.toBase58(),
        ...options,
      })
    );

    const txBuf = Buffer.from(response.data.transaction, 'base64');
    let transaction = Transaction.from(txBuf);
    await this.signAndSendTransaction(transaction);

    await limiter.schedule(() =>
      axios.post(`${JUPITER_API}/recurring/v1/execute`, {
        requestId: response.data.requestId,
        signedTransaction: bs58.encode(transaction.serialize()),
      })
    );
    console.log(`Deposited ${amount} into order: ${order}`);
  }

  async priceWithdraw(order, inputOrOutput, amount = null, options = {}) {
    /**
     * Withdraw from a price-based recurring order
     * @param {string} inputOrOutput - 'In' or 'Out'
     */
    const response = await limiter.schedule(() =>
      axios.post(`${JUPITER_API}/recurring/v1/priceWithdraw`, {
        amount,
        inputOrOutput,
        order,
        user: this.userPublicKey.toBase58(),
        ...options,
      })
    );

    const txBuf = Buffer.from(response.data.transaction, 'base64');
    let transaction = Transaction.from(txBuf);
    await this.signAndSendTransaction(transaction);

    await limiter.schedule(() =>
      axios.post(`${JUPITER_API}/recurring/v1/execute`, {
        requestId: response.data.requestId,
        signedTransaction: bs58.encode(transaction.serialize()),
      })
    );
    console.log(`Withdrawn from order: ${order}`);
  }

  async getRecurringOrders(recurringType, orderStatus, page = 1, includeFailedTx = false) {
    /**
     * Fetch recurring orders
     * @param {string} recurringType - 'time' or 'price'
     * @param {string} orderStatus - 'active' or 'history'
     * @returns {Object} Orders and details
     */
    const response = await limiter.schedule(() =>
      axios.get(`${JUPITER_API}/recurring/v1/getRecurringOrders`, {
        params: {
          recurringType,
          orderStatus,
          user: this.userPublicKey.toBase58(),
          page,
          includeFailedTx,
        },
      })
    );
    return response.data;
  }

  // --- Token API ---
  async getTokenInfo(mintAddress) {
    /**
     * Fetch token metadata
     * @returns {Object} Token details
     */
    const response = await limiter.schedule(() =>
      axios.get(`${JUPITER_API}/tokens/v1/token/${mintAddress}`)
    );
    return response.data;
  }

  async getMintsInMarket(marketAddress) {
    /**
     * Fetch mints in a market
     * @returns {string[]} Mint addresses
     */
    const response = await limiter.schedule(() =>
      axios.get(`${JUPITER_API}/tokens/v1/market/${marketAddress}/mints`)
    );
    return response.data;
  }

  async getTradableMints() {
    /**
     * Fetch all tradable mints
     * @returns {string[]} Mint addresses
     */
    const response = await limiter.schedule(() =>
      axios.get(`${JUPITER_API}/tokens/v1/mints/tradable`)
    );
    return response.data;
  }

  async getTaggedTokens(tags) {
    /**
     * Fetch tokens by tags
     * @param {string} tags - Comma-separated tags (e.g., 'lst,token-2022')
     * @returns {Object[]} Tokens with metadata
     */
    const response = await limiter.schedule(() =>
      axios.get(`${JUPITER_API}/tokens/v1/tagged/${tags}`)
    );
    return response.data;
  }

  async getNewTokens(limit = 10, offset = 0) {
    /**
     * Fetch new tokens
     * @returns {Object[]} New token metadata
     */
    const response = await limiter.schedule(() =>
      axios.get(`${JUPITER_API}/tokens/v1/new`, { params: { limit, offset } })
    );
    return response.data;
  }

  async getAllTokens() {
    /**
     * Fetch all tokens
     * @returns {Object[]} All token metadata
     */
    const response = await limiter.schedule(() =>
      axios.get(`${JUPITER_API}/tokens/v1/all`)
    );
    return response.data;
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

// Example usage (commented out)
/*
(async () => {
  const { initializeWallet } = require('./wallet');
  const wallet = initializeWallet();
  const jupiter = new JupiterService(null, wallet);

  // Example: Execute a swap
  const signature = await jupiter.executeSwap(SOL_MINT, 'YOUR_MEMECOIN_MINT', 1000000000);
  console.log(`Swap executed: ${signature}`);

  // Example: Get balances
  const balances = await jupiter.getBalances();
  console.log('Balances:', balances);

  // Example: Create a trigger order
  const order = await jupiter.createTriggerOrder(SOL_MINT, 'YOUR_MEMECOIN_MINT', 1000000000, 2000000000);
  console.log(`Trigger order: ${order}`);
})();
*/

module.exports = JupiterService;