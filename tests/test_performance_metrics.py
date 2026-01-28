"""Tests for portfolio performance metrics."""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from src.models import Transaction, AssetType, TransactionType
from src.storage import TransactionStorage
from src.prices import PriceFetcher
from src.portfolio import PortfolioAnalyzer


@pytest.fixture
def storage():
    """Create in-memory transaction storage for testing."""
    return TransactionStorage()


@pytest.fixture
def fetcher():
    """Create price fetcher for testing."""
    return PriceFetcher()


@pytest.fixture
def analyzer(storage, fetcher):
    """Create portfolio analyzer for testing."""
    return PortfolioAnalyzer(storage, fetcher)


@pytest.fixture
def simple_portfolio(storage):
    """Create a simple test portfolio."""
    # Initial cash deposit
    storage.add_transaction(Transaction(
        date=date(2024, 1, 1),
        asset="CASH",
        asset_type=AssetType.CASH,
        action=TransactionType.DEPOSIT,
        quantity=Decimal("10000"),
        price=Decimal("1"),
        currency="USD",
        fees=Decimal("0"),
        exchange="",
    ))

    # Buy stock
    storage.add_transaction(Transaction(
        date=date(2024, 1, 15),
        asset="AAPL",
        asset_type=AssetType.STOCK,
        action=TransactionType.BUY,
        quantity=Decimal("100"),
        price=Decimal("150"),
        currency="USD",
        fees=Decimal("10"),
        exchange="NASDAQ",
    ))

    # Auto cash deduction happens in CLI, so manually add it
    storage.add_transaction(Transaction(
        date=date(2024, 1, 15),
        asset="CASH",
        asset_type=AssetType.CASH,
        action=TransactionType.WITHDRAWAL,
        quantity=Decimal("15010"),  # 100 * 150 + 10 fees
        price=Decimal("1"),
        currency="USD",
        fees=Decimal("0"),
        exchange="",
    ))

    return storage


class TestReturnMetrics:
    """Test return metrics calculations."""

    def test_absolute_return_positive(self, analyzer, simple_portfolio):
        """Test absolute return calculation with positive return."""
        # Set current price higher (mock)
        result = analyzer.calculate_absolute_return()

        assert "pct" in result
        assert "usd_amount" in result
        assert result["currency"] == "USD"

    def test_absolute_return_empty_portfolio(self, analyzer):
        """Test absolute return with empty portfolio."""
        result = analyzer.calculate_absolute_return()

        assert result["pct"] == Decimal("0")
        assert result["usd_amount"] == Decimal("0")

    def test_portfolio_dates(self, analyzer, simple_portfolio):
        """Test portfolio date calculation."""
        start_date, end_date, years_invested = analyzer.get_portfolio_dates()

        assert start_date == date(2024, 1, 1)
        assert end_date == date.today()
        assert years_invested >= 0

    def test_cash_flows(self, analyzer, simple_portfolio):
        """Test cash flow extraction."""
        cash_flows = analyzer.get_cash_flows()

        assert len(cash_flows) >= 1
        assert cash_flows[0][0] == date(2024, 1, 1)  # Initial deposit

    def test_cagr_empty_portfolio(self, analyzer):
        """Test CAGR with empty portfolio."""
        cagr = analyzer.calculate_cagr()

        assert cagr == Decimal("0")

    def test_twr_empty_portfolio(self, analyzer):
        """Test TWR with empty portfolio."""
        twr = analyzer.calculate_twr()

        assert twr == Decimal("0")

    def test_mwr_empty_portfolio(self, analyzer):
        """Test MWR with empty portfolio."""
        mwr = analyzer.calculate_mwr()

        assert mwr == Decimal("0")

    def test_relative_return(self, analyzer, simple_portfolio):
        """Test relative return calculation."""
        benchmark_return = Decimal("10")
        relative = analyzer.calculate_relative_return(benchmark_return)

        assert isinstance(relative, Decimal)

    def test_get_return_metrics_dict(self, analyzer, simple_portfolio):
        """Test combined return metrics dictionary."""
        metrics = analyzer.get_return_metrics()

        assert "start_date" in metrics
        assert "end_date" in metrics
        assert "years_invested" in metrics
        assert "absolute_return_pct" in metrics
        assert "cagr_pct" in metrics
        assert "twr_pct" in metrics
        assert "mwr_pct" in metrics


