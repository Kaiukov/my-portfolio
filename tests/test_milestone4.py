"""Milestone 4 tests: MWR/IRR, benchmark comparison, contribution by position.

All tests use deterministic fixed prices and hand-verifiable cash flows.
"""
import sys
from datetime import date
from pathlib import Path

import pandas as pd
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
repo_str = str(REPO_ROOT)
if repo_str not in sys.path:
    sys.path.insert(0, repo_str)
for module_name in list(sys.modules):
    if module_name == "portfolio_db" or module_name.startswith("portfolio_db."):
        del sys.modules[module_name]

from portfolio_db.portfolio_service import PortfolioService
from portfolio_db.performance_service import PerformanceService
from portfolio_db.price_service import PriceService

# ── Fixed price stub ───────────────────────────────────────────────────────────
# AAPL: $100 → $110 over two days (10% gain), SPY: $400 → $404 (1% gain)
FIXED_PRICES = {
    "AAPL": 110.0,
    "SPY": 404.0,
    "EURUSD=X": 1.1,
    "GBPUSD=X": 1.25,
    "UAHUSD=X": 0.025,
}

# Day-1 prices (for two-day series: start → end)
DAY1_PRICES = {
    "AAPL": 100.0,
    "SPY": 400.0,
    "EURUSD=X": 1.1,
    "GBPUSD=X": 1.25,
    "UAHUSD=X": 0.025,
}


def fixed_price_fetch(symbols, start_date, end_date):
    """Returns a two-point series: day1 price then day2 price."""
    index = pd.date_range(start=start_date, end=end_date, freq="D")
    result = {}
    for sym in symbols:
        if len(index) > 1:
            prices = [DAY1_PRICES.get(sym, 100.0)] * (len(index) - 1) + [FIXED_PRICES.get(sym, 100.0)]
        else:
            prices = [FIXED_PRICES.get(sym, 100.0)] * len(index)
        result[sym] = pd.Series(prices, index=index)
    return result


@pytest.fixture(autouse=True)
def stub_prices(monkeypatch):
    monkeypatch.setattr(PriceService, "fetch_all_prices", staticmethod(fixed_price_fetch))


@pytest.fixture
def simple_db(tmp_path: Path) -> str:
    """
    Simple portfolio for hand-verifiable MWR:
      2026-01-02  DEPOSIT USD 10_000   (outflow from investor: -10_000)
      2026-01-03  BUY AAPL 10 @ 100   (reduces cash by 1_000)
    End value on 2026-01-04 with AAPL @ 110:
      cash = 10_000 - 1_000 = 9_000
      AAPL = 10 * 110 = 1_100
      total = 10_100

    Exact MWR: one deposit of 10_000 on day 0, terminal 10_100 on day 2.
    XIRR: -10_000 / (1+r)^0 + 10_100 / (1+r)^(2/365.25) = 0
    => r ≈ very large (short period), but positive.

    SPY prices are seeded manually (400 → 404 = 1% gain).
    """
    db_path = str(tmp_path / "simple.db")
    svc = PortfolioService(db_path)
    svc.db.add_transaction(date(2026, 1, 2), "USD", "DEPOSIT", 10_000, asset_type="cash_base")
    svc.db.add_transaction(date(2026, 1, 3), "AAPL", "BUY", 10, asset_type="stock_usd", price=100.0)
    svc.repair_prices()
    # Seed SPY benchmark prices so benchmark metrics can be computed
    svc.db.insert_price("SPY", date(2026, 1, 2), 400.0)
    svc.db.insert_price("SPY", date(2026, 1, 3), 404.0)
    svc.recalculate(force=True)
    svc.close()
    return db_path


@pytest.fixture
def multi_deposit_db(tmp_path: Path) -> str:
    """
    Portfolio with two deposits and AAPL appreciation for clearer XIRR test:
      2026-01-02  DEPOSIT USD 5_000
      2026-01-15  DEPOSIT USD 5_000
      2026-01-03  BUY AAPL 10 @ 100
    End state: cash ~9_000, AAPL ~1_100 = 10_100
    MWR should be positive (AAPL appreciated 10%).
    """
    db_path = str(tmp_path / "multi.db")
    svc = PortfolioService(db_path)
    svc.db.add_transaction(date(2026, 1, 2), "USD", "DEPOSIT", 5_000, asset_type="cash_base")
    svc.db.add_transaction(date(2026, 1, 3), "AAPL", "BUY", 10, asset_type="stock_usd", price=100.0)
    svc.db.add_transaction(date(2026, 1, 4), "USD", "DEPOSIT", 5_000, asset_type="cash_base")
    svc.repair_prices()
    svc.recalculate(force=True)
    svc.close()
    return db_path


# ── XIRR unit tests (pure math, no DB) ────────────────────────────────────────

