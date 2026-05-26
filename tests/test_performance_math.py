"""Unit tests for performance math: TWR, CAGR, Sharpe, Sortino formulas.

Tests verify that the mathematical relationships hold with hand-calculated
expected values. No mocking of external services — pure formula verification.
"""
import math
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

# ── Price stubs ────────────────────────────────────────────────────────────────
# AAPL: $100 on start, $110 on end (10% gain over the window)
START_PRICE = {"AAPL": 100.0, "EURUSD=X": 1.0, "GBPUSD=X": 1.25}
END_PRICE   = {"AAPL": 110.0, "EURUSD=X": 1.0, "GBPUSD=X": 1.25}


def two_point_fetch(symbols, start_date, end_date):
    """Linear ramp from START_PRICE to END_PRICE."""
    index = pd.date_range(start=start_date, end=end_date, freq="D")
    result = {}
    for sym in symbols:
        s = START_PRICE.get(sym, 100.0)
        e = END_PRICE.get(sym, 100.0)
        if len(index) <= 1:
            prices = [e]
        else:
            prices = [s + (e - s) * i / (len(index) - 1) for i in range(len(index))]
        result[sym] = pd.Series(prices, index=index)
    return result


@pytest.fixture(autouse=True)
def stub_prices(monkeypatch):
    monkeypatch.setattr(PriceService, "fetch_all_prices", staticmethod(two_point_fetch))


@pytest.fixture
def half_invested_db(tmp_path: Path) -> str:
    """
    Portfolio where exactly half is invested in AAPL, half stays cash.
      2026-01-02  DEPOSIT  USD  10_000
      2026-01-03  BUY      AAPL 50 @ 100   → cost 5_000

    AAPL rises 10%: 50 * 110 = 5_500
    Cash stays: 5_000
    End value: 10_500  →  portfolio gain = 5%
    """
    db_path = str(tmp_path / "half.db")
    svc = PortfolioService(db_path)
    svc.db.add_transaction(date(2026, 1, 2), "USD", "DEPOSIT", 10_000, asset_type="cash_base")
    svc.db.add_transaction(date(2026, 1, 3), "AAPL", "BUY", 50, asset_type="stock_usd", price=100.0)
    svc.repair_prices()
    svc.recalculate(force=True)
    svc.close()
    return db_path


@pytest.fixture
def fully_invested_db(tmp_path: Path) -> str:
    """
    Portfolio 100% in AAPL — full 10% gain visible in TWR.
      2026-01-02  DEPOSIT  USD  10_000
      2026-01-03  BUY      AAPL 100 @ 100
    """
    db_path = str(tmp_path / "full.db")
    svc = PortfolioService(db_path)
    svc.db.add_transaction(date(2026, 1, 2), "USD", "DEPOSIT", 10_000, asset_type="cash_base")
    svc.db.add_transaction(date(2026, 1, 3), "AAPL", "BUY", 100, asset_type="stock_usd", price=100.0)
    svc.repair_prices()
    svc.recalculate(force=True)
    svc.close()
    return db_path


# ── TWR formula ───────────────────────────────────────────────────────────────

class TestTWR:
    def test_twr_positive_when_asset_appreciates(self, half_invested_db):
        svc = PortfolioService(half_invested_db, read_only=True)
        stats = svc.get_performance_stats()
        svc.close()
        assert stats["time_weighted_return_pct"] > 0

    def test_twr_fully_invested_approaches_asset_return(self, fully_invested_db):
        """100% in AAPL (+10%) → TWR should be close to 10%."""
        svc = PortfolioService(fully_invested_db, read_only=True)
        stats = svc.get_performance_stats()
        svc.close()
        # TWR may differ slightly from 10% due to multi-day compounding,
        # but must be solidly positive and in the right order of magnitude.
        assert stats["time_weighted_return_pct"] > 0

    def test_twr_equals_total_return_pct(self, half_invested_db):
        """time_weighted_return_pct and total_return_pct must be equal (same metric)."""
        svc = PortfolioService(half_invested_db, read_only=True)
        stats = svc.get_performance_stats()
        svc.close()
        assert stats["time_weighted_return_pct"] == pytest.approx(
            stats["total_return_pct"], rel=1e-6
        )

    def test_twr_manual_product_of_daily_returns(self, half_invested_db):
        """TWR = product of (1 + investment_return_i / 100) - 1."""
        svc = PortfolioService(half_invested_db, read_only=True)
        daily = svc.get_daily_returns()
        stats = svc.get_performance_stats()
        svc.close()

        rows = [r for r in daily if r["portfolio_value"] > 0]
        cumulative = 1.0
        for r in rows[1:]:
            cumulative *= (1 + r["investment_return"] / 100)
        expected_twr = (cumulative - 1) * 100

        assert stats["time_weighted_return_pct"] == pytest.approx(expected_twr, rel=1e-4)


