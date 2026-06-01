# API Response Standardization Plan

## Status: Draft

### Changelog
| Date | Change |
|---|---|
| 2026-02-13 | Initial draft |
| 2026-02-13 | Added pagination for `transactions` and `report`; date range filters; eliminated all plain-text / markdown output |

---

## 1. Context

The portfolio CLI currently outputs responses in inconsistent formats:

- Some commands accept `--format json` or `--format table` flags to toggle output mode
- JSON output is opt-in; plain text / table is the default for most commands
- JSON shape varies per command — no shared envelope, no consistent error structure
- Assessments are mixed into numeric values as tuples `[float, string]`
- Some commands produce no machine-readable output at all (`add`, `delete`, `exchange`, `migrate`, `recalculate`, `verify_prices`)

**Goals:**
1. Every CLI command outputs **pure JSON always** — zero plain text, zero markdown, zero table output
2. All output wrapped in a **standard response envelope**
3. `transactions` and `report` support **pagination** and **date range filtering**

---

## 2. Database Schema (Reference — No Changes Needed)

```
transactions      id, date, asset, action, quantity, asset_type,
                  price, currency, fees, exchange, data_source

prices            date, ticker, price
                  PK: (date, ticker)

daily_returns     date PK, portfolio_value, portfolio_daily_return,
                  investment_return, cash_flow_impact, adjusted_base

refresh_log       refresh_id, refresh_date, refresh_type,
                  rows_affected, timestamp

recalc_cache      cache_key PK, last_calc_date, transaction_count,
                  prices_hash, timestamp
```

Schema is adequate. No schema changes are part of this plan.

---

## 3. Standard Response Envelope

Every command MUST return one of two shapes:

### 3.1 Success

```json
{
  "ok": true,
  "command": "<command-name>",
  "data": <payload>,
  "meta": {
    "generated_at": "<ISO-8601 UTC>",
    "count": <int|null>
  }
}
```

- `ok` — always `true` on success
- `command` — CLI command name (e.g. `"transactions"`, `"performance"`)
- `data` — the actual payload (object or array)
- `meta.generated_at` — UTC timestamp of response generation
- `meta.count` — number of items when `data` is an array, otherwise `null`
- `meta.pagination` — present only on paginated commands (see §5), otherwise omitted

### 3.2 Error

```json
{
  "ok": false,
  "command": "<command-name>",
  "error": {
    "code": "<SCREAMING_SNAKE_CASE>",
    "message": "<human-readable string>"
  },
  "meta": {
    "generated_at": "<ISO-8601 UTC>",
    "count": null
  }
}
```

- `ok` — always `false` on error
- `error.code` — machine-readable error identifier
- `error.message` — human-readable description

### 3.3 Error Codes

| Code | Meaning |
|---|---|
| `NOT_FOUND` | Requested resource does not exist |
| `VALIDATION_ERROR` | Invalid input arguments |
| `DB_ERROR` | Database operation failed |
| `PRICE_FETCH_ERROR` | Could not retrieve market prices |
| `ALREADY_EXISTS` | Duplicate resource |
| `INTERNAL_ERROR` | Unhandled exception |

---

## 4. Metric Value Representation

Currently risk metrics use tuples: `[float, "Good"]`.

Standardized shape — each metric becomes an object:

```json
{
  "value": 1.87,
  "assessment": "Good"
}
```

Applied everywhere: `returns`, `risk_metrics`, `risk_of_loss`, `drawdowns`, `concentration`.

---

## 5. Pagination & Date Filtering

Applies to: **`transactions`** and **`report`** (daily returns).

### 5.1 CLI Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--limit` | int | `50` | Max rows returned per call |
| `--offset` | int | `0` | Number of rows to skip (cursor-style pagination) |
| `--start-date` | `YYYY-MM-DD` | none | Include rows on or after this date |
| `--end-date` | `YYYY-MM-DD` | none | Include rows on or before this date |

Date format for these flags is `YYYY-MM-DD` (ISO 8601), consistent with what the DB stores.
`--start-date` / `--end-date` can be used independently or together.
When no date flags are given, default behaviour returns the **latest 50 rows** (ordered descending by date, then re-ordered ascending in the response).

### 5.2 Pagination Envelope Extension

When a command is paginated the `meta` object gains a `pagination` key:

```json
{
  "ok": true,
  "command": "transactions",
  "data": [ ... ],
  "meta": {
    "generated_at": "2026-02-13T10:00:00Z",
    "count": 50,
    "pagination": {
      "limit": 50,
      "offset": 0,
      "total": 142,
      "has_more": true,
      "next_offset": 50
    }
  }
}
```

