"""High-level portfolio service API."""

import json
from datetime import datetime
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

        # Fetch prices for calculation
        min_date = transactions[0][1]
        max_date = transactions[-1][1]

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

    def close(self):
        """Close database connection."""
        self.db.close()