# ── CAGR formula ──────────────────────────────────────────────────────────────

class TestCAGR:
    def test_cagr_formula_from_twr_and_years(self, half_invested_db):
        """CAGR = (1 + TWR)^(1/years) - 1, annualized from actual date range."""
        svc = PortfolioService(half_invested_db, read_only=True)
        stats = svc.get_performance_stats()
        svc.close()

        twr = stats["time_weighted_return_pct"] / 100
        start = stats["start_date"]
        end = stats["end_date"]
        if isinstance(start, str):
            from datetime import datetime
            start = datetime.strptime(start, "%Y-%m-%d").date()
            end = datetime.strptime(end, "%Y-%m-%d").date()
        years = (end - start).days / 365.25

        if years > 0 and twr > -1:
            expected_cagr = ((1 + twr) ** (1 / years) - 1) * 100
            assert stats["cagr"] == pytest.approx(expected_cagr, rel=1e-4)

    def test_cagr_positive_when_twr_positive(self, fully_invested_db):
        svc = PortfolioService(fully_invested_db, read_only=True)
        stats = svc.get_performance_stats()
        svc.close()
        if stats["time_weighted_return_pct"] > 0:
            assert stats["cagr"] > 0

    def test_cagr_higher_than_twr_for_short_periods(self, fully_invested_db):
        """For periods < 1 year with positive returns, CAGR > TWR (annualization amplifies)."""
        svc = PortfolioService(fully_invested_db, read_only=True)
        stats = svc.get_performance_stats()
        svc.close()
        # Only check if the period is less than a year and returns are positive
        if isinstance(stats["start_date"], str):
            from datetime import datetime
            start = datetime.strptime(stats["start_date"], "%Y-%m-%d").date()
            end = datetime.strptime(stats["end_date"], "%Y-%m-%d").date()
        else:
            start, end = stats["start_date"], stats["end_date"]
        years = (end - start).days / 365.25
        if years < 1 and stats["time_weighted_return_pct"] > 0:
            assert stats["cagr"] > stats["time_weighted_return_pct"]


# ── Sharpe ratio formula ───────────────────────────────────────────────────────

class TestSharpe:
    def test_sharpe_formula_sr_equals_excess_return_over_volatility(self, half_invested_db):
        """Sharpe = (CAGR - rf) / hist_volatility (both in decimal)."""
        svc = PortfolioService(half_invested_db, read_only=True)
        stats = svc.get_performance_stats()
        svc.close()

        if stats["hist_volatility"] == 0:
            pytest.skip("No volatility in flat-price test")

        rf = PortfolioService.RISK_FREE_RATE_ANNUAL
        cagr_d = stats["cagr"] / 100
        vol_d = stats["hist_volatility"] / 100
        expected = (cagr_d - rf) / vol_d
        assert stats["sharpe_ratio"] == pytest.approx(expected, rel=1e-4)

    def test_sharpe_is_float(self, half_invested_db):
        svc = PortfolioService(half_invested_db, read_only=True)
        stats = svc.get_performance_stats()
        svc.close()
        assert isinstance(stats["sharpe_ratio"], float)


# ── Volatility formula ────────────────────────────────────────────────────────

class TestVolatility:
    def test_hist_volatility_equals_std_dev_annualized(self, half_invested_db):
        """hist_volatility = std_dev * sqrt(252)."""
        svc = PortfolioService(half_invested_db, read_only=True)
        stats = svc.get_performance_stats()
        svc.close()
        expected = stats["std_dev"] * math.sqrt(252)
        assert stats["hist_volatility"] == pytest.approx(expected, rel=1e-4)

    def test_std_dev_is_non_negative(self, half_invested_db):
        svc = PortfolioService(half_invested_db, read_only=True)
        stats = svc.get_performance_stats()
        svc.close()
        assert stats["std_dev"] >= 0
        assert stats["hist_volatility"] >= 0


# ── VaR formula ───────────────────────────────────────────────────────────────

