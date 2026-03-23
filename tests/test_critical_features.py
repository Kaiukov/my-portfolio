import sys
from pathlib import Path

import pandas as pd
import pytest
from click.testing import CliRunner

REPO_ROOT = Path(__file__).resolve().parents[1]
repo_str = str(REPO_ROOT)
if repo_str not in sys.path:
    sys.path.insert(0, repo_str)
for module_name in list(sys.modules):
    if module_name == "portfolio_db" or module_name.startswith("portfolio_db."):
        del sys.modules[module_name]

from portfolio_db.cli import cli
from portfolio_db.portfolio_service import PortfolioService, PriceDataUnavailableError
from portfolio_db.price_service import PriceService


def fake_price_fetch(symbols, start_date, end_date):
    index = pd.date_range(start=start_date, end=end_date, freq="D")
    prices = {}
    for symbol in symbols:
        value = {
            "EURUSD=X": 1.2,
            "GBPUSD=X": 1.35,
            "UAHUSD=X": 0.025,
        }.get(symbol, 100.0)
        prices[symbol] = pd.Series([value] * len(index), index=index)
    return prices


@pytest.fixture
def runner():
    return CliRunner()


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "portfolio.db"


@pytest.fixture(autouse=True)
def stub_price_fetch(monkeypatch):
    monkeypatch.setattr(PriceService, "fetch_all_prices", staticmethod(fake_price_fetch))


def test_income_actions_affect_snapshot_not_contributions(db_path: Path):
    service = PortfolioService(str(db_path))
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 1000)
    service.add_transaction("02-01-2026", "USD", "DIVIDEND", 50)
    service.add_transaction("03-01-2026", "USD", "INTEREST", 5)
    service.add_transaction("04-01-2026", "USD", "TAX", 10)
    service.add_transaction("05-01-2026", "USD", "FEE", 2)

    snapshot = service.build_reporting_snapshot()
    service.close()

    assert snapshot["portfolio_value"] == pytest.approx(1043.0)
    assert snapshot["deposits"] == pytest.approx(1000.0)
    assert snapshot["withdrawals"] == pytest.approx(0.0)
    assert snapshot["net_contributions"] == pytest.approx(1000.0)
    assert snapshot["dividends"] == pytest.approx(50.0)
    assert snapshot["interest"] == pytest.approx(5.0)
    assert snapshot["income"] == pytest.approx(55.0)
    assert snapshot["fees"] == pytest.approx(2.0)
    assert snapshot["taxes"] == pytest.approx(10.0)
    assert snapshot["total_profit"] == pytest.approx(43.0)


def test_edit_transaction_updates_row_and_recalculates(db_path: Path, runner: CliRunner):
    service = PortfolioService(str(db_path))
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 1000)
    service.close()

    result = runner.invoke(cli, ["edit", "--id", "1", "--quantity", "1300", "--db", str(db_path)])
    assert result.exit_code == 0, result.output

    service = PortfolioService(str(db_path), read_only=True)
    transaction = service.db.get_transaction_by_id(1)
    snapshot = service.build_reporting_snapshot()
    service.close()

    assert transaction[4] == pytest.approx(1300.0)
    assert transaction[5] == "cash_base"
    assert snapshot["portfolio_value"] == pytest.approx(1300.0)
    assert snapshot["deposits"] == pytest.approx(1300.0)


def test_verify_and_repair_prices_detect_and_fill_missing_fx(db_path: Path):
    service = PortfolioService(str(db_path))
    service.db.add_transaction(
        pd.Timestamp("2026-01-01").date(),
        "EURUSD=X",
        "DEPOSIT",
        1000.0,
        asset_type="cash_fx",
        price=None,
        currency="EUR",
        fees=None,
        exchange="",
        data_source="",
    )

    verify_before = service.verify_prices_storage()
    assert verify_before["coverage"]["issues"]
    assert verify_before["coverage"]["issues"][0]["ticker"] == "EURUSD=X"

    repair = service.repair_prices()
    verify_after = service.verify_prices_storage()
    service.close()

    assert repair["status"] == "success"
    assert "EURUSD=X" in repair["tickers"]
    assert verify_after["coverage"]["issues"] == []
    assert verify_after["refresh_state"]["last_successful_price_refresh"] is not None
    assert verify_after["refresh_state"]["stale_data"] is False


