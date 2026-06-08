monthly_fixed_budget = 1000

[assets]
SPYM = 0.80
SCHD = 0.10
XLU = 0.05
SGOV_base = 0.05
SGOV_unspent = "only when risk filters fail and cash_plus_sgov is below 45%"

[guardrails]
min_risk_deployment_aggressive = 0.80
cash_plus_sgov_ceiling = 0.45
cash_plus_sgov_target = "25-30%"
space_x_max_portfolio_pct = 0.03

[routing]
high_cash_sgov_unspent = "do not add to SGOV; keep for next SPYM-focused execution round"
normal_unspent = "route to SGOV"
