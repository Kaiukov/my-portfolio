# Project specific instructions

## Overview

TypeScript/Bun CLI (`portfolio`) for portfolio tracking with PostgreSQL. Source lives in `portfolio-ts/src/`; `portfolio_db/sql/` is SQL-only and remains the financial source of truth.

- runtime: Bun + TypeScript
- package manager: Bun
- install: `bun install`
- test: `bun test`
- typecheck: `bun run typecheck`
- binary: `portfolio`

## Database Setup

### Local PostgreSQL (development)

```bash
# macOS (install via Homebrew)
brew install postgresql@16
brew services start postgresql@16

# Create portfolio database
createdb portfolio
createuser portfolio_user -P  # set password

# Connect and initialize schema
psql -d portfolio -U portfolio_user
# Then in psql:
# \i portfolio_db/sql/schema.sql
# \i portfolio_db/sql/functions.sql
# \i portfolio_db/sql/procedures.sql
# \i portfolio_db/sql/views.sql
# \i portfolio_db/sql/triggers.sql

# Set environment variable
export PORTFOLIO_DB_URL="postgresql://portfolio_user:password@localhost:5432/portfolio"
```

### Supabase PostgreSQL (cloud-hosted)

1. Create project at https://supabase.com
2. Copy PostgreSQL connection string (User > Database)
3. Run schema initialization scripts (same as above)
4. Set environment variable:
   ```bash
   export PORTFOLIO_DB_URL="postgresql://postgres:password@db.xxx.supabase.co:5432/postgres"
   ```

## Key commands

```bash
bun install
bun run typecheck
bun test
bun run start
portfolio --help
```

## Architecture layers

Three layers. Each owns its domain. No layer reaches into a layer below it that is not its direct dependency.

### PostgreSQL persistence (`portfolio-ts/src/db.ts`)
Owns: SQL, Bun SQL driver, connection lifecycle, `PORTFOLIO_DB_URL` resolution, repository/query helpers, and schema/bootstrap access. The schema and SQL functions in `portfolio_db/sql/` are the financial source of truth.
Rule: No caller outside `src/db.ts` may use the raw SQL handle directly.

### Shared service / use-case layer
Files: `portfolio-ts/src/commands/*`, `portfolio-ts/src/validators.ts`, `portfolio-ts/src/asset_kind.ts`, `portfolio-ts/src/tx.ts`, `portfolio-ts/src/tx_core.ts`, `portfolio-ts/src/sql_apply.ts`
Owns: business logic, financial invariants, transaction rules (SELL-as-of-date, exchange validation), recalculation orchestration, reporting, allocation, cash logic, performance metrics, price-cache behavior, asset/currency normalization.
Rule: No financial invariant lives in adapters. This layer is reused by both CLI and REST API without duplication.

### Adapter layer (`portfolio-ts/src/cli.ts`, `portfolio-ts/src/api/server.ts`, `portfolio-ts/src/mcp/`)
Owns: CLI argument parsing, HTTP routing, MCP tool dispatch, light user-facing validation (format checks, required flags), calling the shared use-case layer, serializing pure JSON responses via `src/response.ts`.
Rules:
- No SQL or Bun SQL imports.
- No business/financial logic.
- No duplication of service logic.
- CLI, REST API, and MCP are peer adapters and must stay behavior-aligned. See `portfolio-ts/PARITY.md` and `src/api/server.ts`.

## CLI JSON contract

All commands emit pure JSON with this envelope:
```json
{"ok": true, "command": "...", "data": ..., "meta": {"generated_at": "...", "count": N, ...}}
```
Errors: `{"ok": false, "command": "...", "error": {"code": "X", "message": "..."}, "meta": {...}}`

## Date format

- **All commands**: `YYYY-MM-DD` (ISO 8601, primary format)
- **Legacy `DD-MM-YYYY`** is still accepted on write commands (`--date`, `--from-date`) but deprecated - a stderr warning is emitted via `console.warn`.

## Command classification

- **Read-only** (never trigger network calls): `report`, `transactions`, `status`, `allocation`, `cash`, `summary`, `concentration`, `performance`, `mwr`, `verify_prices`, `health`, `widget`
- **Mutating** (auto-recalculate after write): `add`, `edit`, `delete`, `exchange`
- **Maintenance / file-level**: `repair_prices`, `recalculate`, `sync`, `refresh`, `backup`, `init`, `cron`, `schedule`

