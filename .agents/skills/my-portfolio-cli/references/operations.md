# Operations

Canonical source:

- `/Users/oleksandrkaiukov/Code/my-portfolio/.agents/skills/my-portfolio-cli/references/operations.md`

Operator workflows supported by the current production baseline:

## Bootstrap

```bash
uv sync                                  # install dependencies
portfolio init --db portfolio.db         # create and verify DB schema (idempotent)
cp .env.example .env                     # configure DB path and log path
```

- `init` is safe to run repeatedly — it creates schema if missing, no-op otherwise
- keep one explicit `--db` path per environment

## Import And Migrate

- use `migrate` to load transactions from the source CSV into DuckDB
- migration should be treated as a write operation followed by price preparation and recalculation
- success output must stay machine-readable JSON

## Add, Edit, And Delete Transaction

- `add` creates a user transaction using one of the supported public actions
- `edit` updates an existing transaction by id and recalculates from the earliest affected date
- `delete` removes a transaction by id and recalculates affected reporting state
- these flows must preserve deterministic downstream reporting after recalculation

## Exchange Currency

- `exchange` is the public workflow for internal currency conversion
- it creates two system transactions:
  - `EXCHANGE_FROM`
  - `EXCHANGE_TO`
- operators should treat these legs as an atomic pair

## Recalculate

- `recalculate` rebuilds daily returns and reporting state from a given date or fully when needed
- recalculation must remain deterministic for the same DB contents
- `recalculate --force` is the full rebuild path

## Verify And Repair Prices

- `verify_prices` is the diagnostic command for stale or missing coverage
- `repair_prices` is the remediation command that refreshes or backfills cached price data
- reporting should fail explicitly when required coverage is still missing after verification or repair

## Refresh Prices Before Reporting

Always run both before reporting:

```bash
portfolio repair_prices && portfolio recalculate
```

`repair_prices` updates price cache; `recalculate` rebuilds `daily_returns`. Default `as_of_date` is the last row in `daily_returns` — stale if `recalculate` hasn't run.

## Read Reporting

- `status`, `cash`, `summary`, `allocation`, and `performance` are read/reporting commands
- these commands must be interpreted as views over one reporting snapshot and one `as_of_date`
- operators should expect equal total portfolio value across those commands for the same snapshot date

## Health Check

```bash
portfolio health --db portfolio.db
```

Returns: `status` (ok/degraded), `stale_data`, `last_successful_price_refresh`,
`last_successful_recalc`, `price_coverage_issues`, `stale_tickers`.

## Backup and Restore

```bash
# Create backup manually
portfolio backup --db portfolio.db                        # timestamped copy in same dir
portfolio backup --db portfolio.db --out /backups/p.db    # explicit path

# Auto-backup before a destructive delete
portfolio delete --id 42 --confirm --backup
```

Recommended: run before destructive operations (bulk delete, migration).
Backup events are logged to `logs/portfolio.log`.

### Restore Procedure

```bash
# Stop any processes using portfolio.db first, then:
cp portfolio.db.backup-20260321-120000.db portfolio.db
portfolio health --db portfolio.db          # verify integrity
portfolio recalculate --db portfolio.db     # rebuild reporting state
```

- Do not restore while the CLI is running (DuckDB uses a single-writer lock)
- After restore, always run `recalculate` to ensure reporting state matches transactions

## Structured Logs

All mutations and key events emit JSON lines to `logs/portfolio.log` (configurable via `PORTFOLIO_LOG_PATH`).

```bash
# Monitor errors in real time
tail -f logs/portfolio.log | jq 'select(.level == "error")'

# All recalc events today
grep '"event":"recalc_done"' logs/portfolio.log | jq .
```
