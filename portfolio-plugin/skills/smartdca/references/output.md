# Smart DCA Output

Keep the final answer short and executable.

The answer must show the monthly buy recommendation for each asset:

- SPYM amount
- XLU amount
- SCHD amount
- SGOV amount

Also show:

1. Regime + PEAK count
2. The 4 market parameters and which ones triggered
3. Per-asset decision logic
4. Buy map in dollars
5. SGOV/deferred routing
6. Portfolio check
7. Benchmark status vs S&P 500
8. Kill-switch status

## Guardrails

- Do not change thresholds on the fly.
- Do not add new indicators without updating `rules.md`.
- Always verify arithmetic so the total equals `monthly_fixed_budget`.
- If data is missing, explain what is missing and what it breaks.
- If `cash + SGOV` is above the ceiling, explicitly show any failed-risk-sleeve dollars as deferred, not SGOV.
