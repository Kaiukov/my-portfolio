# Portfolio CLI

Transaction-based portfolio tracking with FIFO cost basis calculation, CSV import from Interactive Brokers, and multi-currency support with real-time prices.

## Installation

```bash
# Install dependencies
uv sync

# Run CLI commands
uv run python -m src.cli [COMMAND]
```

Or install as a package:
```bash
pip install -e .
portfolio [COMMAND]
```

## Commands

### Import CSV
Import transactions from Interactive Brokers CSV format:
```bash
portfolio import-csv portfolio.csv
portfolio import-csv portfolio.csv --clear-first  # Clear existing transactions
```

**CSV Format Expected:**
- Symbol: Asset ticker (e.g., BTC-USD, AAPL, $$CASH_TX)
- Trade Date: YYYYMMDD format
- Quantity: Number of units
- Purchase Price: Price per unit
- Commission: Transaction fees
- Comment: Exchange/broker name
- Transaction Type: BUY, SELL, DEPOSIT, WITHDRAWAL, FEE

### Add Transaction
Add individual transactions manually:
```bash
# Buy transaction (default)
portfolio add BTC-USD 0.1 --price 50000 --currency USD --asset-type crypto

# Sell transaction
portfolio add BTC-USD 0.05 --price 55000 --currency USD --asset-type crypto --action sell

# Deposit cash
portfolio add CASH 1000 --price 1 --currency USD --asset-type cash --action deposit

# Withdraw cash
portfolio add CASH 500 --price 1 --currency USD --asset-type cash --action withdrawal

# Stock or ETF
portfolio add AAPL 10 --price 150 --currency USD --asset-type stock

# With fees and date
portfolio add AAPL 10 --price 150 --currency USD --asset-type stock --fees 10 --date 2024-01-15
```

### List Transactions
View transaction history:
```bash
portfolio list                           # All transactions
portfolio list --type stock              # Filter by asset type
portfolio list --symbol AAPL             # Filter by symbol
```

### Summary
Show portfolio summary with current values and P&L:
```bash
portfolio summary
```

Output includes:
- Current positions with real-time prices
- Cost basis (FIFO calculation)
- Unrealized P&L per position
- Total portfolio value and overall P&L

### Cash Balances
Show cash balances by currency with USD conversion:
```bash
portfolio cash
```

Output includes:
- Cash quantity per currency
- USD value of each currency balance
- Exchange rates used
- Total cash in USD

### Allocation
Show portfolio allocation by asset type:
```bash
portfolio allocation
```

Output includes:
- Value and percentage for: Crypto, Stock, ETF, Cash

### Export
Export transactions to file:
```bash
portfolio export --format json --output transactions.json
portfolio export --format csv --output transactions.csv
```

## Features

✅ **Transaction-Based Tracking**
- Full audit trail of all transactions
- JSON storage for persistence

✅ **FIFO Cost Basis Calculation**
- Accurate cost basis tracking for tax reporting
- Proper realized/unrealized P&L separation
- First-in-first-out lot matching for sales

✅ **Multi-Currency Support**
- Track positions in different currencies
- Automatic exchange rate conversion
- Display totals in USD

✅ **Real-Time Price Fetching**
- Stock/ETF prices from Yahoo Finance (yfinance)
- Crypto prices from Binance API
- 24-hour price caching to reduce API calls

✅ **Exchange Rate Conversion**
- Frankfurter API for currency conversion (free, no key required)
- Fallback support for Firefly exchange rate API
- Automatic USD conversion for reporting

✅ **CSV Import**
- Interactive Brokers CSV format support
- Automatic asset type detection
- Currency detection from symbol patterns

## Data Files

```
data/
├── transactions.json    # Transaction history storage
└── cache/
    └── prices.json      # Price cache (24-hour TTL)
```

## Asset Type Recognition

The importer automatically detects asset types:

- **Crypto**: Symbols containing "-USD" or "-EUR" (e.g., BTC-USD, ETH-EUR)
- **Cash**: Symbol "$$CASH_TX" converted to "CASH"
- **Stock**: Symbols with European suffixes (.DE=EUR, .L=GBP, .MI=EUR, .PA=EUR)
- **Default**: Treated as Stock (includes ETFs)

