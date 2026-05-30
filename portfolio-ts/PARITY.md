# Parity

| Python command | TypeScript command | Status | Notes |
|---|---|---|---|
| `portfolio status` | `portfolio-ts status` | Python removed | Simple gain formula; Python TWR removed with Python. `as_of_date` from daily_returns. |
| `portfolio transactions` | `portfolio-ts transactions` | Python removed | Read-only, pagination, date filters. |
| `portfolio add` | `portfolio-ts add` | Python removed | Validation + INSERT + recalc. PostgreSQL transaction rollback. |
| `portfolio edit` | `portfolio-ts edit` | Python removed | Validation + UPDATE + recalc. `--dry-run` supported. |
| `portfolio delete` | `portfolio-ts delete` | Python removed | `--confirm` required. `--dry-run` supported. |
| `portfolio exchange` | `portfolio-ts exchange` | Python removed | Two-leg EXCHANGE_FROM/EXCHANGE_TO + recalc. |
| `portfolio report` | — | not started | |
| `portfolio allocation` | — | not started | |
| `portfolio cash` | — | not started | |
| `portfolio summary` | — | not started | |
| `portfolio performance` | — | not started | |
| `portfolio mwr` | — | not started | |
| `portfolio verify_prices` | — | not started | |
| `portfolio repair_prices` | `portfolio-ts repair_prices` | Python removed | yahoo-finance2. `--ticker` comma-separated. Dry-run supported. |
| `portfolio recalculate` | `portfolio-ts recalculate` | Python removed | `--from-date`, `--force`, `--dry-run` supported. |
| `portfolio verify_prices` | `portfolio-ts verify_prices` | Python removed | Coverage check via SQL functions. |
| — | `portfolio-ts sync` | TS-only | Convenience: `repair_prices` + `recalculate`. No Python equivalent. |
| `portfolio backup` | — | not started | |
| `portfolio init` | — | not started | |
| `portfolio health` | — | not started | |
| `portfolio migrate` | — | not started | |
| `portfolio migrate-duckdb-to-postgres` | — | not started | |

## Known differences — write commands

- **Rollback**: TypeScript uses a PostgreSQL transaction (`BEGIN/COMMIT/ROLLBACK` via `sql.begin()`). Python uses application-level snapshot/restore. Both achieve the same atomicity guarantee; TypeScript approach is cleaner.
- **Price pre-check**: Python runs `_require_cached_price_requirements` before calling `refresh_daily_returns_sql` to fail fast on missing prices. TypeScript skips this and lets PostgreSQL raise `'Price unavailable for X as of Y'` from inside the function. Error is surfaced as a DB error.
- **exchange asset normalization**: Python normalises `from`/`to` assets (e.g., `CASH USD` → `USD`) and then checks if they resolve to the same canonical form. TypeScript only checks `fromAsset.toUpperCase() === toAsset.toUpperCase()` (matches Python CLI check but not the deeper service-layer check).
- **add `--backup` delete**: Python's `delete` supports `--backup` to create a DB dump before deleting. TypeScript omits this flag.
- **Date format write commands**: Both use `DD-MM-YYYY`. TypeScript validates the format strictly and converts to `YYYY-MM-DD` for PostgreSQL.

## Known differences — read commands

- **Portfolio value**: TypeScript reads `portfolio_value` from the latest `daily_returns` row. Python computes it via a complex CTE that joins `daily_returns` with `prices` for benchmark/comparison data.
- **Total invested**: TypeScript uses `DEPOSIT - WITHDRAW` from transaction quantities. Python uses `net_contributions` from cash flow analysis (includes FX conversion).
- **Income / Fees / Taxes**: TypeScript reads raw quantities. Python includes trade-level fees and FX conversion.

## Known differences — Phase 3

- **Price provider**: TypeScript uses `yahoo-finance2` npm package; Python uses `yfinance`. Both use Yahoo Finance as the data source. Inverted FX pairs and ticker mapping are ported to TypeScript.
- **`repair_prices --ticker`**: Python CLI accepts `--ticker AAPL --ticker MSFT` (repeated flags); TypeScript CLI accepts `--ticker AAPL,MSFT` (comma-separated). Functional parity.
- **`verify_prices` output**: TypeScript returns simplified coverage data. Python also returns schema info, optimization notes, and repair logs. These can be added in future PRs.
- **`sync` command**: TypeScript-only convenience command (repair_prices + recalculate). No Python equivalent.

## Migration complete

All 5 phases completed:
1. ✅ Read-only CLI (status, transactions)
2. ✅ Write commands (add, edit, delete, exchange)
3. ✅ Maintenance (recalculate, repair_prices, verify_prices, sync)
4. ✅ Cutover (portfolio → TypeScript, portfolio-py fallback)
5. ✅ Python removed (CLI, services, dependencies; SQL schema kept)

**Entrypoint**: `bin/portfolio` → `bun portfolio-ts/src/cli.ts`
**PostgreSQL source of truth**: `portfolio_db/sql/` (schema, functions, procedures, views, triggers)
**TypeScript tests**: `portfolio-ts/tests/` — 60 passing tests