## Common traps

- `add` requires `--exchange` (non-optional)
- `delete` requires `--confirm` (unless `--dry-run`)
- `edit`, `repair_prices`, `recalculate` support `--dry-run`
- `process.exit(1)` makes code after it unreachable in `src/cli.ts`
- The historical `migrate` command (legacy CSV import) is intentionally dropped in the Bun runtime
- `recalculate` uses cached prices only; `repair_prices` fetches from network
- `performance --benchmark` falls back to `PORTFOLIO_BENCHMARK_TICKERS` env var -> `SPY`
- `status`, `cash`, `summary`, `allocation`, `performance`, `mwr` must stay aligned to one reporting snapshot
- `verify_prices` is diagnostic only; `repair_prices` is remediation
- CLI help text vs code: code is the source of truth when they conflict

## Financial correctness rules

These are the invariants future changes must preserve.

### Single source of truth - `validators.ts`, `asset_kind.ts`, and PostgreSQL SQL

All currencies, FX tickers, cash bucket defaults, cash display names, and action groupings live in `portfolio-ts/src/validators.ts`, `portfolio-ts/src/asset_kind.ts`, and the SQL functions under `portfolio_db/sql/`. Service and adapter code may import or re-export those symbols, but they must not maintain parallel copies or drift from the canonical definitions.

### Metric documentation

Every metric MUST document:
- Does it include cash flows? (use `investment_return` = no, `portfolio_daily_return` = yes)
- Does it include fees/taxes?
- Base currency (always USD)
- How are dates aligned with benchmark?

### Fees policy

BUY/SELL fees are part of the financial model and must flow consistently through cash movement, cost basis, realized gain, and total profit. Standalone `FEE` transactions remain part of reporting totals.

### Risk and benchmark math

Risk metrics and monthly aggregation must use `investment_return`. Benchmark-relative metrics must be joined on `date`, not aligned by array position.

### Monthly return naming

Public performance output uses `median_monthly_return`. Do not reintroduce `avg_monthly_return` in emitted JSON.

### Transaction rules

SELL validation is as-of-date based. `exchange_currency` validation lives in the service layer. CLI and API checks are only UX validation.

### Mutation safety

`add`, `edit`, `exchange`, and `delete` must restore state if recalculation fails.

### Service layer purity

Service code must not print directly. Structured output and errors go through the logging and JSON response layers.

### Price cache errors

Missing or failed price fetches and inserts must surface in verification and repair output.

### Test template

Every calculation bug fix needs:
1. A hand-calculated fixture test
2. A regression test for the broken scenario
3. A CLI JSON snapshot test

### Open issue #22 items

- **DONE**: Time-based stale-price max-age enforced - `recalculate` checks `prices_need_fetch` via `maintenance_check`, refuses unless `--force`; `sync` runs `daily_maintenance_check()` before repair. Default threshold: `STALE_MAX_AGE_DAYS = 5` (#84, supersedes #22 finding #9, #66 findings #6/#7).
- **DONE**: Date-format split was unified - all commands accept ISO `YYYY-MM-DD`; legacy `DD-MM-YYYY` accepted with deprecation warning.

## Style

```ts
// camelCase for variables, methods, and functions
// UPPER_SNAKE_CASE for constants
// PascalCase for classes and types
// 2-space indentation
// Keep `bun run typecheck` green under strict TypeScript
```

## Related files

- `portfolio-ts/src/cli.ts` - CLI entrypoint and command dispatch
- `portfolio-ts/src/api/server.ts` - REST API adapter
- `portfolio-ts/src/db.ts` - Bun SQL connection lifecycle and query helpers
- `portfolio-ts/src/commands/*` - command/use-case implementations
- `portfolio-ts/src/validators.ts` - validation rules and shared action/currency sets
- `portfolio-ts/src/asset_kind.ts` - asset metadata and kind normalization
- `portfolio-ts/src/tx.ts`, `portfolio-ts/src/tx_core.ts`, `portfolio-ts/src/sql_apply.ts` - shared transaction helpers
- `portfolio-ts/src/response.ts` - canonical JSON envelope helpers
- `portfolio-ts/PARITY.md` - command parity and dropped legacy commands
- `portfolio_db/sql/*` - PostgreSQL schema and financial source of truth; do not modify casually
- `docs/transaction-spec.md`, `docs/api-response-standardization-plan.md` - output and behavior specs
