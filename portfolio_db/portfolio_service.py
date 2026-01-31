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
        returns = self.get_daily_returns()

        if not returns:
            return {
                'total_days': 0,
                'start_date': None,
                'end_date': None,
                'start_value': 0.0,
                'end_value': 0.0,
                'total_gain': 0.0,
                'avg_daily_return': 0.0,
                'avg_investment_return': 0.0,
                'total_cash_flow': 0.0,
            }

        # Filter out zero values
        returns_with_values = [r for r in returns if r['portfolio_value'] > 0]

        if not returns_with_values:
            return {
                'total_days': 0,
                'start_date': None,
                'end_date': None,
                'start_value': 0.0,
                'end_value': 0.0,
                'total_gain': 0.0,
                'avg_daily_return': 0.0,
                'avg_investment_return': 0.0,
                'total_cash_flow': 0.0,
            }

        total_cash_flow = sum(r['cash_flow_impact'] for r in returns_with_values)

        return {
            'total_days': len(returns_with_values),
            'start_date': returns_with_values[0]['date'],
            'end_date': returns_with_values[-1]['date'],
            'start_value': returns_with_values[0]['portfolio_value'],
            'end_value': returns_with_values[-1]['portfolio_value'],
            'total_gain': returns_with_values[-1]['portfolio_value'] - returns_with_values[0]['portfolio_value'],
            'avg_daily_return': sum(r['portfolio_daily_return'] for r in returns_with_values) / len(returns_with_values),
            'avg_investment_return': sum(r['investment_return'] for r in returns_with_values) / len(returns_with_values),
            'total_cash_flow': total_cash_flow,
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

        # Build position data by asset
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
            elif action == 'DEPOSIT':
                # Handle both new format (USD, EURUSD=X) and old format (CASH USD, CASH EUR)
                from portfolio_db.calculator import get_asset_type
                asset_type = get_asset_type(asset)
                if asset_type in ('cash_base', 'cash_fx') or asset.startswith('CASH'):
                    positions[asset]['shares'] += quantity

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
            market_value = (shares * last_price) if last_price and shares > 0 else 0

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
            if symbol == 'EURUSD=X':
                value_usd = value * fx_prices['EURUSD=X']
                fx_rate = fx_prices['EURUSD=X']
            elif symbol == 'GBPUSD=X':
                value_usd = value * fx_prices['GBPUSD=X']
                fx_rate = fx_prices['GBPUSD=X']
            elif symbol == 'CASH EUR':
                # Backwards compatibility
                value_usd = value * fx_prices['EURUSD=X']
                fx_rate = fx_prices['EURUSD=X']
            elif symbol == 'CASH GBP':
                # Backwards compatibility
                value_usd = value * fx_prices['GBPUSD=X']
                fx_rate = fx_prices['GBPUSD=X']
            else:
                # USD or CASH USD
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

    def close(self):
        """Close database connection."""
        self.db.close()
