# Production Ready Plan

## 1. Product Baseline ✅ DONE

Goal: lock down supported behavior and make the app contract explicit.

- [x] Define the domain model:
  - [x] transaction actions
  - [x] cash/income/fees/taxes semantics
  - [x] TWR as the primary return metric
  - [x] valuation `as_of_date`
  - [x] price source of truth
- [x] Freeze the JSON contract for all commands:
  - [x] `status`
  - [x] `cash`
  - [x] `summary`
  - [x] `allocation`
  - [x] `performance`
  - [x] `transactions`
  - [x] `report`
  - [x] `verify_prices`
  - [x] `repair_prices`
- [x] Document supported workflows:
  - [x] import/migrate
  - [x] add/edit/delete transaction
  - [x] exchange currency
  - [x] recalculate
  - [x] repair prices

Deliverables:

- [x] architecture, API, and operations docs consolidated into the project documentation set

## 2. Data Integrity ✅ DONE

Current priority: highest production risk.

- [x] Build one price pipeline:
  - [x] cached price data as primary source
  - [x] external fetch only for refresh/repair
  - [x] no hidden fallback rates
- [x] Add strict validation for:
  - [x] missing required FX/asset prices
  - [x] gaps in coverage for required reporting dates
  - [x] invalid transaction combinations
- [x] Add DB/service helpers for:
  - [x] get/update transaction
  - [x] price coverage by ticker/date range
  - [x] repair status logging
- [x] Add explicit refresh state:
  - [x] last successful price refresh
  - [x] last successful recalc
  - [x] stale data marker

Deliverable:

- [x] deterministic valuation path
- [x] explicit failures instead of silent approximation

## 3. Transaction Engine ✅ DONE

Second critical area.

- [x] Normalize all supported actions:
  - [x] `BUY`
  - [x] `SELL`
  - [x] `DEPOSIT`
  - [x] `WITHDRAW`
  - [x] `DIVIDEND`
  - [x] `INTEREST`
  - [x] `FEE`
  - [x] `TAX`
  - [x] `TRANSFER`
  - [x] `EXCHANGE_FROM`
  - [x] `EXCHANGE_TO`
- [x] Add validation rules per action:
  - [x] requires price / forbids price
  - [x] requires cash asset / forbids non-cash
  - [x] sign/quantity expectations
- [x] Finish edit flow:
  - [x] safe edit by id
  - [x] recompute from earliest affected date
  - [x] audit metadata
- [x] Resolve `TRANSFER` semantics:
  - [x] treated as internal account movement (not net_contributions)
  - [x] `--account` required for TRANSFER
  - [x] documented in `docs/transaction-spec.md`

Deliverable:

- [x] transaction spec (`docs/transaction-spec.md`)
- [x] deterministic recalc behavior for every action

## 4. Reporting Consistency ✅ DONE

- [x] All read reports must use one snapshot builder (PostgreSQL SQL functions)
- [x] One `as_of_date` for:
  - [x] `status`
  - [x] `cash`
  - [x] `summary`
  - [x] `allocation`
  - [x] `performance`
- [x] Remove duplicate calculations between CLI and service
- [x] Add `--as-of-date` for read commands
- [x] Add investor metrics:
  - [x] `MWR/IRR` (dedicated `mwr` command + embedded in `performance`)
  - [x] benchmark comparison (`--benchmark` flag, configurable ticker)
  - [x] contribution by position

Deliverable:

- [x] same portfolio value everywhere for the same date

## 5. CLI and UX ✅ DONE

- [x] Make command set symmetric:
  - [x] `add`
  - [x] `edit`
  - [x] `delete`
  - [x] `exchange`
  - [x] `verify_prices`
  - [x] `repair_prices`
  - [x] `recalculate`
  - [x] `mwr` (new dedicated command)
- [x] Add `--dry-run` where useful:
  - [x] `edit`
  - [x] `delete`
  - [x] `repair_prices`
  - [x] `recalculate`
- [x] Add stronger error codes:
  - [x] `PRICE_DATA_ERROR`
  - [x] `PRICE_FETCH_ERROR`
  - [x] `NOT_FOUND`
  - [x] `VALIDATION_ERROR`
  - [x] `CONFLICT` (oversell, edit-after-delete, exchange-to-self)
- [x] Add command help examples (epilog on all 15+ commands)
- [x] Unify command naming (snake_case throughout)

Deliverable:

- [x] stable operator experience

## 6. Testing ✅ DONE

Required for production readiness.

- [x] Unit tests:
  - [x] action semantics (`test_invalid_buy_without_price_is_rejected`)
  - [x] cash balances (`test_income_actions_affect_snapshot_not_contributions`)
  - [x] snapshot valuation
  - [x] performance math (`test_performance_math.py` — 23 tests: TWR, CAGR, Sharpe, VaR, drawdown, MWR)
  - [x] price coverage logic (`test_recalculate_fails_explicitly_when_cached_fx_is_missing`)
