# Implement issue #223 — rolling / period returns (1M, 3M, 6M, YTD, 1Y, SII + rolling 12M)

Run `gh issue view 223` and read the full spec. Read-only. Approach A (separate SQL function), exposed in the `performance` command output. IMPORTANT: do NOT modify `portfolio_performance_sql()` — add NEW functions and query them separately, to keep the just-merged perf function untouched.

## Return basis (correctness — non-negotiable)
All period/rolling returns must be **TWR** (time-weighted, cash-flow-neutral): geometric-link the daily `investment_return` over the window, exactly like `portfolio_performance_sql` does:
`EXP(SUM(LN(GREATEST(1.0 + investment_return/100.0, 1e-12)))) - 1`, ×100.
Do NOT use `portfolio_daily_return` or balance-growth — period returns are performance, not contributions. (Round 0 already fixed the `investment_return` base — trust it.)

## SQL (APPEND at end of functions.sql)
1. `portfolio_period_returns_sql(p_as_of_date DATE DEFAULT CURRENT_DATE)` RETURNS TABLE(window TEXT, from_date TEXT, return_pct DOUBLE PRECISION) with one row per window:
   - `1M`  = as_of − interval '1 month' .. as_of
   - `3M`  = − interval '3 months'
   - `6M`  = − interval '6 months'
   - `YTD` = date_trunc('year', as_of) .. as_of
   - `1Y`  = − interval '1 year'
   - `SII` = since inception (min date .. as_of) — MUST equal `time_weighted_return_pct` from `portfolio_performance_sql`.
   Each return = geometric-linked `investment_return` over `daily_returns` rows in [from, as_of].
2. `portfolio_rolling_returns_sql(p_as_of_date DATE DEFAULT CURRENT_DATE, p_window_months INTEGER DEFAULT 12)` RETURNS TABLE(date TEXT, return_pct DOUBLE PRECISION): for each month-end up to as_of that has ≥ window_months of prior history, the trailing-window TWR (geometric-linked investment_return over the prior `p_window_months`). Ordered by date.

## Service (performance.ts)
- After the existing `portfolio_performance_sql` query, run the two new functions and attach to `PerformanceResult`:
  - `period_returns: Record<string, number>` (e.g. `{"1M":1.2,"3M":3.4,"6M":..,"YTD":..,"1Y":..,"SII":..}`)
  - `rolling_12m_returns: Array<{ date: string; return: number }>`
- Defaults: empty `{}` / `[]` in the empty-row path.

## Adapters
No new flags needed — these are returned by default in the `performance` response (flat serialization picks them up). Update `PARITY.md` to note the new fields. Mention them in the CLI `performance` help line.

## Tests (CLAUDE.md template — DB-gated, consistency.integration.test.ts pattern)
- Fixture with ≥1 year of daily history → assert `period_returns.SII` ≈ `portfolio_performance_sql.time_weighted_return_pct` (the key consistency invariant), and `YTD`/`1Y` are present and finite.
- `rolling_12m_returns` is a non-empty ordered series for a >12-month fixture; each value finite.
- CLI snapshot of the extended performance JSON.

## Done =
`bun run typecheck` green; `bun test` green (DB tests skip without DB URL — fine, do NOT start Docker). Commit referencing #223, push branch `feat/223-rolling-returns`. Do NOT deploy or touch prod.