| Field | Type | Description |
|---|---|---|
| `limit` | int | Rows requested (`--limit`) |
| `offset` | int | Rows skipped (`--offset`) |
| `total` | int | Total rows matching the current filter (date range or all) |
| `has_more` | bool | `true` when `offset + count < total` |
| `next_offset` | int\|null | Convenience value: `offset + limit`, or `null` when `has_more` is false |

### 5.3 Date Filter Interaction

| `--start-date` | `--end-date` | Behaviour |
|---|---|---|
| — | — | Latest 50 rows across all time |
| set | — | Rows from `start_date` to latest, paginated |
| — | set | Rows up to `end_date`, paginated |
| set | set | Rows within range, paginated |

`total` in `pagination` always reflects the filtered row count, not the full table size.

### 5.4 Usage Examples

```bash
# Last 50 transactions (default)
portfolio transactions

# Page 2 of 50 (rows 51–100)
portfolio transactions --offset 50

# Custom page size
portfolio transactions --limit 10 --offset 20

# Date range only
portfolio transactions --start-date 2024-01-01 --end-date 2024-12-31

# Date range + pagination
portfolio transactions --start-date 2024-01-01 --limit 20 --offset 40

# Daily returns last 50 days (default)
portfolio report

# Returns for a specific month
portfolio report --start-date 2024-11-01 --end-date 2024-11-30
```

---

## 6. Per-Command Payload Specification

### `migrate`
```json
{
  "rows_imported": 142,
  "source": "path/to/file.csv",
  "db": "path/to/portfolio.db"
}
```

### `add`
```json
{
  "transaction": {
    "id": 143,
    "date": "2024-07-14",
    "asset": "BTC-USD",
    "action": "BUY",
    "quantity": 0.5,
    "asset_type": "crypto",
    "price": 62000.0,
    "currency": "USD",
    "fees": 2.5,
    "exchange": "Binance",
    "data_source": "YAHOO"
  },
  "recalculated": true
}
```

### `delete`
```json
{
  "deleted_id": 42,
  "recalculated": true
}
```

### `exchange`
```json
{
  "from": { "asset": "USD", "quantity": 1000.0 },
  "to":   { "asset": "EUR", "quantity": 920.0 },
  "rate": 0.92,
  "date": "2024-07-14",
  "transaction_ids": [144, 145]
}
```

### `recalculate`
```json
{
  "rows_affected": 365,
  "from_date": "2024-01-01",
  "forced": false
}
```

### `verify_prices`
```json
{
  "total_rows": 5400,
  "unique_tickers": 18,
  "date_range": { "start": "2024-01-01", "end": "2025-01-01" },
  "issues": []
}
```

### `transactions`

Flags: `--limit` (default `50`), `--offset` (default `0`), `--start-date`, `--end-date`

```json
[
  {
    "id": 1,
    "date": "2024-07-14",
    "asset": "XCH-USD",
    "action": "BUY",
    "quantity": 13.05,
    "asset_type": "crypto",
    "price": 19.61,
    "currency": "USD",
    "fees": 0.0,
    "exchange": "Add Note",
    "data_source": "YAHOO"
  }
]
```

`meta.count` = rows returned in this page.
`meta.pagination` = pagination object (see §5.2).
Rows ordered **ascending by date** within the page.

### `report` (daily returns)

Flags: `--limit` (default `50`), `--offset` (default `0`), `--start-date`, `--end-date`

```json
[
  {
    "date": "2024-07-14",
    "portfolio_value": 52430.10,
    "portfolio_daily_return": 0.82,
    "investment_return": 0.95,
    "cash_flow_impact": -200.0,
    "adjusted_base": 51800.0
  }
]
```

`meta.count` = rows returned in this page.
`meta.pagination` = pagination object (see §5.2).
Rows ordered **ascending by date** within the page.

### `status`
```json
{
  "transactions": 124,
  "start_date": "2024-07-14",
  "end_date": "2026-02-16",
  "portfolio_value": 54320.80,
  "total_invested": 48000.00,
  "deposits": 50000.00,
  "withdrawals": 2000.00,
  "total_gain": 6320.80,
  "total_gain_pct": 13.17,
  "as_of_date": "2026-02-16"
}
```

`status.as_of_date` is the canonical reporting snapshot date. It must match `performance.period.end_date`, `allocation.as_of_date`, `summary.meta.as_of_date`, and `cash.meta.as_of_date`.

