# Prices

## Price Cache

Closing prices are stored in the `prices` table: `ticker`, `date`, `price`
(primary key `(date, ticker)`). Prices are the input for every valuation and for
`daily_returns`.

## New instrument bootstrap

`discover_required_tickers_sql()` derives its ticker list from `transactions`,
while the daily-returns guard requires a price for every held asset. A brand-new
instrument therefore has a chicken-and-egg problem: no trade → no price, no price
→ the trade is rejected.

`add_transaction` handles this automatically: if the asset has no price as of the
trade date, the bot fetches that single ticker from Yahoo Finance (10-day lookback
through today), upserts it into `prices`, and re-checks before inserting. If the
provider has no data (delisted symbol, typo), the command fails with
`PRICE_UNAVAILABLE` and an explicit hint instead of a Postgres `INTERNAL_ERROR`.

Manual equivalent, still useful for bulk pre-loading or when a provider outage
must be worked around:

```bash
portfolio repair_prices --ticker ANT --start-date 2026-11-01
portfolio verify_prices
```

Broker venue suffixes are stripped on input: Freedom24 reports `ANT.US`, while
Yahoo Finance knows only `ANT`. `normalizeSymbol()` removes a terminal `.US` and
leaves real dotted symbols such as `BRK.B` unchanged; it is applied both when the
transaction is stored and when a Yahoo request is built.

## verify_prices (Diagnostic)

Read-only scan of the price cache. Reports missing dates, gaps, schema structure. Never fetches from network.

## repair_prices (Remediation)

Fetches missing prices from Yahoo Finance. Supports `--dry-run` and an explicit
`--ticker` list, which bypasses ticker discovery.

```bash
portfolio repair_prices --dry-run
portfolio repair_prices
portfolio repair_prices --ticker ANT,MSFT
```

## recalculate

Uses cached prices only. Does not fetch from network.

```bash
portfolio recalculate
```
