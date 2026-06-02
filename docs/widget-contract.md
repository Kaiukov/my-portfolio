# Widget JSON Contract

Stable, compact, read-only JSON shape for embedding portfolio status in dashboards.

## JSON Shape

```json
{
  "title": "Portfolio",
  "currency": "USD",
  "as_of_date": "2026-05-30",
  "last_refresh": "2026-05-30",
  "value": 19257.13,
  "today": {
    "amount": 125.50,
    "pct": 0.65
  },
  "total": {
    "amount": 4257.13,
    "pct": 28.3
  },
  "series": [
    { "date": "2026-05-01", "value": 19000.00 },
    { "date": "2026-05-02", "value": 19050.00 }
  ]
}
```

## Fields

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| `title` | `string` | Static | Always `"Portfolio"` |
| `currency` | `string` | Static | Always `"USD"` |
| `as_of_date` | `string` | `portfolio_status_sql()` | Evaluation date (ISO YYYY-MM-DD) |
| `last_refresh` | `string` | Most recent `daily_returns.date` | When the portfolio was last recalculated |
| `value` | `number` | `portfolio_status_sql().portfolio_value` | Current portfolio value (same as `status`) |
| `today.amount` | `number` | `daily_returns` delta | Latest day's portfolio value change in USD |
| `today.pct` | `number` | `daily_returns.investment_return` | Latest day's market-driven return % (excludes cash flows) |
| `total.amount` | `number` | `portfolio_status_sql().total_gain` | Total gain since inception (same as `status`) |
| `total.pct` | `number` | `portfolio_status_sql().total_gain_pct` | Total gain % (same as `status`) |
| `series[].date` | `string` | `daily_returns.date` | ISO date for each data point |
| `series[].value` | `number` | `daily_returns.portfolio_value` | Portfolio value on that date |

## Invariants

1. `widget.value == status.portfolio_value` on the same `as_of_date` (consistency invariant)
2. `widget.total.amount == status.total_gain` and `widget.total.pct == status.total_gain_pct`
3. No SQL/Bun SQL imports in the adapter layer — TypeScript only formats output
4. No DB credentials or secrets in the JSON output
5. Pure JSON, follows the existing envelope convention (`success()`/`error()` from `response.ts`)

## Command

```
portfolio-ts widget [--days N] [--as-of-date YYYY-MM-DD]
```

- `--days` (default: 30): number of historical data points in `series`
- `--as-of-date` (default: today): evaluation date
- Read-only; never triggers network calls, price fetches, or mutations

## Out of scope (follow-up)

- Hosting/cron scheduling
- Auth tokens / API keys
- Widget auto-refresh logic
- Embedding (iframe/script tag)
