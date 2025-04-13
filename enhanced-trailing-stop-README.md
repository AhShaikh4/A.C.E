# Enhanced Trailing Stop Implementation

This implementation adds two major improvements to the trailing stop mechanism:

1. **Dynamic ATR Multiplier Based on Profit Level**
2. **Percentage-Based Trailing Stop**

## Dynamic ATR Multiplier

The dynamic ATR multiplier adjusts the trailing stop distance based on the current profit level. As profit increases, the stop becomes tighter to lock in more gains.

### Configuration

```javascript
TRAILING_STOP: {
  // ATR-based trailing stop
  ATR_MULTIPLIER: 2.5, // Default ATR multiplier
  // Dynamic ATR multipliers based on profit levels
  DYNAMIC_ATR_MULTIPLIERS: [
    { PROFIT_PERCENT: 50, MULTIPLIER: 1.5 }, // Tighter stop for large profits
    { PROFIT_PERCENT: 20, MULTIPLIER: 2.0 }, // Medium stop for medium profits
    { PROFIT_PERCENT: 0, MULTIPLIER: 2.5 }   // Wider stop for smaller profits
  ]
}
```

### How It Works

1. The system checks the current profit percentage
2. It selects the appropriate ATR multiplier based on the profit level
3. For example:
   - At 60% profit, it uses a 1.5x ATR multiplier (tighter stop)
   - At 30% profit, it uses a 2.0x ATR multiplier (medium stop)
   - At 10% profit, it uses a 2.5x ATR multiplier (wider stop)

## Percentage-Based Trailing Stop

In addition to the ATR-based stop, a simple percentage-based trailing stop is implemented as a backup.

### Configuration

```javascript
TRAILING_STOP: {
  // Percentage-based trailing stop
  PERCENT: 3.0, // Default trailing stop percentage (3%)
  // Whether to use the maximum of ATR and percentage stops
  USE_MAX_STOP: true
}
```

### How It Works

1. The percentage-based stop is calculated as: `highestPrice * (1 - (PERCENT / 100))`
2. If `USE_MAX_STOP` is true, the system uses whichever stop level is higher (less likely to trigger)
3. This provides a safety net in case the ATR value is unusually low

## Benefits

1. **Adaptive Risk Management**: The stop adjusts based on profit level, becoming more conservative as profits grow
2. **Dual Protection**: Using both ATR and percentage-based stops provides more robust protection
3. **Improved Visibility**: Enhanced logging shows which stop type is active and how far away it is

## Example Output

```
Position MOON: Current price $0.00028480, P/L: 0.14%, Highest: $0.00028630, RSI: 48.59, Holder change: 0.00%
Trailing stop: $0.00027630 (ATR-based, 2.98% away)
```

## When a Stop Triggers

When a trailing stop is triggered, the log will show detailed information:

```
Sell criteria met for MOON: Trailing stop triggered (ATR-based, 3.52% drop from high of $0.00028890)
```

This helps with post-trade analysis to understand exactly why and how the position was exited.