- [x] Integration tests:
  - [x] add/edit/delete/exchange flows (`test_edit_transaction_updates_row_and_recalculates`)
  - [x] recalculate full/partial
  - [x] verify/repair prices (`test_verify_and_repair_prices_detect_and_fill_missing_fx`)
  - [x] CLI JSON envelopes (`test_response_envelope.py` — 13 tests)
- [x] Regression fixtures (`tests/test_golden_snapshots.py`):
  - [x] empty portfolio
  - [x] multi-currency portfolio
  - [x] dividends/taxes/fees
  - [x] missing FX coverage (`test_missing_fx_coverage_raises_on_recalc`, `test_missing_fx_coverage_health_shows_degraded`)
  - [x] stale cached prices (`test_stale_prices_*` — 3 tests)
- [x] Golden snapshot tests:
  - [x] expected `status/cash/allocation/performance` outputs for fixed DB fixtures

Deliverable:

- [x] CI suite with deterministic fixture DBs (`.github/workflows/ci.yml` + all tests use `tmp_path`)

## 7. Packaging and Runtime ✅ DONE

- [x] Add proper project metadata:
  - [x] `package.json` (TypeScript/Bun)
  - [x] console script entrypoint (`portfolio = src/cli.ts`)
- [x] Lock env handling:
  - [x] DB path (via `PORTFOLIO_DB_URL` env var, PostgreSQL-only)
  - [x] logs path (via `PORTFOLIO_LOG_PATH` env var, `.env.example`)
- [x] Add reproducible bootstrap:
  - [x] `bun install` for dependency setup
  - [x] `init` command — idempotent DB verification
- [x] Fix import hygiene:
  - [x] TypeScript strict mode
  - [x] `bun run typecheck` for static validation

Deliverable:

- [x] clean install on a new machine

## 8. Observability and Ops ✅ DONE

- [x] Structured logs:
  - [x] price refresh
  - [x] recalc start/done/failure
  - [x] transaction mutations (add/edit/delete)
  - [x] price coverage failures
- [x] Add health/status command:
  - [x] DB reachable
  - [x] price coverage OK
  - [x] recalc freshness
  - [x] stale tickers count
- [x] Add audit trail:
  - [x] who/when changed transaction (audit columns in DB)
  - [x] before/after values (`before` key in edit response)
- [x] Add backup strategy:
  - [x] DB snapshot (`backup` command + `--backup` flag on `delete`)
  - [x] restore procedure (documented in `operations.md`)

Deliverable:

- [x] operator can detect and recover from failures quickly

## 9. Security and Safety ✅ DONE

- [x] Finish read-only vs write-only path separation
- [x] Restrict dangerous operations:
  - [x] explicit confirm for delete (`--confirm` flag)
  - [x] optional backup before destructive changes (`delete --backup`)
- [x] Validate user inputs strictly
- [x] No silent fallback pricing
- [ ] Optional lock/serialization around writes (deferred — PostgreSQL handles concurrency)

Deliverable:

- [x] predictable and safe financial state

## 10. Production Milestones

### Milestone 1: Core Correctness ✅ DONE

- [x] finish transaction/action model
- [x] finish cached price pipeline
- [x] finish snapshot consistency
- [x] full regression tests (basic coverage)

### Milestone 2: Operator Readiness ✅ DONE

- [x] verify/repair prices
- [x] health/status checks
- [x] structured logs (`logger.py`)
- [x] backup strategy (`backup` command)
- [x] stable CLI contract

### Milestone 3: Deployment Readiness ✅ DONE

- [x] packaging (`package.json` + `portfolio` bin link)
- [x] clean install (`init` command + `.env.example`)
- [x] cron/automation docs (`docs/crontab-schedule.md`)
- [x] CI (`.github/workflows/ci.yml`)

### Milestone 4: Portfolio Intelligence ✅ DONE

- [x] `--as-of-date`
- [x] MWR/IRR (XIRR via Newton-Raphson, `get_mwr_irr()`)
- [x] benchmark comparison (benchmark_twr_pct, benchmark_cagr_pct, up/down capture, relative return)
- [x] contribution by position (`get_contribution_by_position()`)
- [x] dedicated `mwr` CLI command with `--as-of-date`
- [x] configurable benchmark ticker (`--benchmark QQQ` in `performance` command)
- [ ] rebalancing/account layer (deferred to Milestone 5)

## Milestone 5: Future (deferred)

- [ ] rebalancing / account layer
- [x] `BENCHMARK_TICKERS` configurable via `PORTFOLIO_BENCHMARK_TICKERS` env var

## Known Issues

### SPY not cached — benchmark metrics return 0 ✅ FIXED

`BENCHMARK_TICKERS = ['SPY']` added to `PortfolioService`. `repair_prices` now always
fetches benchmark tickers (even if SPY is not in the portfolio) so `spy_twr_pct`,
`up_capture_ratio`, `down_capture_ratio` will populate after the next `repair_prices` run.

- [x] Add SPY benchmark ticker as default benchmark
- [x] Extend `repair_prices` to always fetch benchmark tickers
- [x] Regression test: `test_repair_prices_caches_spy`
