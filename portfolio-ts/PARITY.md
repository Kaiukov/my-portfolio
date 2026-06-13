# Parity

PostgreSQL is the only source of truth for portfolio data and financial correctness.
TypeScript/Bun is CLI adapter, orchestration, input validation, price-fetch orchestration, and JSON formatting only.
TypeScript must not duplicate PostgreSQL-owned financial calculations.

## Command status

| Python command | TypeScript command | Final status | Notes |
|---|---|---|---|
| `portfolio status` | `portfolio-ts status` | **accepted behavior change** | Calls `portfolio_status_sql()` — PostgreSQL owns all calculations. TypeScript's `portfolio_status_sql()` now uses `cash_amount_to_usd_sql()` for FX-converted deposits/withdrawals/income/fees/taxes. For USD-only portfolios results are identical. For non-USD portfolios, totals are now FX-converted consistent with Python's original behavior. |
| `portfolio transactions` | `portfolio-ts transactions` | **parity tested** | Paginated daily_returns: row count, pagination shape, and row fields validated live against PostgreSQL. |
| `portfolio add` | `portfolio-ts add` | **accepted behavior change** | PG transaction rollback via `runTx` → Bun's `sql.begin()` (connection-pinned, true transaction) vs Python application-level snapshot/restore. Functionally equivalent. No `--data-source` flag (Python also doesn't expose it in add). SELL holdings check before insert preserved. |
| `portfolio edit` | `portfolio-ts edit` | **accepted behavior change** | Same pinned-connection rollback approach as add. `--dry-run` supported. `--fee-currency` not exposed (Python also doesn't expose it). |
| `portfolio delete` | `portfolio-ts delete` | **accepted behavior change** | `--confirm` required. `--dry-run`. No `--backup` flag (Python backup is a separate command). PG transaction rollback via pinned connection. |
| `portfolio exchange` | `portfolio-ts exchange` | **accepted behavior change** | Two-leg EXCHANGE_FROM/EXCHANGE_TO. Cash-like validation via `is_cash_like_sql()`. TypeScript checks `fromAsset === toAsset` case-insensitively; Python also checks normalized canonical form. Both reject same-asset exchanges. |
| — | `portfolio-ts split` | **TS-only command** | Corporate action: stock split (forward/reverse). Inserts a single SPLIT transaction row with `quantity` = ratio. FIFO multiplies lot quantities and divides unit cost; cost basis invariant, no realized gain, no cash movement. `--confirm` required. |
| `portfolio repair_prices` | `portfolio-ts repair_prices` | **accepted behavior change** | Uses `yahoo-finance2` npm package vs Python yfinance. Same Yahoo Finance data source; same inverted-FX handling. `--ticker` accepts comma-separated list; Python uses repeated flags. Writes `repair_log` per-ticker + `refresh_log` + `service_state` on successful run. |
| `portfolio recalculate` | `portfolio-ts recalculate` | **parity tested** | Calls `refresh_daily_returns_sql(from_date)`. `--from-date`, `--force`, `--dry-run`, `--max-age-days` supported. **Stale-price enforcement**: refuses recalculation when required tickers lack prices within `STALE_MAX_AGE_DAYS` (default 5) unless `--force`. Same PostgreSQL function as Python. Writes `refresh_log` + `service_state` on successful run. |
| `portfolio verify_prices` | `portfolio-ts verify_prices` | **accepted behavior change** | Coverage check via `discover_required_tickers_sql()` + `get_required_price_checkpoints_sql()`. Simplified output (no schema info, repair logs, optimization notes). Diagnostic only — no functional difference. |
| `portfolio report` | `portfolio-ts report` | **parity tested** | Paginated `daily_returns` with date filters. Fields, pagination, and sort order validated live. Python and TypeScript use the same SQL query path. |
| `portfolio health` | `portfolio-ts health` | **accepted behavior change** | TypeScript uses `needs_recalc()` + `service_state` + checkpoint coverage. Python uses `analyze_price_coverage()` which checks series density as well. TypeScript health is simpler but surfacing the same key signals: DB reachable, stale data, missing price checkpoints. |
| `portfolio init` | `portfolio-ts init` | **accepted behavior change** | TypeScript checks 4 core tables present. Python runs the full PortfolioService constructor which validates schema and runs setup. TypeScript is lighter — DB readiness check only. |
| — | `portfolio-ts income` | **TS-only command** | Read-only dividend/interest report. Calls `portfolio_income_sql()`. No Python equivalent. `--as-of-date`, `--from-date`, `--asset` filters. Returns per-asset/usd_value rows + totals. |
| — | `portfolio-ts realized-gains` | **TS-only command** | Read-only FIFO realized gains detail. Calls `portfolio_realized_gains_sql()` and `portfolio_realized_gains_by_year_sql()`. No Python equivalent. `--from-date`, `--to-date`, `--asset`, `--by-year` filters. Returns per-lot matched-gain rows + tax-year aggregation. Consistency invariant: SUM(detail.realized_gain) == status.realized_gain. |
| `portfolio backup` | `portfolio-ts backup` | **parity tested** | `pg_dump` subprocess. Same flags. `--out` path optional. |
| — | `portfolio-ts sync` | **TS-only command** | Convenience: `daily_maintenance_check` + `repair_prices` + `recalculate`. Stale-price max-age enforced via `--max-age-days` (default `STALE_MAX_AGE_DAYS=5`). No Python equivalent. |
| `portfolio allocation` | `portfolio-ts allocation` | **accepted behavior change** | Calls `portfolio_allocation_sql(as_of_date)` — PostgreSQL owns all calculations. Returns FX-converted per-asset USD values with allocation percentages. TypeScript only sums `value_usd` for `portfolio_value` and formats rows. Supports `--as-of-date`. |
| `portfolio cash` | `portfolio-ts cash` | **accepted behavior change** | Calls `portfolio_cash_sql(as_of_date)` — PostgreSQL owns all calculations. Returns per-currency cash buckets (including stablecoins: USDT, USDC, DAI, etc.) with FX-converted (or 1:1 for stablecoins) USD values. TypeScript only sums `usd_value` to compute `total_usd` (aggregation only, no financial calculation). Supports `--as-of-date` for historical snapshots. |
| `portfolio summary` | `portfolio-ts summary` | **accepted behavior change** | Calls `portfolio_summary_sql(as_of_date)` — PostgreSQL owns all calculations. Returns holding count, total cash, portfolio value, transaction metadata. Supports `--as-of-date`. |
| `portfolio concentration` | `portfolio-ts concentration` | **parity tested** | Calls `portfolio_concentration_sql` — HHI (0-10000), holding count, top-N holdings by allocation. Supports `--as-of-date` and `--top-n`. |
| — | `portfolio-ts diversification` | **TS-only command** | Correlation-aware diversification depth. Calls `portfolio_diversification_depth_sql()` — HHI, effective holdings, pairwise Pearson correlations from price series, correlation-weighted HHI. Supports `--as-of-date`, `--lookback-days`, `--min-correlation`. |
| `portfolio performance` | `portfolio-ts performance` | **implemented** | Calls `portfolio_performance_sql(as_of_date, benchmark, from_date)` — PostgreSQL owns all TWR/Sharpe/MDD/benchmark calculations. Returns total_gain (investment returns only, reconciled with TWR), median_monthly_return via PERCENTILE_CONT, CAGR, risk metrics, benchmark comparison. Also includes `period_returns` (1M/3M/6M/YTD/1Y/SII via `portfolio_period_returns_sql`) and `rolling_12m_returns` (via `portfolio_rolling_returns_sql`). All period/rolling returns are TWR (geometric-linked investment_return). Supports `--as-of-date`, `--benchmark`, `--from-date`, `--period` (ytd/1y/6m/3m). |
| `portfolio mwr` | `portfolio-ts mwr` | **implemented** | SQL-native XIRR (Newton-Raphson + bisection fallback) via `xirr_sql()` and `portfolio_mwr_sql(as_of_date)`. External cash flows (DEPOSIT/WITHDRAW) + terminal portfolio value. Returns annualized MWR as percentage. Supports `--as-of-date`. |
| `portfolio currency_exposure` | `portfolio-ts currency_exposure` | **accepted behavior change** | Calls `portfolio_currency_exposure_sql(as_of_date)` — PostgreSQL owns all calculations. Groups holdings and cash by currency with usd_value, pct, holdings_usd, cash_usd sub-columns. Same `--as-of-date` support and freshness meta as other read-only commands. |
| — | `portfolio-ts cash_drag` | **TS-only command** | Read-only opportunity cost of idle cash vs being invested. Calls `portfolio_cash_drag_sql(as_of_date, from_date, benchmark_return_rate, cash_return_rate)` which reuses `portfolio_cash_sql` + `portfolio_performance_sql`. Returns total cash, portfolio value, CAGR, and drag $/% vs portfolio and benchmark rates. Supports `--as-of-date`, `--from-date`, `--benchmark-return-rate`, `--cash-return-rate`. |
| — | `portfolio-ts projection` | **TS-only command** | Read-only long-term future value projection and goal tracking (FIRE). Calls `portfolio_projection_sql(as_of_date, monthly_contribution, annual_return_rate, target_value, projection_years, inflation_rate)` — PostgreSQL owns all calculations. Supports projection mode (no target: compute FV, real value, return portion) and goal mode (with target: solve years_to_goal, compute required_return_rate via bisection). Supports `--as-of-date`, `--monthly-contribution`, `--annual-return-rate`, `--target-value`, `--projection-years`, `--inflation-rate`. |
| — | `portfolio-ts rebalance` | **TS-only command** | Read-only target-vs-actual drift report. Takes `--target "VTI=50,VXUS=20,BND=30"` and optional `--as-of-date`. Reuses `portfolio_allocation_sql` via `getAllocation()` — no new SQL, no persistence. Drift/trade math is a pure TypeScript function (`computeDrift`). Emits `command:"rebalance"` envelope with summary + rows sorted by `abs(drift_pct)` desc. |
| — | `portfolio-ts decomposition` | **TS-only command** | Read-only growth decomposition: splits total growth into contributions (net deposits) vs market returns. Calls `portfolio_decomposition_sql(as_of_date)` which reuses `portfolio_status_sql()` + `daily_returns` initial value. Emits `command:"decomposition"` envelope. Supports `--as-of-date`. |
| — | `portfolio-ts withdrawal` | **TS-only command** | Read-only safe withdrawal rate / decumulation analysis (#230). Calls `portfolio_withdrawal_sql(as_of_date, annual_withdrawal, withdrawal_rate, time_horizon_years, expected_return, inflation_rate)` — PostgreSQL owns all calculations. Annual simulation with inflation-adjusted end-of-year withdrawals, bisection for max safe withdrawal, deterministic v1 success_likelihood proxy (NOT Monte-Carlo). Supports `--as-of-date`, `--annual-withdrawal`, `--withdrawal-rate`, `--time-horizon-years`, `--expected-return`, `--inflation-rate`. |
| `portfolio migrate` | — | **intentionally dropped** | Legacy CSV import for initial data load. Project data is now fully in PostgreSQL. Existing transactions were imported before this migration was completed. New transactions are added via `portfolio-ts add`. |
| — | `portfolio-ts dashboard publish` | **TS-only command** | Maintenance/file-level command. Assembles a richer `DashboardSnapshot` from existing service-layer getters (summary, status, widget, allocation, cash, performance, freshness) and publishes to Cloudflare KV under key `"dashboard"` in the same `PORTFOLIO_KV` namespace. CLI-only (no REST/MCP surface, matching `cloudflare publish`). |
| — | `portfolio-ts asset_analysis` | **TS-only command** | Read-only asset analytics tool ported from `scripts/yf-analyse-asset.py`, with math and contract fixes applied during the TypeScript port. Fetches Yahoo Finance data and computes risk metrics (beta, Sharpe, Sortino, CAGR, max drawdown, capture ratios, tracking error) and technical indicators (RSI, MACD, MA50/200, stochastic, Williams %R, Stochastic RSI) for arbitrary Yahoo tickers independent of portfolio DB holdings. Supports `--ticker` or `--asset`, `--period` or `--lookback-days`, `--benchmark`, `--as-of-date`, and `--risk-free-rate`. Benchmark-relative metrics use date-key alignment, StochRSI is emitted on a 0..100 scale, MACD signal uses the correctly aligned latest bar, and partial provider failures are returned as structured `warnings[]` / `errors[]` in `data`. Also exposed via `GET /asset_analysis` and MCP `asset_analysis`. |

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
  PASS concentration — JSON shape valid, HHI and top holdings present
  PASS diversification — JSON shape valid, HHI, correlations, and CWHHI present
  PASS  currency_exposure — JSON shape valid, per-currency exposure rows present

Results: 16 pass, 0 fail, 0 skip
```

`bun run typecheck`: ✓  
`bun test`: 519 pass, 0 fail

## MCP adapter parity

The MCP adapter (`portfolio-ts/src/mcp/`) now exposes both read and write tools,
plus a stdio server entrypoint for tunnel-client, matching the JSON envelope
contract of the CLI and HTTP API exactly.

| MCP read tool | CLI equivalent | API route | Freshness meta | Parity |
|---|---|---|---|---|
| `status` | `status` | `GET /status` | Yes | Identical envelope to CLI and API |
| `summary` | `summary` | `GET /summary` | Yes | Identical envelope to CLI and API |
| `cash` | `cash` | `GET /cash` | Yes | Identical envelope to CLI and API |
| `cash_drag` | `cash_drag` | `GET /cash_drag` | Yes | Identical envelope to CLI and API |
| `allocation` | `allocation` | `GET /allocation` | Yes | Identical envelope to CLI and API |
| `concentration` | `concentration` | `GET /concentration` | Yes | Identical envelope to CLI and API |
| `diversification` | `diversification` | `GET /diversification` | Yes | Identical envelope to CLI and API |
| `performance` | `performance` | `GET /performance` | Yes | Identical envelope to CLI and API |
| `mwr` | `mwr` | `GET /mwr` | Yes | Identical envelope to CLI and API |
| `transactions` | `transactions` | — | — | Identical envelope to CLI (pagination) |
| `report` | `report` | — | — | Identical envelope to CLI (pagination) |
| `health` | `health` | `GET /health` | — | Identical envelope to CLI and API |
| `verify_prices` | `verify_prices` | `GET /verify_prices` | — | Identical envelope to CLI and API |
| `widget` | `widget` | — | — | Identical envelope to CLI |
| `currency_exposure` | `currency_exposure` | `GET /currency_exposure` | Yes | Identical envelope to CLI and API |
| `income` | `income` | `GET /income` | — | Identical envelope to CLI and API |
| `realized_gains` | `realized-gains` | `GET /realized_gains` | — | Identical envelope to CLI and API |
| `asset_metadata` | `asset-metadata` | `GET /asset_metadata` | — | Read cache by default; `--refresh`/`?refresh=true` triggers Yahoo fetch |
| `projection` | `projection` | `GET /projection` | — | Calls `portfolio_projection_sql`; projection or goal mode |
| `rebalance` | `rebalance` | `GET /rebalance` | — | Identical envelope to CLI and API; requires `target` param |
| `decomposition` | `decomposition` | `GET /decomposition` | Yes | Identical envelope to CLI and API |
| `withdrawal` | `withdrawal` | `GET /withdrawal` | — | Identical envelope to CLI and API |
| `asset_analysis` | `asset_analysis` | `GET /asset_analysis` | — | Fetches Yahoo Finance data for arbitrary tickers; supports ticker/asset, period or lookback, benchmark, as_of, and risk_free_rate; returns risk metrics + technicals with structured partial issues |

All MCP read tools reuse the existing service-layer functions from `src/commands/*.ts`.
No business logic is duplicated in the MCP adapter. Error handling maps through the
same `toWriteErrorEnvelope` mapper used by the HTTP API adapter.



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
- `functions.sql` — SQL functions including `portfolio_status_sql()`, `portfolio_cash_sql()`, `portfolio_cash_drag_sql()`, `portfolio_projection_sql()`, `portfolio_allocation_sql()`, `portfolio_summary_sql()`, `portfolio_concentration_sql()`, `portfolio_diversification_depth_sql()`, `get_asset_type_sql()`, `is_cash_like_sql()`, `is_stablecoin_sql()`, `needs_recalc()`, `discover_required_tickers_sql()`, `get_required_price_checkpoints_sql()`, `portfolio_asset_metadata_sql()`
- `procedures.sql` — `refresh_daily_returns_sql()` stored procedure
- `views.sql` — `current_holdings`, `cash_balances`, `portfolio_allocation`, `holdings_with_value`
- `triggers.sql` — audit triggers

