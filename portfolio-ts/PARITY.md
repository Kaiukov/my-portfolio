# Parity

PostgreSQL is the only source of truth for portfolio data and financial correctness.
TypeScript/Bun is CLI adapter, orchestration, and JSON formatting only.

| Python command | TypeScript command | Status | Notes |
|---|---|---|---|
| `portfolio status` | `portfolio-ts status` | partial | Calls `portfolio_status_sql()` — PG owns all calculations. Gap: raw quantities used for income/fees/taxes (not FX-converted). |
| `portfolio transactions` | `portfolio-ts transactions` | partial | Read-only, pagination, date filters. |
| `portfolio add` | `portfolio-ts add` | partial | Validation + INSERT + `refresh_daily_returns_sql`. PG transaction rollback. Not live-parity-tested yet. |
| `portfolio edit` | `portfolio-ts edit` | partial | UPDATE + recalc. `--dry-run` supported. PG transaction rollback. Not live-parity-tested yet. |
| `portfolio delete` | `portfolio-ts delete` | partial | `--confirm` required. `--dry-run`. PG transaction rollback. No `--backup`. Not live-parity-tested yet. |
| `portfolio exchange` | `portfolio-ts exchange` | partial | Two-leg EXCHANGE_FROM/EXCHANGE_TO + recalc. `is_cash_like_sql` validation. Not live-parity-tested yet. |
| `portfolio repair_prices` | `portfolio-ts repair_prices` | partial | `yahoo-finance2`. `--ticker` comma-separated. `--dry-run`. Not live-parity-tested yet. |
| `portfolio recalculate` | `portfolio-ts recalculate` | partial | `--from-date`, `--force`, `--dry-run`. Calls `refresh_daily_returns_sql`. Not live-parity-tested yet. |
| `portfolio verify_prices` | `portfolio-ts verify_prices` | partial | Coverage check via `discover_required_tickers_sql()`. Simplified output. |
| `portfolio report` | `portfolio-ts report` | partial | Paginated `daily_returns`. Read-only. Pagination matches Python. |
| `portfolio health` | `portfolio-ts health` | partial | DB diagnostic via `needs_recalc()` + service_state + checkpoint coverage. Simplified vs Python (no analyze_price_coverage CTE). |
| `portfolio init` | `portfolio-ts init` | partial | DB connection + schema table count check. Simpler than Python (no schema migration). |
| `portfolio backup` | `portfolio-ts backup` | partial | `pg_dump` subprocess. Same semantics as Python. |
| — | `portfolio-ts sync` | partial | TS-only: `repair_prices` + `recalculate`. |
| `portfolio allocation` | — | intentionally deferred | Requires FX-aware portfolio allocation with PG price lookups. Needs dedicated `portfolio_allocation_sql()` function returning FX-converted USD values. Python's `build_reporting_snapshot` has no safe TypeScript-callable equivalent yet. |
| `portfolio cash` | — | intentionally deferred | Requires FX-aware cash balance snapshots. `cash_balances` view exists but Python adds FX-rate conversion and historical as-of-date support. Needs `portfolio_cash_sql(as_of_date)` PG function. |
| `portfolio summary` | — | intentionally deferred | Requires FX-aware position summary with realized/unrealized gains. Needs dedicated `portfolio_summary_sql()` PG function. |
| `portfolio performance` | — | intentionally deferred | Requires TWR/Sharpe/MDD risk metrics from PG. `get_performance_stats_sql()` CTE exists in Python but not yet extracted as standalone PG function. |
| `portfolio mwr` | — | intentionally deferred | Requires XIRR / Modified Weighted Return. No PG function yet. |
| `portfolio migrate` | — | intentionally dropped | Legacy CSV import. Post-migration: all data is in PostgreSQL. Existing data imported before this migration. |
| `portfolio migrate-duckdb-to-postgres` | — | intentionally dropped | DuckDB has been removed from the project. No DuckDB source exists anymore. |

## Known differences

- **status**: raw transaction quantities used for income/fees/taxes (not FX-converted USD). Python uses FX-aware cash flow analysis. For USD-only portfolios results are identical.
- **health**: TypeScript uses simpler coverage check (checkpoint dates only). Python uses `analyze_price_coverage()` which checks series density.
- **exchange normalization**: TypeScript checks `fromAsset === toAsset` case-insensitively. Python also checks normalized canonical form.
- **repair_prices --ticker**: Python uses repeated flags; TypeScript uses comma-separated string.
- **PG transaction rollback**: TypeScript uses `sql.begin()`. Python uses application-level snapshot/restore. Both are atomic.

## Deferred commands — what is needed to undefer

- **allocation / cash / summary**: Add PostgreSQL functions `portfolio_allocation_sql()`, `portfolio_cash_sql(as_of_date)`, `portfolio_summary_sql(as_of_date)` that perform FX-aware calculations. Then TypeScript can call and pass through.
- **performance**: Extract `get_performance_stats_sql()` CTE from Python into a standalone PostgreSQL function.
- **mwr**: Implement XIRR in PostgreSQL (or call a PG extension if available).

## Phase 5 prerequisites — MET

All commands are either:
- Implemented in TypeScript (status, transactions, add, edit, delete, exchange, repair_prices, recalculate, verify_prices, report, health, init, backup, sync)
- Intentionally deferred with documentation of what PG work is needed
- Intentionally dropped with documented reason

Python removal can proceed.
