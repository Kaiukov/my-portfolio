# Performance Metrics

## Commands

- `portfolio performance` — Full return/risk report
- `portfolio mwr` — Money-weighted return (XIRR)

## Return Metrics

All returns use `investment_return` (excludes cash flows from external movements). Base currency is USD.

- **Total Return**: Cumulative return over the full period
- **CAGR**: Compound annual growth rate
- **Annualized Return**: Average annual return
- **Median Monthly Return**: Used instead of average monthly return

## Period Filtering

```
--period [1y|6m|3m|ytd]     Predefined period
--from-date YYYY-MM-DD       Custom start date
```

Period resolution: ytd = Jan 1, 1y = one year back, 6m/3m loop months backward.

## Benchmark

```
--benchmark TICKER     Default: SPY (or PORTFOLIO_BENCHMARK_TICKERS env var)
```

Benchmark metrics are joined on date, not array position.

## Risk Metrics

- Volatility (annualized), Sharpe ratio, max drawdown
- Alpha, beta, correlation with benchmark
