# Issue #226 Performance / Financial Correctness Audit

Fixture: `portfolio-ts/tests/fixtures/audit_portfolio.sql`  
Independent reference: `scripts/audit/reference.py`  
Expected values: `scripts/audit/expected.json`  
Range: `2024-01-02` through `2026-01-05`; benchmark `SPY`; USD-only; risk-free rate `2.0%`; inflation `2.5%`.

## Metric Checklist

| Metric | SQL source | Return basis | Cash-flow incl? | Fee/tax incl? | USD base? | Benchmark alignment | Annualization | EXPECTED | ACTUAL | Pass/Fail |
|---|---|---|---|---|---|---|---|---:|---|---|
| daily_returns.count | procedures.sql:44-45 | calendar daily rows | Yes | Yes | Yes | N/A | N/A | 735 |  |  |
| portfolio_daily_return | procedures.sql:73-80 | `portfolio_daily_return` | Yes | Yes | Yes | N/A | N/A | checkpoints in expected.json |  |  |
| investment_return | procedures.sql:73-80 | `investment_return` | No external flows | Yes | Yes | N/A | N/A | checkpoints in expected.json |  |  |
| total_days | functions.sql:1350 | N/A | N/A | N/A | Yes | N/A | N/A | 735 |  |  |
| start_date | functions.sql:1351 | N/A | N/A | N/A | Yes | N/A | N/A | 2024-01-02 |  |  |
| end_date | functions.sql:1352 | N/A | N/A | N/A | Yes | N/A | N/A | 2026-01-05 |  |  |
| start_value | functions.sql:1353 | portfolio value | Yes | Yes | Yes | N/A | N/A | 9985.0 |  |  |
| end_value | functions.sql:1354 | portfolio value | Yes | Yes | Yes | N/A | N/A | 16495.0 |  |  |
| total_gain | functions.sql:1550 | TWR | No | Yes | Yes | N/A | N/A | 2151.8074129888 |  |  |
| avg_daily_return | functions.sql:1355,1551 | `portfolio_daily_return` | Yes | Yes | Yes | N/A | N/A | 0.0802986485 |  |  |
| avg_investment_return | functions.sql:1356,1552 | `investment_return` | No | Yes | Yes | N/A | N/A | 0.030274452 |  |  |
| std_dev | functions.sql:1357,1553 | `investment_return` | No | Yes | Yes | N/A | population daily pct | 0.8448967482 |  |  |
| hist_volatility | functions.sql:1554 | `investment_return` | No | Yes | Yes | N/A | `std_dev * sqrt(252)` | 13.4123200758 |  |  |
| var_95 | functions.sql:1358,1555 | `investment_return` | No | Yes | Yes | N/A | N/A | 0.0 |  |  |
| var_99 | functions.sql:1359,1556 | `investment_return` | No | Yes | Yes | N/A | N/A | 0.0 |  |  |
| cvar_95 | functions.sql:1363-1370,1557 | `investment_return` | No | Yes | Yes | N/A | N/A | -0.0227506425 |  |  |
| cvar_99 | functions.sql:1363-1370,1558 | `investment_return` | No | Yes | Yes | N/A | N/A | -0.0227506425 |  |  |
| max_drawdown | functions.sql:1387-1426,1559 | portfolio value | Yes | Yes | Yes | N/A | N/A | 16.5397170838 |  |  |
| avg_drawdown | functions.sql:1387-1426,1560 | portfolio value | Yes | Yes | Yes | N/A | N/A | 9.4454642633 |  |  |
| avg_drawdown_duration | functions.sql:1406-1425,1561 | portfolio value | Yes | Yes | Yes | N/A | calendar rows | 181.0 |  |  |
| time_weighted_return_pct | functions.sql:1360,1562 | `investment_return` | No | Yes | Yes | N/A | geometric link | 21.5503997295 |  |  |
| total_return_pct | functions.sql:1563-1566 | start/end value | Yes | Yes | Yes | N/A | N/A | 65.197796695 |  |  |
| median_monthly_return | functions.sql:1428-1439,1567 | `investment_return` | No | Yes | Yes | N/A | monthly geometric, median | 0.0 |  |  |
| cagr | functions.sql:1568-1574 | TWR | No | Yes | Yes | N/A | 365.25 days/year | 10.1986108363 |  |  |
| beta | functions.sql:1473-1491,1575-1578 | `investment_return` | No | Yes | Yes | join on date | population covariance / variance | 1.1449134917 |  |  |
| sharpe_ratio | functions.sql:1579-1584 | TWR annual return | No | Yes | Yes | N/A | CAGR excess / annual vol | 0.6112746184 |  |  |
| sortino_ratio | functions.sql:1374-1385,1585-1590 | `investment_return` | No | Yes | Yes | N/A | daily excess/downside * sqrt(252) | 0.5777473923 |  |  |
| treynor_ratio | functions.sql:1591-1596 | TWR annual return | No | Yes | Yes | join on date through beta | CAGR excess / beta | 0.0716089984 |  |  |
| information_ratio | functions.sql:1492-1493,1597-1602 | active `investment_return` | No | Yes | Yes | join on date | annualized active mean / tracking error | -3.5365247628 |  |  |
| jensens_alpha | functions.sql:1603-1615 | TWR annual return | No | Yes | Yes | join on date through beta | 365.25-year CAGR CAPM alpha | -5.4788047056 |  |  |
| relative_return | functions.sql:1616-1627 | TWR annual return | No | Yes | Yes | benchmark price series | 365.25-year CAGR spread | -3.7476328241 |  |  |
| tracking_error | functions.sql:1492-1493,1628 | active `investment_return` | No | Yes | Yes | join on date | daily active pct * sqrt(252) | 46.7510829903 |  |  |
| spy_twr_pct | functions.sql:1463-1471,1629-1633 | benchmark prices | N/A | N/A | Yes | benchmark date series | price total return | 30.0 |  |  |
| spy_cagr_pct | functions.sql:1634-1641 | benchmark prices | N/A | N/A | Yes | benchmark date series | 365.25 days/year | 13.9462436605 |  |  |
| up_capture_ratio | functions.sql:1494-1495,1642-1645 | `investment_return` | No | Yes | Yes | join on date | N/A | 0.9585223472 |  |  |
| down_capture_ratio | functions.sql:1496-1497,1646-1649 | `investment_return` | No | Yes | Yes | join on date | N/A | 1.3807629162 |  |  |
| calmar_ratio | functions.sql:1688-1691 | CAGR / drawdown | No | Yes | Yes | N/A | 365.25 CAGR | 0.6166133789 |  |  |
| real_cagr | functions.sql:1692 | CAGR | No | Yes | Yes | N/A | inflation-adjusted CAGR | 7.5108398403 |  |  |
| real_total_return_pct | functions.sql:1693-1697 | total return | Yes | Yes | Yes | N/A | inflation-adjusted over elapsed years | 57.2004405087 |  |  |
| MWR/XIRR | functions.sql:1705-1857,1870-1914 | cash-flow IRR | Yes | terminal value includes fees/taxes | Yes | N/A | 365.0 days/year | 0.0965084319 |  |  |
| deposits | functions.sql:689-690 | transaction flow | Yes | N/A | Yes | N/A | N/A | 15000.0 |  |  |
| withdrawals | functions.sql:691-692 | transaction flow | Yes | N/A | Yes | N/A | N/A | 1000.0 |  |  |
| income | functions.sql:693-694 | dividend/interest flow | No external flow | N/A | Yes | N/A | N/A | 120.0 |  |  |
| fees | functions.sql:695-703 | fee flow | No external flow | Yes | Yes | N/A | N/A | 75.0 |  |  |
| taxes | functions.sql:704-705 | tax flow | No external flow | Yes | Yes | N/A | N/A | 0.0 |  |  |
| cost_basis | functions.sql:589-650 | FIFO lots | N/A | BUY fees included | Yes | N/A | N/A | 5815.0 |  |  |
| realized_gain | functions.sql:596-613,2160-2190 | FIFO lots | N/A | BUY/SELL fees included | Yes | N/A | N/A | 590.0 |  |  |
| unrealized_gain | functions.sql:631-650 | FIFO lots | N/A | BUY fees included | Yes | N/A | N/A | 1835.0 |  |  |
| total_profit | functions.sql:645-650 | realized + unrealized | N/A | BUY/SELL fees included | Yes | N/A | N/A | 2425.0 |  |  |