### `performance`
```json
{
  "period": {
    "start_date": "2024-07-14",
    "end_date": "2026-02-16",
    "total_days": 583
  },
  "values": {
    "start_value": 20000.0,
    "end_value": 54320.80,
    "total_gain": 34320.80,
    "net_gain": 31820.80,
    "deposits": 50000.0,
    "withdrawals": 2000.0,
    "net_contributions": 48000.0,
    "realized_gain": 25000.0,
    "unrealized_gain": 6820.8
  },
  "returns": {
    "time_weighted_return_pct": { "value": 171.6,  "assessment": "Excellent" },
    "total_return_pct":      { "value": 171.6,  "assessment": "Excellent" },
    "cagr_pct":              { "value": 89.4,   "assessment": "Excellent" },
    "avg_daily_return_pct":  { "value": 0.24,   "assessment": "Good" },
    "avg_monthly_return_pct":{ "value": 7.2,    "assessment": "Good" }
  },
  "risk_metrics": {
    "std_dev_pct":           { "value": 1.82,   "assessment": "Low" },
    "hist_volatility_pct":   { "value": 29.1,   "assessment": "High" },
    "beta":                  { "value": 1.12,   "assessment": "Average" },
    "sharpe_ratio":          { "value": 1.87,   "assessment": "Good" },
    "sortino_ratio":         { "value": 2.43,   "assessment": "Excellent" },
    "treynor_ratio":         { "value": 0.15,   "assessment": "Good" },
    "information_ratio":     { "value": 0.92,   "assessment": "Good" },
    "jensens_alpha":         { "value": 0.05,   "assessment": "Good" },
    "relative_return":       { "value": 12.4,   "assessment": "Good" },
    "tracking_error":        { "value": 3.1,    "assessment": "Average" }
  },
  "risk_of_loss": {
    "var_95_pct":            { "value": -2.1,   "assessment": "Moderate" },
    "var_99_pct":            { "value": -3.8,   "assessment": "High" },
    "cvar_95_pct":           { "value": -3.2,   "assessment": "Moderate" },
    "cvar_99_pct":           { "value": -5.1,   "assessment": "High" }
  },
  "drawdowns": {
    "max_drawdown_pct":             { "value": -18.4, "assessment": "Poor" },
    "avg_drawdown_pct":             { "value": -5.2,  "assessment": "Average" },
    "avg_drawdown_duration_days":   { "value": 12.0,  "assessment": "Average" }
  },
  "concentration": {
    "hhi":                      { "value": 0.18,  "assessment": "Moderate" },
    "weighted_avg_exposure":    { "value": 22.5,  "assessment": "Average" },
    "num_positions": 9
  }
}
```

`total_return_pct` is a backward-compatible alias of `time_weighted_return_pct`.
`total_invested` is a backward-compatible alias of `net_contributions` on the service layer.

### `summary`
```json
[
  {
    "symbol": "BTC-USD",
    "status": "OPEN",
    "shares": 0.5,
    "last_price": 62000.0,
    "avg_cost_per_share": 58000.0,
    "total_cost": 29000.0,
    "market_value": 31000.0,
    "dividend_income": 0.0,
    "day_gain_pct": 1.2,
    "day_gain_value": 372.0,
    "total_gain_pct": 6.9,
    "total_gain_value": 2000.0,
    "realized_gain_value": 0.0,
    "realized_gain_pct": 0.0
  },
  {
    "symbol": "USD",
    "status": "OPEN",
    "shares": 2100.0,
    "last_price": 1.0,
    "avg_cost_per_share": 0.0,
    "total_cost": 0.0,
    "market_value": 2100.0,
    "dividend_income": 0.0,
    "day_gain_pct": 0.0,
    "day_gain_value": 0.0,
    "total_gain_pct": 0.0,
    "total_gain_value": 0.0,
    "realized_gain_value": 0.0,
    "realized_gain_pct": 0.0
  }
]
```
`meta.count` = number of positions.
`meta.as_of_date` = reporting snapshot date used for all valuation in this response.

### `allocation`
```json
{
  "as_of_date": "2026-02-16",
  "positions": [
    {
      "symbol": "BTC-USD",
      "type": "asset",
      "value": 31000.0,
      "percentage": 57.1
    },
    {
      "symbol": "EURUSD=X",
      "type": "cash",
      "value": 2220.8,
      "percentage": 4.1,
      "original_currency_value": 1200.0,
      "fx_rate": 1.851
    }
  ],
  "summary": [
    { "symbol": "TOTAL ASSETS",     "type": "summary", "value": 50000.0, "percentage": 92.1 },
    { "symbol": "TOTAL CASH",       "type": "summary", "value": 4320.8,  "percentage": 7.9 },
    { "symbol": "TOTAL PORTFOLIO",  "type": "summary", "value": 54320.8, "percentage": 100.0 }
  ],
  "total_value": 54320.8
}
```

`allocation.total_value` must equal `performance.values.end_value` for the same `as_of_date`.

