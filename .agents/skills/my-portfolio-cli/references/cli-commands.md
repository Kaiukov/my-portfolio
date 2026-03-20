# CLI Commands

Current public commands in `portfolio_db/cli.py`:

- `migrate`
- `report`
- `transactions`
- `status`
- `add`
- `edit`
- `verify_prices`
- `repair_prices`
- `recalculate`
- `allocation`
- `cash`
- `delete`
- `performance`
- `summary`
- `exchange`

Command usage notes:

- Read/report commands should open the DB in read-only mode.
- Mutating commands should trigger recalculation only when needed.
- Public command names must match what operators and docs use.
- `verify_prices` is diagnostic.
- `repair_prices` is remediation and should fetch/cache missing or incomplete price series.

Important operator expectations:

- `add` and `edit` support portfolio cash-flow actions, including:
  - `DEPOSIT`
  - `WITHDRAW`
  - `DIVIDEND`
  - `INTEREST`
  - `FEE`
  - `TAX`
  - `TRANSFER`
- `recalculate --force` must rebuild full daily returns deterministically.
- `cash` should expose cash balances and cash-related income/expense metrics.
- `performance` should expose deposits, withdrawals, net contributions, realized gain, unrealized gain, and income/expense metrics when available.
