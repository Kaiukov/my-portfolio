# Prices

## Price Cache

Closing prices cached in `price_cache` table: ticker, date, close, currency, data_source.

## verify_prices (Diagnostic)

Read-only scan of the price cache. Never fetches from network.

Output groups gaps into:
- `coverage_issues`: backward-compatible union of all missing checkpoint dates
- `historical_coverage_issues`: missing checkpoint dates before today
- `current_day_missing`: today-only checkpoint gaps that can still resolve during the trading day

This split lets `health` treat today-only quote lag as `provisional` instead of `degraded`.

## repair_prices (Remediation)

Fetches missing prices from Yahoo Finance. Supports `--dry-run`.

```bash
portfolio repair_prices --dry-run
portfolio repair_prices
```

## recalculate

Uses cached prices only. Does not fetch from network.

```bash
portfolio recalculate
```
