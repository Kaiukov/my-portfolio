"""High-level portfolio service API."""

import json
import hashlib
from datetime import datetime, date
from pathlib import Path

from portfolio_db.database import PortfolioDatabase
from portfolio_db.price_service import PriceService
from portfolio_db.calculator import DailyReturnCalculator


class PortfolioService:
    """High-level API for portfolio operations."""

    def __init__(self, db_path: str = "portfolio.db"):
        """Initialize service."""
        self.db = PortfolioDatabase(db_path)
        self.price_service = PriceService()

    def setup_from_csv(self, csv_path: str):
        """Complete setup workflow from CSV."""
        # Clear existing data
        self.db.clear_transactions()
        self.db.clear_daily_returns()

        # Migrate CSV
        self.db.migrate_from_csv(csv_path)

        # Fetch prices
        self._fetch_and_cache_prices()

        # Calculate returns
        self._calculate_and_store_returns()

    def _fetch_and_cache_prices(self):
        """Fetch prices for all assets."""
        # For now, just skip caching - prices will be fetched on demand during calculation
        # This avoids issues with price_series iteration
        pass

    def _calculate_and_store_returns(self):
        """Calculate and store daily returns."""
        # Get transactions and prices
        transactions = self.db.get_transactions()
        if not transactions:
            return

        # Discover assets and currencies for price lookup
        discovered_assets = self.discover_assets_and_currencies()
        assets = discovered_assets['assets']
        fx_currencies = discovered_assets['fx_currencies']

        # Fetch prices for calculation - extend through today
        min_date = transactions[0][1]
        max_date = transactions[-1][1]
        today = date.today()

        # Extend to today if last transaction is before today
        if max_date < today:
            max_date = today

        # Combine assets and FX currencies for price fetching
        all_symbols = list(assets)
        all_symbols.extend(fx_currencies)

        prices_dict = self.price_service.fetch_all_prices(
            all_symbols, min_date, max_date
        )

        # Calculate returns
        calculator = DailyReturnCalculator(transactions, prices_dict, min_date, max_date)
        results = calculator.calculate_all_returns()

        # Store results
        for result in results:
            self.db.insert_daily_return(
                result['date'],
                result['portfolio_value'],
                result['portfolio_daily_return'],
                investment_return=result.get('investment_return'),
                cash_flow_impact=result.get('cash_flow_impact'),
                adjusted_base=result.get('adjusted_base')
            )

    def get_daily_returns(self) -> list:
        """Get all daily returns as list of dicts with separated metrics."""
        returns = self.db.get_daily_returns()
        return [
            {
                'date': str(ret[0]),
                'portfolio_value': float(ret[1]),
                'portfolio_daily_return': float(ret[2]) if ret[2] is not None else 0.0,
                'investment_return': float(ret[3]) if ret[3] is not None else 0.0,
                'cash_flow_impact': float(ret[4]) if ret[4] is not None else 0.0,
                'adjusted_base': float(ret[5]) if ret[5] is not None else 0.0
            }
            for ret in returns
        ]

    def get_transactions(self) -> list:
        """Get all transactions as list of dicts."""
        transactions = self.db.get_transactions()

        # Get column names from schema
        col_names = [
            'id', 'date', 'asset', 'action', 'quantity',
            'asset_type', 'price', 'currency', 'fees', 'exchange', 'data_source'
        ]

        return [
            {col_names[i]: (
                str(trans[i]) if i == 1 else trans[i]  # Convert date to string
            ) for i in range(len(col_names))}
            for trans in transactions
        ]

    def export_returns_json(self, output_path: str):
        """Export daily returns to JSON."""
        returns = self.get_daily_returns()
        with open(output_path, 'w') as f:
            json.dump(returns, f, indent=2)

    def export_transactions_json(self, output_path: str):
        """Export transactions to JSON."""
        transactions = self.get_transactions()
        with open(output_path, 'w') as f:
            json.dump(transactions, f, indent=2)

    def get_performance_stats(self) -> dict:
        """Get portfolio performance statistics with separated return metrics."""
        import math
        from datetime import datetime
        returns = self.get_daily_returns()

        empty_stats = {
            'total_days': 0,
            'start_date': None,
            'end_date': None,
            'start_value': 0.0,
            'end_value': 0.0,
            'total_gain': 0.0,
            'net_gain': 0.0,
            'total_cash_flow': 0.0,
            'total_return_pct': 0.0,
            'avg_daily_return': 0.0,
            'avg_monthly_return': 0.0,
            'cagr': 0.0,
            'avg_investment_return': 0.0,
            'std_dev': 0.0,
            'hist_volatility': 0.0,
            'beta': 0.0,
            'sharpe_ratio': 0.0,
            'var_95': 0.0,
            'var_99': 0.0,
            'cvar_95': 0.0,
            'cvar_99': 0.0,
            'max_drawdown': 0.0,
            'avg_drawdown': 0.0,
            'avg_drawdown_duration': 0.0,
        }

        if not returns:
            return empty_stats.copy()

        # Filter out zero values
        returns_with_values = [r for r in returns if r['portfolio_value'] > 0]

        if not returns_with_values:
            return empty_stats.copy()

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

            spy_prices = self.price_service.fetch_all_prices(['SPY'], min_date, max_date)
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
        except:
            pass

        total_cash_flow = sum(r['cash_flow_impact'] for r in returns_with_values)
        start_value = returns_with_values[0]['portfolio_value']
        end_value = returns_with_values[-1]['portfolio_value']
        gross_gain = end_value - start_value
        net_gain = gross_gain - total_cash_flow

        # Calculate basic returns
        # True ROI: Net Gain relative to all capital invested
        # Total invested = Start Value + Deposits (cash flow into portfolio)
        total_invested = start_value + total_cash_flow  # deposits are positive
        total_return_pct = (net_gain / total_invested * 100) if total_invested > 0 else 0.0

        # CAGR from Total Return (accounts for deposit timing)
        # CAGR = (1 + Total Return)^(1/years) - 1
        from datetime import datetime
        start_date = datetime.strptime(returns_with_values[0]['date'], '%Y-%m-%d').date()
        end_date = datetime.strptime(returns_with_values[-1]['date'], '%Y-%m-%d').date()
        years = (end_date - start_date).days / 365.25
        total_return_decimal = total_return_pct / 100
        cagr_decimal = (((1 + total_return_decimal) ** (1 / years) - 1)) if total_return_decimal > -1 and years > 0 else 0.0
        cagr = cagr_decimal * 100

        # Sharpe Ratio (annualized)
        # SR = (Rp - Rf) / σp
        rf_annual = 0.02  # 2% annual risk-free rate
        sharpe_ratio = ((cagr_decimal - rf_annual) / (hist_volatility/100)) if hist_volatility > 0 else 0.0

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
            'end_date': returns_with_values[-1]['date'],
            'start_value': start_value,
            'end_value': end_value,
            'total_gain': gross_gain,
            'net_gain': net_gain,
            'total_cash_flow': total_cash_flow,
            'total_return_pct': total_return_pct,
            'avg_daily_return': avg,
            'avg_monthly_return': avg_monthly_return,
            'cagr': cagr,
            'avg_investment_return': sum(r['investment_return'] for r in returns_with_values) / len(returns_with_values),
            'std_dev': std_dev,
            'hist_volatility': hist_volatility,
            'beta': beta,
            'sharpe_ratio': sharpe_ratio,
            'var_95': var_95,
            'var_99': var_99,
            'cvar_95': cvar_95,
            'cvar_99': cvar_99,
            'max_drawdown': max_drawdown,
            'avg_drawdown': avg_drawdown,
            'avg_drawdown_duration': avg_drawdown_duration,
        }

    def evaluate_metric(self, metric_name: str, value: float) -> str:
        """Evaluate metric and return assessment comment."""
        assessments = {
            'avg_daily_return': lambda v: '✅ Excellent' if v > 0.2 else ('⚠️ Below avg' if v > 0 else '❌ Negative'),
            'avg_monthly_return': lambda v: '✅ Excellent' if v > 5 else ('⚠️ Below avg' if v > 0 else '❌ Negative'),
            'cagr': lambda v: '✅ Excellent' if v > 20 else ('⚠️ Good' if v > 10 else ('⚠️ Moderate' if v > 0 else '❌ Negative')),
            'total_return_pct': lambda v: '✅ Excellent' if v > 50 else ('⚠️ Good' if v > 20 else ('⚠️ Moderate' if v > 0 else '❌ Negative')),
            'std_dev': lambda v: '✅ Low' if v < 2 else ('⚠️ Moderate' if v < 4 else '❌ High'),
            'hist_volatility': lambda v: '✅ Low' if v < 20 else ('⚠️ Moderate' if v < 40 else '❌ High'),
            'beta': lambda v: '✅ Low corr' if abs(v) < 0.5 else ('⚠️ Moderate' if abs(v) < 1 else '❌ High'),
            'sharpe_ratio': lambda v: '✅ Excellent' if v > 2 else ('⚠️ Good' if v > 1 else ('⚠️ Poor' if v > 0 else '❌ Bad')),
            'var_95': lambda v: '✅ Low risk' if v > -3 else ('⚠️ Moderate' if v > -5 else '❌ High risk'),
            'var_99': lambda v: '✅ Low risk' if v > -5 else ('⚠️ Moderate' if v > -8 else '❌ High risk'),
            'cvar_95': lambda v: '✅ Low risk' if v > -4 else ('⚠️ Moderate' if v > -7 else '❌ High risk'),
            'cvar_99': lambda v: '✅ Low risk' if v > -6 else ('⚠️ Moderate' if v > -10 else '❌ High risk'),
            'max_drawdown': lambda v: '✅ Excellent' if v < 10 else ('⚠️ Normal' if v < 25 else '❌ High'),
            'avg_drawdown': lambda v: '✅ Low' if v < 4 else ('⚠️ Normal' if v < 8 else '❌ High'),
            'avg_drawdown_duration': lambda v: '✅ Fast' if v < 10 else ('⚠️ Normal' if v < 30 else '❌ Slow'),
            'hhi': lambda v: '✅ Diversified' if v < 0.15 else ('⚠️ Moderate' if v < 0.25 else '❌ Concentrated'),
            'weighted_avg_exposure': lambda v: '✅ Low' if v < 0.1 else ('⚠️ Moderate' if v < 0.2 else '❌ High'),
        }
        return assessments.get(metric_name, lambda v: '')(value)

    def get_concentration_metrics(self) -> dict:
        """Calculate portfolio concentration metrics."""
        allocation = self.get_allocation(allocation_type='all')
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

    def add_transaction(self, date_obj, asset: str, action: str, quantity: float, price: float = None, asset_type: str = None, currency: str = 'USD', fees: float = None, exchange: str = '', data_source: str = '') -> dict:
        """
        Add transaction and auto-trigger smart recalculation.

        Args:
            date_obj: Transaction date (date object or string DD-MM-YYYY)
            asset: Asset symbol
            action: BUY, SELL, or DEPOSIT
            quantity: Transaction quantity
            price: Asset price (optional, will be detected for unknown assets)
            asset_type: Asset type (optional, will be detected if not provided)
            currency: Currency code (default USD)
            fees: Transaction fees (optional)
            exchange: Exchange name (optional)
            data_source: Data source (optional)

        Returns:
            {"status": "success", "recalc_type": "partial|full", "from_date": ..., "transaction_id": ...}
        """
        # Parse date if string
        if isinstance(date_obj, str):
            date_obj = datetime.strptime(date_obj, '%d-%m-%Y').date()

        # Get last date BEFORE adding transaction
        last_date_before = self.db.get_last_transaction_date()

        # Detect asset_type if not provided
        if not asset_type:
            asset_type = self.price_service.detect_asset_type(asset)

        # Add transaction to database
        trans_id, is_old = self.db.add_transaction(
            date_obj, asset, action, quantity,
            asset_type=asset_type, price=price,
            currency=currency, fees=fees,
            exchange=exchange, data_source=data_source
        )

        # Determine recalculation scope based on date relative to previous last date
        if last_date_before is None:
            # First transaction ever
            is_full_recalc = True
            from_date = date_obj
        elif date_obj < last_date_before:
            # Old transaction - need full recalc from this date
            is_full_recalc = True
            from_date = date_obj
        else:
            # Recent transaction - partial recalc from this date
            is_full_recalc = False
            from_date = date_obj

        # Perform recalculation
        self.recalculate(from_date=from_date, force=False)

        recalc_type = 'full' if is_full_recalc else 'partial'
        return {
            'status': 'success',
            'recalc_type': recalc_type,
            'from_date': str(from_date),
            'transaction_id': trans_id
        }

    def _generate_cache_key(self) -> str:
        """Generate cache key based on transaction state."""
        transactions = self.db.get_transactions()
        trans_count = len(transactions)

        # Create hash of transaction data for cache validation
        if transactions:
            trans_str = json.dumps([str(t) for t in transactions])
            trans_hash = hashlib.md5(trans_str.encode()).hexdigest()
        else:
            trans_hash = ""

        return f"portfolio_{trans_count}_{trans_hash}"

    def _check_cache(self, from_date=None) -> bool:
        """Check if recalculation is needed based on cache."""
        cache_key = self._generate_cache_key()
        cached = self.db.get_cache(cache_key)

        if not cached:
            return False  # No cache found, need to recalculate

        cached_date = cached[1]  # last_calc_date

        # Convert to date if needed
        if hasattr(cached_date, 'date'):
            cached_date = cached_date.date()
        if hasattr(from_date, 'date'):
            from_date = from_date.date()

        # If no from_date specified, cache is valid if it exists
        if from_date is None:
            return True

        # If from_date is provided, cache is only valid if calculated after from_date
        if cached_date > from_date:
            return True  # Cache is more recent than requested date

        return False

    def _update_cache(self):
        """Update cache after successful recalculation."""
        cache_key = self._generate_cache_key()
        trans_count = self.db.get_transaction_count()
        self.db.set_cache(cache_key, date.today(), trans_count)

    def _detect_recalc_scope(self, new_trans_date) -> tuple:
        """
        Determine recalculation scope based on transaction date.
        Returns: (from_date, is_full_recalc)
        """
        last_date = self.db.get_last_transaction_date()

        if last_date is None:
            # First transaction ever
            return (new_trans_date, True)

        if new_trans_date < last_date:
            # Old transaction - need full recalc from this date
            return (new_trans_date, True)
        else:
            # Recent transaction - partial recalc from this date
            return (new_trans_date, False)

    def recalculate(self, from_date=None, force=False):
        """
        Smart recalculation with optional date range and caching.

        Args:
            from_date: Start date for recalc (None = full recalc from beginning)
            force: If True, ignore optimization and recalc everything

        Returns:
            {"status": "success", "recalc_type": "partial|full", "rows_affected": ...}
        """
        transactions = self.db.get_transactions()
        if not transactions:
            return {'status': 'error', 'message': 'No transactions found'}

        # Check cache if not forcing recalc
        if not force and self._check_cache(from_date):
            return {
                'status': 'success',
                'recalc_type': 'cached',
                'message': 'Using cached results'
            }

        # Determine recalc scope
        if force or from_date is None:
            # Full recalculation
            min_date = transactions[0][1]
            is_full_recalc = True
            self.db.clear_daily_returns()
        else:
            # Partial recalculation - delete from this date onwards
            is_full_recalc = False
            self.db.delete_daily_returns_from_date(from_date)
            min_date = from_date

        # Discover assets and currencies for price lookup
        discovered_assets = self.discover_assets_and_currencies()
        assets = set(discovered_assets['assets'])
        fx_currencies = discovered_assets['fx_currencies']

        # Get date range - always extend to today
        min_trans_date = transactions[0][1]
        max_trans_date = transactions[-1][1]
        max_date = date.today()

        # Combine assets and FX currencies for price fetching
        all_symbols = list(assets)
        all_symbols.extend(fx_currencies)

        # Fetch prices for needed date range
        prices_dict = self.price_service.fetch_all_prices(
            all_symbols, min_date, max_date
        )

        # Calculate returns using calculator
        calculator = DailyReturnCalculator(transactions, prices_dict, min_trans_date, max_trans_date)
        results = calculator.calculate_all_returns()

        # Persist prices to database for caching
        self._persist_prices_to_db(prices_dict)

        # Filter results if partial recalc
        if not is_full_recalc and from_date:
            results = [r for r in results if r['date'] >= from_date]

        # Store results
        rows_affected = 0
        for result in results:
            self.db.insert_daily_return(
                result['date'],
                result['portfolio_value'],
                result['portfolio_daily_return'],
                investment_return=result.get('investment_return'),
                cash_flow_impact=result.get('cash_flow_impact'),
                adjusted_base=result.get('adjusted_base')
            )
            rows_affected += 1

        # Log refresh event
        recalc_type = 'full' if is_full_recalc else 'partial'
        self.db.log_refresh(recalc_type, rows_affected)

        # Update cache after successful recalculation
        self._update_cache()

        return {
            'status': 'success',
            'recalc_type': recalc_type,
            'rows_affected': rows_affected
        }

    def discover_assets_and_currencies(self):
        """
        Discover all assets and required FX currencies from transactions.

        Returns:
            dict: Contains 'assets' and 'fx_currencies' lists
        """
        from portfolio_db.calculator import get_asset_type

        # Get unique assets from database
        assets = set(self.db.get_unique_assets())

        # Get unique currencies from transactions
        currencies = set(self.db.get_unique_currencies())

        # Determine required FX pairs
        fx_currencies = set()

        # Based on explicit currencies field
        for currency in currencies:
            if currency and currency != 'USD':  # Assuming USD is base currency
                if currency == 'EUR':
                    fx_currencies.add('EURUSD=X')
                elif currency == 'GBP':
                    fx_currencies.add('GBPUSD=X')
                elif currency == 'UAH':
                    fx_currencies.add('UAHUSD=X')

        # Check assets using get_asset_type for unified classification
        for asset in assets:
            asset_type = get_asset_type(asset)

            # FX currencies that are needed
            if asset_type == 'cash_fx':
                # Asset itself is FX (e.g., EURUSD=X, GBPUSD=X)
                fx_currencies.add(asset)
            elif asset_type == 'stock_gbp':
                # Stocks in GBP need GBPUSD rate
                fx_currencies.add('GBPUSD=X')
            elif asset_type == 'stock_eur':
                # Stocks in EUR need EURUSD rate
                fx_currencies.add('EURUSD=X')

            # Backwards compatibility: old CASH format
            if asset.startswith('CASH'):
                if asset == 'CASH EUR':
                    fx_currencies.add('EURUSD=X')
                elif asset == 'CASH GBP':
                    fx_currencies.add('GBPUSD=X')
                elif asset == 'CASH UAH':
                    fx_currencies.add('UAHUSD=X')

        return {
            'assets': list(assets),
            'fx_currencies': list(fx_currencies)
        }

    def _persist_prices_to_db(self, prices_dict: dict):
        """Store fetched prices to database for caching."""
        import pandas as pd
        try:
            for asset, price_data in prices_dict.items():
                if price_data is None or len(price_data) == 0:
                    continue

                # Handle both Series and DataFrame
                if isinstance(price_data, pd.DataFrame):
                    # If DataFrame, extract the first column (usually 'Close')
                    if len(price_data.columns) > 0:
                        price_series = price_data.iloc[:, 0]
                    else:
                        continue
                else:
                    price_series = price_data

                # Insert prices for this asset
                for date_idx, price in price_series.items():
                    date_obj = date_idx.date() if hasattr(date_idx, 'date') else date_idx
                    # Skip NaN values
                    try:
                        if price is None or (isinstance(price, float) and price != price):  # NaN check
                            continue
                        self.db.insert_price(asset, date_obj, float(price))
                    except Exception:
                        pass  # Skip individual price insert errors
        except Exception:
            pass  # Non-critical: if price persistence fails, calculation still works

    def verify_prices_storage(self) -> dict:
        """Verify and report on prices table structure and optimization."""
        info = self.db.get_prices_table_info()
        ticker_counts = self.db.get_prices_by_ticker_count()

        return {
            'status': 'verified',
            'schema': [
                {
                    'column': col[1],
                    'type': col[2],
                    'is_primary_key': col[5] > 0
                }
                for col in info['schema']
            ],
            'statistics': {
                'total_records': info['total_records'],
                'min_date': str(info['min_date']) if info['min_date'] else None,
                'max_date': str(info['max_date']) if info['max_date'] else None,
                'date_range_days': (info['max_date'] - info['min_date']).days if info['max_date'] and info['min_date'] else 0,
            },
            'ticker_breakdown': [
                {'ticker': ticker, 'record_count': count}
                for ticker, count in ticker_counts
            ],
            'optimization_notes': [
                'Primary key on (date, ticker) is optimal for lookups',
                'Index on ticker column enables fast filtering by asset',
                f'Table contains {len(ticker_counts)} unique tickers',
                f'Storage is efficient for {info["total_records"]} price records'
            ]
        }

    def get_actual_cash_balances(self) -> dict:
        """
        Single source of truth for cash balances.

        Calculates: Deposits - Spent on BUY + Received from SELL

        Returns:
            {
                'USD': {'balance': 1234.56, 'deposits': 5000, 'spent': 4000, 'received': 234.56},
                'EURUSD=X': {...},
                'GBPUSD=X': {...}
            }
        """
        from portfolio_db.calculator import get_asset_type

        transactions = self.db.get_transactions()
        cash_balances = {
            'USD': {'balance': 0.0, 'deposits': 0.0, 'spent': 0.0, 'received': 0.0},
            'EURUSD=X': {'balance': 0.0, 'deposits': 0.0, 'spent': 0.0, 'received': 0.0},
            'GBPUSD=X': {'balance': 0.0, 'deposits': 0.0, 'spent': 0.0, 'received': 0.0},
        }

        for trans in transactions:
            asset = trans[2]
            action = trans[3].upper()
            quantity = trans[4]
            price = trans[6]

            asset_type = get_asset_type(asset)

            # Determine which cash currency is affected
            if asset_type == 'stock_gbp':
                cash_key = 'GBPUSD=X'
            elif asset_type == 'stock_eur':
                cash_key = 'EURUSD=X'
            else:
                cash_key = 'USD'

            if action == 'DEPOSIT':
                # Handle both new format (USD, EURUSD=X) and old format (CASH USD, CASH EUR)
                if asset_type in ('cash_base', 'cash_fx') or asset.startswith('CASH'):
                    # Map asset to cash key
                    if asset_type == 'cash_base' or asset == 'CASH USD':
                        deposit_key = 'USD'
                    elif asset_type == 'cash_fx':
                        deposit_key = asset  # EURUSD=X, GBPUSD=X
                    elif asset == 'CASH EUR':
                        deposit_key = 'EURUSD=X'
                    elif asset == 'CASH GBP':
                        deposit_key = 'GBPUSD=X'
                    else:
                        deposit_key = 'USD'

                    cash_balances[deposit_key]['deposits'] += quantity
                    cash_balances[deposit_key]['balance'] += quantity
            elif action == 'BUY' and price:
                # Buying deducts from cash
                cost = quantity * price
                cash_balances[cash_key]['spent'] += cost
                cash_balances[cash_key]['balance'] -= cost
            elif action == 'SELL' and price:
                # Selling adds to cash
                proceeds = quantity * price
                cash_balances[cash_key]['received'] += proceeds
                cash_balances[cash_key]['balance'] += proceeds

        return cash_balances

    def get_position_summary(self, include_closed=True):
        """
        Get position-level summary with gains/losses.

        Args:
            include_closed: Include closed positions (shares = 0)

        Returns:
            List of position dicts with all required metrics
        """
        transactions = self.db.get_transactions()
        if not transactions:
            return []

        # Get latest daily return data
        daily_returns = self.get_daily_returns()
        latest_date = daily_returns[-1]['date'] if daily_returns else None
        latest_portfolio_value = daily_returns[-1]['portfolio_value'] if daily_returns else 0

        # Get latest prices - fetch all assets
        assets = self.db.get_unique_assets()
        min_date = transactions[0][1]
        max_date = date.today()

        discovered = self.discover_assets_and_currencies()
        all_symbols = list(discovered['assets'])
        all_symbols.extend(discovered['fx_currencies'])

        # Fetch prices from database first, then supplement with fresh prices
        prices_dict = {}

        # Try to fetch fresh prices
        try:
            prices_dict = self.price_service.fetch_all_prices(all_symbols, min_date, max_date)
        except Exception:
            pass

        # Build position data by asset (skip cash DEPOSIT - will be replaced with actual balances)
        positions = {}
        for trans in transactions:
            asset = trans[2]
            action = trans[3].upper()
            quantity = trans[4]
            price = trans[6]
            date_obj = trans[1]

            if asset not in positions:
                positions[asset] = {
                    'symbol': asset,
                    'shares': 0,
                    'buy_quantity': 0,
                    'buy_cost': 0.0,
                    'sell_quantity': 0,
                    'sell_proceeds': 0.0,
                    'dividend_income': 0.0,
                    'first_buy_date': date_obj,
                    'last_price_from_trans': None,
                }

            if action == 'BUY':
                positions[asset]['shares'] += quantity
                positions[asset]['buy_quantity'] += quantity
                if price:
                    positions[asset]['buy_cost'] += quantity * price
                    positions[asset]['last_price_from_trans'] = price
                positions[asset]['first_buy_date'] = min(positions[asset]['first_buy_date'], date_obj)
            elif action == 'SELL':
                positions[asset]['shares'] -= quantity
                positions[asset]['sell_quantity'] += quantity
                if price:
                    positions[asset]['sell_proceeds'] += quantity * price
                    positions[asset]['last_price_from_trans'] = price
            # DEPOSIT for cash is handled separately via get_actual_cash_balances()

        # Use actual cash balances as single source of truth
        actual_cash = self.get_actual_cash_balances()

        # Create/Update cash positions with actual balances
        from portfolio_db.calculator import get_asset_type

        for cash_key, cash_data in actual_cash.items():
            # Skip if balance is 0 and no deposits ever made
            if cash_data['balance'] == 0 and cash_data['deposits'] == 0:
                continue

            # Determine the symbol to use
            if cash_key == 'USD':
                symbol = 'USD'
            else:
                symbol = cash_key  # EURUSD=X, GBPUSD=X

            # Add or update cash position with actual balance
            if symbol not in positions:
                positions[symbol] = {
                    'symbol': symbol,
                    'shares': cash_data['balance'],
                    'buy_quantity': 0,
                    'buy_cost': 0.0,
                    'sell_quantity': 0,
                    'sell_proceeds': 0.0,
                    'dividend_income': 0.0,
                    'first_buy_date': date.today(),
                    'last_price_from_trans': None,
                }
            else:
                positions[symbol]['shares'] = cash_data['balance']

        # Calculate summary metrics for each position
        result = []
        for asset, pos_data in positions.items():
            shares = pos_data['shares']

            # Round to 0 if very small (rounding errors from floating point math)
            if abs(shares) < 0.01:
                shares = 0

            # Skip if closed and not including closed positions
            if shares == 0 and not include_closed:
                continue

            # Get latest price - try multiple sources
            last_price = None
            from portfolio_db.calculator import get_asset_type
            asset_type = get_asset_type(asset)

            # Helper to extract FX rate from price series
            def extract_fx_rate(fx_series):
                if fx_series is None:
                    return 1.0
                try:
                    val = fx_series.iloc[-1]
                    if hasattr(val, 'iloc'):
                        return float(val.iloc[0])
                    elif hasattr(val, 'values'):
                        return float(val.values[0] if len(val.values) > 0 else val)
                    else:
                        return float(val)
                except:
                    return 1.0

            if asset_type == 'cash_base' or asset == 'CASH USD':
                last_price = 1.0  # USD is always $1
            elif asset_type == 'cash_fx':
                # FX pairs: get actual FX rate from prices
                price_series = prices_dict.get(asset)
                if price_series is not None:
                    try:
                        import pandas as pd
                        val = price_series.iloc[-1]
                        # Handle Series (multi-column DataFrame) vs scalar
                        if hasattr(val, 'iloc'):
                            last_price = float(val.iloc[0])
                        elif hasattr(val, 'values'):
                            last_price = float(val.values[0] if len(val.values) > 0 else val)
                        else:
                            last_price = float(val)
                    except:
                        last_price = 1.0  # Fallback
                else:
                    last_price = 1.0  # Fallback
            elif asset.startswith('CASH'):
                # Old format: CASH EUR, CASH GBP - get FX rate
                if asset == 'CASH EUR':
                    last_price = extract_fx_rate(prices_dict.get('EURUSD=X'))
                elif asset == 'CASH GBP':
                    last_price = extract_fx_rate(prices_dict.get('GBPUSD=X'))
                else:
                    last_price = 1.0  # CASH USD
            else:
                # Try price_dict first
                price_series = prices_dict.get(asset)
                if price_series is not None:
                    try:
                        import pandas as pd
                        val = price_series.iloc[-1]
                        if hasattr(val, 'iloc'):
                            last_price = float(val.iloc[0])
                        elif hasattr(val, 'values'):
                            last_price = float(val.values[0] if len(val.values) > 0 else val)
                        else:
                            last_price = float(val)
                    except:
                        pass

                # Fallback to transaction price
                if last_price is None:
                    last_price = pos_data['last_price_from_trans']

                # Apply FX conversion for non-USD stocks
                if last_price and asset_type == 'stock_gbp':
                    gbp_rate = extract_fx_rate(prices_dict.get('GBPUSD=X'))
                    last_price = last_price * gbp_rate
                elif last_price and asset_type == 'stock_eur':
                    eur_rate = extract_fx_rate(prices_dict.get('EURUSD=X'))
                    last_price = last_price * eur_rate

            # Calculate metrics
            avg_cost_per_share = (pos_data['buy_cost'] / pos_data['buy_quantity']) if pos_data['buy_quantity'] > 0 else 0
            # Total cost of CURRENT shares (not all shares ever bought)
            total_cost = (shares * avg_cost_per_share) if shares > 0 else 0
            # Market value: for cash, allow negative values; for other assets, only positive
            is_cash = asset_type in ('cash_base', 'cash_fx') or asset.startswith('CASH')
            market_value = (shares * last_price) if last_price and (shares > 0 or is_cash) else 0

            # Unrealized gains (only for current holding)
            unrealized_gain_value = market_value - total_cost if shares > 0 else 0
            unrealized_gain_pct = (unrealized_gain_value / total_cost * 100) if total_cost > 0 and shares > 0 else 0

            # Realized gains (from sold positions)
            realized_gain_value = pos_data['sell_proceeds'] - (pos_data['sell_quantity'] * avg_cost_per_share) if pos_data['sell_quantity'] > 0 else 0
            realized_gain_pct = (realized_gain_value / (pos_data['sell_quantity'] * avg_cost_per_share) * 100) if pos_data['sell_quantity'] > 0 and avg_cost_per_share > 0 else 0

            # Daily gains (calculate from price changes for this position)
            daily_gain_pct = 0.0
            daily_gain_value = 0.0

            if shares > 0 and last_price and not asset.startswith('CASH'):
                # Get price series to calculate daily change
                price_series = prices_dict.get(asset)
                if price_series is not None and len(price_series) > 1:
                    try:
                        import pandas as pd
                        # Extract price values from the DataFrame/Series
                        if isinstance(price_series, pd.DataFrame):
                            # DataFrame case: extract column for this asset
                            today_price = float(price_series.iloc[-1][asset])
                            yesterday_price = float(price_series.iloc[-2][asset])
                        else:
                            # Series case
                            today_price = float(price_series.iloc[-1])
                            yesterday_price = float(price_series.iloc[-2])

                        if yesterday_price > 0:
                            daily_gain_pct = ((today_price - yesterday_price) / yesterday_price) * 100
                            daily_gain_value = shares * (today_price - yesterday_price)
                    except:
                        pass

            status = 'OPEN' if shares > 0 else 'CLOSED'

            result.append({
                'symbol': asset,
                'status': status,
                'shares': shares,
                'last_price': last_price,
                'avg_cost_per_share': avg_cost_per_share,
                'total_cost': total_cost,
                'market_value': market_value,
                'dividend_income': pos_data['dividend_income'],
                'day_gain_pct': daily_gain_pct,
                'day_gain_value': daily_gain_value,
                'total_gain_pct': unrealized_gain_pct,
                'total_gain_value': unrealized_gain_value,
                'realized_gain_value': realized_gain_value,
                'realized_gain_pct': realized_gain_pct,
            })

        # Sort by market value descending
        result.sort(key=lambda x: x['market_value'], reverse=True)
        return result

    def get_allocation(self, allocation_type='all'):
        """
        Get portfolio allocation breakdown.

        Args:
            allocation_type: 'assets' (stocks/crypto only), 'cash' (cash only), or 'all' (both)

        Returns:
            List of allocation dicts with symbol, value, percentage
        """
        from portfolio_db.calculator import get_asset_type

        positions = self.get_position_summary(include_closed=False)

        # Separate assets and cash
        assets = []
        cash = []
        for p in positions:
            asset_type = get_asset_type(p['symbol'])
            if asset_type in ('cash_base', 'cash_fx') or p['symbol'].startswith('CASH'):
                cash.append(p)
            else:
                assets.append(p)

        # Fetch FX rates for cash conversion
        transactions = self.db.get_transactions()
        min_date = transactions[0][1] if transactions else date.today()
        max_date = date.today()

        fx_prices = {}
        try:
            fx_dict = self.price_service.fetch_all_prices(
                ['EURUSD=X', 'GBPUSD=X'], min_date, max_date
            )
            # Extract latest FX rates
            for fx_pair in ['EURUSD=X', 'GBPUSD=X']:
                if fx_pair in fx_dict:
                    ps = fx_dict[fx_pair]
                    try:
                        import pandas as pd
                        if isinstance(ps, pd.DataFrame):
                            fx_prices[fx_pair] = float(ps.iloc[-1][fx_pair])
                        else:
                            fx_prices[fx_pair] = float(ps.iloc[-1])
                    except:
                        pass
        except:
            pass

        # Default FX rates if fetching fails
        if 'EURUSD=X' not in fx_prices:
            fx_prices['EURUSD=X'] = 1.196
        if 'GBPUSD=X' not in fx_prices:
            fx_prices['GBPUSD=X'] = 1.3769

        # Convert cash to USD
        cash_in_usd = []
        for pos in cash:
            symbol = pos['symbol']
            value = pos['market_value']
            asset_type = get_asset_type(symbol)

            # Convert to USD if not already USD
            # FX pairs (EURUSD=X, GBPUSD=X) already have market_value in USD
            # because market_value = shares (foreign currency) * price (FX rate to USD)
            if symbol == 'EURUSD=X':
                value_usd = value  # Already in USD
                fx_rate = 1.0  # No conversion applied
            elif symbol == 'GBPUSD=X':
                value_usd = value  # Already in USD
                fx_rate = 1.0  # No conversion applied
            elif symbol == 'CASH EUR':
                # Backwards compatibility - old format needs conversion
                value_usd = value * fx_prices['EURUSD=X']
                fx_rate = fx_prices['EURUSD=X']
            elif symbol == 'CASH GBP':
                # Backwards compatibility - old format needs conversion
                value_usd = value * fx_prices['GBPUSD=X']
                fx_rate = fx_prices['GBPUSD=X']
            else:
                # USD
                value_usd = value
                fx_rate = 1.0

            cash_in_usd.append({
                **pos,
                'value_usd': value_usd,
                'fx_rate': fx_rate,
            })

        # Calculate totals using USD-converted values
        total_assets_value = sum(p['market_value'] for p in assets)
        total_cash_value = sum(p['value_usd'] for p in cash_in_usd)
        total_portfolio_value = total_assets_value + total_cash_value

        result = []

        if allocation_type in ['assets', 'all']:
            # Add assets allocation
            for pos in assets:
                if allocation_type == 'all':
                    pct = (pos['market_value'] / total_portfolio_value * 100) if total_portfolio_value > 0 else 0
                else:  # assets only
                    pct = (pos['market_value'] / total_assets_value * 100) if total_assets_value > 0 else 0

                result.append({
                    'symbol': pos['symbol'],
                    'type': 'asset',
                    'value': pos['market_value'],
                    'percentage': pct,
                })

        if allocation_type in ['cash', 'all']:
            # Add cash allocation (converted to USD)
            for pos in cash_in_usd:
                if allocation_type == 'all':
                    pct = (pos['value_usd'] / total_portfolio_value * 100) if total_portfolio_value > 0 else 0
                else:  # cash only
                    pct = (pos['value_usd'] / total_cash_value * 100) if total_cash_value > 0 else 0

                result.append({
                    'symbol': pos['symbol'],
                    'type': 'cash',
                    'value': pos['value_usd'],
                    'percentage': pct,
                    'original_currency_value': pos['market_value'],
                    'fx_rate': pos['fx_rate'],
                })

        # Sort by value descending
        result.sort(key=lambda x: x['value'], reverse=True)

        # Add summary totals
        summary = []
        if allocation_type in ['assets', 'all']:
            if allocation_type == 'all':
                assets_pct = (total_assets_value / total_portfolio_value * 100) if total_portfolio_value > 0 else 0
            else:
                assets_pct = 100.0 if total_assets_value > 0 else 0

            summary.append({
                'symbol': 'TOTAL ASSETS',
                'type': 'summary',
                'value': total_assets_value,
                'percentage': assets_pct,
            })

        if allocation_type in ['cash', 'all']:
            if allocation_type == 'all':
                cash_pct = (total_cash_value / total_portfolio_value * 100) if total_portfolio_value > 0 else 0
            else:
                cash_pct = 100.0 if total_cash_value > 0 else 0

            summary.append({
                'symbol': 'TOTAL CASH',
                'type': 'summary',
                'value': total_cash_value,
                'percentage': cash_pct,
            })

        if allocation_type == 'all':
            summary.append({
                'symbol': 'TOTAL PORTFOLIO',
                'type': 'summary',
                'value': total_portfolio_value,
                'percentage': 100.0,
            })

        return {
            'positions': result,
            'summary': summary,
            'total_value': total_portfolio_value,
        }

    def delete_transaction(self, transaction_id: int) -> dict:
        """Delete transaction and auto-recalculate returns."""
        # Get transaction before deletion
        trans = self.db.con.execute(
            "SELECT id, date, asset, action, quantity FROM transactions WHERE id = ?",
            [transaction_id]
        ).fetchone()

        if not trans:
            raise ValueError(f"Transaction ID {transaction_id} not found")

        trans_date = trans[1]

        # Delete transaction
        self.db.delete_transaction_by_id(transaction_id)

        # Delete daily returns from that date onwards
        self.db.delete_daily_returns_from_date(trans_date)

        # Recalculate from that date
        recalc_result = self.recalculate(from_date=trans_date)

        return {
            'transaction_id': trans[0],
            'deleted_transaction': {
                'date': str(trans[1]),
                'asset': trans[2],
                'action': trans[3],
                'quantity': trans[4]
            },
            'recalc_type': recalc_result['recalc_type'],
            'from_date': str(trans_date),
            'rows_affected': recalc_result.get('rows_affected', 0)
        }

    def close(self):
        """Close database connection."""
        self.db.close()