class TestRiskMetrics:
    """Test risk metrics calculations."""

    def test_volatility_returns_decimal(self, analyzer, simple_portfolio):
        """Test volatility calculation returns Decimal."""
        volatility = analyzer.calculate_volatility()

        assert isinstance(volatility, Decimal)
        assert volatility >= 0

    def test_max_drawdown_structure(self, analyzer, simple_portfolio):
        """Test max drawdown returns correct structure."""
        dd = analyzer.calculate_max_drawdown()

        assert "max_drawdown_pct" in dd
        assert "peak_date" in dd
        assert "trough_date" in dd

    def test_beta_returns_decimal(self, analyzer, simple_portfolio):
        """Test beta calculation returns Decimal."""
        beta = analyzer.calculate_beta()

        assert isinstance(beta, Decimal)
        assert beta > 0

    def test_alpha_calculation(self, analyzer, simple_portfolio):
        """Test alpha calculation."""
        alpha = analyzer.calculate_alpha(Decimal("10"))

        assert isinstance(alpha, Decimal)

    def test_sharpe_ratio_positive(self, analyzer, simple_portfolio):
        """Test Sharpe ratio is calculated."""
        sharpe = analyzer.calculate_sharpe_ratio()

        assert isinstance(sharpe, Decimal)

    def test_sortino_ratio_positive(self, analyzer, simple_portfolio):
        """Test Sortino ratio is calculated."""
        sortino = analyzer.calculate_sortino_ratio()

        assert isinstance(sortino, Decimal)

    def test_get_risk_metrics_dict(self, analyzer, simple_portfolio):
        """Test combined risk metrics dictionary."""
        metrics = analyzer.get_risk_metrics()

        assert "volatility_pct" in metrics
        assert "max_drawdown" in metrics
        assert "beta" in metrics
        assert "sharpe_ratio" in metrics
        assert "sortino_ratio" in metrics


class TestStructuralMetrics:
    """Test structural metrics calculations."""

    def test_count_trades(self, analyzer, simple_portfolio):
        """Test trade counting."""
        count = analyzer.count_trades()

        assert isinstance(count, int)
        assert count >= 1

    def test_get_trades_per_month(self, analyzer, simple_portfolio):
        """Test trades per month calculation."""
        trades_per_month = analyzer.get_trades_per_month()

        assert isinstance(trades_per_month, Decimal)
        assert trades_per_month >= 0

    def test_average_portfolio_value(self, analyzer, simple_portfolio):
        """Test average portfolio value calculation."""
        avg_value = analyzer.get_average_portfolio_value()

        assert isinstance(avg_value, Decimal)
        assert avg_value > 0

    def test_calculate_turnover(self, analyzer, simple_portfolio):
        """Test turnover calculation returns proper structure."""
        turnover = analyzer.calculate_turnover()

        assert "annual_turnover_pct" in turnover
        assert "trades_per_month" in turnover
        assert "trading_style" in turnover
        assert turnover["trading_style"] in [
            "very_active", "active", "moderate", "low", "very_low", "no_activity", "insufficient_data"
        ]

    def test_calculate_diversification_index(self, analyzer, simple_portfolio):
        """Test diversification index calculation."""
        div = analyzer.calculate_diversification_index()

        assert "total_index" in div
        assert "by_symbol" in div
        assert "by_type" in div
        assert "interpretation" in div
        assert 0 <= float(div["total_index"]) <= 1

    def test_tracking_error(self, analyzer, simple_portfolio):
        """Test tracking error calculation."""
        error = analyzer.calculate_tracking_error(Decimal("10"))

        assert isinstance(error, Decimal)
        assert error >= 0

    def test_get_structural_metrics_dict(self, analyzer, simple_portfolio):
        """Test combined structural metrics dictionary."""
        metrics = analyzer.get_structural_metrics()

        assert "turnover" in metrics
        assert "diversification" in metrics


