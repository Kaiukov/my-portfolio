monthly_fixed_budget = 1000

[assets]
SPYM = 0.80
SCHD = 0.10
XLU = 0.05
SGOV_base = 0.05  # applies only when cash+SGOV is below target band (25-30%); otherwise 0

[guardrails]
min_risk_deployment_aggressive = 0.80
cash_plus_sgov_ceiling = 0.45
cash_plus_sgov_target = "25-30%"
space_x_max_portfolio_pct = 0.03
# cash+SGOV includes: USD/USDT/USDC + SGOV + FX-cash (GBP/EUR).
# BTC and other crypto are EXCLUDED from cash bucket and risk-sleeve targets.

[catch_up_surcharge]
enabled_when = "cash + SGOV > 30%"
amount_usd = 1000
route = "100% SPYM"
disable_when = "cash + SGOV <= 30%"

[technical_filters]
SPYM_rsi_cap = 70
risk_rsi_cap = 65
on_fail = "defer — never SGOV"
filter_logic = "buy if RSI(14) < cap OR price < SMA90"

[non_model_positions]
btc_monthly_usd = 100
btc = "out-of-model, price-independent standing order, not governed by SmartDCA (regime, filters, surcharge, SGOV routing)"
crypto_other = "out-of-model speculative pocket, excluded from risk sleeves & cash bucket; soft cap analogous to space_x_max_portfolio_pct, no hard sell"
fx_cash = "counts as idle cash toward cash+SGOV; convert to USD opportunistically at acceptable FX rate into SPYM funnel; do not let accumulate"
vgit = "bond sleeve (treasury bond), NOT SGOV cash-equivalent; keep cash+SGOV as a clean cash measure separate from bond sleeve"

[routing]
high_cash_sgov_unspent = "do not add to SGOV; defer for next SPYM-focused execution round"
normal_unspent = "route to SGOV when cash+SGOV is below target band; otherwise 0"
