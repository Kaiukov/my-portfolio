---
name: my-portfolio-cli
description: Use when working on the `portfolio` CLI, its JSON response contract, reporting snapshot rules, transaction writes, price repair/verification, or CLI help/tests in `portfolio_db`.
---

# My Portfolio CLI

Use this skill for any task that changes or explains the `portfolio` command line or its supporting services.

## Source of truth

- `portfolio_db/cli.py` - command names, help text, option wiring, and command-level validation
- `portfolio_db/portfolio_service.py` - reporting snapshot, benchmark default, error mapping, write flows
- `portfolio_db/reporting_service.py` - as-of valuation, cash/position reporting
- `portfolio_db/transaction_service.py` - add/edit/delete/exchange behavior
- `portfolio_db/price_cache_service.py` - cached prices, repair flows, stale-state handling
- `portfolio_db/database.py` - DuckDB schema and pagination queries
- `portfolio_db/validators.py` - shared validation rules and limits
- `portfolio_db/response.py` - JSON envelope and error shape
- `tests/test_cli_help.py` and pytest coverage - verify the public contract

## Safe workflow

1. Inspect code first. If help text and code disagree, code wins.
2. Confirm the current CLI surface:
   - `uv run portfolio --help`
   - `uv run portfolio COMMAND --help`
3. Classify the command before editing:
   - read-only: `report`, `transactions`, `status`, `allocation`, `cash`, `summary`, `performance`, `mwr`, `verify_prices`, `health`
   - mutating or networked: `add`, `edit`, `delete`, `exchange`, `migrate`, `repair_prices`, `recalculate`, `init`
   - file-level mutation only: `backup`
4. Verify date behavior before changing examples:
   - read/report commands use `YYYY-MM-DD`
   - write/recalc paths still use legacy `DD-MM-YYYY` where implemented
   - `migrate` ingests semicolon-separated CSV with `DD-MM-YYYY`
5. Watch for the common traps:
   - `add` requires `--exchange`
   - `delete` requires `--confirm`
   - `edit`, `repair_prices`, and `recalculate` support `--dry-run`
   - `repair_prices` fetches price data and writes to the cache
   - `recalculate` uses cached prices only and can be forced with `--force`
   - `performance --benchmark` falls back to `PORTFOLIO_BENCHMARK_TICKERS`, then `SPY`
   - `status`, `cash`, `summary`, `allocation`, `performance`, and `mwr` must stay aligned to one reporting snapshot
6. After edits, run the narrowest useful verification:
   - `uv run portfolio --help`
   - `uv run portfolio COMMAND --help`
   - `pytest -q`
   - if price/reporting behavior changed, also smoke test `portfolio health`, `portfolio verify_prices`, and one read-only snapshot command
7. Do not invent features, flags, or defaults. If the code does not prove it, leave it out.

## Practical notes

- `migrate` is destructive: it clears existing transactions and `daily_returns` before import.
- Missing valuation data should surface as explicit `PRICE_DATA_ERROR`, not silent fallback.
- `verify_prices` is diagnostic only; `repair_prices` is remediation.
- Keep examples truthful and operator-oriented.
- If a change touches help text, update or add tests like `tests/test_cli_help.py`.
- If a change touches transaction or pricing logic, keep the CLI and service layers in sync and re-run pytest.
