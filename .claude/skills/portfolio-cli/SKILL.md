---
name: portfolio-cli
description: This skill should be used when the user asks to "add transaction", "check portfolio", "show performance metrics", "calculate Sharpe ratio", "view portfolio summary", "migrate transactions", "list trades", "delete transaction", or mentions DuckDB portfolio tracking, P&L calculation, risk metrics, or position management.
version: 0.3.0
---

# Portfolio DuckDB CLI Skill

## Purpose

Manage portfolio transactions and analyze performance using DuckDB. Provides commands for adding trades, viewing positions with real-time gains/losses, calculating risk-adjusted performance metrics (Sharpe, Sortino, Treynor, Information Ratio, Jensen's Alpha), and tracking daily returns with separated investment vs cash flow metrics.

## Commands

### Performance Metrics (NEW)
```bash
uv run python -m portfolio_db.cli performance [--table] [--md]
```

**Risk-Adjusted Metrics:**
- **Sharpe Ratio** - Return per unit of total risk (volatility)
- **Sortino Ratio** - Return per unit of downside risk only
- **Treynor Ratio** - Return per unit of systematic risk (beta)
- **Information Ratio** - Excess return vs benchmark per unit of tracking error
- **Jensen's Alpha** - CAPM-adjusted excess return
- **Relative Return** - Portfolio return minus SPY benchmark return
- **Tracking Error** - Volatility of excess returns vs benchmark

**Output Formats:**
- `--table` - Human-readable ASCII table with assessments
- `--md` - Markdown format with tables (for documentation)
- Default - JSON with metric evaluations

**Examples:**
```bash
# JSON output (default)
uv run python -m portfolio_db.cli performance

# Human-readable table
uv run python -m portfolio_db.cli performance --table

# Markdown for documentation
uv run python -m portfolio_db.cli performance --md
```

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

### Delete Transaction (NEW)
```bash
uv run python -m portfolio_db.cli delete --id ID [--confirm]
```

Deletes a transaction by ID and auto-recalculates returns from the transaction date. Requires confirmation unless `--confirm` flag is used.

**Example:**
```bash
# Delete with confirmation prompt
uv run python -m portfolio_db.cli delete --id 42

# Delete without confirmation
uv run python -m portfolio_db.cli delete --id 42 --confirm
```

### View Portfolio Summary
```bash
uv run python -m portfolio_db.cli summary [--filter open|all] [--export FILE]
```

**Options:**
- `--filter` - `open` (held positions) or `all` (includes closed) (default: all)
- `--export` - Path to save as CSV (e.g., summary.csv)

**Output includes:** Symbol, shares, last price, average cost, market value, daily gains, total gains, and realized gains.

### Asset Allocation
```bash
uv run python -m portfolio_db.cli allocation [--type assets|cash|all] [--export FILE]
```

**Options:**
- `--type` - `assets`, `cash`, or `all` (default: all)
- `--export` - Path to save as CSV

### Cash Balances (NEW)
```bash
uv run python -m portfolio_db.cli cash
```

Shows actual cash balances with breakdown by currency, converted to USD equivalent using Yahoo Finance FX rates.

**Output includes:**
- Balance (USD equivalent)
- Total deposits
- Spent on BUY transactions
- Received from SELL transactions

**Supported currencies:** USD, EUR (EURUSD=X), GBP (GBPUSD=X)

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
**Risk-Adjusted Metrics:** Sharpe, Sortino, Treynor, Information Ratio, Jensen's Alpha for comprehensive performance analysis.
**Benchmark Comparison:** SPY-based metrics (Relative Return, Tracking Error, Beta, Information Ratio).
**Separated Metrics:** Distinguishes between gains from market movement ("Investment %") and changes from deposits/withdrawals ("Cash Flow").
**Auto-Recalculation:** Adding or deleting transactions automatically triggers smart partial or full recalculation.
**Multi-Currency Support:** Handles USD, EUR, GBP using Yahoo Finance FX pairs with automatic USD conversion.
**Real-Time Valuation:** Uses `yfinance` to fetch latest prices for stocks, ETFs, and crypto.
**Output Flexibility:** JSON, ASCII table, and Markdown formats for different use cases.

## Data Storage

- **Database:** `portfolio.db` (DuckDB)
- **Tables:** `transactions`, `prices`, `daily_returns`, `recalc_cache`, `refresh_log`

## Performance Metrics Explained

### Risk-Adjusted Ratios

| Metric | Formula | Measures | Good Value |
|--------|---------|----------|------------|
| **Sharpe Ratio** | (Rp - Rf) / σ | Return per unit of total risk | > 2.0 |
| **Sortino Ratio** | (Rp - Rf) / σd | Return per unit of downside risk | > 3.0 |
| **Treynor Ratio** | (Rp - Rf) / β | Return per unit of systematic risk | > 5.0 |
| **Information Ratio** | (Rp - Rb) / TE | Excess return vs benchmark per unit of tracking error | > 1.0 |
| **Jensen's Alpha** | Rp - (Rf + β(Rm - Rf)) | CAPM-adjusted excess return | > 3% |

**Where:**
- Rp = Portfolio return (CAGR)
- Rf = Risk-free rate (2%)
- Rb = Benchmark return (SPY)
- σ = Total volatility (annualized)
- σd = Downside deviation
- β = Beta vs SPY
- TE = Tracking error

### Benchmark Metrics

| Metric | Description | Good Value |
|--------|-------------|------------|
| **Relative Return** | Portfolio CAGR minus SPY CAGR | > 5% |
| **Tracking Error** | Std dev of excess returns | < 5% |
| **Beta** | Correlation with SPY | ~1.0 (market) |

## Common Workflows

**Analyze portfolio performance:**
```bash
# Add transaction
uv run python -m portfolio_db.cli add --date 01-02-2026 --asset AAPL --action BUY --quantity 10 --price 150

# View performance metrics
uv run python -m portfolio_db.cli performance --table

# Get Markdown for documentation
uv run python -m portfolio_db.cli performance --md > performance.md
```

**Check positions and gains:**
```bash
uv run python -m portfolio_db.cli summary
uv run python -m portfolio_db.cli cash
uv run python -m portfolio_db.cli allocation --type all
```

**Manage transactions:**
```bash
# List all transactions
uv run python -m portfolio_db.cli transactions --format table

# Delete a transaction
uv run python -m portfolio_db.cli delete --id 42

# Verify prices cache
uv run python -m portfolio_db.cli verify-prices
```

**Export data for external analysis:**
```bash
# Export positions
uv run python -m portfolio_db.cli summary --export my_positions.csv

# Export performance as JSON
uv run python -m portfolio_db.cli performance > metrics.json

# Export daily returns
uv run python -m portfolio_db.cli report --format json > daily_history.json
```

## Metric Interpretation

### Return Metrics

- **Total Return:** Overall portfolio gain percentage
- **CAGR:** Compound Annual Growth Rate (time-adjusted return)
- **Avg Daily/Monthly Return:** Average periodic returns

### Risk Metrics

- **Standard Deviation:** Daily return volatility (higher = more volatile)
- **Historical Volatility:** Annualized volatility (σ × √252)
- **Beta:** Sensitivity to SPY movements (1.0 = market, <1 = defensive, >1 = aggressive)

### Risk-Adjusted Performance

- **Sharpe Ratio > 2:** Excellent risk-adjusted returns
- **Sortino Ratio > 3:** Strong downside protection
- **Treynor Ratio > 5:** Good reward per systematic risk
- **Information Ratio > 1:** Consistent outperformance vs benchmark
- **Jensen's Alpha > 3%:** Significant skill-based returns

### Drawdown Analysis

- **Max Drawdown:** Largest peak-to-trough decline (lower = better)
- **Avg Drawdown:** Average decline during drawdown periods
- **Avg Duration:** Typical length of drawdown periods
