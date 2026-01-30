"""High-level portfolio service API."""

import json
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

        # Get unique assets for price lookup
        assets = set()
        for trans in transactions:
            assets.add(trans[2])  # asset at index 2

        # Fetch prices for calculation - extend through today
        min_date = transactions[0][1]
        max_date = transactions[-1][1]
        today = date.today()

        # Extend to today if last transaction is before today
        if max_date < today:
            max_date = today

        prices_dict = self.price_service.fetch_all_prices(
            list(assets), min_date, max_date
        )

        # Calculate returns
        calculator = DailyReturnCalculator(transactions, prices_dict, min_date, max_date)
        results = calculator.calculate_all_returns()

        # Store results
        for result in results:
            self.db.insert_daily_return(
                result['date'],
                result['portfolio_value'],
                result['portfolio_daily_return']
            )

    def get_daily_returns(self) -> list:
        """Get all daily returns as list of dicts."""
        returns = self.db.get_daily_returns()
        return [
            {
                'date': str(ret[0]),
                'portfolio_value': float(ret[1]),
                'portfolio_daily_return': float(ret[2]) if ret[2] is not None else 0.0
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
        """Get portfolio performance statistics."""
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
            }

        return {
            'total_days': len(returns_with_values),
            'start_date': returns_with_values[0]['date'],
            'end_date': returns_with_values[-1]['date'],
            'start_value': returns_with_values[0]['portfolio_value'],
            'end_value': returns_with_values[-1]['portfolio_value'],
            'total_gain': returns_with_values[-1]['portfolio_value'] - returns_with_values[0]['portfolio_value'],
            'avg_daily_return': sum(r['portfolio_daily_return'] for r in returns_with_values) / len(returns_with_values),
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
        Smart recalculation with optional date range.

        Args:
            from_date: Start date for recalc (None = full recalc from beginning)
            force: If True, ignore optimization and recalc everything

        Returns:
            {"status": "success", "recalc_type": "partial|full", "rows_affected": ...}
        """
        transactions = self.db.get_transactions()
        if not transactions:
            return {'status': 'error', 'message': 'No transactions found'}

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

        # Get unique assets
        assets = set()
        for trans in transactions:
            assets.add(trans[2])  # asset at index 2

        # Get date range - always extend to today
        min_trans_date = transactions[0][1]
        max_trans_date = transactions[-1][1]
        max_date = date.today()

        # Fetch prices for needed date range
        prices_dict = self.price_service.fetch_all_prices(
            list(assets), min_date, max_date
        )

        # Calculate returns using calculator
        calculator = DailyReturnCalculator(transactions, prices_dict, min_trans_date, max_trans_date)
        results = calculator.calculate_all_returns()

        # Filter results if partial recalc
        if not is_full_recalc and from_date:
            results = [r for r in results if r['date'] >= from_date]

        # Store results
        rows_affected = 0
        for result in results:
            self.db.insert_daily_return(
                result['date'],
                result['portfolio_value'],
                result['portfolio_daily_return']
            )
            rows_affected += 1

        # Log refresh event
        recalc_type = 'full' if is_full_recalc else 'partial'
        self.db.log_refresh(recalc_type, rows_affected)

        return {
            'status': 'success',
            'recalc_type': recalc_type,
            'rows_affected': rows_affected
        }

    def close(self):
        """Close database connection."""
        self.db.close()
