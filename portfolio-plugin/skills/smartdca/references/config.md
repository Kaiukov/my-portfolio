monthly_fixed_budget = 1000

[assets]
SPYM = 0.80
SCHD = 0.10
XLU = 0.05
SGOV_base = 0.05  # applies only when cash+SGOV is below target band (25-30%); otherwise 0
SGOV_unspent = "only when risk filters fail and cash_plus_sgov is below 45%"

[guardrails]
min_risk_deployment_aggressive = 0.80
cash_plus_sgov_ceiling = 0.45
cash_plus_sgov_target = "25-30%"
space_x_max_portfolio_pct = 0.03

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

[routing]
high_cash_sgov_unspent = "do not add to SGOV; defer for next SPYM-focused execution round"
normal_unspent = "route to SGOV when cash+SGOV is below target band; otherwise 0"