## Smell Analysis

### `hist_volatility`

SQL expression: `COALESCE(d.std_dev_val, 0.0) * SQRT(252.0)` at `functions.sql:1554`.

Textbook formula: annualized volatility equals the standard deviation of periodic returns multiplied by the square root of periods per year. The SQL uses population standard deviation of daily percentage `investment_return` and annualizes with 252 trading days.

Finding: MATCHES a conventional trading-day methodology. Caveat: `refresh_daily_returns_sql()` emits calendar-day rows, so the 252-day factor is a methodology choice that treats the series as trading-day risk despite weekend/holiday zero rows. I did not change it because the project already documents risk annualization with 252-day volatility semantics.

### `sharpe_ratio`

SQL expression: annualized TWR/CAGR excess return divided by annualized volatility at `functions.sql:1579-1584`.

Textbook formula: `(portfolio annual return - risk-free annual rate) / annualized volatility`. The annual return may be arithmetic annualized mean or geometric CAGR depending on reporting policy.

Finding: MATCHES the documented CAGR-based method, with a methodology choice. It is not the arithmetic-mean Sharpe variant, but it is internally consistent with the function's TWR/CAGR reporting surface and uses `investment_return` volatility.

### `sortino_ratio`

SQL expression: `((avg_investment_return - target_daily) / downside_deviation_daily) * SQRT(252.0)` at `functions.sql:1585-1590`.

