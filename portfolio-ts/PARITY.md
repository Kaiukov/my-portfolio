# Parity

| Python command | TypeScript command | Status | Notes |
|---|---|---|---|
| `portfolio status` | `portfolio-ts status` | partial | Initial JSON shape implemented. Missing complex performance stats (requires daily_returns + price data); uses simple transaction aggregation instead. `total_gain_pct` is computed as `(portfolio_value - total_invested) / total_invested * 100` — Python uses TWR from performance_stats SQL. |
| `portfolio transactions` | `portfolio-ts transactions` | partial | Read-only output matches column schema and pagination. Does not implement `add`/`edit`/`delete`/`exchange`. |
| `portfolio add` | — | not started | Next command to port. |
| `portfolio edit` | — | not started | |
| `portfolio delete` | — | not started | |
| `portfolio exchange` | — | not started | |
| `portfolio report` | — | not started | |
| `portfolio allocation` | — | not started | |
| `portfolio cash` | — | not started | |
| `portfolio summary` | — | not started | |
| `portfolio performance` | — | not started | |
| `portfolio mwr` | — | not started | |
| `portfolio verify_prices` | — | not started | |
| `portfolio repair_prices` | — | not started | |
| `portfolio recalculate` | — | not started | |
| `portfolio backup` | — | not started | |
| `portfolio init` | — | not started | |
| `portfolio health` | — | not started | |
| `portfolio migrate` | — | not started | |
| `portfolio migrate-duckdb-to-postgres` | — | not started | |

## Known differences

- **Portfolio value**: TypeScript reads `portfolio_value` from the latest `daily_returns` row. Python computes it via a complex CTE that joins `daily_returns` with `prices` for benchmark/comparison data.
- **Total invested**: TypeScript uses `DEPOSIT - WITHDRAW` from transaction quantities. Python uses `net_contributions` from cash flow analysis (includes FX conversion).
- **Income**: TypeScript sums `DIVIDEND + INTEREST` quantities. Python computes from cash flow metrics with FX conversion.
- **Fees/Taxes**: TypeScript reads raw quantities from `FEE`/`TAX` transactions. Python includes both standalone fees and trade fees via cash flow analysis.
- **Date format**: Both use `YYYY-MM-DD` for read commands (consistent with Python CLI contract).

## Next command to port

`portfolio-ts add` — basic transaction insertion without recalculation logic.
