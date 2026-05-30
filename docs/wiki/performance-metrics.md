# Performance Metrics

All performance metrics are computed by PostgreSQL. TypeScript only formats the JSON output.

**Source:** `portfolio_performance_sql(as_of_date DATE, benchmark TEXT, from_date DATE)` in `functions.sql`.

---

## Return Metrics

### Time-Weighted Return (TWR)

- **Field:** `time_weighted_return_pct` (also emitted as `total_return_pct` — they are identical)
- **Includes cash flows?** No — uses `investment_return` (cash-flow-independent daily returns)
- **Base currency:** USD
- **Calculation:** Chain-linked daily returns: `∏(1 + r_i) − 1` where `r_i` is the investment return for day `i`

TWR measures the compound growth rate of the portfolio, eliminating the distorting effect of deposit/withdrawal timing.

### Money-Weighted Return (MWR / XIRR)

See the `mwr` command in [cli-reference.md](cli-reference.md). MWR is computed separately via `portfolio_mwr_sql()` and accounts for the actual timing of cash flows.

### Total Gain

- **Field:** `total_gain` (USD)
- **Includes cash flows?** No — this is the investment return (cash-flow-independent)
- **Reconciliation:** `total_gain` is the same value used to derive `time_weighted_return_pct`. It represents the dollar gain attributable to investment performance only, not the portfolio dollar gain shown in `status` (which includes net cash flows).

### CAGR

- **Field:** `cagr`
- **Formula:** `(1 + TWR)^(1/years) − 1`

---

## Monthly Return Metrics

### Median Monthly Return

- **Field:** `median_monthly_return`
- **Computation:** True median via `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY monthly_return)` in PostgreSQL
- **Input:** Monthly returns derived from `investment_return` (cash-flow-independent daily returns)
- **Why median?** The median is robust to outliers (unlike the mean). It represents the "typical" monthly return.

Do not reintroduce `avg_monthly_return` in emitted JSON. Public output uses `median_monthly_return` only.

---

## Risk Metrics

| Metric | Field | Description |
|---|---|---|
| Standard Deviation | `std_dev` | Daily return std dev (investment returns) |
| Historical Volatility | `hist_volatility` | `std_dev × √252` |
| Value at Risk 95% | `var_95` | 5th percentile of daily returns |
| Value at Risk 99% | `var_99` | 1st percentile of daily returns |
| Conditional VaR 95% | `cvar_95` | Expected shortfall below VaR 95% |
| Conditional VaR 99% | `cvar_99` | Expected shortfall below VaR 99% |
| Max Drawdown | `max_drawdown` | Largest peak-to-trough decline (%) |
| Avg Drawdown | `avg_drawdown` | Average drawdown over the period (%) |
| Avg Drawdown Duration | `avg_drawdown_duration` | Average days spent in a drawdown |

Risk metrics use `investment_return` (cash-flow-independent), not `portfolio_daily_return`.

---

## Benchmark-Relative Metrics

Benchmark defaults to `SPY` (or `PORTFOLIO_BENCHMARK_TICKERS` env var).

| Metric | Field | Description |
|---|---|---|
| Benchmark TWR | `spy_twr_pct` | Benchmark time-weighted return (%) |
| Benchmark CAGR | `spy_cagr_pct` | Benchmark CAGR (%) |
| Beta | `beta` | Covariance(portfolio, benchmark) / Variance(benchmark) |
| Jensen's Alpha | `jensens_alpha` | Portfolio return − CAPM expected return |
| Information Ratio | `information_ratio` | Active return ÷ tracking error |
| Tracking Error | `tracking_error` | Std dev of excess returns vs benchmark |
| Relative Return | `relative_return` | TWR − benchmark TWR (percentage points) |
| Up Capture Ratio | `up_capture_ratio` | Portfolio return ÷ benchmark return on up days |
| Down Capture Ratio | `down_capture_ratio` | Portfolio return ÷ benchmark return on down days |

Benchmark-relative metrics are joined on `date`, not aligned by array position.

---

## Date Alignment

- All daily returns are aligned on calendar dates
- Benchmark returns are fetched for the same date range
- Missing benchmark dates (non-trading days) are handled by PostgreSQL