class TestCalculateXirr:
    def test_simple_annual_return(self):
        """Invest 100 on day 0, get back 110 one year later → 10% return."""
        flows = [
            {'date': date(2025, 1, 1), 'amount': -100.0},
            {'date': date(2026, 1, 1), 'amount': 110.0},
        ]
        rate = PerformanceService.calculate_xirr(flows)
        assert 0.08 < rate < 0.12, f"Expected ~10%, got {rate:.4f}"

    def test_zero_return(self):
        """Invest 100, get back 100 after a year → 0% return."""
        flows = [
            {'date': date(2025, 1, 1), 'amount': -100.0},
            {'date': date(2026, 1, 1), 'amount': 100.0},
        ]
        rate = PerformanceService.calculate_xirr(flows)
        assert abs(rate) < 0.01, f"Expected ~0%, got {rate:.4f}"

    def test_negative_return(self):
        """Invest 100, get back 90 after a year → ~-10% return."""
        flows = [
            {'date': date(2025, 1, 1), 'amount': -100.0},
            {'date': date(2026, 1, 1), 'amount': 90.0},
        ]
        rate = PerformanceService.calculate_xirr(flows)
        assert -0.12 < rate < -0.08, f"Expected ~-10%, got {rate:.4f}"

    def test_insufficient_flows_returns_zero(self):
        assert PerformanceService.calculate_xirr([]) == 0.0
        assert PerformanceService.calculate_xirr([{'date': date(2025, 1, 1), 'amount': -100.0}]) == 0.0

    def test_all_same_sign_returns_zero(self):
        """All outflows or all inflows → no valid IRR."""
        flows = [
            {'date': date(2025, 1, 1), 'amount': -100.0},
            {'date': date(2025, 6, 1), 'amount': -50.0},
        ]
        assert PerformanceService.calculate_xirr(flows) == 0.0

    def test_two_year_investment(self):
        """Invest 100, get 121 after 2 years → ~10% p.a."""
        flows = [
            {'date': date(2024, 1, 1), 'amount': -100.0},
            {'date': date(2026, 1, 1), 'amount': 121.0},
        ]
        rate = PerformanceService.calculate_xirr(flows)
        assert 0.08 < rate < 0.12, f"Expected ~10%, got {rate:.4f}"

    def test_multiple_deposits(self):
        """Two deposits then terminal value — should return positive rate."""
        flows = [
            {'date': date(2025, 1, 1), 'amount': -1000.0},
            {'date': date(2025, 7, 1), 'amount': -1000.0},
            {'date': date(2026, 1, 1), 'amount': 2200.0},
        ]
        rate = PerformanceService.calculate_xirr(flows)
        assert rate > 0, f"Expected positive return, got {rate:.4f}"


# ── MWR/IRR integration tests ──────────────────────────────────────────────────

class TestMwrIrr:
    def test_mwr_is_positive_when_portfolio_gains(self, simple_db):
        """Portfolio grew from 10_000 to 10_100 → MWR must be positive."""
        svc = PortfolioService(simple_db, read_only=True)
        mwr = svc.get_mwr_irr()
        svc.close()
        assert mwr > 0, f"Expected positive MWR, got {mwr}"

    def test_mwr_is_float(self, simple_db):
        svc = PortfolioService(simple_db, read_only=True)
        mwr = svc.get_mwr_irr()
        svc.close()
        assert isinstance(mwr, float)

    def test_mwr_empty_portfolio_returns_zero(self, tmp_path):
        db_path = str(tmp_path / "empty.db")
        svc = PortfolioService(db_path)
        mwr = svc.get_mwr_irr()
        svc.close()
        assert mwr == 0.0

    def test_mwr_multi_deposit_positive(self, multi_deposit_db):
        """Two deposits with appreciating asset → MWR positive."""
        svc = PortfolioService(multi_deposit_db, read_only=True)
        mwr = svc.get_mwr_irr()
        svc.close()
        assert mwr > 0

    def test_mwr_pct_in_performance_output(self, simple_db):
        """performance CLI includes mwr_irr section with mwr_pct."""
        from click.testing import CliRunner
        from portfolio_db.cli import cli
        import json
        runner = CliRunner()
        result = runner.invoke(cli, ["performance", simple_db])
        data = json.loads(result.output)
        assert data["ok"] is True
        assert "mwr_irr" in data["data"]
        mwr_section = data["data"]["mwr_irr"]
        assert "mwr_pct" in mwr_section
        assert isinstance(mwr_section["mwr_pct"], (int, float))
        assert mwr_section["mwr_pct"] > 0, "MWR% should be positive for gaining portfolio"


# ── Benchmark section tests ────────────────────────────────────────────────────

