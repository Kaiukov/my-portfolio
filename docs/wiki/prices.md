# Prices

## Price Cache

Closing prices cached in `price_cache` table: ticker, date, close, currency, data_source.

## verify_prices (Diagnostic)

Read-only scan of the price cache. Reports missing dates, gaps, schema structure. Never fetches from network.

## repair_prices (Remediation)

Fetches missing prices from Yahoo Finance (yfinance). Supports `--dry-run`.

```bash
uv run portfolio repair_prices --dry-run
uv run portfolio repair_prices
```

## recalculate

Uses cached prices only. Does not fetch from network.

```bash
uv run portfolio recalculate
```

## yfinance Version Check

After every CLI command, a background thread checks latest yfinance from PyPI:

- Cached in `~/.cache/portfolio/yfinance_version_check` for 24h
- Stderr warning if outdated: `Note: yfinance X is out of date (latest: Y). Run: uv add yfinance>=Y`
