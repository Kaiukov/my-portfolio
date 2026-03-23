import json
import sys
from datetime import date
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
import portfolio_db.recalculation_service as recalc_module


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


def test_recalculate_failure_preserves_existing_daily_returns(db_path: Path, monkeypatch):
    service = PortfolioService(str(db_path))
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 1000)
    daily_returns_before = service.get_daily_returns()

    def boom(self):
        raise ValueError("simulated calc failure")

    monkeypatch.setattr(recalc_module.DailyReturnCalculator, "calculate_all_returns", boom)

    with pytest.raises(PriceDataUnavailableError):
        service.recalculate(force=True)

    assert service.get_daily_returns() == daily_returns_before, (
        "Failed recalc must preserve previously stored daily returns"
    )
    assert service.get_refresh_state()["stale_data"] is True
    service.close()


def test_recalculate_uses_bulk_daily_return_replace(db_path: Path, monkeypatch):
    service = PortfolioService(str(db_path))
    service.db.add_transaction(
        pd.Timestamp("2026-01-01").date(),
        "USD",
        "DEPOSIT",
        1000.0,
        asset_type="cash_base",
    )
    service.db.add_transaction(
        pd.Timestamp("2026-01-02").date(),
        "AAPL",
        "BUY",
        1.0,
        asset_type="stock_usd",
        price=100.0,
    )
    monkeypatch.setattr(service, "_require_cached_price_requirements", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        service._recalc.price_cache,
        "load_calculation_prices",
        lambda symbols, start_date, end_date: fake_price_fetch(symbols, start_date, end_date),
    )

    calls = []
    original_replace = service.db.replace_daily_returns

    def spy(rows, start_date=None):
        calls.append((len(rows), start_date))
        return original_replace(rows, start_date=start_date)

    def fail_if_row_write(*args, **kwargs):
        raise AssertionError("recalculate should not call insert_daily_return row-by-row")

    monkeypatch.setattr(service.db, "replace_daily_returns", spy)
    monkeypatch.setattr(service.db, "insert_daily_return", fail_if_row_write)

    result = service.recalculate(force=True)

    assert result["status"] == "success"
    assert calls == [(len(service.get_daily_returns()), None)]
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


# ── Bug #5: non-USD stock day_gain must use per-day FX rates ──

def _make_fx_price_fetch(day1, stock_price_day1, stock_price_day2, fx_day1, fx_day2):
    """Stub that returns day-specific prices for regional stock + FX pair."""
    def fetch(symbols, start_date, end_date):
        idx = pd.date_range(start=start_date, end=end_date, freq="D")
        result = {}
        for s in symbols:
            if s == "VGEU.DE":
                values = [stock_price_day1 if pd.Timestamp(d).date() <= day1 else stock_price_day2 for d in idx]
                result[s] = pd.Series(values, index=idx)
            elif s == "VUKG.L":
                values = [stock_price_day1 if pd.Timestamp(d).date() <= day1 else stock_price_day2 for d in idx]
                result[s] = pd.Series(values, index=idx)
            elif s == "EURUSD=X":
                values = [fx_day1 if pd.Timestamp(d).date() <= day1 else fx_day2 for d in idx]
                result[s] = pd.Series(values, index=idx)
            elif s == "GBPUSD=X":
                values = [fx_day1 if pd.Timestamp(d).date() <= day1 else fx_day2 for d in idx]
                result[s] = pd.Series(values, index=idx)
            else:
                result[s] = pd.Series([1.0] * len(idx), index=idx)
        return result
    return fetch


def _setup_non_usd_stock_service(db_path, monkeypatch, fetch_fn, symbol, currency, asset_type):
    """Add USD deposit + one non-USD stock BUY directly, then repair+recalc."""
    monkeypatch.setattr(PriceService, "fetch_all_prices", staticmethod(fetch_fn))
    service = PortfolioService(str(db_path))
    # Add transactions directly to DB to avoid recalc-before-price-load order issue
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 10000)
    service.db.add_transaction(
        date(2026, 1, 1), symbol, "BUY", 100,
        asset_type=asset_type, price=50.0, currency=currency,
    )
    service.repair_prices()
    service.recalculate(force=True)
    return service


def test_stock_eur_day_gain_reflects_fx_only_movement(db_path: Path, monkeypatch):
    """Flat local price, FX 1.08→1.10: day_gain must capture pure FX PnL."""
    day1, day2 = date(2026, 1, 1), date(2026, 1, 2)
    shares, local_price = 100, 50.0

    service = _setup_non_usd_stock_service(
        db_path, monkeypatch,
        _make_fx_price_fetch(day1, local_price, local_price, fx_day1=1.08, fx_day2=1.10),
        symbol="VGEU.DE", currency="EUR", asset_type="stock_eur",
    )
    positions = service.get_position_summary(as_of_date=day2)
    pos = next(p for p in positions if p["symbol"] == "VGEU.DE")
    service.close()

    # yesterday: 100*50*1.08=5400 | today: 100*50*1.10=5500
    assert pos["day_gain_value"] == pytest.approx(shares * local_price * (1.10 - 1.08))
    assert pos["day_gain_pct"] == pytest.approx((local_price * 1.10 - local_price * 1.08) / (local_price * 1.08) * 100)


