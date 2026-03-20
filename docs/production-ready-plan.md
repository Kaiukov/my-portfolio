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

- [x] `docs/architecture.md` → `.agents/skills/my-portfolio-cli/references/architecture.md`
- [x] `docs/api.md` → `.agents/skills/my-portfolio-cli/references/api-contract.md`
- [x] `docs/operations.md` → `.agents/skills/my-portfolio-cli/references/operations.md`

## 2. Data Integrity ✅ DONE

Current priority: highest production risk.

- [x] Build one price pipeline:
  - [x] cached DuckDB prices as primary source
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

## 3. Transaction Engine ⚠️ PARTIAL

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

- [x] All read reports must use one snapshot builder (`reporting_service.py`)
- [x] One `as_of_date` for:
  - [x] `status`
  - [x] `cash`
  - [x] `summary`
  - [x] `allocation`
  - [x] `performance`
- [x] Remove duplicate calculations between CLI and service
- [x] Add `--as-of-date` for read commands
- [ ] Add investor metrics later:
  - [ ] `MWR/IRR`
  - [ ] benchmark comparison
  - [ ] contribution by position

Deliverable:

- [x] same portfolio value everywhere for the same date

## 5. CLI and UX ⚠️ PARTIAL

- [x] Make command set symmetric:
  - [x] `add`
  - [x] `edit`
  - [x] `delete`
  - [x] `exchange`
  - [x] `verify_prices`
  - [x] `repair_prices`
  - [x] `recalculate`
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
  - [ ] `CONFLICT`
- [ ] Add command help examples
- [x] Unify command naming (snake_case throughout)

Deliverable:

- stable operator experience

## 6. Testing ⚠️ PARTIAL

Required for production readiness.

- [x] Unit tests:
  - [x] action semantics (`test_invalid_buy_without_price_is_rejected`)
  - [x] cash balances (`test_income_actions_affect_snapshot_not_contributions`)
  - [x] snapshot valuation
  - [ ] performance math
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
  - [ ] missing FX coverage
  - [ ] stale cached prices
- [x] Golden snapshot tests:
  - [x] expected `status/cash/allocation/performance` outputs for fixed DB fixtures

Deliverable:

- [ ] CI suite with deterministic fixture DBs

## 7. Packaging and Runtime ⚠️ PARTIAL

- [x] Add proper project metadata:
  - [x] `pyproject.toml`
  - [x] console script entrypoint (`portfolio = "portfolio_db.cli:cli"`)
- [x] Lock env handling:
  - [x] DB path (via `--db` flag)
  - [x] logs path (via `PORTFOLIO_LOG_PATH` env var, `.env.example`)
  - [ ] provider settings
- [x] Add reproducible bootstrap:
  - [ ] `uv sync` documented
  - [x] `init` command — idempotent DB initialization
- [ ] Fix import hygiene:
  - [ ] local package isolation
  - [ ] no accidental imports from sibling repos

Deliverable:

- [ ] clean install on a new machine

## 8. Observability and Ops ⚠️ PARTIAL

- [x] Structured logs (`portfolio_db/logger.py` → `logs/portfolio.log`):
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
  - [ ] before/after values
- [ ] Add backup strategy:
  - [ ] DB snapshot
  - [ ] restore procedure

Deliverable:

- [ ] operator can detect and recover from failures quickly

## 9. Security and Safety ✅ DONE

- [x] Finish read-only vs write-only path separation
- [x] Restrict dangerous operations:
  - [x] explicit confirm for delete (`--confirm` flag)
  - [ ] optional backup before destructive changes
- [x] Validate user inputs strictly
- [x] No silent fallback pricing
- [ ] Optional lock/serialization around writes

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

### Milestone 3: Deployment Readiness ⚠️ IN PROGRESS

- [x] packaging (`pyproject.toml` + console script)
- [x] clean install (`init` command + `.env.example`)
- [ ] cron/automation docs
- [x] CI (`.github/workflows/ci.yml`)

### Milestone 4: Portfolio Intelligence ⚠️ PARTIAL

- [x] `--as-of-date`
- [ ] MWR/IRR
- [ ] benchmark reports
- [ ] rebalancing/account layer

## Recommended Immediate Next Sprint

- [ ] missing FX coverage + stale cached prices regression fixtures
- [ ] cron/automation docs (`docs/operations.md` update)
- [ ] import isolation verification (`uv sync` clean install test)
- [ ] MWR/IRR (Milestone 4)
