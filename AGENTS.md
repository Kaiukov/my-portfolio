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

```bash
# Open a new split, then run cmd with DeepSeek for fast/cheap tasks
cmux new-split right
cmux send --surface surface:N "cmd --model deepseek-v4-pro --yolo 'your task'"
cmux send-key --surface surface:N "Enter"
```

Key flags:
- `--yolo` — bypass all permission prompts (alias for `--dangerously-skip-permissions`)
- `--auto-accept` — auto-accept tool calls (softer than `--yolo`)
- `--model deepseek-v4-pro` — intelligent tasks: architecture, bug fixes, reasoning
- `--model deepseek-v4-flash` — dirty tasks: lint, imports, ruff fixes, mechanical edits
- `-p "query"` — non-interactive single-shot mode
- `--list-models` — show available models

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

## Architecture

- `portfolio_db/cli.py` — Click CLI commands and help text
- `portfolio_db/portfolio_service.py` — main orchestrator; reporting snapshots, write flows
- `portfolio_db/reporting_service.py` — as-of valuation, cash/position reporting
- `portfolio_db/transaction_service.py` — add/edit/delete/exchange validation and rollback
- `portfolio_db/calculator.py` — daily return calculation (investment_return vs portfolio_daily_return)
- `portfolio_db/performance_service.py` — risk metrics, benchmark comparison, concentration
- `portfolio_db/database.py` — PostgreSQL connection, schema initialization, migrations, pagination
- `portfolio_db/sql/schema.sql` — PostgreSQL DDL: tables (transactions, prices, daily_returns, refresh_log, etc.)
- `portfolio_db/sql/functions.sql` — PostgreSQL helper functions for asset type detection, price lookups, valuations
- `portfolio_db/sql/procedures.sql` — PostgreSQL procedures: refresh_daily_returns_sql (main calculation engine)
- `portfolio_db/sql/views.sql` — PostgreSQL views: current_holdings, cash_balances, portfolio_allocation, portfolio_summary
- `portfolio_db/sql/triggers.sql` — PostgreSQL triggers: auto-update timestamp columns
- `portfolio_db/domain.py` — SINGLE SOURCE OF TRUTH for currencies, FX tickers, cash buckets, action helpers
- `portfolio_db/response.py` — JSON envelope: `success()` exits 0, `error()` calls `sys.exit(1)` and never returns
- `portfolio_db/logger.py` — structured JSON logs to `PORTFOLIO_LOG_PATH` (file only, never stdout)
- `portfolio_db/validators.py` — shared validation
- `portfolio_db/price_service.py` — yfinance wrapper with reverse-quoted FX inversion
- `portfolio_db/price_cache_service.py` — cached prices, repair flows, stale-state

## CLI JSON contract

All commands emit pure JSON with this envelope:
```json
{"ok": true, "command": "...", "data": ..., "meta": {"generated_at": "...", "count": N, ...}}
```
Errors: `{"ok": false, "command": "...", "error": {"code": "X", "message": "..."}, "meta": {...}}`

## Date format trap

- **Read/report commands**: `YYYY-MM-DD` (`--start-date`, `--end-date`, `--as-of-date`)
- **Write/recalc commands**: `DD-MM-YYYY` (legacy; `--date`, `--from-date` on `add`/`edit`/`exchange`/`recalculate`)
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

These are hard-won invariants. Violating any of them produces wrong JSON that looks correct.

### Single source of truth — domain.py

All currencies, FX tickers, cash bucket defaults, cash display names, and action groupings live only in `domain.py`. Do NOT redeclare `CASH_FX_SYMBOLS`, `CASH_BUCKET_DEFAULTS`, `CASH_DISPLAY_CURRENCY`, or action sets in `portfolio_service.py` or `calculator.py`. The class-level shadows in `PortfolioService` (lines 60-71) are stale subsets — they must be removed and imports from `domain.py` used instead.

### Metric documentation

Every metric MUST document:
- Does it include cash flows? (use `investment_return` = no, `portfolio_daily_return` = yes)
- Does it include fees/taxes?
- Base currency (always USD)
- How are dates aligned with benchmark?

### Fees policy

CLI accepts `--fees` on BUY/SELL but the calculator and reporting layer ignore fees for trade cash movements (`quantity * price` only, no fee subtraction). Fees are only accounted as standalone `FEE` transactions. Either:
- Prohibit `--fees` on BUY/SELL, OR
- Apply fees to cash balance, cost basis, realized gain, and total profit.

A half-supported `--fees` on trades is misleading. Pick one.

### Risk metrics: use investment_return, not portfolio_daily_return

`portfolio_daily_return` includes deposit/withdrawal impact. All risk metrics (volatility, VaR, beta, Sharpe, Sortino, Treynor, IR, capture ratios) and monthly aggregation must use `investment_return` instead. Currently `performance_service.py:146` uses `portfolio_daily_return` — this contaminates every downstream metric.

### Benchmark alignment: join by date, never by array index

SPY and portfolio return arrays must be joined on date, not aligned via `[-n:]` array slicing. Array alignment breaks on weekends, holidays, crypto trading days, and cash-only days. Currently `performance_service.py:211-213` and `:316-319` use array-position alignment.

### `avg_monthly_return` is a median

`performance_service.py:380` returns `sorted(monthly_returns)[len(monthly_returns)//2]` — this is the median, not average. Either rename to `median_monthly_return` or compute the mean.

### SELL validation must use as-of-date

CLI SELL conflict check (`cli.py:309`) queries total net holdings without date filtering. A backdated SELL can pass because future BUY transactions inflate the net. The invariant "cannot sell more than held on transaction date" must live in the service layer with a date-aware query.

### `exchange_currency` validation at service layer

From/to assets must be cash-like, quantity > 0, rate > 0, from != to. CLI currently only checks from != to. Move these checks to `transaction_service.py:exchange_currency`.

### All mutating commands must be rollback-safe

`add`, `edit`, and `exchange` capture rollback snapshots and restore on recalc failure. `delete` does NOT (`transaction_service.py:256-291`) — it deletes the row, then deletes daily_returns, then recalculates. If recalc fails, state is broken. Give `delete` the same rollback treatment.

### CLI validation is NOT the source of truth

Every financial invariant that must hold for correctness (SELL-as-of-date, exchange validation, cash-like asset rules, quantity/price constraints) must live in the service layer. CLI validation is a UX convenience, not a safety net.

### No `print()` from service layer

`price_service.py:102` prints a warning to stdout. This breaks the "pure JSON output" contract. Route through structured logging (`logger.py`) instead.

### Price cache must surface errors

Failed price fetches/inserts must appear in structured status (repair log, verify_prices output). Silent swallowing produces wrong valuations.

### Bug fix template: three tests

Every calculation bug fix needs:
1. Hand-calculated fixture test (independent verification)
2. Regression test (specific scenario that was broken)
3. CLI JSON snapshot test (end-to-end contract)

### Calculator action constants

`calculator.py:18-22` redeclares action groupings (`EXTERNAL_INFLOW_ACTIONS`, etc.) that duplicate `PortfolioService` and `domain.py`. These must come from a single source.

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
