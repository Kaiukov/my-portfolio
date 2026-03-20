# Production Ready Plan

## 1. Product Baseline

Goal: lock down supported behavior and make the app contract explicit.

- Define the domain model:
  - transaction actions
  - cash/income/fees/taxes semantics
  - TWR as the primary return metric
  - valuation `as_of_date`
  - price source of truth
- Freeze the JSON contract for all commands:
  - `status`
  - `cash`
  - `summary`
  - `allocation`
  - `performance`
  - `transactions`
  - `report`
  - `verify_prices`
  - `repair_prices`
- Document supported workflows:
  - import/migrate
  - add/edit/delete transaction
  - exchange currency
  - recalculate
  - repair prices

Deliverables:

- `docs/architecture.md`
- `docs/api.md`
- `docs/operations.md`

## 2. Data Integrity

Current priority: highest production risk.

- Build one price pipeline:
  - cached DuckDB prices as primary source
  - external fetch only for refresh/repair
  - no hidden fallback rates
- Add strict validation for:
  - missing required FX/asset prices
  - gaps in coverage for required reporting dates
  - invalid transaction combinations
- Add DB/service helpers for:
  - get/update transaction
  - price coverage by ticker/date range
  - repair status logging
- Add explicit refresh state:
  - last successful price refresh
  - last successful recalc
  - stale data marker

Deliverable:

- deterministic valuation path
- explicit failures instead of silent approximation

## 3. Transaction Engine

Second critical area.

- Normalize all supported actions:
  - `BUY`
  - `SELL`
  - `DEPOSIT`
  - `WITHDRAW`
  - `DIVIDEND`
  - `INTEREST`
  - `FEE`
  - `TAX`
  - `TRANSFER`
  - `EXCHANGE_FROM`
  - `EXCHANGE_TO`
- Add validation rules per action:
  - requires price / forbids price
  - requires cash asset / forbids non-cash
  - sign/quantity expectations
- Finish edit flow:
  - safe edit by id
  - recompute from earliest affected date
  - audit metadata
- Resolve `TRANSFER` semantics:
  - either external contribution
  - or internal account transfer
  - preferred: add `account` dimension and treat transfer as internal

Deliverable:

- transaction spec
- deterministic recalc behavior for every action

## 4. Reporting Consistency

- All read reports must use one snapshot builder
- One `as_of_date` for:
  - `status`
  - `cash`
  - `summary`
  - `allocation`
  - `performance`
- Remove duplicate calculations between CLI and service
- Add `--as-of-date` for read commands
- Add investor metrics later:
  - `MWR/IRR`
  - benchmark comparison
  - contribution by position

Deliverable:

- same portfolio value everywhere for the same date

## 5. CLI and UX

- Make command set symmetric:
  - `add`
  - `edit`
  - `delete`
  - `exchange`
  - `verify_prices`
  - `repair_prices`
  - `recalculate`
- Add `--dry-run` where useful:
  - `edit`
  - `delete`
  - `repair_prices`
  - `recalculate`
- Add stronger error codes:
  - `PRICE_DATA_ERROR`
  - `PRICE_FETCH_ERROR`
  - `NOT_FOUND`
  - `VALIDATION_ERROR`
  - `CONFLICT`
- Add command help examples
- Unify command naming:
  - either snake_case everywhere
  - or kebab-case everywhere

Deliverable:

- stable operator experience

## 6. Testing

Required for production readiness.

- Unit tests:
  - action semantics
  - cash balances
  - snapshot valuation
  - performance math
  - price coverage logic
- Integration tests:
  - add/edit/delete/exchange flows
  - recalculate full/partial
  - verify/repair prices
  - CLI JSON envelopes
- Regression fixtures:
  - empty portfolio
  - multi-currency portfolio
  - dividends/taxes/fees
  - missing FX coverage
  - stale cached prices
- Golden snapshot tests:
  - expected `status/cash/allocation/performance` outputs for fixed DB fixtures

Deliverable:

- CI suite with deterministic fixture DBs

## 7. Packaging and Runtime

- Add proper project metadata:
  - `pyproject.toml`
  - console script entrypoint
- Lock env handling:
  - DB path
  - logs path
  - provider settings
- Add reproducible bootstrap:
  - `uv sync`
  - one command to initialize DB
- Fix import hygiene:
  - local package isolation
  - no accidental imports from sibling repos

Deliverable:

- clean install on a new machine

## 8. Observability and Ops

- Structured logs for:
  - price refresh
  - recalc
  - transaction mutations
  - failures
- Add health/status command:
  - DB reachable
  - price coverage OK
  - recalc freshness
  - stale tickers count
- Add audit trail:
  - who/when changed transaction
  - before/after values
- Add backup strategy:
  - DB snapshot
  - restore procedure

Deliverable:

- operator can detect and recover from failures quickly

## 9. Security and Safety

- Finish read-only vs write-only path separation
- Restrict dangerous operations:
  - explicit confirm for delete
  - optional backup before destructive changes
- Validate user inputs strictly
- No silent fallback pricing
- Optional lock/serialization around writes

Deliverable:

- predictable and safe financial state

## 10. Production Milestones

### Milestone 1: Core Correctness

- finish transaction/action model
- finish cached price pipeline
- finish snapshot consistency
- full regression tests

### Milestone 2: Operator Readiness

- verify/repair prices
- health/status checks
- logs + backup
- stable CLI contract

### Milestone 3: Deployment Readiness

- packaging
- clean install
- cron/automation docs
- import isolation and CI

### Milestone 4: Portfolio Intelligence

- `--as-of-date`
- MWR/IRR
- benchmark reports
- rebalancing/account layer

## Recommended Immediate Next Sprint

- finish `TRANSFER` semantics
- add `--as-of-date` to read commands
- add `health` command
- add golden fixture tests for report consistency
- add `repair_prices --dry-run`
- document operator workflow