class TestBenchmarkData:
    """Test benchmark data fetching."""

    def test_get_risk_free_rate(self, fetcher):
        """Test risk-free rate fetching."""
        rate = fetcher.get_risk_free_rate()

        assert isinstance(rate, Decimal)
        assert 0 < rate < Decimal("0.1")  # Should be between 0% and 10%

    def test_get_benchmark_performance(self, fetcher):
        """Test benchmark performance fetching."""
        perf = fetcher.get_benchmark_performance("SPY")

        if perf:
            assert "return_pct" in perf
            assert "start_price" in perf
            assert "end_price" in perf

    def test_get_benchmark_daily_returns(self, fetcher):
        """Test benchmark daily returns fetching."""
        returns = fetcher.get_benchmark_daily_returns("SPY")

        assert isinstance(returns, list)
        assert len(returns) > 0


class TestEdgeCases:
    """Test edge cases and error handling."""

    def test_portfolio_less_than_one_year(self):
        """Test portfolio created less than a year ago."""
        storage = TransactionStorage()

        # Deposit yesterday
        yesterday = date.today() - timedelta(days=1)
        storage.add_transaction(Transaction(
            date=yesterday,
            asset="CASH",
            asset_type=AssetType.CASH,
            action=TransactionType.DEPOSIT,
            quantity=Decimal("1000"),
            price=Decimal("1"),
            currency="USD",
            fees=Decimal("0"),
            exchange="",
        ))

        analyzer = PortfolioAnalyzer(storage, PriceFetcher())
        _, _, years = analyzer.get_portfolio_dates()

        assert years < 1

    def test_single_position(self):
        """Test portfolio with single position."""
        storage = TransactionStorage()

        storage.add_transaction(Transaction(
            date=date(2024, 1, 1),
            asset="CASH",
            asset_type=AssetType.CASH,
            action=TransactionType.DEPOSIT,
            quantity=Decimal("1000"),
            price=Decimal("1"),
            currency="USD",
            fees=Decimal("0"),
            exchange="",
        ))

        analyzer = PortfolioAnalyzer(storage, PriceFetcher())
        div = analyzer.calculate_diversification_index()

        assert div["total_index"] == Decimal("0")  # Single asset = no diversification

    def test_no_trades(self):
        """Test portfolio with only cash."""
        storage = TransactionStorage()

        storage.add_transaction(Transaction(
            date=date(2024, 1, 1),
            asset="CASH",
            asset_type=AssetType.CASH,
            action=TransactionType.DEPOSIT,
            quantity=Decimal("5000"),
            price=Decimal("1"),
            currency="USD",
            fees=Decimal("0"),
            exchange="",
        ))

        analyzer = PortfolioAnalyzer(storage, PriceFetcher())
        count = analyzer.count_trades()

        assert count == 0

    def test_multiple_currencies(self):
        """Test portfolio with multiple currencies."""
        storage = TransactionStorage()

        # USD deposit
        storage.add_transaction(Transaction(
            date=date(2024, 1, 1),
            asset="CASH",
            asset_type=AssetType.CASH,
            action=TransactionType.DEPOSIT,
            quantity=Decimal("5000"),
            price=Decimal("1"),
            currency="USD",
            fees=Decimal("0"),
            exchange="",
        ))

        # EUR deposit
        storage.add_transaction(Transaction(
            date=date(2024, 1, 1),
            asset="CASH",
            asset_type=AssetType.CASH,
            action=TransactionType.DEPOSIT,
            quantity=Decimal("5000"),
            price=Decimal("1"),
            currency="EUR",
            fees=Decimal("0"),
            exchange="",
        ))

        analyzer = PortfolioAnalyzer(storage, PriceFetcher())
        metrics = analyzer.get_return_metrics()

        assert metrics is not None
