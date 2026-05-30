# Parity

PostgreSQL is the only source of truth for portfolio data and financial correctness.
TypeScript/Bun is CLI adapter, orchestration, and JSON formatting only.

| Python command | TypeScript command | Status | Notes |
|---|---|---|---|
| `portfolio status` | `portfolio-ts status` | partial | Calls `portfolio_status_sql()` — PG owns all calculations. Known gap: deposits/withdrawals/income/fees/taxes use raw quantities (not FX-converted). Python uses FX-aware cash flow analysis. |
| `portfolio transactions` | `portfolio-ts transactions` | partial | Read-only, pagination, date filters. Write ops via dedicated commands. |
| `portfolio add` | `portfolio-ts add` | partial | Validation + INSERT + `refresh_daily_returns_sql`. Rollback via PG transaction. Not parity-tested against real DB yet. |
| `portfolio edit` | `portfolio-ts edit` | partial | UPDATE + recalc. `--dry-run` supported. PG transaction rollback. Not parity-tested. |
| `portfolio delete` | `portfolio-ts delete` | partial | `--confirm` required. `--dry-run`. PG transaction rollback. No `--backup`. Not parity-tested. |
| `portfolio exchange` | `portfolio-ts exchange` | partial | Two-leg EXCHANGE_FROM/EXCHANGE_TO + recalc. Cash-like validated via `is_cash_like_sql()`. Not parity-tested. |
| `portfolio repair_prices` | `portfolio-ts repair_prices` | partial | `yahoo-finance2` (same Yahoo Finance source as Python yfinance). `--ticker` comma-separated. `--dry-run`. Not parity-tested. |
| `portfolio recalculate` | `portfolio-ts recalculate` | partial | `--from-date`, `--force`, `--dry-run`. Calls `refresh_daily_returns_sql`. Not parity-tested. |
| `portfolio verify_prices` | `portfolio-ts verify_prices` | partial | Coverage check via `discover_required_tickers_sql()` + `get_required_price_checkpoints_sql()`. Simplified output. |
| — | `portfolio-ts sync` | partial | TS-only: `repair_prices` + `recalculate`. No Python equivalent. |
| `portfolio report` | — | not started | |
| `portfolio allocation` | — | not started | |
| `portfolio cash` | — | not started | |
| `portfolio summary` | — | not started | |
| `portfolio performance` | — | not started | |
| `portfolio mwr` | — | not started | |
| `portfolio backup` | — | not started | |
| `portfolio init` | — | not started | |
| `portfolio health` | — | not started | |
| `portfolio migrate` | — | not started | |
| `portfolio migrate-duckdb-to-postgres` | — | not started | |

## Python removal prerequisites (NOT met yet)

Python must NOT be removed until ALL of the following are satisfied:

- [ ] All kept commands are implemented in TypeScript
- [ ] All kept commands have parity tests comparing real JSON against Python output
- [ ] Unported commands (report, allocation, cash, summary, performance, mwr, backup, init, health, migrate) are either ported or explicitly documented as intentionally dropped
- [ ] `portfolio_status_sql()` FX-conversion gap is resolved or documented as acceptable
- [ ] `scripts/parity-check.sh` passes for all migrated commands

## Known differences

- **status — financial metrics**: TypeScript calls `portfolio_status_sql()` which uses raw transaction quantities. Python uses FX-aware cash flow analysis (`get_reporting_totals_sql` via reporting snapshot). For USD-only portfolios results are identical. For mixed-currency portfolios there may be small differences.
- **exchange normalization**: TypeScript only checks `fromAsset === toAsset` case-insensitively. Python also checks normalized canonical form.
- **repair_prices --ticker**: Python uses repeated flags; TypeScript uses comma-separated string.
- **verify_prices output**: TypeScript returns simplified coverage data (no schema info, repair logs, or optimization notes).
- **sync**: TypeScript-only convenience command. No Python equivalent.
- **PostgreSQL transaction rollback**: TypeScript uses `sql.begin()` (native PG transactions). Python uses application-level snapshot/restore. Both are atomic; TypeScript approach is cleaner.
