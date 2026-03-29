# CLI Commands

Current public commands in `portfolio_db/cli.py`:

- `init` — initialize a new portfolio DB (idempotent)
- `migrate`
- `report`
- `transactions`
- `status`
- `add`
- `edit` — supports `--dry-run`
- `verify_prices`
- `repair_prices` — supports `--dry-run`
- `recalculate` — supports `--dry-run`
- `allocation`
- `cash`
- `delete`
- `performance`
- `summary`
- `exchange`
- `health`

## Command notes

- Read/report commands open the DB in read-only mode.
- Mutating commands trigger recalculation only when needed.
- Public command names must match what operators and docs use.
- `verify_prices` is diagnostic (read-only).
- `repair_prices` fetches and caches missing/incomplete price series. Use `--dry-run` to preview without fetching.
- `edit --dry-run` shows current transaction and proposed changes without writing.
- `recalculate --dry-run` shows from_date, last_recalc state, and price issues without executing.
- `health` returns DB reachability, stale state, price coverage issues, and recalc freshness.
- `init` is idempotent — safe to run on an existing DB.

## Operator actions supported by `add` / `edit`

- `DEPOSIT` / `WITHDRAW`
- `DIVIDEND` / `INTEREST`
- `FEE` / `TAX`
- `TRANSFER`
- `BUY` / `SELL`
- `EXCHANGE_FROM` / `EXCHANGE_TO` (via `exchange` command)

## Flags

- `--db` — path to DuckDB file (default: `portfolio.db`)
- `--as-of-date` — snapshot date for read commands. Defaults to last date in `daily_returns`; stale if `recalculate` hasn't run after `repair_prices`.
- `--dry-run` — preview without mutating state (`edit`, `repair_prices`, `recalculate`)
- `--confirm` — required for `delete`
- `--force` — bypass cache check in `recalculate`
