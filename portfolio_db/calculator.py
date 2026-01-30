"""Daily return calculation with separated investment returns vs cash flows."""

import pandas as pd
from datetime import datetime, timedelta
import numpy as np
from typing import Dict, List, Tuple
import yfinance as yf


class DailyReturnCalculator:
    """Calculate daily portfolio returns with separated return metrics."""

    def __init__(self, transactions: List[Tuple], prices_dict: Dict, min_date=None, max_date=None):
        """
        Initialize calculator.

        Args:
            transactions: List of transaction tuples from database
            prices_dict: Dict of {asset: pd.Series with date index and prices}
            min_date: Min date for FX fetching
            max_date: Max date for FX fetching
        """
        self.transactions = transactions
        self.prices_dict = prices_dict
        self.fx_data = {}

        # Fetch FX data if date range provided
        if min_date and max_date:
            self._fetch_fx_data(min_date, max_date)

    def _fetch_fx_data(self, min_date, max_date):
        """Fetch FX data for EUR and GBP and add to prices dict for persistence."""
        for ticker in ['EURUSD=X', 'GBPUSD=X']:
            try:
                data = yf.download(
                    ticker,
                    start=min_date - timedelta(days=10),
                    end=max_date + timedelta(days=1),
                    progress=False
                )
                if isinstance(data, pd.DataFrame):
                    rates = data['Close']
                else:
                    rates = data['Close']
                self.fx_data[ticker] = rates.sort_index()

                # Also add to prices_dict so it gets persisted to database
                self.prices_dict[ticker] = rates.sort_index()
            except Exception:
                pass

    def _get_fx_rate(self, fx_ticker: str, date_obj) -> float:
        """Get FX rate for a specific date."""
        if fx_ticker not in self.fx_data:
            return 1.196 if fx_ticker == 'EURUSD=X' else 1.3769

        try:
            rate = self.fx_data[fx_ticker].asof(pd.Timestamp(date_obj))
            if isinstance(rate, float) and np.isnan(rate):
                return 1.196 if fx_ticker == 'EURUSD=X' else 1.3769
            return float(rate) if rate is not None else (1.196 if fx_ticker == 'EURUSD=X' else 1.3769)
        except Exception:
            return 1.196 if fx_ticker == 'EURUSD=X' else 1.3769

    def _calculate_portfolio_value(self, holdings: Dict, date) -> float:
        """Calculate total portfolio value for given holdings on a date."""
        total_value = 0.0

        for asset, quantity in holdings.items():
            if quantity == 0:
                continue

            if asset not in self.prices_dict:
                continue

            price_series = self.prices_dict[asset]

            try:
                price_value = price_series.asof(date)
                if isinstance(price_value, pd.Series):
                    price = price_value.iloc[0] if len(price_value) > 0 else None
                else:
                    price = price_value
            except Exception:
                price = None

            if price is None or (isinstance(price, float) and np.isnan(price)):
                continue

            price = float(price)

            if asset.startswith('CASH'):
                asset_value = quantity
            elif asset.endswith('.L'):
                fx_rate = self._get_fx_rate('GBPUSD=X', date)
                asset_value = quantity * price * fx_rate
            elif asset.endswith('.DE'):
                fx_rate = self._get_fx_rate('EURUSD=X', date)
                asset_value = quantity * price * fx_rate
            else:
                asset_value = quantity * price

            total_value += float(asset_value)

        return total_value

    def _get_daily_cash_flow(self, holdings_by_date: Dict, date_obj, trans_by_asset: Dict) -> float:
        """Calculate net cash flow (deposits - withdrawals) for a specific date."""
        cash_flow = 0.0

        for asset, trans_list in trans_by_asset.items():
            for trans in trans_list:
                if trans['date'] == date_obj:
                    action = trans['action']
                    quantity = trans['quantity']

                    if action == 'DEPOSIT' or (asset.startswith('CASH') and action == 'BUY'):
                        cash_flow += quantity
                    elif action == 'SELL' and asset.startswith('CASH'):
                        cash_flow -= quantity

        return cash_flow

    def calculate_all_returns(self) -> List[Dict]:
        """Calculate daily returns with separated investment returns vs cash flows."""
        if not self.transactions:
            return []

        min_date = None
        max_date = None

        # Create dict of transactions by asset
        trans_by_asset = {}
        for trans in self.transactions:
            date_obj = trans[1]
            asset = trans[2]
            action = trans[3]
            quantity = trans[4]

            if min_date is None or date_obj < min_date:
                min_date = date_obj
            if max_date is None or date_obj > max_date:
                max_date = date_obj

            if asset not in trans_by_asset:
                trans_by_asset[asset] = []
            trans_by_asset[asset].append({
                'date': date_obj,
                'action': action.upper(),
                'quantity': quantity
            })

        if not min_date or not max_date:
            return []

        today = datetime.now().date()
        if max_date < today:
            max_date = today

        date_range = pd.date_range(start=min_date, end=max_date, freq='D')

        # Initialize holdings
        holdings = {date: {} for date in date_range}

        # Process transactions
        for asset, trans_list in trans_by_asset.items():
            for trans in trans_list:
                trans_date = trans['date']
                action = trans['action']
                quantity = trans['quantity']

                for date in date_range:
                    if date >= pd.Timestamp(trans_date):
                        if asset not in holdings[date]:
                            holdings[date][asset] = 0
                        if action in ['BUY', 'DEPOSIT']:
                            holdings[date][asset] += quantity
                        elif action == 'SELL':
                            holdings[date][asset] -= quantity

        # Calculate values and returns
        results = []
        adjusted_base = 0.0

        for i, date in enumerate(date_range):
            date_obj = date.date()
            portfolio_value = self._calculate_portfolio_value(holdings[date], date)

            # Calculate cash flow impact for this date
            cash_flow_impact = self._get_daily_cash_flow(holdings, date_obj, trans_by_asset)

            if i == 0:
                # First day - initialize base with portfolio value
                portfolio_daily_return = 0.0
                investment_return = 0.0
                adjusted_base = portfolio_value
                cash_flow_impact = 0.0  # No impact on first day
            else:
                prev_value = results[i - 1]['portfolio_value']

                # Total daily return
                if prev_value > 0:
                    portfolio_daily_return = (
                        (portfolio_value - prev_value) / prev_value * 100
                    )
                else:
                    portfolio_daily_return = 0.0

                # Update adjusted base with cash flow
                adjusted_base += cash_flow_impact

                # Investment return (excluding cash flow impact)
                value_change = portfolio_value - prev_value - cash_flow_impact
                if adjusted_base > 0:
                    investment_return = (value_change / adjusted_base) * 100
                else:
                    investment_return = 0.0

            results.append({
                'date': date_obj,
                'portfolio_value': portfolio_value,
                'portfolio_daily_return': portfolio_daily_return,
                'investment_return': investment_return,
                'cash_flow_impact': cash_flow_impact,
                'adjusted_base': adjusted_base
            })

        return results

    def _get_price_for_date(self, asset: str, date_obj) -> float:
        """Get price for asset on specific date."""
        if asset not in self.prices_dict:
            return None

        price_series = self.prices_dict[asset]
        try:
            price = price_series.asof(pd.Timestamp(date_obj))
            if isinstance(price, float) and np.isnan(price):
                return None
            return float(price) if price is not None else None
        except Exception:
            return None
