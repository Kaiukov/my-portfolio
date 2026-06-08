---
name: portfolio-analyse
description: When the user needs to analyse a ticker with risk metrics, run portfolio-level analytics (cash drag, projection, rebalance, decomposition, currency exposure, diversification, income, realized gains, withdrawal, asset metadata), or get deeper analytics beyond status/performance.
---

# Portfolio CLI — Analysis & Analytics

Two categories: **ticker analysis** (fetches from Yahoo Finance) and **portfolio analytics** (uses cached prices, no network).

## Ticker Analysis

Analyze any Yahoo Finance ticker with risk metrics and technical indicators:

```bash
portfolio asset_analysis --ticker AAPL
portfolio asset_analysis --ticker SPY --benchmark QQQ
portfolio asset_analysis --ticker BTC-USD --period 1y
portfolio asset_analysis --asset AAPL --lookback-days 504
portfolio asset_analysis --ticker VTI --as-of-date 2026-05-01 --risk-free-rate 0.05
```

Alias: `asset-analysis`. Flags:
- `--ticker` / `--asset` (required) — Yahoo Finance symbol
- `--period` — analysis period (e.g. `1mo`, `3mo`, `6mo`, `1y`, `2y`, `5y`, `max`)
- `--lookback-days` / `--lookback_days` — override period with N trading days
- `--benchmark` — benchmark for beta/alpha/IR (default `SPY`)
- `--as-of-date` / `--as_of_date` — YYYY-MM-DD reference date
- `--risk-free-rate` / `--risk_free_rate` — risk-free rate for Sharpe (default 0.05)

## Portfolio-Level Analytics

All read commands emit the standard JSON envelope and use cached prices (no network fetch).

### Cash Drag
```bash
portfolio cash_drag
portfolio cash_drag --as-of-date 2026-01-31 --from-date 2025-01-01 --benchmark-return-rate 0.10 --cash-return-rate 0.03
```

### Projection
```bash
portfolio projection --monthly-contribution 1000 --annual-return-rate 0.08
portfolio projection --target-value 1000000 --projection-years 20 --inflation-rate 0.03
```

### Rebalance
```bash
portfolio rebalance --target "VTI=50,VXUS=20,BND=30"
portfolio rebalance --target "VTI=50,VXUS=20,BND=30" --as-of-date 2026-01-31
```

### Decomposition
```bash
portfolio decomposition
portfolio decomposition --as-of-date 2026-01-31
```

### Currency Exposure
```bash
portfolio currency_exposure
```

### Diversification
```bash
portfolio diversification
portfolio diversification --as-of-date 2026-01-31 --lookback-days 252
```

Flags: `--lookback-days` / `--lookback_days` (default 252), `--min-correlation` / `--min_correlation`.

### Income
```bash
portfolio income
portfolio income --as-of-date 2026-01-31 --from-date 2025-01-01 --asset AAPL
```

### Realized Gains
```bash
portfolio realized-gains
portfolio realized-gains --from-date 2025-01-01 --to-date 2025-12-31
portfolio realized-gains --by-year
portfolio realized-gains --asset AAPL
```

### Withdrawal
```bash
portfolio withdrawal
portfolio withdrawal --annual-withdrawal 40000 --time-horizon-years 30 --expected-return 0.07 --inflation-rate 0.03
```

### Asset Metadata
```bash
portfolio asset-metadata
portfolio asset-metadata --asset AAPL
portfolio asset-metadata --refresh
```

## Core Read Commands

For `status`, `cash`, `allocation`, `summary`, `concentration`, `performance`, `mwr`, `transactions`, and `report`, see the [portfolio-status](../status/SKILL.md) skill.
