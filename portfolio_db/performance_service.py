"""Stats, metrics, and concentration calculations."""


class PerformanceService:
    def __init__(self, db, reporting):
        self.db = db
        self.reporting = reporting

    def get_performance_stats(self, as_of_date, get_daily_returns_fn, build_snapshot_fn, risk_free_rate_annual) -> dict:
        """Get portfolio performance statistics with separated return metrics."""
        import math
        from datetime import datetime
        snapshot = build_snapshot_fn(as_of_date=as_of_date)
        as_of_date = snapshot['as_of_date']
        returns = get_daily_returns_fn()
        if as_of_date is not None:
            returns = [row for row in returns if row['date'] <= as_of_date]

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
        }

        if as_of_date is None:
            return empty_stats.copy()

        # Filter out zero values
        returns_with_values = [r for r in returns if r['portfolio_value'] > 0]

        if not returns_with_values:
            stats = empty_stats.copy()
            stats.update({
                'start_date': as_of_date,
                'end_date': as_of_date,
                'end_value': snapshot['portfolio_value'],
                'net_gain': snapshot['total_profit'],
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
                'time_weighted_return_pct': snapshot['time_weighted_return_pct'],
                'total_return_pct': snapshot['total_return_pct'],
                'cagr': snapshot['cagr'],
            })
            return stats

        # Calculate portfolio stats
        daily_returns = [r['portfolio_daily_return'] for r in returns_with_values]
        avg = sum(daily_returns) / len(daily_returns)
        variance = sum((r - avg) ** 2 for r in daily_returns) / len(daily_returns)
        std_dev = math.sqrt(variance)
        hist_volatility = std_dev * math.sqrt(252)

        # Calculate VaR and CVaR (percentiles and tail risk)
        import numpy as np
        var_95 = np.percentile(daily_returns, 5)
        var_99 = np.percentile(daily_returns, 1)
        cvar_95 = np.mean([r for r in daily_returns if r <= var_95])
        cvar_99 = np.mean([r for r in daily_returns if r <= var_99])

        # Calculate Max Drawdown, Average Drawdown, and Drawdown Duration stats
        max_value = returns_with_values[0]['portfolio_value']
        max_drawdown = 0.0
        drawdowns = []
        drawdown_start = None
        drawdown_durations = []

        for i, r in enumerate(returns_with_values):
            value = r['portfolio_value']
            if value > max_value:
                max_value = value
                # Drawdown ended, calculate duration
                if drawdown_start is not None:
                    duration = i - drawdown_start
                    drawdown_durations.append(duration)
                    drawdown_start = None
            drawdown = (max_value - value) / max_value * 100 if max_value > 0 else 0
            if drawdown > 0:
                drawdowns.append(drawdown)
                if drawdown_start is None:
                    drawdown_start = i
            max_drawdown = max(max_drawdown, drawdown)

        # If still in drawdown at end
        if drawdown_start is not None:
            drawdown_durations.append(len(returns_with_values) - drawdown_start)

        avg_drawdown = sum(drawdowns) / len(drawdowns) if drawdowns else 0.0
        avg_drawdown_duration = sum(drawdown_durations) / len(drawdown_durations) if drawdown_durations else 0.0

        # Calculate Beta against SPY
        beta = 0.0
        try:
            min_date = datetime.strptime(returns_with_values[0]['date'], '%Y-%m-%d').date()
            max_date = datetime.strptime(returns_with_values[-1]['date'], '%Y-%m-%d').date()

            spy_prices = self.db.get_price_series(['SPY'], start_date=min_date, end_date=max_date)
            if spy_prices and 'SPY' in spy_prices and len(spy_prices['SPY']) > 1:
                import pandas as pd
                spy_series = spy_prices['SPY']
                if isinstance(spy_series, pd.DataFrame):
                    spy_series = spy_series.iloc[:, 0]

                # Calculate SPY daily returns
                spy_returns = []
                for i in range(1, len(spy_series)):
                    prev_val = float(spy_series.iloc[i-1])
                    curr_val = float(spy_series.iloc[i])
                    if prev_val > 0:
                        spy_returns.append((curr_val - prev_val) / prev_val * 100)

                # Align and calculate Beta
                n = min(len(spy_returns), len(daily_returns))
                if n > 1:
                    spy_returns = spy_returns[-n:]
                    portfolio_returns = daily_returns[-n:]

                    # Covariance
                    avg_portfolio = sum(portfolio_returns) / len(portfolio_returns)
                    avg_spy = sum(spy_returns) / len(spy_returns)
                    covariance = sum((p - avg_portfolio) * (s - avg_spy) for p, s in zip(portfolio_returns, spy_returns)) / n

                    # Variance of market
                    variance_market = sum((s - avg_spy) ** 2 for s in spy_returns) / len(spy_returns)

                    beta = covariance / variance_market if variance_market > 0 else 0.0
        except Exception:
            beta = 0.0

        total_cash_flow = snapshot['net_contributions']
        start_value = returns_with_values[0]['portfolio_value']
        end_value = snapshot['portfolio_value']
        gross_gain = end_value - start_value
        net_gain = snapshot['total_profit']

        # External cash-flow model:
        # deposits / withdrawals are investor actions,
        # realized / unrealized are investment results,
        # TWR is the primary return metric because it isolates manager performance.
        # Keep total_invested as a backward-compatible alias for net contributed capital.
        total_invested = snapshot['total_invested']
        cumulative_twr = 1.0
        for row in returns_with_values[1:]:
            cumulative_twr *= (1 + (row['investment_return'] / 100))
        time_weighted_return_pct = (cumulative_twr - 1) * 100
        total_return_pct = time_weighted_return_pct

        # CAGR from Total Return (accounts for deposit timing)
        # Use TWR-based annualization so deposits/withdrawals do not distort CAGR.
        start_date = datetime.strptime(returns_with_values[0]['date'], '%Y-%m-%d').date()
        end_date = datetime.strptime(returns_with_values[-1]['date'], '%Y-%m-%d').date()
        years = (end_date - start_date).days / 365.25
        total_return_decimal = total_return_pct / 100
        cagr_decimal = (((1 + total_return_decimal) ** (1 / years) - 1)) if total_return_decimal > -1 and years > 0 else 0.0
        cagr = cagr_decimal * 100

        # Sharpe Ratio (annualized)
        # SR = (Rp - Rf) / σp
        rf_annual = risk_free_rate_annual
        sharpe_ratio = ((cagr_decimal - rf_annual) / (hist_volatility/100)) if hist_volatility > 0 else 0.0

        # Sortino Ratio (annualized) - only downside risk
        # Sortino = (Rp - Rf) / σd where σd = standard deviation of downside
        rf_daily_pct = (rf_annual / 252) * 100  # Daily risk-free in %
        target_return_daily_pct = rf_daily_pct  # Target = risk-free rate
        downside_diffs = [r - target_return_daily_pct for r in daily_returns if r < target_return_daily_pct]
        # Downside deviation: standard deviation of downside returns only
        downside_deviation_daily = math.sqrt(sum(d**2 for d in downside_diffs) / len(downside_diffs)) if downside_diffs else 0.0
        # Daily Sortino, then annualize
        excess_return_daily = avg - rf_daily_pct  # avg is already in %
        sortino_daily = excess_return_daily / downside_deviation_daily if downside_deviation_daily > 0 else 0.0
        sortino_ratio = sortino_daily * math.sqrt(252)  # Annualize

        # Treynor Ratio - reward per unit of systematic risk (beta)
        # Treynor = (Rp - Rf) / β
        treynor_ratio = ((cagr_decimal - rf_annual) / beta) if beta != 0 else 0.0

        # Information Ratio - excess return vs benchmark per unit of tracking error
        # IR = (Rp - Rb) / Tracking Error
        # Tracking Error = std dev of (portfolio return - benchmark return)
        information_ratio = 0.0
        spy_cagr = 0.0  # Market (SPY) CAGR for Jensen's Alpha
        tracking_error = 0.0  # Annualized tracking error for benchmark comparison
        relative_return = 0.0  # Portfolio return minus benchmark return
        try:
            min_date = datetime.strptime(returns_with_values[0]['date'], '%Y-%m-%d').date()
            max_date = datetime.strptime(returns_with_values[-1]['date'], '%Y-%m-%d').date()

            spy_prices = self.db.get_price_series(['SPY'], start_date=min_date, end_date=max_date)
            if spy_prices and 'SPY' in spy_prices and len(spy_prices['SPY']) > 1:
                import pandas as pd
                spy_series = spy_prices['SPY']
                if isinstance(spy_series, pd.DataFrame):
                    spy_series = spy_series.iloc[:, 0]

                # Calculate SPY daily returns
                spy_returns = []
                for i in range(1, len(spy_series)):
                    prev_val = float(spy_series.iloc[i-1])
                    curr_val = float(spy_series.iloc[i])
                    if prev_val > 0:
                        spy_returns.append((curr_val - prev_val) / prev_val * 100)

                # Calculate SPY CAGR
                spy_start = float(spy_series.iloc[0])
                spy_end = float(spy_series.iloc[-1])
                spy_total_return = (spy_end - spy_start) / spy_start
                spy_cagr = (((1 + spy_total_return) ** (1 / years) - 1)) if spy_total_return > -1 and years > 0 else 0.0

                # Relative Return = Portfolio CAGR - Benchmark CAGR
                relative_return = (cagr_decimal - spy_cagr) * 100  # In percentage

                # Align portfolio and benchmark returns
                n = min(len(spy_returns), len(daily_returns))
                if n > 1:
                    spy_returns = spy_returns[-n:]
                    portfolio_returns = daily_returns[-n:]

                    # Calculate excess returns (portfolio - benchmark)
                    excess_returns = [p - s for p, s in zip(portfolio_returns, spy_returns)]

                    # Average excess return (annualized)
                    avg_excess_daily = sum(excess_returns) / len(excess_returns)
                    avg_excess_annual = avg_excess_daily * 252 / 100  # Convert to decimal

                    # Tracking Error = standard deviation of excess returns (annualized)
                    tracking_error_daily = math.sqrt(sum((e - avg_excess_daily) ** 2 for e in excess_returns) / len(excess_returns))
                    tracking_error_annual = tracking_error_daily * math.sqrt(252) / 100  # Convert to decimal
                    tracking_error = tracking_error_annual * 100  # Convert to percentage

                    # Information Ratio
                    information_ratio = (avg_excess_annual / tracking_error_annual) if tracking_error_annual > 0 else 0.0
        except Exception:
            spy_cagr = 0.0

        # Jensen's Alpha - excess return over expected return (CAPM)
        # Alpha = Rp - (Rf + B * (Rm - Rf))
        # where Rp = portfolio return, Rf = risk-free rate, B = beta, Rm = market return
        jensens_alpha = (cagr_decimal - (rf_annual + beta * (spy_cagr - rf_annual))) * 100  # In percentage

        # Monthly return (simplified: from daily returns)
        # Better: compound daily returns to get monthly
        monthly_returns = []
        i = 0
        while i < len(returns_with_values):
            # Get month start
            current_month_key = (datetime.strptime(returns_with_values[i]['date'], '%Y-%m-%d').date().year,
                                  datetime.strptime(returns_with_values[i]['date'], '%Y-%m-%d').date().month)

            # Find end of month
            month_end = i
            while month_end + 1 < len(returns_with_values):
                next_date = datetime.strptime(returns_with_values[month_end + 1]['date'], '%Y-%m-%d').date()
                next_key = (next_date.year, next_date.month)
                if next_key != current_month_key:
                    break
                month_end += 1

            # Calculate monthly return: compound daily returns
            month_return = 0.0
            for j in range(i, month_end + 1):
                daily_ret = returns_with_values[j]['portfolio_daily_return'] / 100
                # Compound: (1 + r1) * (1 + r2) - 1
                month_return = (1 + month_return/100) * (1 + daily_ret) - 1
                month_return *= 100

            monthly_returns.append(month_return)
            i = month_end + 1

        avg_monthly_return = sorted(monthly_returns)[len(monthly_returns)//2] if monthly_returns else 0.0

        return {
            'total_days': len(returns_with_values),
            'start_date': returns_with_values[0]['date'],
            'end_date': as_of_date,
            'start_value': start_value,
            'end_value': end_value,
            'total_gain': gross_gain,
            'net_gain': net_gain,
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
            'time_weighted_return_pct': time_weighted_return_pct,
            'total_cash_flow': total_cash_flow,
            'total_invested': total_invested,
            'total_return_pct': total_return_pct,
            'avg_daily_return': avg,
            'avg_monthly_return': avg_monthly_return,
            'cagr': cagr,
            'avg_investment_return': sum(r['investment_return'] for r in returns_with_values) / len(returns_with_values),
            'std_dev': std_dev,
            'hist_volatility': hist_volatility,
            'beta': beta,
            'sharpe_ratio': sharpe_ratio,
            'sortino_ratio': sortino_ratio,
            'treynor_ratio': treynor_ratio,
            'information_ratio': information_ratio,
            'jensens_alpha': jensens_alpha,
            'relative_return': relative_return,
            'tracking_error': tracking_error,
            'var_95': var_95,
            'var_99': var_99,
            'cvar_95': cvar_95,
            'cvar_99': cvar_99,
            'max_drawdown': max_drawdown,
            'avg_drawdown': avg_drawdown,
            'avg_drawdown_duration': avg_drawdown_duration,
        }

    def evaluate_metric(self, metric_name: str, value: float) -> str:
        """Evaluate metric and return assessment comment (no emojis for JSON)."""
        assessments = {
            'avg_daily_return': lambda v: 'Excellent' if v > 0.2 else ('Below avg' if v > 0 else 'Negative'),
            'avg_monthly_return': lambda v: 'Excellent' if v > 5 else ('Below avg' if v > 0 else 'Negative'),
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
        allocation = get_allocation_fn(allocation_type='all', as_of_date=as_of_date)
        positions = allocation['positions']
        total_value = allocation['total_value']

        if total_value == 0 or not positions:
            return {
                'hhi': 0.0,
                'weighted_avg_exposure': 0.0,
                'num_positions': 0,
            }

        # Calculate HHI (sum of squared weights)
        # HHI < 0.15 = low concentration, 0.15-0.25 = moderate, > 0.25 = high
        weights = [p['value'] / total_value for p in positions]
        hhi = sum(w ** 2 for w in weights)

        # Weighted Average Exposure = average position weight
        weighted_avg_exposure = sum(w for w in weights) / len(weights) if weights else 0.0

        return {
            'hhi': hhi,
            'weighted_avg_exposure': weighted_avg_exposure,
            'num_positions': len(positions),
        }
