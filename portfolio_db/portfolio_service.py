"""High-level portfolio service API."""

import json
import hashlib
from datetime import datetime, date
from pathlib import Path

from portfolio_db.database import PortfolioDatabase
from portfolio_db.price_service import PriceService
from portfolio_db.calculator import DailyReturnCalculator


class PriceDataUnavailableError(ValueError):
    """Raised when required price or FX data is unavailable for valuation."""
    pass


class PortfolioService:
    """High-level API for portfolio operations."""

    RISK_FREE_RATE_ANNUAL = 0.02
    BASE_CURRENCY = 'USD'
    EXTERNAL_INFLOW_ACTIONS = {'DEPOSIT', 'TRANSFER'}
    EXTERNAL_OUTFLOW_ACTIONS = {'WITHDRAW'}
    INCOME_ACTIONS = {'DIVIDEND', 'INTEREST'}
    EXPENSE_ACTIONS = {'FEE', 'TAX'}
    TRADE_ACTIONS = {'BUY', 'SELL'}
    SYSTEM_ACTIONS = {'EXCHANGE_FROM', 'EXCHANGE_TO'}
    SUPPORTED_ACTIONS = tuple(sorted(
        EXTERNAL_INFLOW_ACTIONS
        | EXTERNAL_OUTFLOW_ACTIONS
        | INCOME_ACTIONS
        | EXPENSE_ACTIONS
        | TRADE_ACTIONS
        | SYSTEM_ACTIONS
    ))
    CASH_FX_SYMBOLS = ('EURUSD=X', 'GBPUSD=X', 'UAHUSD=X')
    CASH_BUCKET_DEFAULTS = {
        'USD': {'balance': 0.0, 'deposits': 0.0, 'withdrawals': 0.0, 'spent': 0.0, 'received': 0.0, 'dividends': 0.0, 'interest': 0.0, 'fees': 0.0, 'taxes': 0.0},
        'EURUSD=X': {'balance': 0.0, 'deposits': 0.0, 'withdrawals': 0.0, 'spent': 0.0, 'received': 0.0, 'dividends': 0.0, 'interest': 0.0, 'fees': 0.0, 'taxes': 0.0},
        'GBPUSD=X': {'balance': 0.0, 'deposits': 0.0, 'withdrawals': 0.0, 'spent': 0.0, 'received': 0.0, 'dividends': 0.0, 'interest': 0.0, 'fees': 0.0, 'taxes': 0.0},
    }
    CASH_DISPLAY_CURRENCY = {
        'USD': 'USD',
        'EURUSD=X': 'EUR',
        'GBPUSD=X': 'GBP',
        'UAHUSD=X': 'UAH',
    }
    ALLOCATION_SUMMARY_LABELS = {
        'assets': 'TOTAL ASSETS',
        'cash': 'TOTAL CASH',
        'portfolio': 'TOTAL PORTFOLIO',
    }

    def __init__(self, db_path: str = "portfolio.db", read_only: bool = False):
        """Initialize service."""
        self.db = PortfolioDatabase(db_path, read_only=read_only)
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

    def _load_calculation_prices(self, symbols: list[str], start_date, end_date) -> dict:
        """Load calculation prices by combining live fetch results with cached DB prices."""
        import pandas as pd

        try:
            live_prices = self.price_service.fetch_all_prices(symbols, start_date, end_date)
        except Exception:
            live_prices = {}

        cached_prices = self.db.get_price_series(symbols, start_date=start_date, end_date=end_date)
        merged = dict(cached_prices)

        for symbol, series in live_prices.items():
            cached_series = merged.get(symbol)
            if cached_series is None or len(cached_series) == 0:
                merged[symbol] = series
                continue
            if series is None or len(series) == 0:
                continue

            combined = pd.concat([cached_series, series]).sort_index()
            combined = combined[~combined.index.duplicated(keep='last')]
            merged[symbol] = combined

        return merged

    def _calculate_and_store_returns(self):
        """Calculate and store daily returns."""
        import pandas as pd

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

        prices_dict = self._load_calculation_prices(all_symbols, min_date, max_date)

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

    def get_daily_returns_paginated(self, limit: int = 50, offset: int = 0, start_date=None, end_date=None):
        """Get paginated daily returns with optional date filter."""
        rows, total = self.db.get_daily_returns_paginated(limit, offset, start_date, end_date)
        data = [
            {
                'date': str(ret[0]),
                'portfolio_value': float(ret[1]),
                'portfolio_daily_return': float(ret[2]) if ret[2] is not None else 0.0,
                'investment_return': float(ret[3]) if ret[3] is not None else 0.0,
                'cash_flow_impact': float(ret[4]) if ret[4] is not None else 0.0,
                'adjusted_base': float(ret[5]) if ret[5] is not None else 0.0,
            }
            for ret in rows
        ]
        return data, total

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

    def get_transactions_paginated(self, limit: int = 50, offset: int = 0, start_date=None, end_date=None):
        """Get paginated transactions with optional date filter."""
        col_names = [
            'id', 'date', 'asset', 'action', 'quantity',
            'asset_type', 'price', 'currency', 'fees', 'exchange', 'data_source'
        ]
        rows, total = self.db.get_transactions_paginated(limit, offset, start_date, end_date)
        data = [
            {col_names[i]: (str(trans[i]) if i == 1 else trans[i]) for i in range(len(col_names))}
            for trans in rows
        ]
        return data, total

    @staticmethod
    def _serialize_transaction_row(trans) -> dict:
        """Convert a DB transaction tuple into the standard response shape."""
        col_names = [
            'id', 'date', 'asset', 'action', 'quantity',
            'asset_type', 'price', 'currency', 'fees', 'exchange', 'data_source'
        ]
        return {
            name: (str(value) if name == 'date' else value)
            for name, value in zip(col_names, trans)
        }

    @classmethod
    def _empty_cash_bucket(cls) -> dict:
        """Return a new mutable cash bucket record."""
        return {
            'balance': 0.0,
            'deposits': 0.0,
            'withdrawals': 0.0,
            'spent': 0.0,
            'received': 0.0,
            'dividends': 0.0,
            'interest': 0.0,
            'fees': 0.0,
            'taxes': 0.0,
        }

    @classmethod
    def validate_action(cls, action: str) -> str:
        """Normalize and validate a transaction action."""
        normalized = action.upper()
        if normalized not in cls.SUPPORTED_ACTIONS:
            supported = ", ".join(cls.SUPPORTED_ACTIONS)
            raise ValueError(f"Unsupported action {action!r}. Supported actions: {supported}")
        return normalized

    @staticmethod
    def derive_asset_type(asset: str) -> str:
        """Classify assets using the app's internal ticker rules."""
        from portfolio_db.calculator import get_asset_type

        return get_asset_type(asset)

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

    @staticmethod
    def _normalize_cash_asset(asset: str, asset_type: str) -> str:
        """Map cash-like assets to a canonical ticker."""
        if asset_type == 'cash_base' or asset == 'CASH USD':
            return PortfolioService.BASE_CURRENCY
        if asset_type == 'cash_fx':
            return asset
        if asset == 'CASH EUR':
            return 'EURUSD=X'
        if asset == 'CASH GBP':
            return 'GBPUSD=X'
        if asset == 'CASH UAH':
            return 'UAHUSD=X'
        return asset

    def _get_fx_conversion_series(self, cash_assets: set, min_date, max_date) -> dict:
        """Fetch FX series needed to convert cash flows into USD."""
        fx_assets = {asset for asset in cash_assets if asset not in {self.BASE_CURRENCY, 'CASH USD'}}
        if not fx_assets:
            return {}

        try:
            return self.price_service.fetch_all_prices(sorted(fx_assets), min_date, max_date)
        except Exception:
            return {}

    def _convert_cash_amount_to_usd(self, asset: str, quantity: float, date_obj, fx_prices: dict) -> float:
        """Convert a cash amount in the original cash currency to USD."""
        from portfolio_db.calculator import get_asset_type

        asset_type = get_asset_type(asset)
        normalized_asset = self._normalize_cash_asset(asset, asset_type)
        if normalized_asset == self.BASE_CURRENCY:
            return float(quantity)

        fx_rate = self._require_series_price_asof(
            fx_prices.get(normalized_asset),
            date_obj,
            symbol=normalized_asset,
            kind='FX rate',
        )
        return float(quantity) * fx_rate

    def _empty_reporting_snapshot(self) -> dict:
        """Return an empty reporting snapshot."""
        return {
            'as_of_date': None,
            'portfolio_value': 0.0,
            'positions': [],
            'cash_balances': [],
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
            'total_profit': 0.0,
            'time_weighted_return_pct': 0.0,
            'total_return_pct': 0.0,
            'total_invested': 0.0,
            'cagr': 0.0,
        }

    def _resolve_as_of_date(self, as_of_date=None):
        """Resolve the canonical reporting date."""
        if as_of_date is not None:
            return as_of_date

        returns = self.get_daily_returns()
        if returns:
            return datetime.strptime(returns[-1]['date'], '%Y-%m-%d').date()

        last_transaction_date = self.db.get_last_transaction_date()
        if last_transaction_date:
            return last_transaction_date

        return None

    @staticmethod
    def _extract_scalar_price(value):
        """Extract scalar from Series/DataFrame cell-like objects."""
        if value is None:
            return None
        if hasattr(value, 'iloc'):
            if len(value) == 0:
                return None
            value = value.iloc[0]
        elif hasattr(value, 'values'):
            values = value.values
            if len(values) == 0:
                return None
            value = values[0]

        try:
            value = float(value)
        except (TypeError, ValueError):
            return None

        if value != value:
            return None
        return value

    def _get_series_price_asof(self, price_series, valuation_ts):
        """Read price using asof semantics at or before valuation_ts."""
        import pandas as pd

        if price_series is None:
            return None
        try:
            return self._extract_scalar_price(price_series.asof(pd.Timestamp(valuation_ts)))
        except Exception:
            return None

    def _require_series_price_asof(self, price_series, valuation_ts, *, symbol: str, kind: str) -> float:
        """Read mandatory price/FX data or raise a user-facing retry error."""
        value = self._get_series_price_asof(price_series, valuation_ts)
        if value is None:
            valuation_label = str(getattr(valuation_ts, 'date', lambda: valuation_ts)())
            raise PriceDataUnavailableError(
                f"{kind} unavailable for {symbol} as of {valuation_label}; try again."
            )
        return value

    @staticmethod
    def _get_cash_key_for_asset(asset: str, asset_type: str) -> str:
        """Return canonical cash bucket for an asset or currency."""
        if asset_type == 'stock_gbp' or asset == 'CASH GBP':
            return PortfolioService.CASH_FX_SYMBOLS[1]
        if asset_type == 'stock_eur' or asset == 'CASH EUR':
            return PortfolioService.CASH_FX_SYMBOLS[0]
        if asset_type == 'cash_fx':
            return asset
        return PortfolioService.BASE_CURRENCY

    def _get_transactions_up_to(self, as_of_date=None):
        """Return transactions up to and including as_of_date."""
        transactions = self.db.get_transactions()
        if as_of_date is None:
            return transactions
        return [trans for trans in transactions if trans[1] <= as_of_date]

    def _load_reporting_price_context(self, as_of_date) -> dict:
        """Fetch price context for one reporting date."""
        import pandas as pd

        transactions = self._get_transactions_up_to(as_of_date)
        if not transactions:
            return {
                'as_of_date': as_of_date,
                'valuation_ts': pd.Timestamp(as_of_date) if as_of_date else None,
                'transactions': [],
                'prices_dict': {},
                'returns': [],
            }

        min_date = transactions[0][1]
        discovered = self.discover_assets_and_currencies()
        all_symbols = list(discovered['assets'])
        all_symbols.extend(discovered['fx_currencies'])
        prices_dict = self.db.get_price_series(all_symbols, start_date=min_date, end_date=as_of_date)

        returns = [
            row for row in self.get_daily_returns()
            if datetime.strptime(row['date'], '%Y-%m-%d').date() <= as_of_date
        ]

        return {
            'as_of_date': as_of_date,
            'valuation_ts': pd.Timestamp(as_of_date),
            'transactions': transactions,
            'prices_dict': prices_dict,
            'returns': returns,
        }

    def _get_external_cash_flow_metrics(self, transactions=None, as_of_date=None, fx_prices=None) -> dict:
        """Calculate cash-flow and cash-income metrics in USD."""
        from portfolio_db.calculator import get_asset_type

        if transactions is None:
            transactions = self._get_transactions_up_to(as_of_date)
        if not transactions:
            return {
                'deposits': 0.0,
                'withdrawals': 0.0,
                'net_contributions': 0.0,
                'dividends': 0.0,
                'interest': 0.0,
                'fees': 0.0,
                'taxes': 0.0,
                'income': 0.0,
                'cash_flow_events': [],
            }

        if fx_prices is None:
            cash_assets = set()
            min_date = transactions[0][1]
            max_date = transactions[-1][1]

            for trans in transactions:
                asset = trans[2]
                asset_type = get_asset_type(asset)
                if asset_type in ('cash_base', 'cash_fx') or asset.startswith('CASH'):
                    cash_assets.add(self._normalize_cash_asset(asset, asset_type))

            fx_prices = self._get_fx_conversion_series(cash_assets, min_date, max_date)

        deposits = 0.0
        withdrawals = 0.0
        dividends = 0.0
        interest = 0.0
        fees = 0.0
        taxes = 0.0
        cash_flow_events = []

        for trans in transactions:
            date_obj = trans[1]
            asset = trans[2]
            action = self.validate_action(trans[3])
            quantity = float(trans[4])
            asset_type = get_asset_type(asset)
            is_cash_asset = asset_type in ('cash_base', 'cash_fx') or asset.startswith('CASH')

            if not is_cash_asset:
                continue

            amount_usd = self._convert_cash_amount_to_usd(asset, quantity, date_obj, fx_prices)
            if action in self.EXTERNAL_INFLOW_ACTIONS:
                deposits += amount_usd
                cash_flow_events.append({'date': date_obj, 'amount': amount_usd})
            elif action in self.EXTERNAL_OUTFLOW_ACTIONS:
                withdrawals += amount_usd
                cash_flow_events.append({'date': date_obj, 'amount': -amount_usd})
            elif action == 'DIVIDEND':
                dividends += amount_usd
            elif action == 'INTEREST':
                interest += amount_usd
            elif action == 'FEE':
                fees += amount_usd
            elif action == 'TAX':
                taxes += amount_usd

        return {
            'deposits': deposits,
            'withdrawals': withdrawals,
            'net_contributions': deposits - withdrawals,
            'dividends': dividends,
            'interest': interest,
            'fees': fees,
            'taxes': taxes,
            'income': dividends + interest,
            'cash_flow_events': cash_flow_events,
        }

    def _get_profit_components(self, positions=None) -> dict:
        """Split PnL into realized and unrealized components."""
        from portfolio_db.calculator import get_asset_type

        if positions is None:
            positions = self.get_position_summary(include_closed=True)

        realized = 0.0
        unrealized = 0.0

        for position in positions:
            asset_type = get_asset_type(position['symbol'])
            if asset_type in ('cash_base', 'cash_fx') or position['symbol'].startswith('CASH'):
                continue
            realized += float(position.get('realized_gain_value') or 0.0)
            unrealized += float(position.get('total_gain_value') or 0.0)

        return {
            'realized': realized,
            'unrealized': unrealized,
            'total_profit': realized + unrealized,
        }

    def get_performance_stats(self) -> dict:
        """Get portfolio performance statistics with separated return metrics."""
        import math
        from datetime import datetime
        snapshot = self.build_reporting_snapshot()
        as_of_date = snapshot['as_of_date']
        returns = self.get_daily_returns()
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
        from datetime import datetime
        start_date = datetime.strptime(returns_with_values[0]['date'], '%Y-%m-%d').date()
        end_date = datetime.strptime(returns_with_values[-1]['date'], '%Y-%m-%d').date()
        years = (end_date - start_date).days / 365.25
        total_return_decimal = total_return_pct / 100
        cagr_decimal = (((1 + total_return_decimal) ** (1 / years) - 1)) if total_return_decimal > -1 and years > 0 else 0.0
        cagr = cagr_decimal * 100

        # Sharpe Ratio (annualized)
        # SR = (Rp - Rf) / σp
        rf_annual = self.RISK_FREE_RATE_ANNUAL
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
            action: BUY, SELL, DEPOSIT, WITHDRAW, or FEE
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
        action = self.validate_action(action)

        # Get last date BEFORE adding transaction
        last_date_before = self.db.get_last_transaction_date()

        # Detect asset_type if not provided
        if not asset_type and action not in self.SYSTEM_ACTIONS:
            asset_type = self.derive_asset_type(asset)

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

    def edit_transaction(self, transaction_id: int, **changes) -> dict:
        """Edit a transaction and recalculate from the earliest affected date."""
        existing = self.db.get_transaction_by_id(transaction_id)
        if not existing:
            raise ValueError(f"Transaction ID {transaction_id} not found")

        current = self._serialize_transaction_row(existing)
        updated = current.copy()
        updated.update({key: value for key, value in changes.items() if value is not None})

        if isinstance(updated['date'], str):
            try:
                updated['date'] = datetime.strptime(updated['date'], '%d-%m-%Y').date()
            except ValueError:
                updated['date'] = datetime.strptime(updated['date'], '%Y-%m-%d').date()

        updated['action'] = self.validate_action(updated['action'])

        if updated['action'] not in self.SYSTEM_ACTIONS:
            updated['asset_type'] = self.derive_asset_type(updated['asset'])

        recalc_from = min(existing[1], updated['date'])
        updated_row = self.db.update_transaction(
            transaction_id,
            date=updated['date'],
            asset=updated['asset'],
            action=updated['action'],
            quantity=updated['quantity'],
            asset_type=updated.get('asset_type'),
            price=updated.get('price'),
            currency=updated.get('currency', 'USD'),
            fees=updated.get('fees'),
            exchange=updated.get('exchange', ''),
            data_source=updated.get('data_source', ''),
        )
        recalc_result = self.recalculate(from_date=recalc_from, force=True)
        return {
            'status': 'success',
            'recalc_type': recalc_result.get('recalc_type', 'full'),
            'from_date': str(recalc_from),
            'transaction': self._serialize_transaction_row(updated_row),
        }

    def exchange_currency(self, date_obj, from_asset: str, to_asset: str, quantity: float, rate: float) -> dict:
        """
        Exchange one currency for another.

        Creates two transactions:
        1. EXCHANGE_FROM: deducts from source currency
        2. EXCHANGE_TO: adds to target currency

        Args:
            date_obj: Transaction date
            from_asset: Source asset/currency (e.g., USD, EURUSD=X)
            to_asset: Target asset/currency (e.g., USD, EURUSD=X)
            quantity: Amount to exchange (in source currency)
            rate: Exchange rate (amount of target per 1 unit of source)

        Returns:
            {"status": "success", "from_trans_id": ..., "to_trans_id": ..., "recalc_type": ..., "from_date": ...}
        """
        # Get last date BEFORE adding transaction
        last_date_before = self.db.get_last_transaction_date()

        target_amount = quantity * rate

        # Add EXCHANGE_FROM transaction (deduct from source)
        from_trans_id, _ = self.db.add_transaction(
            date_obj, from_asset, 'EXCHANGE_FROM', -quantity,
            asset_type=None, price=None, currency='', fees=None,
            exchange='', data_source=f'→ {to_asset} @ {rate}'
        )

        # Add EXCHANGE_TO transaction (add to target)
        to_trans_id, _ = self.db.add_transaction(
            date_obj, to_asset, 'EXCHANGE_TO', target_amount,
            asset_type=None, price=None, currency='', fees=None,
            exchange='', data_source=f'← {from_asset} @ {rate}'
        )

        # Determine recalculation scope
        if last_date_before is None:
            is_full_recalc = True
            from_date = date_obj
        elif date_obj < last_date_before:
            is_full_recalc = True
            from_date = date_obj
        else:
            is_full_recalc = False
            from_date = date_obj

        # Perform recalculation
        self.recalculate(from_date=from_date, force=False)

        recalc_type = 'full' if is_full_recalc else 'partial'
        return {
            'status': 'success',
            'from_trans_id': from_trans_id,
            'to_trans_id': to_trans_id,
            'recalc_type': recalc_type,
            'from_date': str(from_date),
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
        calc_start_date = transactions[0][1]
        if force or from_date is None:
            # Full recalculation
            is_full_recalc = True
            self.db.clear_daily_returns()
        else:
            # Partial recalculation still needs the full historical price context.
            # The calculator rebuilds holdings from the first transaction, so
            # fetching prices only from from_date breaks the retained rows'
            # prev_value / adjusted_base chain.
            is_full_recalc = False
            self.db.delete_daily_returns_from_date(from_date)

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

        # Fetch prices for the full calculation window even during partial
        # recalculation. Results can still be filtered before persistence.
        prices_dict = self._load_calculation_prices(all_symbols, calc_start_date, max_date)

        # Calculate returns using calculator
        calculator = DailyReturnCalculator(transactions, prices_dict, min_trans_date, max_date)
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
            if currency and currency != self.BASE_CURRENCY:  # Assuming USD is base currency
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
                    except Exception as e:
                        # Individual price insert failures are non-critical
                        # Calculation still works with fresh prices
                        continue
        except Exception as e:
            # Price persistence is non-critical - calculations use fresh prices
            pass

    def analyze_price_coverage(self, start_date=None, end_date=None) -> dict:
        """Inspect cached price coverage for all required tickers."""
        transactions = self.db.get_transactions()
        if not transactions:
            return {
                'required_range': {'start': None, 'end': None},
                'required_tickers': [],
                'coverage': [],
                'issues': [],
            }

        required_start = start_date or transactions[0][1]
        required_end = end_date or self._resolve_as_of_date() or transactions[-1][1]
        discovered = self.discover_assets_and_currencies()
        required_tickers = sorted({
            ticker for ticker in (set(discovered['assets']) | set(discovered['fx_currencies']))
            if ticker != self.BASE_CURRENCY
        })
        cached = self.db.get_price_series(required_tickers, start_date=required_start, end_date=required_end)

        coverage = []
        issues = []
        for ticker in required_tickers:
            series = cached.get(ticker)
            cached_rows = len(series) if series is not None else 0
            cached_start = series.index[0].date() if series is not None and len(series) else None
            cached_end = series.index[-1].date() if series is not None and len(series) else None
            has_start_price = self._get_series_price_asof(series, required_start) is not None
            has_end_price = self._get_series_price_asof(series, required_end) is not None
            issue_flags = []
            if cached_rows == 0:
                issue_flags.append('missing_series')
            if not has_start_price:
                issue_flags.append('missing_start_coverage')
            if not has_end_price:
                issue_flags.append('missing_end_coverage')
            coverage.append({
                'ticker': ticker,
                'required_start': str(required_start),
                'required_end': str(required_end),
                'cached_start': str(cached_start) if cached_start else None,
                'cached_end': str(cached_end) if cached_end else None,
                'cached_rows': cached_rows,
                'has_required_start_price': has_start_price,
                'has_required_end_price': has_end_price,
                'issues': issue_flags,
            })
            if issue_flags:
                issues.append({'ticker': ticker, 'issues': issue_flags})

        return {
            'required_range': {'start': str(required_start), 'end': str(required_end)},
            'required_tickers': required_tickers,
            'coverage': coverage,
            'issues': issues,
        }

    def repair_prices(self, tickers=None, start_date=None, end_date=None) -> dict:
        """Fetch and persist cached prices for missing or requested tickers."""
        coverage = self.analyze_price_coverage(start_date=start_date, end_date=end_date)
        required_start = start_date or (
            datetime.strptime(coverage['required_range']['start'], '%Y-%m-%d').date()
            if coverage['required_range']['start'] else None
        )
        required_end = end_date or (
            datetime.strptime(coverage['required_range']['end'], '%Y-%m-%d').date()
            if coverage['required_range']['end'] else None
        )

        if required_start is None or required_end is None:
            return {'status': 'skipped', 'tickers': [], 'rows_loaded': 0}

        target_tickers = sorted(set(tickers or [
            item['ticker'] for item in coverage['coverage'] if item['issues']
        ]))
        if not target_tickers:
            return {'status': 'up_to_date', 'tickers': [], 'rows_loaded': 0}

        prices_dict = self.price_service.fetch_all_prices(target_tickers, required_start, required_end)
        self._persist_prices_to_db(prices_dict)
        rows_loaded = sum(len(series) for series in prices_dict.values() if series is not None)
        return {
            'status': 'success',
            'tickers': target_tickers,
            'rows_loaded': rows_loaded,
            'range': {'start': str(required_start), 'end': str(required_end)},
        }

    def verify_prices_storage(self) -> dict:
        """Verify and report on prices table structure and optimization."""
        info = self.db.get_prices_table_info()
        ticker_counts = self.db.get_prices_by_ticker_count()
        coverage = self.analyze_price_coverage()

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
            'coverage': coverage,
            'optimization_notes': [
                'Primary key on (date, ticker) is optimal for lookups',
                'Index on ticker column enables fast filtering by asset',
                f'Table contains {len(ticker_counts)} unique tickers',
                f'Storage is efficient for {info["total_records"]} price records',
                f'Price coverage issues detected: {len(coverage["issues"])}',
            ]
        }

    def get_actual_cash_balances(self, as_of_date=None) -> dict:
        """Single source of truth for raw cash balances up to as_of_date."""
        from portfolio_db.calculator import get_asset_type

        transactions = self._get_transactions_up_to(as_of_date)
        cash_balances = {
            symbol: values.copy()
            for symbol, values in self.CASH_BUCKET_DEFAULTS.items()
        }

        for trans in transactions:
            asset = trans[2]
            action = trans[3].upper()
            quantity = float(trans[4])
            price = trans[6]
            asset_type = get_asset_type(asset)
            cash_key = self._get_cash_key_for_asset(asset, asset_type)

            if action in self.EXTERNAL_INFLOW_ACTIONS and (asset_type in ('cash_base', 'cash_fx') or asset.startswith('CASH')):
                deposit_key = self._normalize_cash_asset(asset, asset_type)
                cash_balances.setdefault(deposit_key, self._empty_cash_bucket())
                cash_balances[deposit_key]['deposits'] += quantity
                cash_balances[deposit_key]['balance'] += quantity
            elif action in self.EXTERNAL_OUTFLOW_ACTIONS and (asset_type in ('cash_base', 'cash_fx') or asset.startswith('CASH')):
                withdraw_key = self._normalize_cash_asset(asset, asset_type)
                cash_balances.setdefault(withdraw_key, self._empty_cash_bucket())
                cash_balances[withdraw_key]['withdrawals'] += quantity
                cash_balances[withdraw_key]['balance'] -= quantity
            elif action in self.INCOME_ACTIONS and (asset_type in ('cash_base', 'cash_fx') or asset.startswith('CASH')):
                income_key = self._normalize_cash_asset(asset, asset_type)
                cash_balances.setdefault(income_key, self._empty_cash_bucket())
                metric_key = 'dividends' if action == 'DIVIDEND' else 'interest'
                cash_balances[income_key][metric_key] += quantity
                cash_balances[income_key]['balance'] += quantity
            elif action == 'BUY' and price:
                cash_balances[cash_key]['spent'] += quantity * price
                cash_balances[cash_key]['balance'] -= quantity * price
            elif action == 'SELL' and price:
                cash_balances[cash_key]['received'] += quantity * price
                cash_balances[cash_key]['balance'] += quantity * price
            elif action in self.EXPENSE_ACTIONS:
                fee_key = self._normalize_cash_asset(asset, asset_type) if (asset_type in ('cash_base', 'cash_fx') or asset.startswith('CASH')) else cash_key
                cash_balances.setdefault(fee_key, self._empty_cash_bucket())
                metric_key = 'fees' if action == 'FEE' else 'taxes'
                cash_balances[fee_key][metric_key] += quantity
                cash_balances[fee_key]['balance'] -= quantity
            elif action == 'EXCHANGE_FROM':
                exchange_key = self._normalize_cash_asset(asset, asset_type) if (asset_type in ('cash_base', 'cash_fx') or asset.startswith('CASH')) else cash_key
                cash_balances.setdefault(exchange_key, self._empty_cash_bucket())
                cash_balances[exchange_key]['balance'] += quantity
            elif action == 'EXCHANGE_TO':
                exchange_key = self._normalize_cash_asset(asset, asset_type) if (asset_type in ('cash_base', 'cash_fx') or asset.startswith('CASH')) else cash_key
                cash_balances.setdefault(exchange_key, self._empty_cash_bucket())
                cash_balances[exchange_key]['balance'] += quantity

        return cash_balances

    def _build_cash_snapshot(self, as_of_date, price_context: dict) -> list:
        """Build valued cash balances for one reporting snapshot."""
        valuation_ts = price_context['valuation_ts']
        prices_dict = price_context['prices_dict']
        raw_balances = self.get_actual_cash_balances(as_of_date=as_of_date)

        snapshot = []
        for symbol, raw in raw_balances.items():
            fx_rate = 1.0
            has_activity = any(float(raw[key]) != 0.0 for key in raw)
            if symbol != self.BASE_CURRENCY and has_activity:
                fx_rate = self._require_series_price_asof(
                    prices_dict.get(symbol),
                    valuation_ts,
                    symbol=symbol,
                    kind='FX rate',
                )

            snapshot.append({
                'symbol': symbol,
                'currency': self.CASH_DISPLAY_CURRENCY.get(symbol, symbol),
                'balance': raw['balance'],
                'market_value': raw['balance'] * fx_rate,
                'usd_value': raw['balance'] * fx_rate,
                'last_price': fx_rate,
                'fx_rate': fx_rate,
                'deposits': raw['deposits'],
                'withdrawals': raw['withdrawals'],
                'spent': raw['spent'],
                'received': raw['received'],
                'dividends': raw['dividends'],
                'interest': raw['interest'],
                'fees': raw['fees'],
                'taxes': raw['taxes'],
            })

        return snapshot

    def _build_position_snapshot(self, as_of_date, price_context: dict, cash_snapshot: list, include_closed=True) -> list:
        """Build position-level reporting snapshot."""
        from portfolio_db.calculator import get_asset_type

        transactions = price_context['transactions']
        valuation_ts = price_context['valuation_ts']
        prices_dict = price_context['prices_dict']

        positions = {}
        for trans in transactions:
            asset = trans[2]
            action = trans[3].upper()
            quantity = float(trans[4])
            price = trans[6]
            date_obj = trans[1]

            if action not in self.TRADE_ACTIONS:
                continue

            if asset not in positions:
                positions[asset] = {
                    'symbol': asset,
                    'shares': 0.0,
                    'buy_quantity': 0.0,
                    'buy_cost': 0.0,
                    'sell_quantity': 0.0,
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

        def fx_rate(symbol: str) -> float:
            return self._require_series_price_asof(
                prices_dict.get(symbol),
                valuation_ts,
                symbol=symbol,
                kind='FX rate',
            )

        result = []
        for symbol, pos_data in positions.items():
            shares = pos_data['shares']
            if abs(shares) < 0.01:
                shares = 0.0
            if shares == 0 and not include_closed:
                continue

            asset_type = get_asset_type(symbol)
            last_price = self._get_series_price_asof(prices_dict.get(symbol), valuation_ts)
            if last_price is None and shares > 0:
                raise PriceDataUnavailableError(
                    f"Price unavailable for {symbol} as of {as_of_date}; try again."
                )
            if last_price is None:
                last_price = pos_data['last_price_from_trans']
            if last_price is not None and asset_type == 'stock_gbp':
                last_price *= fx_rate('GBPUSD=X')
            elif last_price is not None and asset_type == 'stock_eur':
                last_price *= fx_rate('EURUSD=X')

            avg_cost_per_share = (pos_data['buy_cost'] / pos_data['buy_quantity']) if pos_data['buy_quantity'] > 0 else 0.0
            total_cost = (shares * avg_cost_per_share) if shares > 0 else 0.0
            market_value = (shares * last_price) if last_price and shares > 0 else 0.0
            unrealized_gain_value = market_value - total_cost if shares > 0 else 0.0
            unrealized_gain_pct = (unrealized_gain_value / total_cost * 100) if total_cost > 0 and shares > 0 else 0.0
            realized_gain_value = pos_data['sell_proceeds'] - (pos_data['sell_quantity'] * avg_cost_per_share) if pos_data['sell_quantity'] > 0 else 0.0
            realized_gain_pct = (realized_gain_value / (pos_data['sell_quantity'] * avg_cost_per_share) * 100) if pos_data['sell_quantity'] > 0 and avg_cost_per_share > 0 else 0.0

            daily_gain_pct = 0.0
            daily_gain_value = 0.0
            price_series = prices_dict.get(symbol)
            if shares > 0 and last_price and price_series is not None:
                try:
                    price_history = price_series.loc[:as_of_date]
                    if hasattr(price_history, 'columns'):
                        price_history = price_history.iloc[:, 0]
                    if len(price_history) > 1:
                        today_price = float(price_history.iloc[-1])
                        yesterday_price = float(price_history.iloc[-2])
                        if asset_type == 'stock_gbp':
                            rate = fx_rate('GBPUSD=X')
                            today_price *= rate
                            yesterday_price *= rate
                        elif asset_type == 'stock_eur':
                            rate = fx_rate('EURUSD=X')
                            today_price *= rate
                            yesterday_price *= rate
                        if yesterday_price > 0:
                            daily_gain_pct = ((today_price - yesterday_price) / yesterday_price) * 100
                            daily_gain_value = shares * (today_price - yesterday_price)
                except Exception:
                    pass

            result.append({
                'symbol': symbol,
                'status': 'OPEN' if shares > 0 else 'CLOSED',
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

        for cash in cash_snapshot:
            if cash['balance'] == 0 and not include_closed and cash['deposits'] == 0 and cash['withdrawals'] == 0:
                continue
            result.append({
                'symbol': cash['symbol'],
                'status': 'OPEN' if cash['balance'] > 0 else 'CLOSED',
                'shares': cash['balance'],
                'last_price': cash['last_price'],
                'avg_cost_per_share': 0.0,
                'total_cost': 0.0,
                'market_value': cash['market_value'],
                'dividend_income': 0.0,
                'day_gain_pct': 0.0,
                'day_gain_value': 0.0,
                'total_gain_pct': 0.0,
                'total_gain_value': 0.0,
                'realized_gain_value': 0.0,
                'realized_gain_pct': 0.0,
            })

        result.sort(key=lambda item: item['market_value'], reverse=True)
        return result

    def _aggregate_reporting_totals(self, as_of_date, positions: list, transactions=None, fx_prices=None) -> dict:
        """Aggregate totals for the snapshot."""
        from portfolio_db.calculator import get_asset_type

        if transactions is None:
            transactions = self._get_transactions_up_to(as_of_date)

        cash_flow_metrics = self._get_external_cash_flow_metrics(
            transactions=transactions,
            as_of_date=as_of_date,
            fx_prices=fx_prices,
        )
        realized_gain = 0.0
        unrealized_gain = 0.0
        portfolio_value = 0.0

        for position in positions:
            portfolio_value += float(position.get('market_value') or 0.0)
            asset_type = get_asset_type(position['symbol'])
            if asset_type in ('cash_base', 'cash_fx') or position['symbol'].startswith('CASH'):
                continue
            realized_gain += float(position.get('realized_gain_value') or 0.0)
            unrealized_gain += float(position.get('total_gain_value') or 0.0)

        income = cash_flow_metrics['income']
        fees = cash_flow_metrics['fees']
        taxes = cash_flow_metrics['taxes']
        total_profit = realized_gain + unrealized_gain + income - fees - taxes
        return {
            'portfolio_value': portfolio_value,
            'deposits': cash_flow_metrics['deposits'],
            'withdrawals': cash_flow_metrics['withdrawals'],
            'net_contributions': cash_flow_metrics['net_contributions'],
            'dividends': cash_flow_metrics['dividends'],
            'interest': cash_flow_metrics['interest'],
            'fees': fees,
            'taxes': taxes,
            'income': income,
            'realized_gain': realized_gain,
            'unrealized_gain': unrealized_gain,
            'total_profit': total_profit,
            'total_return_pct': 0.0,
            'time_weighted_return_pct': 0.0,
            'total_invested': cash_flow_metrics['net_contributions'],
            'cagr': 0.0,
        }

    def build_reporting_snapshot(self, as_of_date=None, include_closed=True) -> dict:
        """Build one deterministic reporting snapshot."""
        as_of_date = self._resolve_as_of_date(as_of_date)
        if as_of_date is None:
            return self._empty_reporting_snapshot()

        price_context = self._load_reporting_price_context(as_of_date)
        cash_snapshot = self._build_cash_snapshot(as_of_date, price_context)
        positions = self._build_position_snapshot(as_of_date, price_context, cash_snapshot, include_closed=include_closed)
        totals = self._aggregate_reporting_totals(
            as_of_date,
            positions,
            transactions=price_context['transactions'],
            fx_prices=price_context['prices_dict'],
        )

        snapshot = self._empty_reporting_snapshot()
        snapshot.update({
            'as_of_date': str(as_of_date),
            'portfolio_value': totals['portfolio_value'],
            'positions': positions,
            'cash_balances': cash_snapshot,
            'deposits': totals['deposits'],
            'withdrawals': totals['withdrawals'],
            'net_contributions': totals['net_contributions'],
            'dividends': totals['dividends'],
            'interest': totals['interest'],
            'fees': totals['fees'],
            'taxes': totals['taxes'],
            'income': totals['income'],
            'realized_gain': totals['realized_gain'],
            'unrealized_gain': totals['unrealized_gain'],
            'total_profit': totals['total_profit'],
            'time_weighted_return_pct': totals['time_weighted_return_pct'],
            'total_return_pct': totals['total_return_pct'],
            'total_invested': totals['total_invested'],
            'cagr': totals['cagr'],
        })
        return snapshot

    def get_position_summary(self, include_closed=True):
        """Get position-level summary with gains/losses."""
        snapshot = self.build_reporting_snapshot(include_closed=include_closed)
        return snapshot['positions']

    def get_allocation(self, allocation_type='all'):
        """Get portfolio allocation breakdown from the snapshot."""
        from portfolio_db.calculator import get_asset_type

        snapshot = self.build_reporting_snapshot(include_closed=False)
        positions = snapshot['positions']
        assets = []
        cash = []
        for position in positions:
            asset_type = get_asset_type(position['symbol'])
            if asset_type in ('cash_base', 'cash_fx') or position['symbol'].startswith('CASH'):
                cash.append(position)
            else:
                assets.append(position)

        total_assets_value = sum(position['market_value'] for position in assets)
        total_cash_value = sum(position['market_value'] for position in cash)
        total_portfolio_value = snapshot['portfolio_value']

        result = []
        if allocation_type in ['assets', 'all']:
            for position in assets:
                denominator = total_portfolio_value if allocation_type == 'all' else total_assets_value
                pct = (position['market_value'] / denominator * 100) if denominator > 0 else 0.0
                result.append({
                    'symbol': position['symbol'],
                    'type': 'asset',
                    'value': position['market_value'],
                    'percentage': pct,
                })

        if allocation_type in ['cash', 'all']:
            cash_lookup = {item['symbol']: item for item in snapshot['cash_balances']}
            for position in cash:
                denominator = total_portfolio_value if allocation_type == 'all' else total_cash_value
                pct = (position['market_value'] / denominator * 100) if denominator > 0 else 0.0
                cash_meta = cash_lookup.get(position['symbol'], {})
                result.append({
                    'symbol': position['symbol'],
                    'type': 'cash',
                    'value': position['market_value'],
                    'percentage': pct,
                    'original_currency_value': cash_meta.get('balance', position['shares']),
                    'fx_rate': cash_meta.get('fx_rate', position['last_price']),
                })

        result.sort(key=lambda item: item['value'], reverse=True)

        summary = []
        if allocation_type in ['assets', 'all']:
            assets_pct = (total_assets_value / total_portfolio_value * 100) if allocation_type == 'all' and total_portfolio_value > 0 else (100.0 if total_assets_value > 0 else 0.0)
            summary.append({'symbol': self.ALLOCATION_SUMMARY_LABELS['assets'], 'type': 'summary', 'value': total_assets_value, 'percentage': assets_pct})
        if allocation_type in ['cash', 'all']:
            cash_pct = (total_cash_value / total_portfolio_value * 100) if allocation_type == 'all' and total_portfolio_value > 0 else (100.0 if total_cash_value > 0 else 0.0)
            summary.append({'symbol': self.ALLOCATION_SUMMARY_LABELS['cash'], 'type': 'summary', 'value': total_cash_value, 'percentage': cash_pct})
        if allocation_type == 'all':
            summary.append({'symbol': self.ALLOCATION_SUMMARY_LABELS['portfolio'], 'type': 'summary', 'value': total_portfolio_value, 'percentage': 100.0})

        return {
            'as_of_date': snapshot['as_of_date'],
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
