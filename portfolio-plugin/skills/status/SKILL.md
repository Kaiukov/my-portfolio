---
name: portfolio-status
description: When the user needs to check portfolio value, allocation, cash, performance (TWR/mwr), summary, concentration, or price diagnostics.
---

# Portfolio CLI — Status & Reporting

All read commands emit pure JSON with the envelope `{"ok": true, "command": "...", "data": ..., "meta": ...}`. They never trigger network calls — they use the most recent cached prices.

## Core Commands

```bash
# Current portfolio value and holdings
portfolio status
portfolio status --as-of-date 2026-01-31

# Cash balances by currency with USD conversion
portfolio cash

# Allocation breakdown by asset
portfolio allocation

# High-level summary metrics
portfolio summary

# Concentration metrics (HHI + top holdings)
portfolio concentration
portfolio concentration --top-n 10

# Performance: TWR primary, CAGR, Sharpe, max drawdown, benchmark
portfolio performance
portfolio performance --benchmark QQQ --period ytd
portfolio performance --from-date 2025-01-01

# Money-weighted return (XIRR)
portfolio mwr

# Paginated transaction list
portfolio transactions --limit 20 --offset 40

# Paginated daily returns
portfolio report --limit 20 --offset 0
```

## Maintenance

```bash
# Price coverage diagnostics (read-only)
portfolio verify_prices

# Fetch missing prices from Yahoo Finance
portfolio repair_prices --dry-run
portfolio repair_prices

# Rebuild daily returns from cached prices
portfolio recalculate --dry-run
portfolio recalculate --force

# Daily maintenance: stale check + repair + recalculate
portfolio sync

# One-shot fetch + recalculate (scheduled job)
portfolio refresh
portfolio refresh --dry-run
```

## Scheduling

```bash
portfolio schedule emit       # Print crontab block
portfolio schedule install    # Install managed crontab
portfolio schedule remove     # Remove managed crontab
```

## JSON Envelope

Success:

```json
{"ok": true, "command": "status", "data": {}, "meta": {"generated_at": "..."}}
```

Error:

```json
{"ok": false, "command": "status", "error": {"code": "X", "message": "..."}, "meta": {}}
```
