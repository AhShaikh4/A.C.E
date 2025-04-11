# Environment Variables Documentation

This document describes all environment variables used in the Solana Memecoin Trading Bot.

## Required Variables

### Wallet Configuration
- `PRIVATE_KEY`: Your base58-encoded private key
  - Required for trading operations
  - Must be kept secure and never shared
  - Example: (Do not use this key): `4wBqpZM9...`

### API Keys
- `MORALIS_API_KEY`: Your Moralis API key
  - Required for on-chain analysis and holder data
  - Get from: https://moralis.io

## Optional Variables

### Network Settings
- `NETWORK`: The Solana network to connect to
  - Default: `mainnet-beta`
  - Options: `mainnet-beta`, `devnet`, `testnet`

### Logging Configuration
- `LOG_LEVEL`: Determines the verbosity of logging
  - Default: `info`
  - Options: `debug`, `info`, `warn`, `error`
  - Effects:
    - `debug`: All messages including detailed debugging
    - `info`: Standard operational messages
    - `warn`: Only warnings and errors
    - `error`: Only error messages

## Security Notes

1. Never commit your `.env` file to version control
2. Keep your private key secure and never share it
3. Regularly rotate API keys
4. Use different keys for development and production

## Usage

1. Fill in your values
2. Ensure `.env` is listed in `.gitignore`