### `cash`
```json
[
  {
    "currency": "USD",
    "balance": 2100.0,
    "usd_value": 2100.0,
    "fx_rate": 1.0,
    "deposits": 5000.0,
    "withdrawals": 500.0,
    "spent": 2200.0,
    "received": 0.0
  },
  {
    "currency": "EUR",
    "balance": 1200.0,
    "usd_value": 2220.8,
    "fx_rate": 1.851,
    "deposits": 1500.0,
    "withdrawals": 0.0,
    "spent": 300.0,
    "received": 0.0
  }
]
```
`meta.count` = number of currencies.
`meta.as_of_date` = reporting snapshot date used for FX valuation.
If FX data is unavailable for the snapshot date, the command should return an error instead of defaulting a rate.

---

## 6. Breaking Changes & Migration

| Command | Current behaviour | After |
|---|---|---|
| `transactions` | `--format json` needed; no pagination | JSON always; `--limit`, `--offset`, `--start-date`, `--end-date`; default last 50 rows |
| `report` | `--format json` needed; no pagination | JSON always; `--limit`, `--offset`, `--start-date`, `--end-date`; default last 50 rows |
| `performance` | JSON by default but with `--table`/`--md` flags | JSON always; remove `--table` / `--md` |
| `summary` | table by default | JSON always |
| `allocation` | table by default | JSON always |
| `cash` | table by default | JSON always |
| `status` | plain text | JSON always |
| `add` | plain text confirmation | JSON always |
| `delete` | plain text confirmation | JSON always |
| `exchange` | plain text confirmation | JSON always |
| `migrate` | plain text summary | JSON always |
| `recalculate` | plain text summary | JSON always |
| `verify_prices` | plain text table | JSON always |

**Flags to remove:** `--format`, `--table`, `--md`, `--export` (CSV export is a separate concern, out of scope here).
**Flags to add on `transactions` and `report`:** `--limit`, `--offset`, `--start-date`, `--end-date`.

---

## 7. Implementation Plan

### Phase 1 — Shared envelope utility
- Create `portfolio_db/response.py`
  - `success(command, data, count=None) -> str` — returns JSON string
  - `error(command, code, message) -> str` — returns JSON string
  - Helper: `now_utc() -> str` for `meta.generated_at`

### Phase 2 — Metric value refactor
- Update `evaluate_metric` in `portfolio_service.py` to return `{"value": float, "assessment": str}` dicts
- Update `get_performance_stats()` to use new metric shape throughout

### Phase 3 — Command-by-command migration (in `cli.py`)
Wrap each command output with `success()` / `error()`:

1. `migrate`
2. `add`
3. `delete`
4. `exchange`
5. `recalculate`
6. `verify_prices`
7. `transactions` — remove `--format`; add `--limit` (50), `--offset` (0), `--start-date`, `--end-date`; emit `meta.pagination`
8. `report` — remove `--format`; add `--limit` (50), `--offset` (0), `--start-date`, `--end-date`; emit `meta.pagination`
9. `status`
10. `performance` — remove `--table` / `--md` flags
11. `summary`
12. `allocation`
13. `cash`

### Phase 3a — Service layer pagination support
- Update `get_transactions(limit, offset, start_date, end_date)` in `portfolio_service.py`
  - Add `LIMIT / OFFSET` to the DuckDB query
  - Run a separate `COUNT(*)` query (same filter, no limit) for `pagination.total`
- Update `get_daily_returns(limit, offset, start_date, end_date)` in `portfolio_service.py`
  - Same pattern: filtered query + count query
- Both queries order by `date DESC` for the fetch (latest first), then reverse before returning so the response is ascending by date within each page

### Phase 4 — Error handling
- Wrap all command bodies in try/except
- Catch known exceptions, map to error codes, emit `error()` envelope
- Always exit with code `1` on error

### Phase 5 — Tests
- Update `tests/test_calculator.py` if any assertions check old output format
- Add `tests/test_response_envelope.py` to verify envelope structure for each command

---

## 8. File Changes Summary

| File | Change |
|---|---|
| `portfolio_db/response.py` | **CREATE** — envelope helpers |
| `portfolio_db/portfolio_service.py` | Update `evaluate_metric`, `get_performance_stats`; add pagination params to `get_transactions`, `get_daily_returns` |
| `portfolio_db/cli.py` | Rewrite output logic for all 13 commands; remove format flags |
| `tests/test_response_envelope.py` | **CREATE** — envelope tests |
| `tests/test_calculator.py` | Update if assertions on old output format exist |

---

## 9. Out of Scope

- CSV export (`--export`) — separate concern, leave as-is
- HTTP/REST API layer — not requested
- Authentication / rate limiting
- Pagination on commands other than `transactions` and `report`
- Schema migrations

---

*Plan saved. Awaiting approval before any code changes.*
