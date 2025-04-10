// simulation-runner.js - Integration between main.js and simulator.js

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { performTA } = require('./TA');
const { DexScreenerService } = require('./src/services/dexscreener');
const { BOT_CONFIG } = require('./config');
const { runSimulation, simulateTrading } = require('./simulation/simulator');
const logger = require('./logger');

// Ensure simulation logs directory exists
const SIMULATION_LOG_DIR = path.join(BOT_CONFIG.LOG_DIR || './logs', 'simulation');

/**
 * Initialize simulation environment
 */
async function initializeSimulation() {
  try {
    // Create simulation log directory
    await fs.mkdir(SIMULATION_LOG_DIR, { recursive: true }).catch(() => {});
    
    logger.info('Initializing simulation environment...');
    
    // Initialize services
    const dexService = new DexScreenerService();
    
    return {
      dexService
    };
  } catch (error) {
    logger.error('Failed to initialize simulation:', error);
    throw error;
  }
}

/**
 * Run a single simulation cycle
 * @param {Object} services - Initialized services
 */
async function runSimulationCycle(services) {
  try {
    const startTime = Date.now();
    logger.info('Starting simulation analysis cycle...');
    
    // Perform technical analysis
    logger.info('Performing technical analysis for simulation...');
    const analyzedTokens = await performTA(services.dexService);
    
    // Log analysis results
    const duration = Date.now() - startTime;
    logger.info(`Analysis complete. Found ${analyzedTokens.length} tokens in ${duration}ms`);
    
    // Simulate trading with analyzed tokens
    logger.info('Simulating trading with analyzed tokens...');
    const tradingResult = await simulateTrading(analyzedTokens, services.dexService);
    
    if (tradingResult.success) {
      logger.info(`Trading simulation successful. Positions opened: ${tradingResult.positionsOpened}`);
      if (tradingResult.positionsOpened > 0) {
        tradingResult.positions.forEach(pos => {
          logger.info(`Simulated position opened: ${pos.symbol} at $${pos.entryPrice}, amount: ${pos.amount}`);
        });
      }
    } else {
      logger.warn(`Trading simulation failed: ${tradingResult.reason}`);
    }
    
    logger.info(`Simulation cycle completed in ${Date.now() - startTime}ms`);
    return analyzedTokens;
  } catch (error) {
    logger.error('Simulation cycle error:', error);
    return [];
  }
}

/**
 * Start the simulation
 */
async function startSimulation() {
  try {
    logger.info('Starting Solana Memecoin Trading Bot Simulation...');
    
    // Initialize simulation
    const services = await initializeSimulation();
    
    // Run the full simulation
    await runSimulation();
    
    logger.info('Simulation completed successfully.');
  } catch (error) {
    logger.error('Simulation failed:', error);
    process.exit(1);
  }
}

/**
 * Run a quick simulation test with a single cycle
 */
async function runQuickSimulation() {
  try {
    logger.info('Starting quick simulation test...');
    
    // Initialize simulation
    const services = await initializeSimulation();
    
    // Run a single simulation cycle
    await runSimulationCycle(services);
    
    logger.info('Quick simulation test completed.');
  } catch (error) {
    logger.error('Quick simulation test failed:', error);
    process.exit(1);
  }
}

// Run the simulation if this file is executed directly
if (require.main === module) {
  // Check for quick simulation flag
  const quickMode = process.argv.includes('--quick');
  
  if (quickMode) {
    runQuickSimulation();
  } else {
    startSimulation();
  }
}

// Export functions for potential programmatic use
module.exports = {
  startSimulation,
  runQuickSimulation,
  runSimulationCycle
};
