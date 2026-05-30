# CLI Reference

All commands emit JSON envelopes: `{"ok": true, "command": "...", "data": ..., "meta": {...}}` on success; `{"ok": false, ..., "error": {"code": "...", "message": "..."}}` on failure.

Dates: ISO `YYYY-MM-DD` (primary). Legacy `DD-MM-YYYY` still accepted on write commands with a deprecation warning.

---

## `status`

Current portfolio status snapshot.

```
portfolio-ts status
```

**Output fields:**

| Field | Type | Description |
|---|---|---|
| `transactions` | number | Total transaction count |
| `portfolio_value` | number \| null | Current portfolio market value (USD) |
| `total_invested` | number \| null | Net cash contributed (deposits − withdrawals) |
| `deposits` | number | Total external deposits |
| `withdrawals` | number | Total external withdrawals |
| `income` | number | Total DIVIDEND + INTEREST income |
| `fees` | number | Total fees paid |
| `taxes` | number | Total taxes paid |
| `total_gain` | number \| null | portfolio_value − total_invested |
| `total_gain_pct` | number \| null | total_gain / total_invested × 100 |
| `cost_basis` | number \| null | Aggregate cost basis of current holdings (FIFO) |
| `realized_gain` | number \| null | Cumulative realized gains from closed positions (FIFO) |
| `unrealized_gain` | number \| null | Current holdings market value − cost_basis |
| `total_profit` | number \| null | realized_gain + unrealized_gain |
| `as_of_date` | string \| null | Date of the snapshot |

