# Smart DCA Strategy

A monthly dollar-cost averaging strategy that adjusts risk exposure based on four macro market indicators. Built as a Claude Code plugin skill (`portfolio-plugin/skills/smartdca/`).

## How It Works

Every month, the strategy:

1. **Fetches 4 macro indicators**: CAPE (Shiller P/E), Fear & Greed Index, US Unemployment Rate (UNRATE), and S&P 500 position vs its 200-day SMA.
2. **Counts PEAK conditions**: Each indicator above/below a threshold counts as one PEAK.
3. **Derives a regime**: 0–1 PEAK = AGGRESSIVE, 2 PEAK = CAUTION, 3–4 PEAK = PROTECTION.
4. **Evaluates each risk asset** (SPYM, XLU, SCHD) against technical filters on execution day.
5. **Produces a buy map** in dollars that sums to the monthly fixed budget.
 6. **Applies SPYM catch-up surcharge**: while `cash + SGOV > 30%`, an extra $1000 goes 100% into SPYM (temporary catch-up).
 7. **Routes unspent dollars**: defers for the next SPYM-focused round. Never auto-converts failed amounts into SGOV.

## Regime Rules

| PEAK count | Regime | Meaning |
|-----------|--------|---------|
| 0–1 | AGGRESSIVE | Full risk deployment |
| 2 | CAUTION | Reduce risk exposure |
| 3–4 | PROTECTION | Capital preservation |

If more than 1 indicator is missing, the regime defaults to CAUTION.

## Asset Allocation (Base)

| Asset | Allocation | Purpose |
|-------|-----------|---------|
| SPYM | 80% | Core catch-up (S&P 600 small-cap value) |
| SCHD | 10% | Dividend growth |
| XLU | 5% | Utilities (defensive) |
| SGOV | 5% | Base cash-like allocation |

Monthly budget: $1,000. All percentages are relative to this budget.

## Technical Filters (Execution Day)

Each risk asset must pass its filter to receive the base allocation:

| Asset | Filter |
|-------|--------|
| SPYM | RSI(14) < 70 OR Price < SMA90 |
| XLU | RSI(14) < 65 OR Price < SMA90 |
| SCHD | RSI(14) < 65 OR Price < SMA90 |

Failed amounts are deferred for the next SPYM round. Never auto-converted into SGOV.

## Cash Management

- **Ceiling**: When cash + SGOV exceeds 45% of portfolio value, new contributions prioritize SPYM.
- **Target band**: 25–30% cash + SGOV.
- **SPYM catch-up surcharge**: When `cash + SGOV > 30%`, an extra $1000 is deployed 100% into SPYM on top of the base budget. Auto-disables when ≤30%.
- **SGOV base** applies only below the target band (25-30%). At/above target, SGOV_base contribution is 0.
- **Unspent routing**: Deferred for the next SPYM round. Never routed to SGOV.

## Benchmark

Strategy performance is measured against the S&P 500 Total Return (via SPY). Alerts trigger if:
- Underperformance exceeds 10 p.p. over 12 months.
- Underperformance exceeds 20 p.p. over 24 months.

## Kill-Switch

If underperformance exceeds 20 p.p. over 24 months AND cash + SGOV stays above 45% for 6+ consecutive months, the strategy should be reconsidered.

## Tooling

- **Macro data**: `portfolio-plugin/skills/smartdca/scripts/macro_indicators.py` — fetches all 4 indicators.
- **Technical data**: Project CLI command `asset_analysis` (replaces legacy `yf-analyse-asset.py`).
- **Portfolio state**: Project CLI commands `status`, `allocation`, `cash`, `performance`.

## Files

| Path | Purpose |
|------|---------|
| `portfolio-plugin/skills/smartdca/SKILL.md` | Skill entry point & workflow |
| `portfolio-plugin/skills/smartdca/references/*.md` | Detailed reference docs |
| `portfolio-plugin/skills/smartdca/scripts/macro_indicators.py` | Macro data fetcher |
| `portfolio-plugin/skills/smartdca/references/example-run.md` | Illustrative execution example |
| `docs/smartdca-strategy.md` | This overview |
