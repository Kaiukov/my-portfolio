# API Contract

Canonical source:

- `/Users/oleksandrkaiukov/Code/my-portfolio/.agents/skills/my-portfolio-cli/references/api-contract.md`

Key contract rules:

- Every command returns pure JSON.
- Success envelope:
  - `ok`
  - `command`
  - `data`
  - `meta`
- Error envelope:
  - `ok: false`
  - `command`
  - `error.code`
  - `error.message`
  - `meta`
- Date formats:
  - read filters use `YYYY-MM-DD`
  - some write commands still accept legacy `DD-MM-YYYY`
  - production target is one date format everywhere, but current callers must preserve implemented behavior until changed intentionally
- `transactions` and `report` support pagination and date filters.
- Reporting commands should stay machine-readable and consistent across the app.

Reporting consistency rules:

- `status`, `cash`, `summary`, `allocation`, and `performance` must agree on one reporting snapshot.
- One `as_of_date` per response path.
- `allocation.total_value` must match `performance.values.end_value` for the same snapshot.
- No silent FX fallback. Missing required price/FX data must surface as an explicit error.

Current reporting source-of-truth rules:

- `PortfolioService.build_reporting_snapshot()` is the canonical read-path snapshot builder.
- `status`, `cash`, `summary`, `allocation`, and `performance` must derive from one snapshot and one `as_of_date`.
- `as_of_date` resolves in this order:
  - explicit caller-supplied date
  - latest daily return date
  - last transaction date

Required command coverage for the stable contract:

- read/reporting:
  - `status`
  - `cash`
  - `summary`
  - `allocation`
  - `performance`
  - `transactions`
  - `report`
- write/repair:
  - `migrate`
  - `add`
  - `edit`
  - `delete`
  - `exchange`
  - `recalculate`
  - `verify_prices`
  - `repair_prices`

Current command set to keep in sync with docs:

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
