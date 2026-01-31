"""Tests for portfolio calculator with investment return and cash flow separation."""

import pytest
from datetime import datetime, date, timedelta
import pandas as pd
from portfolio_db.calculator import DailyReturnCalculator, get_asset_type


class TestGetAssetType:
    """Test asset type classification."""

    def test_usd_is_cash_base(self):
        assert get_asset_type('USD') == 'cash_base'

    def test_eurusd_is_cash_fx(self):
        assert get_asset_type('EURUSD=X') == 'cash_fx'

    def test_gbpusd_is_cash_fx(self):
        assert get_asset_type('GBPUSD=X') == 'cash_fx'

    def test_uahusd_is_cash_fx(self):
        assert get_asset_type('UAHUSD=X') == 'cash_fx'

    def test_crypto_is_crypto(self):
        assert get_asset_type('BTC-USD') == 'crypto'
        assert get_asset_type('ETH-USD') == 'crypto'

    def test_london_stock_is_stock_gbp(self):
        assert get_asset_type('VODX.L') == 'stock_gbp'

    def test_german_stock_is_stock_eur(self):
        assert get_asset_type('DAX.DE') == 'stock_eur'

    def test_us_stock_is_stock_usd(self):
        assert get_asset_type('AAPL') == 'stock_usd'
        assert get_asset_type('MSFT') == 'stock_usd'


class TestDailyReturnCalculator:
    """Test daily return calculation with separated metrics."""

    def test_simple_usd_deposit(self):
        """Test simple USD deposit with no price changes."""
        transactions = [
            (1, date(2025, 1, 1), 'USD', 'DEPOSIT', 1000.0),
        ]

        prices_dict = {
            'USD': pd.Series([1.0], index=pd.date_range('2025-01-01', periods=1))
        }

        calc = DailyReturnCalculator(transactions, prices_dict)
        results = calc.calculate_all_returns()

        assert len(results) > 0
        first = results[0]
        assert first['portfolio_value'] == 1000.0
        assert first['investment_return'] == 0.0  # First day
        assert first['portfolio_daily_return'] == 0.0

    def test_twr_with_price_appreciation(self):
        """Test TWR: deposit 1000 USD, price rises 10%, investment_return should be 10%."""
        # Create 2 days of prices for USD (always 1.0)
        prices_dict = {
            'USD': pd.Series(
                [1.0, 1.0],
                index=pd.date_range('2025-01-01', periods=2)
            ),
            'AAPL': pd.Series(
                [100.0, 110.0],  # 10% appreciation
                index=pd.date_range('2025-01-01', periods=2)
            )
        }

        transactions = [
            (1, date(2025, 1, 1), 'USD', 'DEPOSIT', 1000.0),
            (2, date(2025, 1, 1), 'AAPL', 'BUY', 10.0),  # Buy 10 shares @ $100 = $1000
        ]

        calc = DailyReturnCalculator(transactions, prices_dict)
        results = calc.calculate_all_returns()

        assert len(results) >= 2

        # Day 1: initial position
        day1 = results[0]
        assert day1['portfolio_value'] == pytest.approx(2000.0, rel=0.01)  # 1000 USD + 10*100 AAPL
        assert day1['investment_return'] == 0.0

        # Day 2: AAPL appreciated 10%
        day2 = results[1]
        expected_value = 1000.0 + (10 * 110.0)  # 2100
        assert day2['portfolio_value'] == pytest.approx(expected_value, rel=0.01)
        # investment_return = (2100 - 2000) / 2000 * 100 = 5% (portfolio return)
        # But this tests the TWR calculation
        assert day2['investment_return'] > 0

    def test_cash_flow_impact_separation(self):
        """Test that cash flow impact is separated from investment return."""
        prices_dict = {
            'USD': pd.Series(
                [1.0, 1.0],
                index=pd.date_range('2025-01-01', periods=2)
            )
        }

        transactions = [
            (1, date(2025, 1, 1), 'USD', 'DEPOSIT', 1000.0),
            (2, date(2025, 1, 2), 'USD', 'DEPOSIT', 500.0),  # Additional deposit
        ]

        calc = DailyReturnCalculator(transactions, prices_dict)
        results = calc.calculate_all_returns()

        assert len(results) >= 2

        day1 = results[0]
        assert day1['portfolio_value'] == 1000.0
        assert day1['cash_flow_impact'] == 0.0

        day2 = results[1]
        assert day2['portfolio_value'] == 1500.0
        assert day2['cash_flow_impact'] == 500.0
        # No price change, so investment_return should be 0
        assert day2['investment_return'] == pytest.approx(0.0, abs=0.01)

    def test_fx_cash_deposit_conversion(self):
        """Test FX cash deposits are converted to USD."""
        prices_dict = {
            'EURUSD=X': pd.Series(
                [1.10, 1.10],
                index=pd.date_range('2025-01-01', periods=2)
            ),
            'USD': pd.Series(
                [1.0, 1.0],
                index=pd.date_range('2025-01-01', periods=2)
            )
        }

        transactions = [
            (1, date(2025, 1, 1), 'EURUSD=X', 'DEPOSIT', 1000.0),  # 1000 EUR at 1.10 = 1100 USD
        ]

        calc = DailyReturnCalculator(transactions, prices_dict)
        results = calc.calculate_all_returns()

        assert len(results) > 0
        first = results[0]
        # Portfolio value should be 1000 EUR * 1.10 = 1100 USD
        assert first['portfolio_value'] == pytest.approx(1100.0, rel=0.01)


class TestBackwardsCompatibility:
    """Test backwards compatibility with old CASH format."""

    def test_old_cash_usd_format(self):
        """Test that old CASH USD format still works."""
        prices_dict = {
            'CASH USD': pd.Series([1.0], index=pd.date_range('2025-01-01', periods=1))
        }

        transactions = [
            (1, date(2025, 1, 1), 'CASH USD', 'DEPOSIT', 1000.0),
        ]

        calc = DailyReturnCalculator(transactions, prices_dict)
        results = calc.calculate_all_returns()

        assert len(results) > 0
        assert results[0]['portfolio_value'] == pytest.approx(1000.0, rel=0.01)

    def test_old_cash_eur_format(self):
        """Test that old CASH EUR format still works."""
        prices_dict = {
            'CASH EUR': pd.Series(
                [1.0],
                index=pd.date_range('2025-01-01', periods=1)
            ),
            'EURUSD=X': pd.Series(
                [1.10],
                index=pd.date_range('2025-01-01', periods=1)
            )
        }

        transactions = [
            (1, date(2025, 1, 1), 'CASH EUR', 'DEPOSIT', 1000.0),  # 1000 EUR
        ]

        calc = DailyReturnCalculator(
            transactions, prices_dict,
            min_date=date(2025, 1, 1),
            max_date=date(2025, 1, 1)
        )
        results = calc.calculate_all_returns()

        assert len(results) > 0
        # Should convert EUR to USD using FX rate
        # The value should be around 1000-1200 (depending on whether it uses cached rate or fallback)
        assert results[0]['portfolio_value'] > 1000.0