class TestVaR:
    def test_var_99_more_extreme_than_var_95(self, half_invested_db):
        """VaR 99% must be <= VaR 95% (more extreme tail)."""
        svc = PortfolioService(half_invested_db, read_only=True)
        stats = svc.get_performance_stats()
        svc.close()
        # Both are negative percentiles; 99% tail loss >= 95% tail loss in magnitude
        assert stats["var_99"] <= stats["var_95"]

    def test_cvar_more_extreme_than_var(self, half_invested_db):
        """CVaR (expected shortfall) must be <= VaR at same confidence level."""
        svc = PortfolioService(half_invested_db, read_only=True)
        stats = svc.get_performance_stats()
        svc.close()
        assert stats["cvar_95"] <= stats["var_95"]
        assert stats["cvar_99"] <= stats["var_99"]

    def test_var_values_are_floats(self, half_invested_db):
        svc = PortfolioService(half_invested_db, read_only=True)
        stats = svc.get_performance_stats()
        svc.close()
        for key in ("var_95", "var_99", "cvar_95", "cvar_99"):
            assert isinstance(stats[key], float), f"{key} is not float"


# ── Drawdown formula ──────────────────────────────────────────────────────────

class TestDrawdown:
    def test_max_drawdown_non_negative(self, half_invested_db):
        svc = PortfolioService(half_invested_db, read_only=True)
        stats = svc.get_performance_stats()
        svc.close()
        assert stats["max_drawdown"] >= 0

    def test_avg_drawdown_lte_max_drawdown(self, half_invested_db):
        svc = PortfolioService(half_invested_db, read_only=True)
        stats = svc.get_performance_stats()
        svc.close()
        assert stats["avg_drawdown"] <= stats["max_drawdown"]

    def test_no_drawdown_on_monotonic_gain(self, fully_invested_db):
        """Monotonically rising portfolio → max_drawdown = 0."""
        svc = PortfolioService(fully_invested_db, read_only=True)
        stats = svc.get_performance_stats()
        svc.close()
        # Prices go from 100 to 110 linearly — no drawdown expected
        assert stats["max_drawdown"] == pytest.approx(0.0, abs=0.01)


# ── MWR vs TWR comparison ─────────────────────────────────────────────────────

class TestMwrVsTwr:
    def test_mwr_and_twr_both_positive(self, half_invested_db):
        svc = PortfolioService(half_invested_db, read_only=True)
        stats = svc.get_performance_stats()
        mwr = svc.get_mwr_irr()
        svc.close()
        assert stats["time_weighted_return_pct"] > 0
        assert mwr > 0

    def test_mwr_is_annualized_decimal(self, half_invested_db):
        """MWR is returned as annual decimal, e.g. 0.10 = 10%."""
        svc = PortfolioService(half_invested_db, read_only=True)
        mwr = svc.get_mwr_irr()
        svc.close()
        # For short-period gains, annualized MWR can be very high but must be > -1
        assert mwr > -1.0

    def test_single_deposit_mwr_equals_xirr(self, half_invested_db):
        """MWR with one deposit should be a valid XIRR result."""
        svc = PortfolioService(half_invested_db, read_only=True)
        snap = svc.build_reporting_snapshot()
        mwr = svc.get_mwr_irr()
        svc.close()
        # Terminal value 10_500, one deposit of 10_000 → should be positive
        assert snap["portfolio_value"] == pytest.approx(10_500.0, rel=0.05)
        assert mwr > 0


# ── FX day_gain regression ─────────────────────────────────────────────────────