Textbook formula: annualized excess return over target divided by annualized downside deviation, using only downside observations.

Finding: MATCHES the daily-return Sortino form. It annualizes daily excess and daily downside deviation by the same 252-day convention. It intentionally uses arithmetic average daily `investment_return`, not CAGR; I treated that as a standard Sortino methodology rather than a bug.

### `jensens_alpha`

SQL expression: portfolio CAGR minus `[risk-free + beta * (benchmark CAGR - risk-free)]`, multiplied by 100 at `functions.sql:1603-1615`.

Textbook formula: `alpha = R_p - (R_f + beta * (R_m - R_f))`.

Finding: MATCHES CAPM alpha using annualized geometric portfolio and benchmark returns. Beta is computed from date-joined daily `investment_return` and benchmark returns, so benchmark alignment is not array-position based.

## Confirmations

`total_return_pct` #5 fix is present and correct: current SQL computes `((end_value - start_value) / start_value) * 100.0` at `functions.sql:1563-1566`, while TWR remains geometric-linked `investment_return` at `functions.sql:1360,1562`. In the audit fixture, `total_return_pct = 65.197796695` and `time_weighted_return_pct = 21.5503997295`, proving they are no longer aliases.

Benchmark alignment is join-on-date for beta, tracking error, information ratio, and capture ratios through `INNER JOIN bench_returns b USING (date)` at `functions.sql:1473-1479`. No array-index benchmark alignment was found in `portfolio_performance_sql`.

## Bug Fixes Applied

1. `portfolio_realized_gains_sql(p_from_date, p_to_date, p_asset)` previously filtered all BUY/SELL/SPLIT rows by `p_from_date`, which discarded pre-period FIFO lots needed to price in-period SELL rows. The function now processes all lots through `p_to_date` and applies `p_from_date` only when emitting realized-gain rows. This is covered by `portfolio-ts/tests/audit_performance.integration.test.ts`.
