# Smart DCA Rules

## Portfolio setup

Use `references/config.md` as the single source of truth for:

- the monthly fixed budget
- asset allocation percentages
- SGOV base allocation
- unspent cash routing

Do not restate the numeric values here. Read them from `config.md`.
Compute dollar allocations by multiplying each asset percentage by `monthly_fixed_budget`.
The SPYM catch-up surcharge (`catch_up_surcharge` in config.md) adds extra $1000 to SPYM on top of the base budget when active.

## Market parameters

The 4 market parameters are:

- CAPE
- SPX vs SMA200
- Fear & Greed
- UNRATE

## Macro PEAK conditions

- CAPE > 30
- SPX < SMA200
- Fear & Greed > 75
- UNRATE <= 3.8

Count each true condition as 1 PEAK.

## Labor market bands

- UNRATE 3.8-4.8 = OK
- UNRATE > 4.8 = macro warning, not PEAK

## Regimes

- 0-1 PEAK -> AGGRESSIVE
- 2 PEAK -> CAUTION
- 3-4 PEAK -> PROTECTION
- missing >1 indicator -> CAUTION

## Base allocation by asset

- SPYM, XLU, SCHD, and SGOV base all come from `config.md`.
- Convert percentages to dollars using `monthly_fixed_budget`.
- Do not hardcode alternative dollar amounts here.
- In AGGRESSIVE regime, risk deployment should be at least `min_risk_deployment_aggressive` from `config.md` unless data is missing or the kill-switch is active.

## Technical filters

Check these only on execution day:

- SPYM: `RSI(14) < 70 OR Price < SMA90`
- XLU/SCHD: `RSI(14) < 65 OR Price < SMA90`
- If a filter fails, **defer** the amount for the next SPYM-focused round. Never auto-convert a failed amount into SGOV.

Each asset is evaluated separately. Do not apply one asset's technical result to another asset.
If a risk asset passes the filter, keep its base allocation from `config.md`.

## High cash + SGOV override

- When `cash + SGOV` is at or above the ceiling from `config.md`, new monthly contributions should prioritize SPYM until the portfolio moves back toward the target band.
- Do not increase SGOV in AGGRESSIVE regime while `cash + SGOV` is above the ceiling, except for explicit user override.
- If technical filters block a risk sleeve, defer that amount rather than permanently converting it into SGOV.
- Re-check the deferred amount on the next execution window.

## Catch-up SPYM surcharge

- While excess cash is being deployed, on top of the base monthly SmartDCA buy, buy an extra fixed $1000 of SPYM funded from idle cash.
- Surcharge is active when `cash + SGOV > 30%` of portfolio. Auto-disables when `cash + SGOV <= 30%`.
- Surcharge route is 100% SPYM while active. In AGGRESSIVE regime with surcharge active, SGOV is **not** increased.
- This is a temporary catch-up mechanism, not the permanent monthly budget.
- SGOV_base (5%) applies only when `cash + SGOV` is below the target band (25-30%). When at/above target, SGOV_base contribution is 0.
- Unspent/deferred dollars are held for the next SPYM round, not parked in SGOV.

## Anti-peak rules

- Fear & Greed < 20 adds `$60` to risk sleeves from SGOV.
- Distribution is proportional to the sleeve caps.
- If SGOV+cash >45% persists for 2 months, next month adds 10 p.p. to risk sleeves.
- If SGOV+cash is already above the ceiling, the added 10 p.p. goes first to SPYM.

## Benchmark

- Compare against S&P 500 Total Return proxy via SPY.
- Use rolling 12m and 24m.
- Alert if underperformance exceeds 10 p.p. over 12m or 20 p.p. over 24m.

## Kill-switch

- Reconsider the strategy if underperformance exceeds 20 p.p. over 24m and SGOV+cash stays >45% for 6+ months.
