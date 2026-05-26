"""Stats, metrics, and concentration calculations."""


class PerformanceService:
    def __init__(self, db, reporting):
        self.db = db
        self.reporting = reporting

    @staticmethod
    def calculate_xirr(cash_flows: list) -> float:
        """Calculate XIRR using Newton-Raphson.

        cash_flows: list of {'date': date, 'amount': float}
          Negative amounts = outflows (investor deposits).
          Positive amounts = inflows (withdrawals + terminal portfolio value).
        Returns annual rate as a decimal (0.10 = 10%). Returns 0.0 on failure.
        """
        if not cash_flows or len(cash_flows) < 2:
            return 0.0
        amounts = [cf['amount'] for cf in cash_flows]
        if all(a <= 0 for a in amounts) or all(a >= 0 for a in amounts):
            return 0.0
        ref_date = cash_flows[0]['date']
        days = [(cf['date'] - ref_date).days for cf in cash_flows]

        def npv(rate):
            return sum(a / ((1 + rate) ** (d / 365.25)) for a, d in zip(amounts, days))

        def dnpv(rate):
            return sum(
                -d / 365.25 * a / ((1 + rate) ** (d / 365.25 + 1))
                for a, d in zip(amounts, days)
            )

        rate = 0.1  # initial guess 10%
        for _ in range(200):
            f = npv(rate)
            df = dnpv(rate)
            if abs(df) < 1e-12:
                break
            new_rate = rate - f / df
            if new_rate <= -1:
                new_rate = -0.9999
            if abs(new_rate - rate) < 1e-7:
                rate = new_rate
                break
            rate = new_rate
        try:
            if abs(npv(rate)) < 1.0:
                return round(float(rate), 8)
        except Exception:
            pass
        return 0.0

    def get_performance_stats(self, as_of_date, build_snapshot_fn, risk_free_rate_annual, benchmark_ticker='SPY', from_date=None) -> dict:
        """Get portfolio performance statistics with separated return metrics."""
        snapshot = build_snapshot_fn(as_of_date=as_of_date)
        as_of_date = snapshot['as_of_date']

        empty_stats = {
            'total_days': 0,
            'start_date': None,
            'end_date': None,
            'start_value': 0.0,
            'end_value': 0.0,
            'total_gain': 0.0,
            'net_gain': 0.0,
            'deposits': 0.0,
            'withdrawals': 0.0,
            'net_contributions': 0.0,
            'dividends': 0.0,
            'interest': 0.0,
            'fees': 0.0,
            'taxes': 0.0,
            'income': 0.0,
            'realized_gain': 0.0,
            'unrealized_gain': 0.0,
            'time_weighted_return_pct': 0.0,
            'total_cash_flow': 0.0,
            'total_invested': 0.0,
            'total_return_pct': 0.0,
            'avg_daily_return': 0.0,
            'avg_monthly_return': 0.0,
            'median_monthly_return': 0.0,
            'cagr': 0.0,
            'avg_investment_return': 0.0,
            'std_dev': 0.0,
            'hist_volatility': 0.0,
            'beta': 0.0,
            'sharpe_ratio': 0.0,
            'sortino_ratio': 0.0,
            'treynor_ratio': 0.0,
            'information_ratio': 0.0,
            'jensens_alpha': 0.0,
            'relative_return': 0.0,
            'tracking_error': 0.0,
            'var_95': 0.0,
            'var_99': 0.0,
            'cvar_95': 0.0,
            'cvar_99': 0.0,
            'max_drawdown': 0.0,
            'avg_drawdown': 0.0,
            'avg_drawdown_duration': 0.0,
            'spy_twr_pct': 0.0,
            'spy_cagr_pct': 0.0,
            'up_capture_ratio': 0.0,
            'down_capture_ratio': 0.0,
        }

        if as_of_date is None:
            return empty_stats.copy()

        perf = self.db.get_performance_stats_sql(as_of_date, benchmark_ticker, risk_free_rate_annual, from_date=from_date)
        if not perf:
            return empty_stats.copy()

        # Merge SQL-derived stats with snapshot totals that are already part of the reporting snapshot.
        perf.update({
            'deposits': snapshot['deposits'],
            'withdrawals': snapshot['withdrawals'],
            'net_contributions': snapshot['net_contributions'],
            'dividends': snapshot['dividends'],
            'interest': snapshot['interest'],
            'fees': snapshot['fees'],
            'taxes': snapshot['taxes'],
            'income': snapshot['income'],
            'realized_gain': snapshot['realized_gain'],
            'unrealized_gain': snapshot['unrealized_gain'],
            'total_cash_flow': snapshot['net_contributions'],
            'total_invested': snapshot['total_invested'],
            'net_gain': snapshot['total_profit'],
            'total_gain': snapshot['portfolio_value'] - perf['start_value'],
        })

        return {
            **perf,
        }

    def evaluate_metric(self, metric_name: str, value: float) -> str:
        """Evaluate metric and return assessment comment (no emojis for JSON)."""
        assessments = {
            'avg_daily_return': lambda v: 'Excellent' if v > 0.2 else ('Below avg' if v > 0 else 'Negative'),
            'median_monthly_return': lambda v: 'Excellent' if v > 5 else ('Below avg' if v > 0 else 'Negative'),
            'cagr': lambda v: 'Excellent' if v > 20 else ('Good' if v > 10 else ('Moderate' if v > 0 else 'Negative')),
            'total_return_pct': lambda v: 'Excellent' if v > 50 else ('Good' if v > 20 else ('Moderate' if v > 0 else 'Negative')),
            'std_dev': lambda v: 'Low' if v < 2 else ('Moderate' if v < 4 else 'High'),
            'hist_volatility': lambda v: 'Low' if v < 20 else ('Moderate' if v < 40 else 'High'),
            'beta': lambda v: 'Low corr' if abs(v) < 0.5 else ('Moderate' if abs(v) < 1 else 'High'),
            'sharpe_ratio': lambda v: 'Excellent' if v > 2 else ('Good' if v > 1 else ('Poor' if v > 0 else 'Bad')),
            'sortino_ratio': lambda v: 'Excellent' if v > 3 else ('Good' if v > 1.5 else ('Poor' if v > 0 else 'Bad')),
            'treynor_ratio': lambda v: 'Excellent' if v > 5 else ('Good' if v > 2 else ('Poor' if v > 0 else 'Bad')),
            'information_ratio': lambda v: 'Excellent' if v > 1.0 else ('Good' if v > 0.5 else ('Poor' if v > 0 else 'Bad')),
            'jensens_alpha': lambda v: 'Excellent' if v > 3 else ('Good' if v > 1 else ('Neutral' if v > -1 else 'Underperforming')),
            'relative_return': lambda v: 'Outperforming' if v > 5 else ('Good' if v > 0 else ('Neutral' if v > -5 else 'Underperforming')),
            'tracking_error': lambda v: 'Low' if v < 5 else ('Moderate' if v < 10 else 'High'),
            'var_95': lambda v: 'Low risk' if v > -3 else ('Moderate' if v > -5 else 'High risk'),
            'var_99': lambda v: 'Low risk' if v > -5 else ('Moderate' if v > -8 else 'High risk'),
            'cvar_95': lambda v: 'Low risk' if v > -4 else ('Moderate' if v > -7 else 'High risk'),
            'cvar_99': lambda v: 'Low risk' if v > -6 else ('Moderate' if v > -10 else 'High risk'),
            'max_drawdown': lambda v: 'Excellent' if v < 10 else ('Normal' if v < 25 else 'High'),
            'avg_drawdown': lambda v: 'Low' if v < 4 else ('Normal' if v < 8 else 'High'),
            'avg_drawdown_duration': lambda v: 'Fast' if v < 10 else ('Normal' if v < 30 else 'Slow'),
            'hhi': lambda v: 'Diversified' if v < 0.15 else ('Moderate' if v < 0.25 else 'Concentrated'),
            'weighted_avg_exposure': lambda v: 'Low' if v < 0.1 else ('Moderate' if v < 0.2 else 'High'),
        }
        assessment = assessments.get(metric_name, lambda v: '')(value)
        return {"value": round(float(value), 6), "assessment": assessment}

    def get_concentration_metrics(self, as_of_date, get_allocation_fn) -> dict:
        """Calculate portfolio concentration metrics."""
        return self.db.get_concentration_metrics_sql(as_of_date)

    def get_contribution_by_position(self, as_of_date, build_snapshot_fn) -> list:
        """Return per-position contribution to portfolio total gain.

        For each position returns:
          - symbol, status, market_value, weight_pct
          - total_gain_value (unrealized + realized)
          - contribution_to_gain_pct: position gain / net_contributions * 100
        """
        return self.db.get_contribution_by_position_rows(as_of_date)
