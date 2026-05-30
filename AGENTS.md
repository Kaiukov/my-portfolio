# Project specific instructions

## CMUX environment

```bash
cmux -v                        # version
cmux new-split right           # split right in current workspace
cmux new-split down            # split down
cmux close-surface --surface surface:N   # close a split
cmux send --surface surface:N "cmd"      # send text to split
cmux send-key --surface surface:N "Enter"
cmux read-screen --surface surface:N --lines 20   # read split output
cmux tree                      # show all workspaces/panes
```

### Agetns deployment

- for most task utilize `deepseek v4 flash` (fast, cheap, good for lint, imports, mechanical edits)
- for complex reasoning, architecture, bug fixes, use `deepseek v4 pro` (more expensive, better at reasoning and code generation)
- use `--yolo` flag to bypass all permission prompts for maximum speed (only for trusted commands)
- agents must be pro-active and creating for speed up proccess. 
- main agent must deligatee task to agents via cmux cli commands and to be an orcestrator of the process.
- orcestrator agent must spawn, steer and kill agents as needed, and be responsible for final output.

## Command Code (`cmd`) in split view

**IMPORTANT**: Never use `-p "..."` via cmux — long prompts sent as a single string get stuck in the shell buffer and never execute. Always open cmd interactively first, then send the prompt as a separate step.

```bash
# Step 1: open a new split and start cmd interactively
cmux new-split right
cmux send --surface surface:N "cmd --model deepseek/deepseek-v4-pro --yolo"
cmux send-key --surface surface:N "Enter"

# Step 2: wait for cmd REPL to be ready (look for "Ask your question..." prompt)
until cmux read-screen --surface surface:N --lines 3 | grep -q "Ask your question"; do sleep 2; done

# Step 3: send the prompt text, then Enter
cmux send --surface surface:N "your task description here"
cmux send-key --surface surface:N "Enter"

# Step 4: wait for response (look for "❯" prompt returning)
until cmux read-screen --surface surface:N --lines 3 | grep -q "^❯"; do sleep 3; done
cmux read-screen --surface surface:N --lines 40
```

Key flags:
- `--yolo` — bypass all permission prompts (alias for `--dangerously-skip-permissions`)
- `--auto-accept` — auto-accept tool calls (softer than `--yolo`)
- `--model deepseek/deepseek-v4-pro` — intelligent tasks: architecture, bug fixes, reasoning
- `--model deepseek/deepseek-v4-flash` — dirty tasks: lint, imports, ruff fixes, mechanical edits
- `--list-models` — show available models
- `-p "query"` — non-interactive single-shot mode (**do NOT use via cmux**, only from the main terminal directly)

## Overview

Python CLI (`portfolio`) for portfolio tracking with PostgreSQL. Source lives in `portfolio_db/`, not `src/`.

- package manager: `uv`
- build backend: hatchling
- Python >= 3.13
- database: PostgreSQL (required; DuckDB support removed)
- library dependencies: click, psycopg[binary], numpy, pandas, yfinance

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

### DuckDB Migration (from legacy)

If migrating from DuckDB:
```bash
# Install DuckDB support (optional)
# Note: duckdb is no longer a core dependency; install separately if needed
pip install duckdb

# Run migration (requires PORTFOLIO_DB_URL set to target PostgreSQL)
uv run portfolio migrate-duckdb-to-postgres \
  --from ~/portfolio.duckdb \
  --to $PORTFOLIO_DB_URL
```

The migration command:
- Copies `transactions`, `daily_returns`, `price_cache` tables
- Validates row counts match after copy
- Resets PostgreSQL sequences for safe future inserts
- Emits JSON progress report (dry-run available with `--dry-run`)

## Key commands

```bash
uv sync              # install dependencies
uv run pytest -q     # run tests (CI: uv run pytest -q --tb=short)
uv run ruff check .  # lint
uv run portfolio     # run CLI
```

## Architecture layers

Three layers. Each owns its domain. No layer reaches into a layer below it that is not its direct dependency.

### PostgreSQL persistence (portfolio_db/database.py)
Owns: SQL, psycopg driver, schema setup, migrations, connection lifecycle, PORTFOLIO_DB_URL resolution, all repository/query methods.
Rule: No caller outside this file may use `db.con` directly.

### Shared service / use-case layer
Files: portfolio_service.py, transaction_service.py, reporting_service.py, recalculation_service.py, performance_service.py, price_service.py, price_cache_service.py, calculator.py, domain.py, validators.py
Owns: business logic, financial invariants, transaction rules (SELL-as-of-date, exchange validation), recalculation orchestration, reporting, allocation, cash logic, performance metrics, price-cache behavior.
Rule: No financial invariant lives in CLI or API adapters. This layer is callable by CLI now and by MCP/API adapters later without modification.

### Adapter layer (current: CLI only)
Files: portfolio_db/cli.py
Owns: Click argument parsing, light user-facing validation (format checks, required flags), calling shared use-case layer, serializing pure JSON responses via response.py.
Rules:
- No SQL or psycopg imports.
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

## Date format

- **All commands**: `YYYY-MM-DD` (ISO 8601, primary format)
- **Legacy `DD-MM-YYYY`** is still accepted on write commands (`--date`, `--from-date`) but deprecated — a stderr warning is emitted via `console.warn`. Remove legacy support after migration window closes.
- `migrate` ingests semicolon-separated CSV with `DD-MM-YYYY` dates

## Command classification

- **Read-only** (never trigger network calls): `report`, `transactions`, `status`, `allocation`, `cash`, `summary`, `performance`, `mwr`, `verify_prices`, `health`
- **Mutating** (auto-recalculate after write): `add`, `edit`, `delete`, `exchange`, `migrate`, `repair_prices`, `recalculate`
- **File-level**: `backup`, `init`

## Common traps

- `add` requires `--exchange` (non-optional)
- `delete` requires `--confirm` (unless `--dry-run`)
- `edit`, `repair_prices`, `recalculate` support `--dry-run`
- `error()` calls `sys.exit(1)` — code after it is unreachable
- `migrate` is destructive: clears existing transactions and daily_returns before import
- `recalculate` uses cached prices only; `repair_prices` fetches from network
- `performance --benchmark` falls back to `PORTFOLIO_BENCHMARK_TICKERS` env var → `SPY`
- `status`, `cash`, `summary`, `allocation`, `performance`, `mwr` must stay aligned to one reporting snapshot
- `verify_prices` is diagnostic only; `repair_prices` is remediation
- CLI help text vs code: code is the source of truth when they conflict

## Financial correctness rules

These are the invariants future changes must preserve.

### Single source of truth — domain.py

All currencies, FX tickers, cash bucket defaults, cash display names, and action groupings live in `domain.py`. Service and calculator code may import or re-export those symbols, but they must not maintain parallel copies or drift from `domain.py`.

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

- Time-based stale-price max-age is still not enforced.
- **DONE**: Date-format split was unified — all commands accept ISO `YYYY-MM-DD`; legacy `DD-MM-YYYY` accepted with deprecation warning.

## Style

```python
# snake_case for variables, methods, functions
# UPPER_SNAKE_CASE for constants
# PascalCase for classes
# ruff: py313 target, line-length 100
```

## Related files

- Skill: `.agents/skills/my-portfolio-cli/SKILL.md` — detailed workflow for CLI changes
- Docs: `docs/transaction-spec.md`, `docs/api-response-standardization-plan.md`
