# API Contract

Use the project doc as canonical source:

- `/Users/oleksandrkaiukov/Code/my-portfolio/docs/api-response-standardization-plan.md`

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
- `transactions` and `report` support pagination and date filters.
- Reporting commands should stay machine-readable and consistent across the app.

Reporting consistency rules:

- `status`, `cash`, `summary`, `allocation`, and `performance` must agree on one reporting snapshot.
- One `as_of_date` per response path.
- `allocation.total_value` must match `performance.values.end_value` for the same snapshot.
- No silent FX fallback. Missing required price/FX data must surface as an explicit error.

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
