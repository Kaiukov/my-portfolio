# Data Integrity

Canonical source:

- `/Users/oleksandrkaiukov/Code/my-portfolio/.agents/skills/my-portfolio-cli/references/data-integrity.md`

This document completes Production Ready Plan Step 2 for the current baseline and records what is already implemented versus what is still missing.

## Goal

- one deterministic valuation path
- explicit failures instead of silent approximation
- one cached price pipeline for reporting

## Deterministic Price Pipeline

Read path:

- reporting loads cached price series from DuckDB through `PortfolioDatabase.get_price_series()`
- reporting uses as-of lookup semantics at or before the valuation timestamp
- required market prices and FX rates are enforced by `PriceDataUnavailableError`
- read/reporting commands surface this as `PRICE_DATA_ERROR`

Refresh and repair path:

- `verify_prices` reports cached coverage against the required ticker/date range
- `repair_prices` fetches missing or incomplete series and persists them into DuckDB
- recalculation loads full price context, calculates returns, then persists prices and daily returns

Non-goal:

- no silent live fetch during reporting
- no hidden fallback FX rates
- no valuation using guessed prices

## Required Coverage Rules

Coverage is evaluated across the required date range implied by transactions and requested dates.

For each required ticker:

- cached series must exist
- a usable price must exist at required start via as-of lookup
- a usable price must exist at required end via as-of lookup

Current issue flags:

- `missing_series`
- `missing_start_coverage`
- `missing_end_coverage`

If a held asset or required FX rate is unavailable at reporting `as_of_date`, reporting must fail explicitly.

## Explicit Failure Policy

Read/reporting commands:

- `status`
- `cash`
- `allocation`
- `performance`
- `summary`

must fail with machine-readable price errors when valuation inputs are incomplete.

Current error contract:

- service raises `PriceDataUnavailableError`
- CLI maps reporting failures to `PRICE_DATA_ERROR`
- CLI maps repair fetch failures to `PRICE_FETCH_ERROR`
- CLI maps malformed input to `VALIDATION_ERROR`

## Known Fixed Bugs

- **FX day-gain was always 0.0** — `day_gain_pct` / `day_gain_value` for FX cash positions (EURUSD=X, GBPUSD=X) were hardcoded to `0.0` in the cash snapshot loop. Fixed by computing daily gain from price series, same logic as stocks. Regression tests in `TestFXDayGain`.
- **Pandas date-slice deprecation** — both stock and FX cash day-gain branches used `price_series.loc[:as_of_date]` (`datetime.date`). Replaced with `price_series.loc[:valuation_ts]` (`pd.Timestamp`) to prevent future silent `except` swallow.

## Implemented Data-Integrity Helpers

Database helpers already present:

- `get_transaction_by_id()`
- `update_transaction()`
- `delete_transaction_by_id()`
- `get_price_series()`
- `log_refresh()`

Service helpers already present:

- `analyze_price_coverage()`
- `verify_prices_storage()`
- `repair_prices()`
- `build_reporting_snapshot()`

These are the current building blocks for deterministic valuation and mutation safety.

## Refresh State

Current implemented state:

- `refresh_log` records recalculation events with:
  - `refresh_date`
  - `refresh_type`
  - `rows_affected`
  - timestamp
- `recalc_cache` stores:
  - cache key
  - last calculated date
  - transaction count
  - prices hash

Current gap:

- there is no explicit first-class state yet for:
  - last successful price refresh
  - last successful recalc as an operator-facing status field
  - stale data marker surfaced in CLI health output

Until that exists, operators must infer freshness from:

- `verify_prices` coverage output
- `refresh_log`
- `daily_returns` max date

## Validation Rules For Step 2

When changing valuation or price flows:

- keep DuckDB cached prices as the reporting source of truth
- preserve explicit failure behavior for missing required prices
- preserve `verify_prices` as diagnostic and `repair_prices` as remediation
- do not introduce hidden runtime fetches into read/reporting commands

When changing transaction mutations:

- use id-based lookup/update/delete helpers
- recalculate from the earliest affected date
- preserve deterministic downstream reporting after mutation

## Status

Step 2 is partially completed in code and completed as a source-of-truth doc.

Implemented now:

- cached coverage analysis
- repair flow
- explicit reporting failures for missing required prices
- transaction lookup and update helpers
- recalculation refresh logging

Still open for full code completion:

- stronger transaction-combination validation rules
- operator-facing freshness status
- price coverage by ticker/date-range helper surfaced as a stable public API
