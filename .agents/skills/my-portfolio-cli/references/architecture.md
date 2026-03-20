# Architecture

Canonical source:

- `/Users/oleksandrkaiukov/Code/my-portfolio/.agents/skills/my-portfolio-cli/references/architecture.md`

This document completes Production Ready Plan Step 1 by freezing the baseline domain model and reporting semantics the CLI should follow.

## Core Invariants

- CLI output is always pure JSON.
- The skill `references/` directory is the documentation source of truth.
- Read-path valuation uses DuckDB-cached price series and FX series.
- External fetching is allowed for refresh and repair flows, not for silent read-time fallback.
- Reporting commands must agree on one deterministic `as_of_date`.
- TWR is the primary portfolio return metric.

## Supported Actions

Public user-entered actions:

- `BUY`
- `SELL`
- `DEPOSIT`
- `WITHDRAW`
- `DIVIDEND`
- `INTEREST`
- `FEE`
- `TAX`
- `TRANSFER`

System-generated actions:

- `EXCHANGE_FROM`
- `EXCHANGE_TO`

Action groups in the current implementation:

- external inflows:
  - `DEPOSIT`
  - `TRANSFER`
- external outflows:
  - `WITHDRAW`
- income:
  - `DIVIDEND`
  - `INTEREST`
- expenses:
  - `FEE`
  - `TAX`
- trades:
  - `BUY`
  - `SELL`
- system exchange legs:
  - `EXCHANGE_FROM`
  - `EXCHANGE_TO`

## Action Semantics

`BUY`

- increases position shares
- decreases cash by `quantity * price`
- requires tradable asset, positive quantity, and trade price for correct valuation and cash accounting

`SELL`

- decreases position shares
- increases cash by `quantity * price`
- requires tradable asset, positive quantity, and trade price for correct valuation and cash accounting

`DEPOSIT`

- external cash contribution into a cash asset
- increases cash balance
- counts toward deposits and net contributions
- must not create an investment position

`WITHDRAW`

- external cash removal from a cash asset
- decreases cash balance
- counts toward withdrawals and net contributions
- must not create an investment position

`DIVIDEND`

- cash income credited to a cash asset
- increases cash balance
- counts as income, specifically dividends
- does not count as external contribution

`INTEREST`

- cash income credited to a cash asset
- increases cash balance
- counts as income, specifically interest
- does not count as external contribution

`FEE`

- cash expense
- decreases cash balance
- counts as fee expense
- must not create or change a non-cash position

`TAX`

- cash expense
- decreases cash balance
- counts as tax expense
- must not create or change a non-cash position

`TRANSFER`

- current implementation classifies this as an external inflow
- it currently increases cash and counts toward net contributions
- production risk remains: the long-term meaning is still ambiguous between external contribution and internal account transfer
- until an account dimension exists, treat `TRANSFER` as external contributed cash in docs and behavior

`EXCHANGE_FROM`

- system-only source leg of a currency exchange
- created by `exchange`
- stores negative source quantity
- reduces the source cash bucket

`EXCHANGE_TO`

- system-only target leg of a currency exchange
- created by `exchange`
- stores positive target quantity
- increases the target cash bucket

## Price Source Of Truth

- DuckDB cached prices are the read-path source of truth.
- Reporting loads price series through database access before valuation.
- Price lookup uses as-of semantics: use the latest cached value on or before the valuation timestamp.
- If a required asset price or FX rate is missing at `as_of_date`, the read path must fail explicitly.
- No hidden approximation or fallback FX conversion is allowed in reporting.

## Valuation Model

- Base currency is `USD`.
- `build_reporting_snapshot(as_of_date=None, include_closed=True)` is the canonical valuation builder.
- `as_of_date` resolves in this order:
  - explicit requested date
  - latest daily returns date
  - last transaction date
- Snapshot valuation includes:
  - valued cash balances
  - open and optionally closed positions
  - deposits, withdrawals, income, fees, taxes
  - realized gain, unrealized gain, total profit
  - time-weighted return, total return, and CAGR

Cash valuation rules:

- raw cash balances are derived from transactions up to and including `as_of_date`
- USD cash values at par
- non-USD cash buckets require cached FX series at `as_of_date`

Position valuation rules:

- only `BUY` and `SELL` affect share inventory
- open positions require a cached market price at `as_of_date`
- missing price for a held asset is an explicit failure
- GBP and EUR stock prices are converted to USD with cached FX series

## Reporting Snapshot Invariant

The following commands must represent the same portfolio state for the same date:

- `status`
- `cash`
- `summary`
- `allocation`
- `performance`

Required invariant:

- one shared snapshot
- one shared `as_of_date`
- no duplicate valuation logic outside the service snapshot builder

## Return Metric Policy

- TWR is the primary return metric.
- TWR is preferred because deposits and withdrawals are investor decisions, not manager performance.
- `total_invested` remains a backward-compatible alias for net contributed capital.
- CAGR should be derived from TWR-based total return, not naive contribution-distorted growth.

## Open Baseline Decisions

These are intentionally frozen as current truth or flagged for later redesign:

- `TRANSFER` currently behaves as external inflow until account-aware transfers exist.
- write commands still use mixed date formats in parts of the CLI.
- external fetch is a repair/refresh concern and should not silently occur during reporting.
