# Profit Branch - Tiered Profit Taking Implementation

This branch implements a tiered profit taking strategy to improve the trading bot's profitability.

## What is Tiered Profit Taking?

Tiered profit taking is a strategy where instead of selling an entire position at a single profit target, the bot sells portions of the position at different profit levels. This approach has several advantages:

1. **Secures profits earlier**: By selling a portion of the position at lower profit targets, the bot locks in some gains even if the price doesn't reach the higher targets.
2. **Reduces risk**: Partial profit taking reduces exposure as the position becomes profitable.
3. **Allows for moonshots**: By keeping a portion of the position until higher profit targets, the bot can still capture significant gains if the price continues to rise.

## Implementation Details

### Configuration (config.js)

The tiered profit taking strategy is configured in the `SELL_CRITERIA` object:

```javascript
TIERED_PROFIT_TAKING: {
  ENABLED: true,
  TIERS: [
    { PERCENT: 5, POSITION_PERCENT: 30 },  // Sell 30% when profit reaches 5%
    { PERCENT: 10, POSITION_PERCENT: 30 }, // Sell another 30% when profit reaches 10%
    // Final 40% uses the PROFIT_TARGET (15%) or trailing stop
  ]
}
```

- `ENABLED`: Toggle to enable/disable tiered profit taking
- `TIERS`: Array of profit tiers, each with:
  - `PERCENT`: The profit percentage at which to trigger a partial sell
  - `POSITION_PERCENT`: The percentage of the total position to sell at this tier

### Sell Decision Logic (meetsSellCriteria)

The `meetsSellCriteria` function has been updated to:

1. Initialize tier tracking for each position
2. Check if any profit tiers have been reached
3. Mark tiers as executed to prevent duplicate sells
4. Return the appropriate sell percentage for each tier

### Partial Selling (executeSell)

The `executeSell` function has been modified to:

1. Accept a `sellPercentage` parameter (defaults to 100%)
2. Calculate the token amount to sell based on the sell percentage
3. Execute the sell for only the specified portion of the position

### Position Management (monitorPositions)

The position monitoring logic has been updated to:

1. Pass the sell percentage to the executeSell function
2. Only delete the position from tracking if selling 100% or if it's a stop loss/emergency exit
3. Keep tracking partially sold positions for future profit tiers

## How It Works

1. When a position becomes profitable, the bot checks if it has reached any of the configured profit tiers.
2. If a tier is reached, the bot sells the specified percentage of the position.
3. The position remains tracked, and the tier is marked as executed to prevent duplicate sells.
4. If the price continues to rise and reaches the next tier, another portion is sold.
5. The final portion is sold when either:
   - The main profit target is reached (default: 15%)
   - A trailing stop is triggered
   - Any other exit condition occurs (RSI overbought, etc.)

## Benefits

- **Improved Risk Management**: Secures profits at multiple levels
- **Psychological Advantage**: Reduces the temptation to exit positions too early or too late
- **Optimized Returns**: Balances between securing profits and maximizing potential gains
- **Reduced Impact of Volatility**: Less affected by price swings after securing partial profits