def test_stock_eur_day_gain_reflects_combined_stock_and_fx_movement(db_path: Path, monkeypatch):
    """Local price 50→52, FX 1.08→1.10: day_gain reflects both components."""
    day1, day2 = date(2026, 1, 1), date(2026, 1, 2)
    shares = 100

    service = _setup_non_usd_stock_service(
        db_path, monkeypatch,
        _make_fx_price_fetch(day1, stock_price_day1=50.0, stock_price_day2=52.0, fx_day1=1.08, fx_day2=1.10),
        symbol="VGEU.DE", currency="EUR", asset_type="stock_eur",
    )
    positions = service.get_position_summary(as_of_date=day2)
    pos = next(p for p in positions if p["symbol"] == "VGEU.DE")
    service.close()

    # yesterday: 100*50*1.08=5400 | today: 100*52*1.10=5720
    assert pos["day_gain_value"] == pytest.approx(shares * (52.0 * 1.10 - 50.0 * 1.08))
    assert pos["day_gain_pct"] == pytest.approx((52.0 * 1.10 - 50.0 * 1.08) / (50.0 * 1.08) * 100)


def test_stock_gbp_day_gain_reflects_fx_only_movement(db_path: Path, monkeypatch):
    """Flat local price, FX 1.28→1.30: day_gain must capture pure FX PnL."""
    day1, day2 = date(2026, 1, 1), date(2026, 1, 2)
    shares, local_price = 100, 50.0

    service = _setup_non_usd_stock_service(
        db_path, monkeypatch,
        _make_fx_price_fetch(day1, local_price, local_price, fx_day1=1.28, fx_day2=1.30),
        symbol="VUKG.L", currency="GBP", asset_type="stock_gbp",
    )
    positions = service.get_position_summary(as_of_date=day2)
    pos = next(p for p in positions if p["symbol"] == "VUKG.L")
    service.close()

    # yesterday: 100*50*1.28=6400 | today: 100*50*1.30=6500
    assert pos["day_gain_value"] == pytest.approx(shares * local_price * (1.30 - 1.28))
    assert pos["day_gain_pct"] == pytest.approx((local_price * 1.30 - local_price * 1.28) / (local_price * 1.28) * 100)


# ── Bug #8: negative cash balance must be OPEN, not CLOSED ──

def test_negative_cash_balance_is_open(db_path: Path):
    service = PortfolioService(str(db_path))
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 100)
    service.add_transaction("02-01-2026", "USD", "WITHDRAW", 150)

    snapshot = service.build_reporting_snapshot(include_closed=True)
    usd = next(p for p in snapshot["positions"] if p["symbol"] == "USD")
    service.close()

    assert usd["shares"] == pytest.approx(-50.0)
    assert usd["status"] == "OPEN", "Negative cash balance is still an active position"


# ── Bug #12: editing TRANSFER account to empty must be rejected ──

def test_transfer_edit_cannot_clear_account(db_path: Path):
    service = PortfolioService(str(db_path))
    result = service.add_transaction("01-01-2026", "USD", "TRANSFER", 500, account="broker-A")
    trans_id = result["transaction_id"]

    with pytest.raises(ValueError, match="TRANSFER requires an account"):
        service.edit_transaction(trans_id, account="")
    service.close()


def test_changing_action_to_transfer_without_account_rejected(db_path: Path):
    service = PortfolioService(str(db_path))
    result = service.add_transaction("01-01-2026", "USD", "DEPOSIT", 500)
    trans_id = result["transaction_id"]

    with pytest.raises(ValueError, match="TRANSFER requires an account"):
        service.edit_transaction(trans_id, action="TRANSFER")
    service.close()


def test_transfer_edit_dry_run_cannot_clear_account(runner, db_path: Path):
    service = PortfolioService(str(db_path))
    result = service.add_transaction("01-01-2026", "USD", "TRANSFER", 500, account="broker-A")
    trans_id = result["transaction_id"]
    service.close()

    result = runner.invoke(cli, ["edit", "--id", str(trans_id), "--account", "", "--dry-run", "--db", str(db_path)])

    assert result.exit_code == 1, result.output
    body = json.loads(result.output)
    assert body["ok"] is False
    assert body["command"] == "edit"
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert "TRANSFER requires an account" in body["error"]["message"]