**FIFO cost basis** (landed in #66): `cost_basis`, `realized_gain`, `unrealized_gain`, and `total_profit` are computed via first-in-first-out tracking in PostgreSQL. Each SELL matches against the oldest BUY lots first. Realized gains are locked in at SELL time; unrealized gains reflect current prices vs remaining lot cost bases.

---

## `performance`

Time-weighted return, risk metrics, and benchmark comparison.

```
portfolio-ts performance [--as-of-date YYYY-MM-DD] [--benchmark TICKER]
                        [--from-date YYYY-MM-DD] [--period ytd|1y|6m|3m]
```

**Flags:**

| Flag | Default | Description |
|---|---|---|
| `--as-of-date` | today | Reporting date |
| `--benchmark` | `PORTFOLIO_BENCHMARK_TICKERS` env or SPY | Benchmark ticker for beta/alpha/relative metrics |
| `--from-date` | portfolio start | Override start date |
| `--period` | — | Shorthand: `ytd`, `1y`, `6m`, `3m` (overrides `--from-date`) |

**Output includes:**

| Field | Description |
|---|---|
| `total_gain` | Investment return (USD) — excludes external cash flows; reconciled with TWR |
| `time_weighted_return_pct` | TWR as percentage (same as `total_return_pct`) |
| `median_monthly_return` | True median of monthly investment returns via `PERCENTILE_CONT` |
| `cagr` | Compound annual growth rate |
| `sharpe_ratio` | Risk-adjusted return (risk-free = 0) |
| `sortino_ratio` | Downside-risk-adjusted return |
| `max_drawdown` | Maximum peak-to-trough decline (%) |
| `beta` | Portfolio beta vs benchmark |
| `std_dev` | Daily return standard deviation |
| `hist_volatility` | Annualized volatility (std_dev × √252) |
| `spy_twr_pct` | Benchmark TWR percentage |
| `jensens_alpha` | Excess return vs CAPM expected return |
| `information_ratio` | Active return ÷ tracking error |
| `up_capture_ratio`, `down_capture_ratio` | Market-capture ratios |

`total_gain` represents **investment returns only** (cash-flow-independent returns), not portfolio dollar gain. It is the numerator used in TWR calculation and reconciles with `time_weighted_return_pct`. For portfolio dollar gain (including cash flows), see `status → total_gain`.

---

## `mwr`

Money-Weighted Return (XIRR) — accounts for timing of deposits and withdrawals.

```
portfolio-ts mwr [--as-of-date YYYY-MM-DD]
```

**Flags:**

| Flag | Default | Description |
|---|---|---|
| `--as-of-date` | today | Reporting date |

**Output fields:**

| Field | Type | Description |
|---|---|---|
| `mwr_pct` | number | Annualized MWR as percentage |
| `as_of_date` | string | Date of calculation |
| `portfolio_value` | number | Always 0 (reserved for future use) |
| `note` | string | Description of the metric |

MWR is computed via a SQL-native XIRR using Newton-Raphson with bisection fallback (`xirr_sql()` and `portfolio_mwr_sql(as_of_date)` in PostgreSQL). It considers all external cash flows (DEPOSIT, WITHDRAW) and the terminal portfolio value.

---

## `cash`

Cash balances by currency with USD conversion.

```
portfolio-ts cash [--as-of-date YYYY-MM-DD]
```

Returns per-currency cash buckets with FX-converted USD values. Non-USD positions use the last available FX rate.

---

## `add`

Add a transaction and recalculate daily returns.

```
portfolio-ts add --date YYYY-MM-DD --asset SYMBOL --action ACTION --quantity N
                [--price P] [--currency CUR] [--fees F] [--fee-currency CUR]
                --exchange NAME [--account LABEL]
```

**Strict input validation** (enforced before any DB write):

| Validation | Rule | Error Example |
|---|---|---|
| `--asset` | For BUY/SELL: must not be a bare ISO currency code. FX pairs must use `XXX=X` format (e.g. `EURUSD=X`). | `EUR` → rejected with "use EURUSD=X" hint |
| `--action` | One of: `BUY`, `SELL`, `DEPOSIT`, `WITHDRAW`, `TRANSFER`, `DIVIDEND`, `INTEREST`, `FEE`, `TAX` | `INVALID` → rejected |
| `--quantity` | Must be a positive number | `-5` → rejected |
| `--price` | Must be a positive number (required for BUY/SELL) | `0` → rejected |
| `--fees` | Must be a non-negative number | `-1` → rejected |
| `--currency` | One of: `USD`, `EUR`, `GBP`, `UAH`, `JPY`, `CHF`, `CAD`, `AUD`, `HKD`, `SGD` | `XYZ` → rejected |
| `--exchange` | Required, non-empty | empty → rejected |

Date validation: must be `YYYY-MM-DD` (ISO) or legacy `DD-MM-YYYY` (deprecated).

---

## `edit`

Edit an existing transaction and recalculate.

```
portfolio-ts edit --id N [--date YYYY-MM-DD] [--asset SYMBOL] [--action ACTION]
                  [--quantity N] [--price P] [--currency CUR] [--fees F]
                  [--exchange NAME] [--account LABEL] [--dry-run]
```

Same input validation rules as `add` apply to each changed field.

---

## `exchange`

Record a currency exchange — creates two linked transactions (EXCHANGE_FROM / EXCHANGE_TO).

```
portfolio-ts exchange --date YYYY-MM-DD --from ASSET --to ASSET --quantity N --rate R
```

Both `--from` and `--to` must be cash-like assets. `--from` and `--to` must differ. `--quantity` and `--rate` must be positive.

---

## `transactions`

Paginated transaction list.

```
portfolio-ts transactions [--limit N] [--offset N] [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD]
```

---

## Other Commands

| Command | Description |
|---|---|
| `delete --id N --confirm` | Delete a transaction and recalculate |
| `recalculate [--from-date YYYY-MM-DD] [--force] [--dry-run]` | Rebuild daily_returns from cached prices |
| `repair_prices [--ticker T] [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD] [--dry-run]` | Fetch missing prices from Yahoo Finance |
| `verify_prices [--max-age-days N]` | Price coverage diagnostics |
| `report [--limit N] [--offset N]` | Paginated daily portfolio returns |
| `allocation [--as-of-date YYYY-MM-DD]` | Portfolio allocation breakdown |
| `summary [--as-of-date YYYY-MM-DD]` | High-level portfolio summary metrics |
| `concentration [--as-of-date YYYY-MM-DD] [--top-n N]` | HHI + top holdings |
| `sync [--dry-run]` | repair_prices + recalculate |
| `health [--max-age-days N]` | DB reachability + price coverage |
| `init` | Verify database schema |
| `backup --out PATH` | pg_dump backup |
