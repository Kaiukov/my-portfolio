---
name: portfolio-cli
description: This skill should be used when the user asks to "add transaction", "check portfolio", "show summary", "migrate transactions", "list trades", "calculate returns", or mentions DuckDB portfolio tracking, P&L calculation, or position management.
version: 0.2.0
---

# Portfolio DuckDB CLI Skill

## Purpose

Manage portfolio transactions and analyze performance using DuckDB. Provides commands for adding trades, viewing positions with real-time gains/losses, and calculating daily returns with separated investment vs cash flow metrics.

## Commands

### Add Transaction
```bash
uv run python -m portfolio_db.cli add --date DD-MM-YYYY --asset SYMBOL --action ACTION --quantity QTY [options]
```

**Actions:** BUY, SELL, DEPOSIT
**Options:**
- `--price` - Asset price in transaction currency
- `--currency` - Currency code (default: USD)
- `--fees` - Transaction fees
- `--exchange` - Exchange or broker name
- `--db` - Path to DuckDB file (default: portfolio.db)

**Examples:**
```bash
# Buy stock
uv run python -m portfolio_db.cli add --date 31-01-2026 --asset AAPL --action BUY --quantity 10 --price 150

# Sell crypto
uv run python -m portfolio_db.cli add --date 31-01-2026 --asset BTC-USD --action SELL --quantity 0.5 --price 95000

# Deposit cash (USD)
uv run python -m portfolio_db.cli add --date 31-01-2026 --asset USD --action DEPOSIT --quantity 1000

# Deposit cash (EUR)
uv run python -m portfolio_db.cli add --date 31-01-2026 --asset EURUSD=X --action DEPOSIT --quantity 500
```

### View Portfolio Summary
```bash
uv run python -m portfolio_db.cli summary [--filter open|all] [--export FILE]
```

**Options:**
- `--filter` - `open` (held positions) or `all` (includes closed) (default: all)
- `--export` - Path to save as CSV (e.g., summary.csv)

### Asset Allocation
```bash
uv run python -m portfolio_db.cli allocation [--type assets|cash|all] [--export FILE]
```

**Options:**
- `--type` - `assets`, `cash`, or `all` (default: all)
- `--export` - Path to save as CSV

### Daily Performance Report
```bash
uv run python -m portfolio_db.cli report [--format table|json]
```

**Formats:** `table` for humans, `json` for structured processing. Includes Portfolio Value, Daily %, Investment %, and Cash Flow impact.

### List Transactions
```bash
uv run python -m portfolio_db.cli transactions [--format table|json]
```

### Portfolio Status
```bash
uv run python -m portfolio_db.cli status
```
Quick overview of transaction count, current value, total gain, and average investment return.

### Recalculate Returns
```bash
uv run python -m portfolio_db.cli recalculate [--force] [--from-date DD-MM-YYYY]
```
Forces recalculation of daily returns from a specific date or the beginning of history.

### Migrate from CSV
```bash
uv run python -m portfolio_db.cli migrate [--csv PATH] [--db PATH]
```
Migrates legacy semicolon-separated CSV transactions to the DuckDB database.

### Verify Prices
```bash
uv run python -m portfolio_db.cli verify-prices
```
Verifies the schema and statistics of the cached price data in DuckDB.

## Portfolio Features

**DuckDB Backend:** High-performance analytical storage for transactions and prices.
**Separated Metrics:** Distinguishes between gains from market movement ("Investment %") and changes from deposits/withdrawals ("Cash Flow").
**Auto-Recalculation:** Adding a transaction automatically triggers a smart partial or full recalculation of historical returns.
**Multi-Currency Support:** Handles USD, EUR, GBP, and UAH using Yahoo Finance FX pairs (e.g., EURUSD=X).
**Real-Time Valuation:** Uses `yfinance` to fetch latest prices for stocks, ETFs, and crypto.

## Data Storage

- **Database:** `portfolio.db` (DuckDB)
- **Tables:** `transactions`, `prices`, `daily_returns`, `recalc_cache`, `refresh_log`.

## Common Workflows

**Check performance after adding trades:**
```bash
uv run python -m portfolio_db.cli add --date 31-01-2026 --asset BTC-USD --action BUY --quantity 0.1 --price 102000
uv run python -m portfolio_db.cli status
uv run python -m portfolio_db.cli summary
```

**Analyze cash vs investments:**
```bash
uv run python -m portfolio_db.cli allocation --type all
uv run python -m portfolio_db.cli report --format table
```

**Export data for external analysis:**
```bash
uv run python -m portfolio_db.cli summary --export my_positions.csv
uv run python -m portfolio_db.cli report --format json > daily_history.json
```