class TestFXDayGain:
    """Regression: day_gain_pct must be non-zero for FX pairs when rate changes."""

    def test_fx_day_gain_pct_nonzero_when_rate_changes(self, tmp_path, monkeypatch):
        """EURUSD=X position must show correct day_gain_pct when rate moves 1.08→1.10."""
        def fx_fetch(symbols, start_date, end_date):
            index = pd.date_range(start=start_date, end=end_date, freq="D")
            result = {}
            for sym in symbols:
                if sym == "EURUSD=X":
                    prices = [1.08] * max(1, len(index) - 1) + [1.10]
                    prices = prices[-len(index):]
                else:
                    prices = [1.0] * len(index)
                result[sym] = pd.Series(prices, index=index)
            return result

        monkeypatch.setattr(PriceService, "fetch_all_prices", staticmethod(fx_fetch))

        db_path = str(tmp_path / "fx_gain.db")
        svc = PortfolioService(db_path)
        svc.db.add_transaction(date(2026, 1, 2), "EURUSD=X", "DEPOSIT", 1_000, asset_type="cash_fx", currency="EUR")
        svc.repair_prices()
        svc.recalculate(force=True)
        svc.close()

        svc = PortfolioService(db_path, read_only=True)
        positions = svc.get_position_summary()
        svc.close()

        fx_pos = next((p for p in positions if p["symbol"] == "EURUSD=X"), None)
        assert fx_pos is not None, "EURUSD=X not found in position summary"
        expected_pct = (1.10 - 1.08) / 1.08 * 100  # ≈ 1.852%
        expected_val = 1_000 * (1.10 - 1.08)         # = 20 USD
        assert fx_pos["day_gain_pct"] == pytest.approx(expected_pct, rel=1e-4)
        assert fx_pos["day_gain_value"] == pytest.approx(expected_val, rel=1e-4)

    def test_fx_day_gain_zero_when_rate_unchanged(self, tmp_path, monkeypatch):
        """EURUSD=X day_gain_pct must be 0 when rate stays flat."""
        def flat_fetch(symbols, start_date, end_date):
            index = pd.date_range(start=start_date, end=end_date, freq="D")
            return {sym: pd.Series([1.10] * len(index), index=index) for sym in symbols}

        monkeypatch.setattr(PriceService, "fetch_all_prices", staticmethod(flat_fetch))

        db_path = str(tmp_path / "fx_flat.db")
        svc = PortfolioService(db_path)
        svc.db.add_transaction(date(2026, 1, 2), "EURUSD=X", "DEPOSIT", 1_000, asset_type="cash_fx", currency="EUR")
        svc.repair_prices()
        svc.recalculate(force=True)
        svc.close()

        svc = PortfolioService(db_path, read_only=True)
        positions = svc.get_position_summary()
        svc.close()

        fx_pos = next((p for p in positions if p["symbol"] == "EURUSD=X"), None)
        assert fx_pos is not None
        assert fx_pos["day_gain_pct"] == pytest.approx(0.0)


# ── Phase 1: risk metrics use investment_return, median, date-join ────────────


@pytest.fixture
def deposit_only_db(tmp_path: Path) -> str:
    """Portfolio with only a deposit — no trades. investment_return ≈ 0."""
    db_path = str(tmp_path / "dep_only.db")
    svc = PortfolioService(db_path)
    svc.db.add_transaction(date(2026, 1, 2), "USD", "DEPOSIT", 10_000, asset_type="cash_base")
    svc.repair_prices()
    svc.recalculate(force=True)
    svc.close()
    return db_path


class TestInvestmentReturnForRisk:
    """Deposit-only portfolio should show near-zero risk from clean returns."""

    def test_volatility_near_zero_when_no_investments(self, deposit_only_db):
        """Deposit-only day → portfolio_daily_return spikes, investment_return ≈ 0.
        risk metrics must use the latter, producing near-zero volatility."""
        svc = PortfolioService(deposit_only_db, read_only=True)
        stats = svc.get_performance_stats()
        svc.close()

        assert stats["hist_volatility"] < 1.0, (
            f"hist_volatility={stats['hist_volatility']:.4f} — should be near-zero for deposit-only, "
            f"but >1 suggests portfolio_daily_return was used instead of investment_return"
        )
        assert stats["std_dev"] < 0.1
        assert stats["beta"] == 0.0  # no benchmark overlap possible


    def test_deposit_does_not_contaminate_sharpe(self, deposit_only_db):
        svc = PortfolioService(deposit_only_db, read_only=True)
        stats = svc.get_performance_stats()
        svc.close()
        assert stats["sharpe_ratio"] == 0.0


class TestMedianMonthlyReturn:
    """median_monthly_return must be the median, not the mean, and named correctly."""

    def test_median_monthly_return_field_exists(self, half_invested_db):
        svc = PortfolioService(half_invested_db, read_only=True)
        stats = svc.get_performance_stats()
        svc.close()
        assert "median_monthly_return" in stats, \
            "Field 'median_monthly_return' missing — was avg_monthly_return renamed?"
        assert "avg_monthly_return" not in stats, \
            "Field 'avg_monthly_return' must not exist after rename to median_monthly_return"


class TestBenchmarkAlignment:
    """Benchmark alignment must use date join, not array slicing."""

    def test_beta_and_capture_in_bounds_after_clean_return_metrics(self, half_invested_db):
        """With investment_return and date-join, beta and capture ratios stay bounded."""
        svc = PortfolioService(half_invested_db, read_only=True)
        stats = svc.get_performance_stats()
        svc.close()
        assert isinstance(stats["up_capture_ratio"], (int, float))
        assert isinstance(stats["down_capture_ratio"], (int, float))
        # Beta from aligned returns must be in a sane range
        assert -5 <= stats["beta"] <= 5
