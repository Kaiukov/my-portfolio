# Prices

## Price Cache

Closing prices cached in `price_cache` table: ticker, date, close, currency, data_source.

## verify_prices (Diagnostic)

Read-only scan of the price cache. Reports missing dates, gaps, schema structure. Never fetches from network.

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