def test_recalculate_fails_explicitly_when_cached_fx_is_missing(db_path: Path):
    service = PortfolioService(str(db_path))
    service.db.add_transaction(
        pd.Timestamp("2026-01-01").date(),
        "EURUSD=X",
        "DEPOSIT",
        1000.0,
        asset_type="cash_fx",
        price=None,
        currency="EUR",
        fees=None,
        exchange="",
        data_source="",
    )

    with pytest.raises(PriceDataUnavailableError):
        service.recalculate(force=True)

    assert service.get_refresh_state()["stale_data"] is True
    service.close()


def test_invalid_buy_without_price_is_rejected(db_path: Path):
    service = PortfolioService(str(db_path))

    with pytest.raises(ValueError, match="requires a positive price"):
        service.add_transaction("01-01-2026", "AAPL", "BUY", 1)

    service.close()


# ── Bug #13: add_transaction must not leave orphan rows when recalc fails ──

def test_add_transaction_rollback_on_recalc_failure(db_path: Path, monkeypatch):
    service = PortfolioService(str(db_path))

    service.add_transaction("02-01-2026", "USD", "DEPOSIT", 1000)
    daily_returns_before = service.get_daily_returns()
    refresh_state_before = service.get_refresh_state()

    def boom(*args, **kwargs):
        raise PriceDataUnavailableError("simulated recalc failure")

    monkeypatch.setattr(service, "_require_cached_price_requirements", boom)

    with pytest.raises(PriceDataUnavailableError):
        service.add_transaction("01-01-2026", "USD", "DEPOSIT", 500)

    assert service.db.get_transaction_count() == 1, (
        "Failed add must not leave an extra transaction row"
    )
    assert service.get_daily_returns() == daily_returns_before, (
        "Failed add must restore daily returns cleared by recalc"
    )
    assert service.get_refresh_state() == refresh_state_before, (
        "Failed add must restore refresh state"
    )
    service.close()


# ── Bug #10: edit_transaction must restore original row when recalc fails ──

def test_edit_transaction_rollback_on_recalc_failure(db_path: Path, monkeypatch):
    service = PortfolioService(str(db_path))

    # Add a valid transaction with real recalc
    result = service.add_transaction("01-01-2026", "USD", "DEPOSIT", 1000)
    trans_id = result["transaction_id"]
    daily_returns_before = service.get_daily_returns()
    refresh_state_before = service.get_refresh_state()

    # Now make recalc always fail
    def boom(*args, **kwargs):
        raise PriceDataUnavailableError("simulated recalc failure")

    monkeypatch.setattr(service, "_require_cached_price_requirements", boom)

    with pytest.raises(PriceDataUnavailableError):
        service.edit_transaction(trans_id, quantity=9999)

    row = service.db.get_transaction_by_id(trans_id)
    assert float(row[4]) == 1000.0, (
        "Original quantity must be restored when edit recalc fails"
    )
    assert service.get_daily_returns() == daily_returns_before, (
        "Failed edit must restore daily returns cleared by recalc"
    )
    assert service.get_refresh_state() == refresh_state_before, (
        "Failed edit must restore refresh state"
    )
    service.close()


# ── Bug #11: deleting the last transaction must not crash ──

def test_delete_last_transaction_does_not_crash(db_path: Path):
    service = PortfolioService(str(db_path))

    result = service.add_transaction("01-01-2026", "USD", "DEPOSIT", 500)
    trans_id = result["transaction_id"]

    delete_result = service.delete_transaction(trans_id)

    assert delete_result["transaction_id"] == trans_id
    assert service.db.get_transaction_count() == 0
    service.close()