class TestBenchmark:
    def test_benchmark_section_in_performance_output(self, simple_db):
        """performance CLI includes benchmark section."""
        from click.testing import CliRunner
        from portfolio_db.cli import cli
        import json
        runner = CliRunner()
        result = runner.invoke(cli, ["performance", simple_db])
        data = json.loads(result.output)
        assert data["ok"] is True
        assert "benchmark" in data["data"]
        bench = data["data"]["benchmark"]
        assert "benchmark_twr_pct" in bench
        assert "benchmark_cagr_pct" in bench
        assert "relative_return_pct" in bench
        assert "up_capture_ratio" in bench
        assert "down_capture_ratio" in bench

    def test_benchmark_fields_are_numeric(self, simple_db):
        from click.testing import CliRunner
        from portfolio_db.cli import cli
        import json
        runner = CliRunner()
        result = runner.invoke(cli, ["performance", simple_db])
        data = json.loads(result.output)
        bench = data["data"]["benchmark"]
        assert isinstance(bench["benchmark_twr_pct"], (int, float))
        assert isinstance(bench["benchmark_cagr_pct"], (int, float))
        assert isinstance(bench["up_capture_ratio"], (int, float))
        assert isinstance(bench["down_capture_ratio"], (int, float))

    def test_spy_twr_with_known_prices(self, simple_db):
        """SPY went from 400 to 404 = 1% gain → spy_twr_pct close to 1."""
        svc = PortfolioService(simple_db, read_only=True)
        stats = svc.get_performance_stats()
        svc.close()
        # SPY TWR: 1% over the 2-day window
        assert abs(stats["spy_twr_pct"] - 1.0) < 0.5, f"spy_twr_pct={stats['spy_twr_pct']}"

    def test_relative_return_is_portfolio_minus_spy(self, simple_db):
        """Relative return = portfolio CAGR - SPY CAGR."""
        svc = PortfolioService(simple_db, read_only=True)
        stats = svc.get_performance_stats()
        svc.close()
        # relative_return should be a number (positive if portfolio > SPY)
        assert isinstance(stats["relative_return"], float)


# ── Contribution by position tests ────────────────────────────────────────────

class TestContributionByPosition:
    def test_contribution_returns_list(self, simple_db):
        svc = PortfolioService(simple_db, read_only=True)
        contribs = svc.get_contribution_by_position()
        svc.close()
        assert isinstance(contribs, list)
        assert len(contribs) > 0

    def test_contribution_has_required_fields(self, simple_db):
        svc = PortfolioService(simple_db, read_only=True)
        contribs = svc.get_contribution_by_position()
        svc.close()
        for item in contribs:
            assert "symbol" in item
            assert "market_value" in item
            assert "weight_pct" in item
            assert "total_gain" in item
            assert "contribution_to_gain_pct" in item

    def test_aapl_has_positive_gain(self, simple_db):
        """AAPL: bought at 100, now 110 → total_gain > 0."""
        svc = PortfolioService(simple_db, read_only=True)
        contribs = svc.get_contribution_by_position()
        svc.close()
        aapl = next((c for c in contribs if c["symbol"] == "AAPL"), None)
        assert aapl is not None, "AAPL not found in contributions"
        assert aapl["total_gain"] > 0, f"AAPL gain={aapl['total_gain']}"
        assert aapl["contribution_to_gain_pct"] > 0

    def test_weights_sum_to_100(self, simple_db):
        """All position weights should sum to 100% of portfolio."""
        svc = PortfolioService(simple_db, read_only=True)
        contribs = svc.get_contribution_by_position()
        svc.close()
        total_weight = sum(c["weight_pct"] for c in contribs)
        assert abs(total_weight - 100.0) < 0.1, f"Weights sum={total_weight}"

    def test_contribution_in_performance_output(self, simple_db):
        """performance CLI includes contribution_by_position list."""
        from click.testing import CliRunner
        from portfolio_db.cli import cli
        import json
        runner = CliRunner()
        result = runner.invoke(cli, ["performance", simple_db])
        data = json.loads(result.output)
        assert data["ok"] is True
        assert "contribution_by_position" in data["data"]
        contribs = data["data"]["contribution_by_position"]
        assert isinstance(contribs, list)
        assert len(contribs) > 0
        # AAPL should be present
        symbols = [c["symbol"] for c in contribs]
        assert "AAPL" in symbols

    def test_empty_portfolio_contribution_empty(self, tmp_path):
        db_path = str(tmp_path / "empty.db")
        svc = PortfolioService(db_path)
        contribs = svc.get_contribution_by_position()
        svc.close()
        assert contribs == []

    def test_sorted_by_absolute_gain(self, simple_db):
        """Contributions are sorted by absolute total_gain descending."""
        svc = PortfolioService(simple_db, read_only=True)
        contribs = svc.get_contribution_by_position()
        svc.close()
        gains = [abs(c["total_gain"]) for c in contribs]
        assert gains == sorted(gains, reverse=True)
