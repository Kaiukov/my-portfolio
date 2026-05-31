---
name: my-portfolio-cli
description: Use when working on the `portfolio-ts` CLI, its JSON response contract, reporting snapshot rules, transaction writes, price repair/verification, or CLI help/tests in `portfolio-ts`.
---

# My Portfolio CLI

Use this skill for any task that changes or explains the `portfolio-ts` command line or its supporting services.

## Source of truth

- `portfolio-ts/src/cli.ts` — command names, help text, option parsing (`parseArgs`), and dispatch to command files
- `portfolio-ts/src/commands/*.ts` — individual command orchestration (status, add, edit, delete, exchange, recalculate, repair_prices, verify_prices, sync, report, cash, allocation, summary, concentration, performance, mwr, health, init, backup)
- `portfolio-ts/src/db.ts` + `portfolio-ts/src/tx.ts` — PostgreSQL connection lifecycle, query/querySingle, transaction wrappers (no direct SQL outside `db.ts`)
- `portfolio-ts/src/validators.ts` — shared validation rules, domain constants (`USER_ACTIONS`, `ALLOWED_CURRENCIES`, `STALE_MAX_AGE_DAYS`), date parsing
- `portfolio-ts/src/response.ts` — JSON envelope (`success`, `error`, `buildPagination`) and TypeScript types
- `portfolio-ts/src/providers/yahoo.ts` — Yahoo Finance price fetcher via `yahoo-finance2` npm package
- `portfolio_db/sql/` — ALL financial math: `schema.sql`, `functions.sql`, `procedures.sql`, `views.sql`, `triggers.sql`
- `portfolio-ts/tests/*.test.ts` — Bun test coverage, verify the public contract

## Safe workflow

1. Inspect code first. If help text and code disagree, code wins.
2. Confirm the current CLI surface:
   - `bun src/cli.ts --help`
   - `bun src/cli.ts <command> --help` (use flags like `--help` on each command)
3. Classify the command before editing:
   - read-only: `status`, `transactions`, `report`, `cash`, `allocation`, `summary`, `concentration`, `performance`, `mwr`, `verify_prices`, `health`
   - mutating or networked: `add`, `edit`, `delete`, `exchange`, `recalculate`, `repair_prices`, `sync`
   - file-level mutation only: `backup`, `init`
4. Verify date behavior before changing examples:
   - all commands use `YYYY-MM-DD` (ISO 8601)
   - legacy `DD-MM-YYYY` accepted on write commands with a stderr deprecation warning via `console.warn`
   - `parseDate()` in `validators.ts` handles both formats
5. Watch for the common traps:
   - `add` requires `--exchange`
   - `delete` requires `--confirm`
   - `edit`, `repair_prices`, and `recalculate` support `--dry-run`
   - `repair_prices` fetches price data and writes to the cache via `yahoo-finance2`
   - `recalculate` uses cached prices only; can be forced with `--force`
   - `sync` runs `daily_maintenance_check` + `repair_prices` + `recalculate` in sequence
   - `performance --benchmark` falls back to `PORTFOLIO_BENCHMARK_TICKERS`, then `SPY`
   - `status`, `cash`, `summary`, `allocation`, `performance`, and `mwr` must stay aligned to one reporting snapshot
   - `init` verifies 4 core PostgreSQL tables exist (schema-ready check)
6. After edits, run the narrowest useful verification:
   - `bun run typecheck`
   - `bun src/cli.ts --help`
   - `bun test <related-test-file>`
   - `bun test` (full suite)
   - if price/reporting behavior changed, also smoke test `bun src/cli.ts health`, `bun src/cli.ts verify_prices`, and one read-only snapshot command
7. Do not invent features, flags, or defaults. If the code does not prove it, leave it out.

## Practical notes

- Missing valuation data should surface as explicit `PRICE_DATA_ERROR`, not silent fallback.
- `verify_prices` is diagnostic only; `repair_prices` is remediation.
- Keep examples truthful and operator-oriented.
- If a change touches help text, update or add tests like `portfolio-ts/tests/cli.test.ts`.
- If a change touches transaction or pricing logic, keep the CLI and service layers in sync and re-run `bun test`.

## Key commands

```bash
bun install                  # install dependencies
bun run typecheck            # run TypeScript type check (tsc --noEmit)
bun test                     # run full test suite
bun src/cli.ts --help        # show CLI help
```

