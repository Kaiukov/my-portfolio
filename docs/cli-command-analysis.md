# CLI Command Analysis

This document analyzes the project CLI implemented in `portfolio_db/cli.py`.

## Entry points and invocation

- Primary CLI is a Click command group (`cli`) in `portfolio_db/cli.py`.
- The module is executable directly via `python -m portfolio_db.cli`.
- Current packaging config appears inconsistent: `[project.scripts]` points to `portfolio = "src.cli:main"`, while the actual implementation is in `portfolio_db/cli.py`.

## Command inventory

The CLI defines 13 commands:

1. `migrate`
2. `report`
3. `transactions`
4. `status`
5. `add`
6. `verify_prices`
7. `recalculate`
8. `allocation`
9. `cash`
10. `delete`
11. `performance`
12. `summary`
13. `exchange`

## Command-level analysis

### 1) `migrate`
- Purpose: imports transactions from CSV and initializes DuckDB-backed data.
- Options:
  - `--csv` (default: `yfiance-transactions/transactions.csv`)
  - `--db` (default: `portfolio.db`)
- Notes:
  - Useful bootstrap command.
  - Default CSV path includes a likely typo (`yfiance` vs `yfinance`).

### 2) `report`
- Purpose: paginated daily returns report.
- Options:
  - `--limit`, `--offset`
  - `--start-date`, `--end-date` in `YYYY-MM-DD`
  - `--db`
- Notes:
  - Uses consistent pagination envelope via `build_pagination`.

### 3) `transactions`
- Purpose: paginated transaction list.
- Options mirror `report`.
- Notes:
  - Date parsing format is also `YYYY-MM-DD`.

### 4) `status`
- Purpose: high-level portfolio snapshot.
- Options:
  - `--db`
- Output includes:
  - transaction count, date range, portfolio value, invested amount, gains, and `as_of_date`.

### 5) `add`
- Purpose: add transaction and trigger recalculation.
- Required options:
  - `--date` (`DD-MM-YYYY`)
  - `--asset`, `--action`, `--quantity`
- Optional options:
  - `--price`, `--currency`, `--fees`, `--exchange`, `--db`
- Notes:
  - `--action` supports `BUY`, `SELL`, `DEPOSIT`, `FEE`.
  - Returns the inserted transaction payload.

### 6) `verify_prices`
- Purpose: validate prices table structure/stats.
- Options:
  - `--db`
- Notes:
  - Returns row totals, unique tickers, date range, and optimization notes.

### 7) `recalculate`
- Purpose: recompute returns.
- Options:
  - `--force`
  - `--from-date` (`DD-MM-YYYY`)
  - `--db`
- Notes:
  - Returns rows affected and recalculation type on success.

### 8) `allocation`
- Purpose: show allocation breakdown.
- Options:
  - `--type` in `{assets, cash, all}`
  - `--db`

### 9) `cash`
- Purpose: show cash balances with USD conversion.
- Options:
  - `--db`
- Notes:
  - Attempts FX fetch for EUR/USD and GBP/USD via `yfinance`.
  - Gracefully degrades to 1.0 FX default and includes warnings.

### 10) `delete`
- Purpose: delete transaction by ID and recalculate.
- Required options:
  - `--id`
- Optional options:
  - `--confirm` (required behavior in non-interactive mode)
  - `--db`
- Notes:
  - Safe-by-default behavior: deletion requires explicit `--confirm`.

### 11) `performance`
- Purpose: full performance and risk metrics.
- Options:
  - `--db`
- Notes:
  - Rich output includes return metrics, volatility, factor/risk stats, VaR/CVaR, drawdown, concentration.

### 12) `summary`
- Purpose: position-level summary with gains/losses.
- Options:
  - `--filter` in `{open, all}`
  - `--db`

### 13) `exchange`
- Purpose: currency exchange transaction pair.
- Required options:
  - `--date` (`DD-MM-YYYY`)
  - `--from`, `--to`, `--quantity`, `--rate`
- Optional:
  - `--db`

## Cross-cutting behavior

- All commands use JSON envelope helpers (`success` / `error`) for machine-friendly output.
- Exceptions are normalized to error envelopes with command-specific error codes.
- Database lifecycle is cleanly managed (`service.close()` in `finally`).
- Date-format inconsistency exists across commands:
  - `report`/`transactions`: `YYYY-MM-DD`
  - `add`/`exchange`/`recalculate --from-date`: `DD-MM-YYYY`

## Operational findings

1. Packaging entry-point mismatch likely breaks installed command execution (`src.cli:main` does not match implementation location).
2. Date format inconsistency can cause user errors and onboarding friction.
3. `delete` command non-interactive safety model is appropriate and explicit.
4. `cash` command has sensible resilience behavior with FX fallback warnings.

## Suggested improvements

1. Align `pyproject.toml` script target to this Click app (`portfolio_db.cli:cli`) or add a compatible wrapper.
2. Standardize date flags to a single format (prefer ISO `YYYY-MM-DD`) across all commands.
3. Add a dedicated `--help` examples section to README once command entrypoint is fixed.
4. Add lightweight CLI tests for argument parsing and date validation behavior.
