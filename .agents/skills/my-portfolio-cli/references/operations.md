# Operations

Canonical source:

- `/Users/oleksandrkaiukov/Code/my-portfolio/.agents/skills/my-portfolio-cli/references/operations.md`

Operator workflows supported by the current production baseline:

## Bootstrap

- install dependencies with `uv sync`
- initialize or migrate the database with `portfolio migrate`
- keep one explicit DB path per environment

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

## Read Reporting

- `status`, `cash`, `summary`, `allocation`, and `performance` are read/reporting commands
- these commands must be interpreted as views over one reporting snapshot and one `as_of_date`
- operators should expect equal total portfolio value across those commands for the same snapshot date
