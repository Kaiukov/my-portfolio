"""Daily return calculation matching reference script logic."""

import pandas as pd
from datetime import datetime, timedelta
import numpy as np
from typing import Dict, List, Tuple
import yfinance as yf


class DailyReturnCalculator:
    """Calculate daily portfolio returns matching reference script."""

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
        """Fetch FX data for EUR and GBP."""
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
            except Exception:
                # If fetch fails, use default rates
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

    def calculate_all_returns(self) -> List[Dict]:
        """Calculate daily returns for entire portfolio."""
        if not self.transactions:
            return []

        # Build holdings dict keyed by date
        # First get date range from transactions
        min_date = None
        max_date = None

        # Create dict of transactions by asset
        trans_by_asset = {}
        for trans in self.transactions:
            date_obj = trans[1]  # date is at index 1
            asset = trans[2]     # asset is at index 2
            action = trans[3]    # action is at index 3
            quantity = trans[4]  # quantity is at index 4

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

        # Create date range
        date_range = pd.date_range(start=min_date, end=max_date, freq='D')

        # Initialize holdings
        holdings = {date: {} for date in date_range}

        # Process transactions
        for asset, trans_list in trans_by_asset.items():
            for trans in trans_list:
                trans_date = trans['date']
                action = trans['action']
                quantity = trans['quantity']

                # Apply transaction to all dates >= transaction date
                for date in date_range:
                    if date >= pd.Timestamp(trans_date):
                        if asset not in holdings[date]:
                            holdings[date][asset] = 0
                        if action in ['BUY', 'DEPOSIT']:
                            holdings[date][asset] += quantity
                        elif action == 'SELL':
                            holdings[date][asset] -= quantity

        # Calculate portfolio value for each date
        results = []
        for date in date_range:
            total_value = 0.0

            for asset, quantity in holdings[date].items():
                if quantity == 0:
                    continue

                if asset not in self.prices_dict:
                    continue

                price_series = self.prices_dict[asset]

                try:
                    # Get price as of this date
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

                # Calculate asset value
                if asset.startswith('CASH'):
                    asset_value = quantity
                elif asset.endswith('.L'):
                    # UK asset - apply GBP to USD conversion
                    fx_rate = self._get_fx_rate('GBPUSD=X', date)
                    asset_value = quantity * price * fx_rate
                elif asset.endswith('.DE'):
                    # German asset - apply EUR to USD conversion
                    fx_rate = self._get_fx_rate('EURUSD=X', date)
                    asset_value = quantity * price * fx_rate
                else:
                    asset_value = quantity * price

                total_value += float(asset_value)

            results.append({
                'date': date.date(),
                'portfolio_value': total_value
            })

        # Calculate daily returns
        for i, result in enumerate(results):
            if i == 0:
                result['portfolio_daily_return'] = 0.0
            else:
                prev_value = results[i - 1]['portfolio_value']
                curr_value = result['portfolio_value']
                if prev_value > 0:
                    result['portfolio_daily_return'] = (
                        (curr_value - prev_value) / prev_value * 100
                    )
                else:
                    result['portfolio_daily_return'] = 0.0

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