## Currency Recognition

Currencies are detected from:
- Crypto symbols: BTC-USD → USD, ETH-EUR → EUR
- Stock symbols: ABC.DE → EUR, ABC.L → GBP
- Default: USD

## FIFO Cost Basis Example

```
Transaction 1: Buy 1 BTC @ $40,000
Transaction 2: Buy 1 BTC @ $50,000
Transaction 3: Sell 1 BTC @ $60,000

Cost basis tracking:
- Lot 1: 1 BTC @ $40,000 (cost basis: $40,000)
- Lot 2: 1 BTC @ $50,000 (cost basis: $50,000)

On sale:
- FIFO sells Lot 1 (40,000 cost basis)
- Realized P&L: $60,000 - $40,000 = +$20,000
- Remaining position: Lot 2 (1 BTC @ cost $50,000)
```

## Enhancements Over Previous Versions

✨ **Cash Display Format**
- Cash assets display as "CASH-USD", "CASH-EUR", "CASH-GBP"
- Not just "CASH" - clearly shows currency

✨ **Total Investment in USD**
- All positions converted to USD for total
- Multi-currency portfolios show USD totals

✨ **Total Cash in USD**
- All cash balances converted to USD
- Single total cash figure in reporting

✨ **Project-Local Storage**
- Data stored in project directory `data/`
- Not in home directory `~/.portfolio/`
- Easier to manage and backup

✨ **Binance API Integration**
- Real crypto prices from Binance API
- Better than static price sources

## Configuration

### Environment Variables
The CLI can use optional environment variables for API credentials:

```bash
# Firefly III API (optional)
FIREFLY_API_URL=https://firefly.example.com
SYNC_SERVICE_API_KEY=your-api-key

# Binance API (free tier, no key required)
# No configuration needed
```

## Testing the System

1. **Import sample data:**
```bash
portfolio import-csv portfolio.csv --clear-first
```

2. **Add some transactions:**
```bash
portfolio add BTC-USD 0.1 --price 45000 --asset-type crypto
portfolio add AAPL 10 --price 150 --asset-type stock
portfolio add CASH 5000 --price 1 --currency USD --asset-type cash --action deposit
```

3. **View portfolio:**
```bash
portfolio summary    # See current values and P&L
portfolio cash       # See cash balances by currency
portfolio allocation # See asset distribution
```

4. **Export data:**
```bash
portfolio export --format json
portfolio export --format csv
```

## Performance Notes

- **Price Caching**: Prices are cached for 24 hours in `data/cache/prices.json`
- **API Rate Limits**:
  - Binance: 1200 requests/minute (generous for personal use)
  - Yahoo Finance: Moderate rate limits via yfinance
  - Frankfurter: No rate limits

- **Large Portfolios**: FIFO calculation is O(n) per position, performant for <10,000 transactions

## Error Handling

The system handles errors gracefully:
- Missing prices show cached value or cost basis as fallback
- API failures don't crash the application
- Invalid CSV rows are skipped with warnings
- Transaction validation prevents invalid states

## Development

```bash
# Run tests
uv run pytest

# Type checking
uv run pyright src/

# Linting
uv run ruff check src/
```

## Architecture

```
src/
├── models.py       # Pydantic data models (Transaction, Position, etc.)
├── storage.py      # JSON file persistence (TransactionStorage)
├── prices.py       # Price fetching & caching (PriceFetcher, PriceCache)
├── portfolio.py    # FIFO analysis (PortfolioAnalyzer)
├── importer.py     # CSV import (InteractiveBrokersImporter)
└── cli.py          # Typer CLI interface
```

Each module has clear responsibilities:
- **models.py**: Data structures with validation
- **storage.py**: Persistence layer (JSON files)
- **prices.py**: External data sources (APIs, caching)
- **portfolio.py**: Business logic (FIFO, P&L calculations)
- **importer.py**: CSV parsing and validation
- **cli.py**: User interface (commands and output formatting)
