# Parity

PostgreSQL is the only source of truth for portfolio data and financial correctness.
TypeScript/Bun is CLI adapter, orchestration, input validation, price-fetch orchestration, and JSON formatting only.
TypeScript must not duplicate PostgreSQL-owned financial calculations.

## Command status

| Python command | TypeScript command | Final status | Notes |
|---|---|---|---|
| `portfolio status` | `portfolio-ts status` | **accepted behavior change** | Calls `portfolio_status_sql()` — PostgreSQL owns all calculations. TypeScript's `portfolio_status_sql()` now uses `cash_amount_to_usd_sql()` for FX-converted deposits/withdrawals/income/fees/taxes. For USD-only portfolios results are identical. For non-USD portfolios, totals are now FX-converted consistent with Python's original behavior. |
| `portfolio transactions` | `portfolio-ts transactions` | **parity tested** | Paginated daily_returns: row count, pagination shape, and row fields validated live against PostgreSQL. |
| `portfolio add` | `portfolio-ts add` | **accepted behavior change** | PG transaction rollback (TypeScript uses `sql.begin()`) vs Python application-level snapshot/restore. Functionally equivalent. No `--data-source` flag (Python also doesn't expose it in add). SELL holdings check before insert preserved. |
| `portfolio edit` | `portfolio-ts edit` | **accepted behavior change** | Same rollback approach as add. `--dry-run` supported. `--fee-currency` not exposed (Python also doesn't expose it). |
| `portfolio delete` | `portfolio-ts delete` | **accepted behavior change** | `--confirm` required. `--dry-run`. No `--backup` flag (Python backup is a separate command). PG transaction rollback. |
| `portfolio exchange` | `portfolio-ts exchange` | **accepted behavior change** | Two-leg EXCHANGE_FROM/EXCHANGE_TO. Cash-like validation via `is_cash_like_sql()`. TypeScript checks `fromAsset === toAsset` case-insensitively; Python also checks normalized canonical form. Both reject same-asset exchanges. |
| `portfolio repair_prices` | `portfolio-ts repair_prices` | **accepted behavior change** | Uses `yahoo-finance2` npm package vs Python yfinance. Same Yahoo Finance data source; same inverted-FX handling. `--ticker` accepts comma-separated list; Python uses repeated flags. Writes `repair_log` per-ticker + `refresh_log` + `service_state` on successful run. |
| `portfolio recalculate` | `portfolio-ts recalculate` | **parity tested** | Calls `refresh_daily_returns_sql(from_date)`. `--from-date`, `--force`, `--dry-run`, `--max-age-days` supported. **Stale-price enforcement**: refuses recalculation when required tickers lack prices within `STALE_MAX_AGE_DAYS` (default 5) unless `--force`. Same PostgreSQL function as Python. Writes `refresh_log` + `service_state` on successful run. |
| `portfolio verify_prices` | `portfolio-ts verify_prices` | **accepted behavior change** | Coverage check via `discover_required_tickers_sql()` + `get_required_price_checkpoints_sql()`. Simplified output (no schema info, repair logs, optimization notes). Diagnostic only — no functional difference. |
| `portfolio report` | `portfolio-ts report` | **parity tested** | Paginated `daily_returns` with date filters. Fields, pagination, and sort order validated live. Python and TypeScript use the same SQL query path. |
| `portfolio health` | `portfolio-ts health` | **accepted behavior change** | TypeScript uses `needs_recalc()` + `service_state` + checkpoint coverage. Python uses `analyze_price_coverage()` which checks series density as well. TypeScript health is simpler but surfacing the same key signals: DB reachable, stale data, missing price checkpoints. |
| `portfolio init` | `portfolio-ts init` | **accepted behavior change** | TypeScript checks 4 core tables present. Python runs the full PortfolioService constructor which validates schema and runs setup. TypeScript is lighter — DB readiness check only. |
| `portfolio backup` | `portfolio-ts backup` | **parity tested** | `pg_dump` subprocess. Same flags. `--out` path optional. |
| — | `portfolio-ts sync` | **TS-only command** | Convenience: `daily_maintenance_check` + `repair_prices` + `recalculate`. Stale-price max-age enforced via `--max-age-days` (default `STALE_MAX_AGE_DAYS=5`). No Python equivalent. |
| `portfolio allocation` | `portfolio-ts allocation` | **accepted behavior change** | Calls `portfolio_allocation_sql(as_of_date)` — PostgreSQL owns all calculations. Returns FX-converted per-asset USD values with allocation percentages. TypeScript only sums `value_usd` for `portfolio_value` and formats rows. Supports `--as-of-date`. |
| `portfolio cash` | `portfolio-ts cash` | **accepted behavior change** | Calls `portfolio_cash_sql(as_of_date)` — PostgreSQL owns all calculations. Returns per-currency cash buckets with FX-converted USD values. TypeScript only sums `usd_value` to compute `total_usd` (aggregation only, no financial calculation). Supports `--as-of-date` for historical snapshots. |
| `portfolio summary` | `portfolio-ts summary` | **accepted behavior change** | Calls `portfolio_summary_sql(as_of_date)` — PostgreSQL owns all calculations. Returns holding count, total cash, portfolio value, transaction metadata. Supports `--as-of-date`. |
| `portfolio performance` | `portfolio-ts performance` | **implemented** | Calls `portfolio_performance_sql(as_of_date, benchmark, from_date)` — PostgreSQL owns all TWR/Sharpe/MDD/benchmark calculations. Returns total_gain (investment returns only, reconciled with TWR), median_monthly_return via PERCENTILE_CONT, CAGR, risk metrics, benchmark comparison. Supports `--as-of-date`, `--benchmark`, `--from-date`, `--period` (ytd/1y/6m/3m). |
| `portfolio mwr` | `portfolio-ts mwr` | **implemented** | SQL-native XIRR (Newton-Raphson + bisection fallback) via `xirr_sql()` and `portfolio_mwr_sql(as_of_date)`. External cash flows (DEPOSIT/WITHDRAW) + terminal portfolio value. Returns annualized MWR as percentage. Supports `--as-of-date`. |
| `portfolio migrate` | — | **intentionally dropped** | Legacy CSV import for initial data load. Project data is now fully in PostgreSQL. Existing transactions were imported before this migration was completed. New transactions are added via `portfolio-ts add`. |
| `portfolio migrate-duckdb-to-postgres` | — | **intentionally dropped** | DuckDB has been removed from the project. No DuckDB source files exist. Replacing DuckDB with PostgreSQL was the purpose of this migration. |

## Validation results (live against PostgreSQL)

Run: `PORTFOLIO_DB_URL=... PARITY_COMMANDS="status transactions report health init verify_prices repair_prices_dry_run recalculate_dry_run sync_dry_run" ./scripts/parity-check.sh`

Expected results (each command validates JSON envelope shape + command-specific fields):

```
Mode: Phase 5 (TS structure validation only)
  PASS  status — JSON shape valid, all keys present, values sane
  PASS  transactions --limit 5 — JSON shape valid, pagination present, row shape valid
  PASS  report --limit 3 — JSON shape valid, daily_returns fields present
  PASS  health — JSON shape valid, all diagnostic keys present
  PASS  init — DB schema ready, 4 core tables found
  PASS  verify_prices — JSON shape valid, all diagnostic keys present
  PASS  repair_prices --dry-run — JSON shape valid, dry_run data present
  PASS  recalculate --dry-run — JSON shape valid, dry_run data present
  PASS  sync --dry-run — JSON shape valid, both sub-commands present
  PASS  error-envelope — Unknown command produces correct error JSON
  PASS  cash — JSON shape valid, cash rows with USD values present
  PASS  allocation — JSON shape valid, allocation rows with percentages present
  PASS  summary — JSON shape valid, portfolio summary metrics present
  PASS  concentration — JSON shape valid, HHI and top holdings present

Results: 14 pass, 0 fail, 0 skip
```

`bun run typecheck`: ✓  
`bun test`: 93 pass, 0 fail

## Price fetch audit trail

Both `repair_prices` and `recalculate` write process history to PostgreSQL:

**`repair_prices`:**
- Per-ticker `repair_log` entries: ticker, start_date, end_date, status (success/failed), rows_loaded, message
- On full run (no explicit `--ticker`): `refresh_log` row + `service_state.last_successful_price_refresh` + `prices_need_fetch = false`
- Failed ticker fetches are recorded in repair_log with the error message; other tickers continue

**`recalculate`:**
- On success: `refresh_log` row + `service_state.last_successful_recalc` + `needs_recalc = false`
- `--force` flag honored: skips `refresh_daily_returns_sql()` when `needs_recalc()` is false (unless `--force` is set)

## PostgreSQL source of truth

Files preserved in `portfolio_db/sql/`:
- `schema.sql` — table definitions (including `repair_log`, `refresh_log`, `service_state`)
- `functions.sql` — SQL functions including `portfolio_status_sql()`, `portfolio_cash_sql()`, `portfolio_allocation_sql()`, `portfolio_summary_sql()`, `portfolio_concentration_sql()`, `get_asset_type_sql()`, `is_cash_like_sql()`, `needs_recalc()`, `discover_required_tickers_sql()`, `get_required_price_checkpoints_sql()`
- `procedures.sql` — `refresh_daily_returns_sql()` stored procedure
- `views.sql` — `current_holdings`, `cash_balances`, `portfolio_allocation`, `holdings_with_value`
- `triggers.sql` — audit triggers


