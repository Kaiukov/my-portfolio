"""Daily return calculation with separated investment returns vs cash flows."""

import pandas as pd
from datetime import datetime, timedelta
import numpy as np
from typing import Dict, List, Tuple
import yfinance as yf

BASE_CURRENCY = 'USD'
LEGACY_CASH_TO_FX = {
    'CASH EUR': 'EURUSD=X',
    'CASH GBP': 'GBPUSD=X',
    'CASH UAH': 'UAHUSD=X',
}
ASSET_TYPE_TO_CASH = {
    'stock_eur': 'EURUSD=X',
    'stock_gbp': 'GBPUSD=X',
}
SUPPORTED_FX_TICKERS = ('EURUSD=X', 'GBPUSD=X', 'UAHUSD=X')
EXTERNAL_INFLOW_ACTIONS = {'DEPOSIT', 'TRANSFER'}
EXTERNAL_OUTFLOW_ACTIONS = {'WITHDRAW'}
INCOME_ACTIONS = {'DIVIDEND', 'INTEREST'}
EXPENSE_ACTIONS = {'FEE', 'TAX'}


def get_asset_type(ticker: str) -> str:
    """Determine asset type by ticker symbol.

    Returns:
        - 'cash_base': USD (rate = 1.0)
        - 'cash_fx': EURUSD=X, GBPUSD=X, etc (FX pairs)
        - 'crypto': Bitcoin, Ethereum (ends with -USD)
        - 'stock_gbp': London stocks (ends with .L)
        - 'stock_eur': German stocks (ends with .DE)
        - 'stock_usd': US stocks and default
    """
    if ticker == BASE_CURRENCY:
        return 'cash_base'
    elif ticker.endswith('USD=X'):
        return 'cash_fx'
    elif ticker.endswith('-USD'):
        return 'crypto'
    elif ticker.endswith('.L'):
        return 'stock_gbp'
    elif ticker.endswith('.DE'):
        return 'stock_eur'
    else:
        return 'stock_usd'


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
        for ticker in SUPPORTED_FX_TICKERS:
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
        price_series = self.fx_data.get(fx_ticker) or self.prices_dict.get(fx_ticker)
        if price_series is None:
            raise ValueError(f"FX rate unavailable for {fx_ticker} as of {date_obj}; try again.")

        try:
            rate = price_series.asof(pd.Timestamp(date_obj))
            if isinstance(rate, pd.Series):
                rate = rate.iloc[0] if len(rate) > 0 else None
            if isinstance(rate, float) and np.isnan(rate):
                raise ValueError(f"FX rate unavailable for {fx_ticker} as of {date_obj}; try again.")
            if rate is None:
                raise ValueError(f"FX rate unavailable for {fx_ticker} as of {date_obj}; try again.")
            return float(rate)
        except Exception:
            raise ValueError(f"FX rate unavailable for {fx_ticker} as of {date_obj}; try again.")

    @staticmethod
    def _fx_ticker_for_asset(asset: str, asset_type: str = None) -> str | None:
        """Resolve FX ticker for a cash-like asset or regional stock type."""
        if asset_type == 'cash_fx':
            return asset
        if asset_type in ASSET_TYPE_TO_CASH:
            return ASSET_TYPE_TO_CASH[asset_type]
        return LEGACY_CASH_TO_FX.get(asset)

    @staticmethod
    def _cash_currency_for_asset_type(asset_type: str) -> str:
        """Resolve cash bucket by asset type."""
        return ASSET_TYPE_TO_CASH.get(asset_type, BASE_CURRENCY)

    def _calculate_portfolio_value(self, holdings: Dict, date) -> float:
        """Calculate total portfolio value for given holdings on a date."""
        total_value = 0.0

        for asset, quantity in holdings.items():
            if quantity == 0:
                continue

            asset_type = get_asset_type(asset)

            # For cash assets, we don't need prices_dict
            if asset_type == 'cash_base':
                # USD: direct value
                asset_value = quantity
            elif asset_type == 'cash_fx':
                # EURUSD=X, GBPUSD=X: need FX rate from prices
                if asset in self.prices_dict:
                    price_series = self.prices_dict[asset]
                    try:
                        price_value = price_series.asof(date)
                        if isinstance(price_value, pd.Series):
                            price = price_value.iloc[0] if len(price_value) > 0 else None
                        else:
                            price = price_value
                    except Exception:
                        price = None

                    if price is not None and not (isinstance(price, float) and np.isnan(price)):
                        asset_value = quantity * float(price)
                    else:
                        fx_ticker = self._fx_ticker_for_asset(asset, asset_type)
                        fx_rate = self._get_fx_rate(fx_ticker, date)
                        asset_value = quantity * fx_rate
                else:
                    asset_value = 0.0
            elif asset.startswith('CASH'):
                # Backwards compatibility: old CASH format (CASH EUR, CASH GBP, CASH USD)
                fx_ticker = self._fx_ticker_for_asset(asset)
                if fx_ticker:
                    fx_rate = self._get_fx_rate(fx_ticker, date)
                    asset_value = quantity * fx_rate
                else:  # CASH USD
                    asset_value = quantity
            else:
                # Regular assets: stocks, crypto, etc
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

                if asset_type in ASSET_TYPE_TO_CASH:
                    fx_rate = self._get_fx_rate(self._cash_currency_for_asset_type(asset_type), date)
                    asset_value = quantity * price * fx_rate
                else:
                    # US stocks, crypto: price already in USD
                    asset_value = quantity * price

            total_value += float(asset_value)

        return total_value

    def _get_daily_cash_flow(self, holdings_by_date: Dict, date_obj, trans_by_asset: Dict) -> float:
        """Calculate net cash flow (deposits - withdrawals) for a specific date in USD."""
        cash_flow = 0.0

        for asset, trans_list in trans_by_asset.items():
            for trans in trans_list:
                if trans['date'] == date_obj:
                    action = trans['action']
                    quantity = trans['quantity']

                    # Determine if this is a cash-related transaction
                    asset_type = get_asset_type(asset)
                    is_cash = asset_type in ('cash_base', 'cash_fx') or asset.startswith('CASH')

                    if action in EXTERNAL_INFLOW_ACTIONS and is_cash:
                        # Convert to USD if needed
                        if asset_type == 'cash_fx':
                            # Get FX rate for this date
                            if asset in self.prices_dict:
                                price_series = self.prices_dict[asset]
                                try:
                                    fx_rate = price_series.asof(pd.Timestamp(date_obj))
                                    if isinstance(fx_rate, pd.Series):
                                        fx_rate = fx_rate.iloc[0] if len(fx_rate) > 0 else None
                                    if fx_rate is not None and not (isinstance(fx_rate, float) and np.isnan(fx_rate)):
                                        cash_flow += quantity * float(fx_rate)
                                    else:
                                        # Fallback
                                        fx_ticker = self._fx_ticker_for_asset(asset, asset_type)
                                        fx_rate = self._get_fx_rate(fx_ticker, date_obj)
                                        cash_flow += quantity * fx_rate
                                except Exception:
                                    # Fallback
                                    fx_ticker = self._fx_ticker_for_asset(asset, asset_type)
                                    fx_rate = self._get_fx_rate(fx_ticker, date_obj)
                                    cash_flow += quantity * fx_rate
                            else:
                                # Fallback
                                fx_ticker = self._fx_ticker_for_asset(asset, asset_type)
                                fx_rate = self._get_fx_rate(fx_ticker, date_obj)
                                cash_flow += quantity * fx_rate
                        elif asset in LEGACY_CASH_TO_FX:
                            # Backwards compatibility
                            fx_rate = self._get_fx_rate(self._fx_ticker_for_asset(asset), date_obj)
                            cash_flow += quantity * fx_rate
                        else:
                            # USD or new format
                            cash_flow += quantity
                    elif action in EXTERNAL_OUTFLOW_ACTIONS and is_cash:
                        # External withdrawal from portfolio cash
                        if asset_type == 'cash_fx':
                            if asset in self.prices_dict:
                                price_series = self.prices_dict[asset]
                                try:
                                    fx_rate = price_series.asof(pd.Timestamp(date_obj))
                                    if isinstance(fx_rate, pd.Series):
                                        fx_rate = fx_rate.iloc[0] if len(fx_rate) > 0 else None
                                    if fx_rate is not None and not (isinstance(fx_rate, float) and np.isnan(fx_rate)):
                                        cash_flow -= quantity * float(fx_rate)
                                    else:
                                        fx_ticker = self._fx_ticker_for_asset(asset, asset_type)
                                        fx_rate = self._get_fx_rate(fx_ticker, date_obj)
                                        cash_flow -= quantity * fx_rate
                                except Exception:
                                    fx_ticker = self._fx_ticker_for_asset(asset, asset_type)
                                    fx_rate = self._get_fx_rate(fx_ticker, date_obj)
                                    cash_flow -= quantity * fx_rate
                            else:
                                fx_ticker = self._fx_ticker_for_asset(asset, asset_type)
                                fx_rate = self._get_fx_rate(fx_ticker, date_obj)
                                cash_flow -= quantity * fx_rate
                        elif asset in LEGACY_CASH_TO_FX:
                            fx_rate = self._get_fx_rate(self._fx_ticker_for_asset(asset), date_obj)
                            cash_flow -= quantity * fx_rate
                        else:
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
            price = trans[6] if len(trans) > 6 else None  # price field

            if min_date is None or date_obj < min_date:
                min_date = date_obj
            if max_date is None or date_obj > max_date:
                max_date = date_obj

            if asset not in trans_by_asset:
                trans_by_asset[asset] = []
            trans_by_asset[asset].append({
                'date': date_obj,
                'action': action.upper(),
                'quantity': quantity,
                'price': price
            })

        if not min_date or not max_date:
            return []

        today = datetime.now().date()
        if max_date < today:
            max_date = today

        date_range = pd.date_range(start=min_date, end=max_date, freq='D')

        # Initialize holdings
        holdings = {date: {} for date in date_range}

        # Process transactions with auto cash deduction for BUY/SELL
        for asset, trans_list in trans_by_asset.items():
            for trans in trans_list:
                trans_date = trans['date']
                action = trans['action']
                quantity = trans['quantity']
                price = trans.get('price')

                # Determine asset type for cash handling
                asset_type = get_asset_type(asset)
                is_cash_asset = asset_type in ('cash_base', 'cash_fx') or asset.startswith('CASH')

                # Determine which cash currency to use based on asset type
                def get_cash_currency(asset_type):
                    return self._cash_currency_for_asset_type(asset_type)

                for date in date_range:
                    if date >= pd.Timestamp(trans_date):
                        # Initialize asset holding if needed
                        if asset not in holdings[date]:
                            holdings[date][asset] = 0

                        if action in ['BUY'] or action in EXTERNAL_INFLOW_ACTIONS or action in INCOME_ACTIONS:
                            holdings[date][asset] += quantity

                            # Auto-deduct cash for BUY only
                            if action == 'BUY' and not is_cash_asset and price:
                                cash_currency = get_cash_currency(asset_type)
                                cash_cost = quantity * price
                                if cash_currency not in holdings[date]:
                                    holdings[date][cash_currency] = 0
                                holdings[date][cash_currency] -= cash_cost

                        elif action == 'SELL':
                            holdings[date][asset] -= quantity

                            # Auto-add cash for SELL (not cash assets)
                            if not is_cash_asset and price:
                                cash_currency = get_cash_currency(asset_type)
                                cash_proceeds = quantity * price
                                if cash_currency not in holdings[date]:
                                    holdings[date][cash_currency] = 0
                                holdings[date][cash_currency] += cash_proceeds

                        elif action in EXPENSE_ACTIONS:
                            # FEE reduces cash holdings without creating position
                            # Use asset as cash currency (USD, EURUSD=X, GBPUSD=X)
                            fee_currency = asset if is_cash_asset else get_cash_currency(asset_type)
                            if fee_currency not in holdings[date]:
                                holdings[date][fee_currency] = 0
                            holdings[date][fee_currency] -= quantity

                        elif action == 'EXCHANGE_FROM':
                            # EXCHANGE_FROM reduces source currency (quantity is negative)
                            exchange_currency = asset if is_cash_asset else get_cash_currency(asset_type)
                            if exchange_currency not in holdings[date]:
                                holdings[date][exchange_currency] = 0
                            holdings[date][exchange_currency] += quantity  # quantity is negative

                        elif action == 'EXCHANGE_TO':
                            # EXCHANGE_TO adds to target currency
                            exchange_currency = asset if is_cash_asset else get_cash_currency(asset_type)
                            if exchange_currency not in holdings[date]:
                                holdings[date][exchange_currency] = 0
                            holdings[date][exchange_currency] += quantity

                        elif action in EXTERNAL_OUTFLOW_ACTIONS:
                            # WITHDRAW reduces cash holdings but doesn't affect investment
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

                # Investment return (excluding cash flow impact)
                value_change = portfolio_value - prev_value - cash_flow_impact
                if adjusted_base > 0:
                    investment_return = (value_change / adjusted_base) * 100
                else:
                    investment_return = 0.0

                # Update adjusted base with cash flow (AFTER investment return calculation)
                adjusted_base += cash_flow_impact

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
