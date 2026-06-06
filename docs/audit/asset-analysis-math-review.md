# Asset Analysis Math Review

Date: 2026-06-06

Scope:

- TypeScript port of `smartdca/scripts/yf-analyse-asset.py`
- Shared math, provider, and adapter contract for `asset_analysis`
- Confirmed findings from issue #265 only

## Confirmed fixes

1. Yahoo chart bounds now use concrete `Date` objects.
   - Replaced alias-style `period1: "1y"` / `"5y"` requests with bounded `period1: Date`, `period2: Date`.
   - `period2` is sent as the next UTC day after `as_of_date` so the requested end date stays inclusive.

2. Provider is injectable and internally consistent.
   - The shared command accepts an injected provider for tests.
   - The default Yahoo provider uses one normalized request and derives:
     - analysis window
     - extended history window
     - benchmark window
     - tracking-error benchmark window
   - Benchmark fetches are deduplicated when the explicit benchmark and tracking benchmark resolve to the same symbol.

3. Partial-data handling is structured.
   - Non-fatal provider and metric issues now live in `data.warnings[]` and `data.errors[]`.
   - Success `meta` does not repeat warnings.
   - Adapter-level failures still return the canonical error envelope with `command: "asset_analysis"`.

4. Benchmark-relative metrics are aligned by date, not by array position.
   - Beta, up/down capture, and tracking error now align asset and benchmark returns on the return date key.
   - This avoids false comparisons when one side has missing sessions or extra timestamps.

5. StochRSI scale is fixed.
   - Values are emitted on the standard 0..100 scale.
   - Signal thresholds use 80/20 against that scale.

6. MACD signal alignment is fixed.
   - Signal EMA is computed against the MACD line on matching indices.
   - The exported `macd_signal` and histogram now refer to the same latest bar as `macd`.

7. Asset type now comes from Yahoo quote type metadata.
   - The port reads `price.quoteType` and normalizes to the public asset type enum.
   - Raw Yahoo `quote_type` is preserved in `info`.

8. CLI/API/MCP option parity is explicit.
   - `ticker` or `asset`
   - `period` or `lookback_days`
   - `benchmark`
   - `as_of_date`
   - `risk_free_rate`
   - `annualization_periods` in `data.request`

9. Default Yahoo client suppresses `yahooSurvey` notices.
   - The shared provider factory instantiates `yahoo-finance2` with `suppressNotices: ["yahooSurvey"]`.
   - This keeps adapter stdout pure JSON for CLI usage.

## Formula notes

- Beta: sample covariance(asset, benchmark) / sample variance(benchmark)
- Tracking error: annualized sample stddev of excess daily returns, using 365 periods for crypto and 252 for conventional exchange-traded series
- Sharpe / Sortino: annualized return minus annual risk-free rate, using asset-kind annualization periods
- Downside deviation: annualized RMS of returns below daily risk-free threshold, using asset-kind annualization periods
- CAGR: trailing dated window from actual `PriceBar` boundaries, annualized from elapsed calendar time
- Calmar: trailing 3-year CAGR divided by max drawdown from the same trailing 3-year window
- RSI: Wilder smoothing
- MACD: EMA(fast) - EMA(slow), signal = EMA(macd, signal_period)
- Stochastic RSI: 0..100 normalized RSI within rolling RSI range

## Known non-issue behavior

- Short lookbacks still return success with null metrics where the math is not supportable.
- `asset_analysis` is intentionally allowed to hit Yahoo Finance even though normal portfolio read commands are cache-only.
- Long-history fetch failures degrade CAGR-related outputs instead of failing the whole command when current-price history is still available.
