---
name: portfolio-cli
description: This skill should be used when the user asks to "add transaction", "check portfolio", "show performance", "view cash", "list trades", "delete transaction", "exchange currency", "show allocation", or mentions DuckDB portfolio tracking, P&L calculation, risk metrics, or position management.
version: 0.4.0
---

# Portfolio CLI

Portfolio tracking system using DuckDB. Run commands via `uv run python -m portfolio_db.cli <command>`.

## Transaction Management

### Add Transaction
```bash
uv run python -m portfolio_db.cli add \
  --date DD-MM-YYYY \
  --asset SYMBOL \
  --action BUY|SELL|DEPOSIT|FEE \
  --quantity QTY \
  --price PRICE \
  --fees FEES \
  --exchange EXCHANGE
```

**Actions:**
- `BUY` - Purchase asset (deducts cash)
- `SELL` - Sell asset (adds cash)
- `DEPOSIT` - Add cash to portfolio
- `FEE` - Record fee (deducts from asset currency)

### Exchange Currency
```bash
uv run python -m portfolio_db.cli exchange \
  --date DD-MM-YYYY \
  --from SOURCE_CURRENCY \
  --to TARGET_CURRENCY \
  --quantity SOURCE_AMOUNT \
  --rate RATE
```

**Rate format:** target currency per 1 unit of source (e.g., 1.178 means 1 EUR = 1.178 USD)

**Currency assets:**
- `USD` - US Dollar cash
- `EURUSD=X` - Euro cash
- `GBPUSD=X` - British Pound cash
- `UAHUSD=X` - Ukrainian Hryvnia cash

### Delete Transaction
```bash
uv run python -m portfolio_db.cli delete --id ID --confirm
```

## Portfolio Views

### Summary - Position Summary
```bash
uv run python -m portfolio_db.cli summary --filter open|all
```
Shows all positions with gains/losses, cost basis, market value.

### Cash - Cash Balances
```bash
uv run python -m portfolio_db.cli cash
```
Shows actual cash balances (deposits - spent + received).

### Allocation - Portfolio Breakdown
```bash
uv run python -m portfolio_db.cli allocation --type assets|cash|all
```
Shows portfolio allocation by percentage.

### Performance - Risk & Return Metrics
```bash
uv run python -m portfolio_db.cli performance --table --md
```
Shows Sharpe ratio, Sortino, Beta, VaR, drawdowns, CAGR.

### Transactions - List All
```bash
uv run python -m portfolio_db.cli transactions --format json|table
```

### Status - Quick Overview
```bash
uv run python -m portfolio_db.cli status
```

### Report - Daily Returns
```bash
uv run python -m portfolio_db.cli report --format json|table
```

## Maintenance

### Recalculate
```bash
uv run python -m portfolio_db.cli recalculate --force --from-date DD-MM-YYYY
```

### Verify Prices
```bash
uv run python -m portfolio_db.cli verify_prices
```

### Migrate from CSV
```bash
uv run python -m portfolio_db.cli migrate --csv path/to/file.csv
```

## Asset Type Detection

The system automatically detects asset types:
- **Stocks** - Ticker symbols (AAPL, MSFT, etc.)
- **Stocks EUR** - `.DE` suffix (VGEU.DE)
- **Stocks GBP** - `.L` suffix (IGLN.L)
- **Crypto** - `-USD` suffix (BTC-USD, ETH-USD)
- **Cash USD** - `USD` or `CASH USD`
- **Cash FX** - `EURUSD=X`, `GBPUSD=X`, `UAHUSD=X`

## Exchange Rate Reference

**FX pairs** (Yahoo Finance format):
- `EURUSD=X` - EUR to USD rate
- `GBPUSD=X` - GBP to USD rate
- `UAHUSD=X` - UAH to USD rate

**To convert EUR → USD:** Use rate as USD per EUR (e.g., 1.178)
**To convert USD → EUR:** Use rate as EUR per USD (e.g., 0.849)