## Architecture layers

Three layers. Each owns its domain. No layer reaches into a layer below it that is not its direct dependency.

### PostgreSQL persistence (`portfolio_db/sql/` + `portfolio-ts/src/db.ts`)
Owns: SQL schema, functions, procedures, views, triggers, ALL financial math. `db.ts` owns connection lifecycle, `query()`, `querySingle()`, `tx.ts` wraps BEGIN/COMMIT/ROLLBACK.
Rule: No caller outside `db.ts` may use the raw Bun SQL connection directly.

### Shared service / use-case layer
Files: `portfolio-ts/src/commands/*.ts`, `portfolio-ts/src/validators.ts`
Owns: business logic orchestration, financial invariants, transaction rules (SELL-as-of-date, exchange validation), recalc/repair orchestration, reporting, allocation, cash logic, performance metrics, price-cache behavior, validation rules.
Rule: No financial invariant lives in the CLI adapter. This layer is callable by CLI now and by MCP/API adapters later without modification. Financial calculations themselves live in SQL — TS commands only orchestrate and format.

### Adapter layer (current: CLI only)
Files: `portfolio-ts/src/cli.ts`, `portfolio-ts/src/response.ts`
Owns: `parseArgs()` argument parsing, light user-facing validation (format checks, required flags), calling shared use-case layer, serializing pure JSON responses via `response.ts`.
Rules:
- No direct SQL (no raw queries).
- No business/financial logic.
- No duplication of service logic.
- Future MCP/API adapters must be able to reuse all shared use-case layer directly without copying CLI code.

### Future adapters (NOT in this PR)
MCP and REST API are future adapters. They will call the same shared service/use-case layer. No implementation in this PR; no new heavy dependencies.

## CLI JSON contract

All commands emit pure JSON with this envelope:
```json
{"ok": true, "command": "...", "data": ..., "meta": {"generated_at": "...", "count": N, ...}}
```
Errors: `{"ok": false, "command": "...", "error": {"code": "X", "message": "..."}, "meta": {...}}`

See `portfolio-ts/src/response.ts` for the `success()`, `error()`, `buildPagination()` helpers.

## Date format

- **All commands**: `YYYY-MM-DD` (ISO 8601, primary format)
- **Legacy `DD-MM-YYYY`** is still accepted on write commands (`--date`, `--from-date`) but deprecated — a stderr warning is emitted via `console.warn`. Remove legacy support after migration window closes.

## Financial correctness rules

These are the invariants future changes must preserve.

### Single source of truth — SQL + validators.ts

All currencies, FX tickers, actions, allowed currencies, and domain constants live in `validators.ts` or SQL functions. TS command files must not maintain parallel copies or drift from these sources.

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

SELL validation is as-of-date based. `exchange_currency` validation lives in the service layer. CLI checks are only UX validation.

### Mutation safety

`add`, `edit`, `exchange`, and `delete` must restore state if recalculation fails (PG transaction rollback).

### Service layer purity

Service code must not print directly. Structured output and errors go through the JSON response layer (`response.ts`).

### Price cache errors

Missing or failed price fetches and inserts must surface in verification and repair output.

### Test template

Every calculation bug fix needs:
1. A hand-calculated fixture test
2. A regression test for the broken scenario
3. A CLI JSON snapshot test

### Open issue #22 items

- **DONE**: Time-based stale-price max-age enforced — `recalculate` checks `prices_need_fetch` via `maintenance_check`, refuses unless `--force`; `sync` runs `daily_maintenance_check()` before repair. Default threshold: `STALE_MAX_AGE_DAYS = 5`.
- **DONE**: Date-format split was unified — all commands accept ISO `YYYY-MM-DD`; legacy `DD-MM-YYYY` accepted with deprecation warning.

## Style

```typescript
// camelCase for variables, methods, functions
// PascalCase for classes and types
// UPPER_SNAKE_CASE for constants
```

## Related files

- Skill: `.agents/skills/my-portfolio-cli/SKILL.md` — detailed workflow for CLI changes
- Docs: `docs/transaction-spec.md`, `docs/api-response-standardization-plan.md`
- Parity: `portfolio-ts/PARITY.md` — Python-to-TypeScript command migration status
