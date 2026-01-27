---
name: portfolio-cli
description: This skill should be used when the user asks to "add transaction", "add dividend", "deposit cash", "check portfolio", "show summary", "import transactions", "list trades", "export portfolio", or mentions portfolio tracking, P&L calculation, position management, or cash deposits.
version: 0.1.0
---

# Portfolio CLI Skill

## Purpose

Execute portfolio transactions and analyze holdings using FIFO cost basis tracking. Provides commands for adding trades, viewing positions, calculating P&L, and managing cash across multiple currencies.

## Commands

### Add Transaction
```bash
uv run python -m src.cli add SYMBOL QUANTITY --price PRICE --asset-type TYPE --action ACTION [options]
```

**Asset Types:** crypto, stock, etf, cash
**Actions:** buy, sell, deposit, withdrawal
**Options:**
- `--currency` - USD, EUR, GBP (default: USD)
- `--fees` - Transaction fees (default: 0)
- `--date` - YYYY-MM-DD format (default: today)
- `--exchange` - Broker name (Binance, Paysera, etc.)

**Examples:**
```bash
# Buy stock
uv run python -m src.cli add AAPL 10 --price 150 --asset-type stock --action buy

# Sell crypto
uv run python -m src.cli add BTC-USD 0.5 --price 95000 --asset-type crypto --action sell --fees 5

# Deposit cash
uv run python -m src.cli add CASH 1000 --price 1 --asset-type cash --action deposit --currency USD

# Historical transaction
uv run python -m src.cli add ETH-USD 2 --price 3500 --asset-type crypto --action buy --date 2025-06-15
```

### Add Dividend
```bash
uv run python -m src.cli dividend AMOUNT --currency CURRENCY [--symbol SYMBOL] [--date DATE]
```

**Parameters:**
- `AMOUNT` - Dividend amount (required)
- `--currency` - Currency code (USD, EUR, GBP, etc., default: USD)
- `--symbol` - Asset symbol dividend came from (optional, for reference)
- `--date` - YYYY-MM-DD format (default: today)

**Behavior:** Deposits dividend to appropriate currency cash position. Creates CASH DEPOSIT transaction automatically.

**Examples:**
```bash
# Add USD dividend
uv run python -m src.cli dividend 100 --currency USD

# Add EUR dividend from AAPL
uv run python -m src.cli dividend 50 --currency EUR --symbol AAPL

# Add GBP dividend from Unilever
uv run python -m src.cli dividend 25 --currency GBP --symbol UNILEVER

# Historical dividend
uv run python -m src.cli dividend 75.50 --currency USD --symbol MSFT --date 2025-01-10
```

**Result:** Dividend recorded as CASH DEPOSIT. Balance for `CASH-{CURRENCY}` increases automatically (e.g., dividend 100 USD → CASH-USD +100).

### View Portfolio
```bash
# Portfolio summary with P&L (table format)
uv run python -m src.cli summary

# Portfolio summary as JSON (LLM-ready)
uv run python -m src.cli summary --json

# Cash balances by currency
uv run python -m src.cli cash

# Cash balances as JSON (LLM-ready)
uv run python -m src.cli cash --json

# Asset allocation
uv run python -m src.cli allocation

# Asset allocation as JSON (LLM-ready)
uv run python -m src.cli allocation --json

# All transactions (filterable)
uv run python -m src.cli list
uv run python -m src.cli list --symbol BTC-USD
uv run python -m src.cli list --type crypto
```

**JSON Output (--json flag):**
All view commands support `--json` for LLM-ready structured output:
- `summary --json` - Positions array + totals object
- `cash --json` - Balances array + total_usd
- `allocation --json` - Allocation array + total_value_usd

### Import CSV
```bash
uv run python -m src.cli import-csv /path/to/file.csv [--clear-first] [--format FORMAT]
```

**Formats:** auto (default), simplified, ib (Interactive Brokers)

```bash
# Auto-detect & import
uv run python -m src.cli import-csv portfolio.csv

# Clear existing & import
uv run python -m src.cli import-csv portfolio.csv --clear-first

# Specific format
uv run python -m src.cli import-csv portfolio.csv --format simplified
```

### Export Portfolio
```bash
uv run python -m src.cli export --format FORMAT [--output FILE]
```

**Formats:** json, csv

```bash
# Export as JSON
uv run python -m src.cli export --format json --output my_portfolio.json

# Export as CSV
uv run python -m src.cli export --format csv --output my_portfolio.csv
```

## Portfolio Features

**FIFO Cost Basis:** Oldest lots sold first for accurate capital gains tracking
**Multi-Currency:** Automatic USD conversion with live exchange rates
**Auto Cash Tracking:** Buying/selling automatically adjusts cash balances
**Real-Time P&L:** Current holdings valued at live market prices

**Calculations:**
- **Unrealized P&L** = Current Value - Cost Basis (open positions)
- **Realized P&L** = Locked gains/losses from sold positions
- **Total P&L** = Unrealized + Realized

## Data Storage

Transactions stored in `/data/transactions.json` with full history and FIFO lot tracking.

## Common Workflows

**Add multiple trades quickly:**
```bash
uv run python -m src.cli add BTC-USD 0.1 --price 45000 --asset-type crypto --action buy --date 2025-01-15
uv run python -m src.cli add ETH-USD 2 --price 3000 --asset-type crypto --action buy --date 2025-01-16
uv run python -m src.cli add BTC-USD 0.05 --price 50000 --asset-type crypto --action sell --date 2025-01-20
```

**Manage multi-currency cash:**
```bash
uv run python -m src.cli add CASH 500 --price 1 --asset-type cash --action deposit --currency EUR
uv run python -m src.cli add CASH 1000 --price 1 --asset-type cash --action deposit --currency USD
uv run python -m src.cli dividend 100 --currency USD
uv run python -m src.cli dividend 50 --currency EUR --symbol AAPL
uv run python -m src.cli cash
```

**Import & analyze:**
```bash
uv run python -m src.cli import-csv transactions.csv --clear-first
uv run python -m src.cli summary
uv run python -m src.cli allocation
```

**Get portfolio data as JSON (LLM-ready):**
```bash
# Output JSON summary
uv run python -m src.cli summary --json

# Output cash balances as JSON
uv run python -m src.cli cash --json

# Output allocation as JSON
uv run python -m src.cli allocation --json

# Save JSON to file
uv run python -m src.cli summary --json > portfolio_summary.json

# Export transactions (alternative JSON export)
uv run python -m src.cli export --format json --output transactions.json
```
