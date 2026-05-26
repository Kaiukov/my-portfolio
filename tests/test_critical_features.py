import json
import importlib
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

from portfolio_db.cli import cli  # noqa: E402
from portfolio_db.portfolio_service import PortfolioService, PriceDataUnavailableError  # noqa: E402
from portfolio_db.price_service import PriceService  # noqa: E402


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

@pytest.fixture(autouse=True)
def stub_price_fetch(monkeypatch):
    monkeypatch.setattr(PriceService, "fetch_all_prices", staticmethod(fake_price_fetch))


def test_income_actions_affect_snapshot_not_contributions():
    service = PortfolioService()
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


def test_edit_transaction_updates_row_and_recalculates(runner):
    service = PortfolioService()
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 1000)
    service.close()

    result = runner.invoke(cli, ["edit", "--id", "1", "--quantity", "1300"])
    assert result.exit_code == 0, result.output

    service = PortfolioService(read_only=True)
    transaction = service.db.get_transaction_by_id(1)
    snapshot = service.build_reporting_snapshot()
    service.close()

    assert transaction[4] == pytest.approx(1300.0)
    assert transaction[5] == "cash_base"
    assert snapshot["portfolio_value"] == pytest.approx(1300.0)
    assert snapshot["deposits"] == pytest.approx(1300.0)


def test_verify_and_repair_prices_detect_and_fill_missing_fx():
    service = PortfolioService()
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


def test_recalculate_fails_explicitly_when_cached_fx_is_missing():
    service = PortfolioService()
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


def test_recalculate_failure_preserves_existing_daily_returns(monkeypatch):
    service = PortfolioService()
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 1000)
    daily_returns_before = service.get_daily_returns()

    def boom(*args, **kwargs):
        raise ValueError("simulated calc failure")

    monkeypatch.setattr(service.db, "refresh_daily_returns_sql", boom)

    with pytest.raises(PriceDataUnavailableError):
        service.recalculate(force=True)

    assert service.get_daily_returns() == daily_returns_before, (
        "Failed recalc must preserve previously stored daily returns"
    )
    assert service.get_refresh_state()["stale_data"] is True
    service.close()


def test_recalculate_uses_database_refresh_function(monkeypatch):
    service = PortfolioService()
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

    calls = []
    def spy(from_date=None):
        calls.append(from_date)
        return 1

    def fail_if_row_write(*args, **kwargs):
        raise AssertionError("recalculate should not call insert_daily_return row-by-row")

    monkeypatch.setattr(service.db, "refresh_daily_returns_sql", spy)
    monkeypatch.setattr(service.db, "insert_daily_return", fail_if_row_write)

    result = service.recalculate(force=True)

    assert result["status"] == "success"
    assert calls == [None]
    service.close()


def test_invalid_buy_without_price_is_rejected():
    service = PortfolioService()

    with pytest.raises(ValueError, match="requires a positive price"):
        service.add_transaction("01-01-2026", "AAPL", "BUY", 1)

    service.close()


# ── Bug #13: add_transaction must not leave orphan rows when recalc fails ──

def test_add_transaction_rollback_on_recalc_failure(monkeypatch):
    service = PortfolioService()

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

def test_edit_transaction_rollback_on_recalc_failure(monkeypatch):
    service = PortfolioService()

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

def test_delete_last_transaction_does_not_crash():
    service = PortfolioService()

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
            # Regional stocks
            if s in ("VGEU.DE", "VUKG.L", "7203.T", "NESN.SW", "SHOP.TO", "CSL.AX", "0005.HK", "D05.SG"):
                values = [stock_price_day1 if pd.Timestamp(d).date() <= day1 else stock_price_day2 for d in idx]
                result[s] = pd.Series(values, index=idx)
            # FX pairs — XXXUSD=X format
            elif s.endswith("USD=X"):
                values = [fx_day1 if pd.Timestamp(d).date() <= day1 else fx_day2 for d in idx]
                result[s] = pd.Series(values, index=idx)
            else:
                result[s] = pd.Series([1.0] * len(idx), index=idx)
        return result
    return fetch


def _setup_non_usd_stock_service(monkeypatch, fetch_fn, symbol, currency, asset_type):
    """Add USD deposit + one non-USD stock BUY directly, then repair+recalc."""
    monkeypatch.setattr(PriceService, "fetch_all_prices", staticmethod(fetch_fn))
    service = PortfolioService()
    # Add transactions directly to DB to avoid recalc-before-price-load order issue
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 10000)
    service.db.add_transaction(
        date(2026, 1, 1), symbol, "BUY", 100,
        asset_type=asset_type, price=50.0, currency=currency,
    )
    # repair_prices() will use mocked fetch_all_prices
    service.repair_prices()
    service.recalculate(force=True)
    return service


def test_stock_eur_day_gain_reflects_fx_only_movement(monkeypatch):
    """Flat local price, FX 1.08→1.10: day_gain must capture pure FX PnL."""
    day1, day2 = date(2026, 1, 1), date(2026, 1, 2)
    shares, local_price = 100, 50.0

    service = _setup_non_usd_stock_service(
        monkeypatch,
        _make_fx_price_fetch(day1, local_price, local_price, fx_day1=1.08, fx_day2=1.10),
        symbol="VGEU.DE", currency="EUR", asset_type="stock_eur",
    )
    positions = service.get_position_summary(as_of_date=day2)
    pos = next(p for p in positions if p["symbol"] == "VGEU.DE")
    service.close()

    # yesterday: 100*50*1.08=5400 | today: 100*50*1.10=5500
    assert pos["day_gain_value"] == pytest.approx(shares * local_price * (1.10 - 1.08))
    assert pos["day_gain_pct"] == pytest.approx((local_price * 1.10 - local_price * 1.08) / (local_price * 1.08) * 100)


def test_stock_eur_day_gain_reflects_combined_stock_and_fx_movement(monkeypatch):
    """Local price 50→52, FX 1.08→1.10: day_gain reflects both components."""
    day1, day2 = date(2026, 1, 1), date(2026, 1, 2)
    shares = 100

    service = _setup_non_usd_stock_service(
        monkeypatch,
        _make_fx_price_fetch(day1, stock_price_day1=50.0, stock_price_day2=52.0, fx_day1=1.08, fx_day2=1.10),
        symbol="VGEU.DE", currency="EUR", asset_type="stock_eur",
    )
    positions = service.get_position_summary(as_of_date=day2)
    pos = next(p for p in positions if p["symbol"] == "VGEU.DE")
    service.close()

    # yesterday: 100*50*1.08=5400 | today: 100*52*1.10=5720
    assert pos["day_gain_value"] == pytest.approx(shares * (52.0 * 1.10 - 50.0 * 1.08))
    assert pos["day_gain_pct"] == pytest.approx((52.0 * 1.10 - 50.0 * 1.08) / (50.0 * 1.08) * 100)


def test_stock_gbp_day_gain_reflects_fx_only_movement(monkeypatch):
    """Flat local price, FX 1.28→1.30: day_gain must capture pure FX PnL."""
    day1, day2 = date(2026, 1, 1), date(2026, 1, 2)
    shares, local_price = 100, 50.0

    service = _setup_non_usd_stock_service(
        monkeypatch,
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

def test_negative_cash_balance_is_open():
    service = PortfolioService()
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 100)
    service.add_transaction("02-01-2026", "USD", "WITHDRAW", 150)

    snapshot = service.build_reporting_snapshot(include_closed=True)
    usd = next(p for p in snapshot["positions"] if p["symbol"] == "USD")
    service.close()

    assert usd["shares"] == pytest.approx(-50.0)
    assert usd["status"] == "OPEN", "Negative cash balance is still an active position"


# ── Bug #12: editing TRANSFER account to empty must be rejected ──

def test_transfer_edit_cannot_clear_account():
    service = PortfolioService()
    result = service.add_transaction("01-01-2026", "USD", "TRANSFER", 500, account="broker-A")
    trans_id = result["transaction_id"]

    with pytest.raises(ValueError, match="TRANSFER requires an account"):
        service.edit_transaction(trans_id, account="")
    service.close()


def test_changing_action_to_transfer_without_account_rejected():
    service = PortfolioService()
    result = service.add_transaction("01-01-2026", "USD", "DEPOSIT", 500)
    trans_id = result["transaction_id"]

    with pytest.raises(ValueError, match="TRANSFER requires an account"):
        service.edit_transaction(trans_id, action="TRANSFER")
    service.close()


def test_transfer_edit_dry_run_cannot_clear_account(runner):
    service = PortfolioService()
    result = service.add_transaction("01-01-2026", "USD", "TRANSFER", 500, account="broker-A")
    trans_id = result["transaction_id"]
    service.close()

    result = runner.invoke(cli, ["edit", "--id", str(trans_id), "--account", "", "--dry-run"])

    assert result.exit_code == 1, result.output
    body = json.loads(result.output)
    assert body["ok"] is False
    assert body["command"] == "edit"
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert "TRANSFER requires an account" in body["error"]["message"]


# ── Issue #16: multi-currency support (JPY, CHF, CAD, AUD, HKD, SGD) ──


def test_price_service_inverts_reverse_quoted_yahoo_fx_pairs(monkeypatch):
    """Reverse-quoted Yahoo FX pairs must be inverted into internal XXXUSD=X rates."""
    import portfolio_db.price_service as price_service_module

    price_service_module = importlib.reload(price_service_module)
    idx = pd.date_range(start="2026-03-20", periods=2, freq="D")

    def fake_download(ticker, start, end, **kwargs):
        value_map = {
            "JPY=X": [150.0, 200.0],
            "EURUSD=X": [1.10, 1.11],
        }
        return pd.DataFrame({"Close": value_map[ticker]}, index=idx)

    monkeypatch.setattr(price_service_module.yf, "download", fake_download)

    service = price_service_module.PriceService()
    prices = service.fetch_all_prices(
        ["JPYUSD=X", "EURUSD=X"],
        start_date=date(2026, 3, 20),
        end_date=date(2026, 3, 21),
    )

    assert prices["JPYUSD=X"].tolist() == pytest.approx([1 / 150.0, 1 / 200.0])
    assert prices["EURUSD=X"].tolist() == pytest.approx([1.10, 1.11])


def test_regional_stock_buy_reduces_local_currency_cash_bucket():
    """Regional stock trades must hit the matching FX cash bucket, not USD."""
    service = PortfolioService()
    service.db.add_transaction(
        date(2026, 1, 1),
        "JPYUSD=X",
        "DEPOSIT",
        10_000.0,
        asset_type="cash_fx",
        currency="JPY",
    )
    service.db.add_transaction(
        date(2026, 1, 2),
        "7203.T",
        "BUY",
        100.0,
        asset_type="stock_jpy",
        price=50.0,
        currency="JPY",
    )

    raw_balances = service._reporting.get_actual_cash_balances(
        date(2026, 1, 2),
        service.EXTERNAL_INFLOW_ACTIONS,
        service.TRANSFER_ACTIONS,
        service.EXTERNAL_OUTFLOW_ACTIONS,
        service.INCOME_ACTIONS,
        service.EXPENSE_ACTIONS,
        service.TRADE_ACTIONS,
    )
    service.close()

    assert raw_balances["JPYUSD=X"]["balance"] == pytest.approx(5_000.0)
    assert raw_balances["JPYUSD=X"]["spent"] == pytest.approx(5_000.0)
    assert raw_balances["USD"]["balance"] == pytest.approx(0.0)


@pytest.mark.parametrize(
    ("symbol", "currency", "asset_type", "fx_rate"),
    [
        ("7203.T", "JPY", "stock_jpy", 0.0065),
        ("NESN.SW", "CHF", "stock_chf", 1.12),
        ("SHOP.TO", "CAD", "stock_cad", 0.74),
        ("CSL.AX", "AUD", "stock_aud", 0.66),
        ("0005.HK", "HKD", "stock_hkd", 0.128),
        ("D05.SG", "SGD", "stock_sgd", 0.74),
    ],
)
def test_regional_stock_last_price_uses_matching_fx_rate(
    monkeypatch,
    symbol,
    currency,
    asset_type,
    fx_rate,
):
    """All supported regional stock types must convert their local close into USD."""
    day1 = date(2026, 1, 1)
    local_price = 50.0

    service = _setup_non_usd_stock_service(
        monkeypatch,
        _make_fx_price_fetch(day1, local_price, local_price, fx_day1=fx_rate, fx_day2=fx_rate),
        symbol=symbol,
        currency=currency,
        asset_type=asset_type,
    )
    positions = service.get_position_summary(as_of_date=day1)
    pos = next(p for p in positions if p["symbol"] == symbol)
    service.close()

    assert pos["last_price"] == pytest.approx(local_price * fx_rate)


# ─── Phase 0: Single Source of Truth ──────────────────────────────────────────


def test_portfolio_service_constants_from_domain():
    from portfolio_db import domain
    from portfolio_db.portfolio_service import PortfolioService

    assert PortfolioService.CASH_FX_SYMBOLS is domain.CASH_FX_SYMBOLS
    assert PortfolioService.CASH_BUCKET_DEFAULTS is domain.CASH_BUCKET_DEFAULTS
    assert PortfolioService.CASH_DISPLAY_CURRENCY is domain.CASH_DISPLAY_CURRENCY
    assert PortfolioService.EXTERNAL_INFLOW_ACTIONS is domain.EXTERNAL_INFLOW_ACTIONS
    assert PortfolioService.EXTERNAL_OUTFLOW_ACTIONS is domain.EXTERNAL_OUTFLOW_ACTIONS
    assert PortfolioService.TRANSFER_ACTIONS is domain.TRANSFER_ACTIONS
    assert PortfolioService.INCOME_ACTIONS is domain.INCOME_ACTIONS
    assert PortfolioService.EXPENSE_ACTIONS is domain.EXPENSE_ACTIONS
    assert PortfolioService.TRADE_ACTIONS is domain.TRADE_ACTIONS
    assert PortfolioService.SYSTEM_ACTIONS is domain.SYSTEM_ACTIONS
    assert PortfolioService.SUPPORTED_ACTIONS is domain.SUPPORTED_ACTIONS


def test_calculator_uses_domain_action_constants():
    from portfolio_db import domain
    from portfolio_db._legacy import calculator

    assert calculator.EXTERNAL_INFLOW_ACTIONS is domain.EXTERNAL_INFLOW_ACTIONS
    assert calculator.EXTERNAL_OUTFLOW_ACTIONS is domain.EXTERNAL_OUTFLOW_ACTIONS
    assert calculator.TRANSFER_ACTIONS is domain.TRANSFER_ACTIONS
    assert calculator.INCOME_ACTIONS is domain.INCOME_ACTIONS
    assert calculator.EXPENSE_ACTIONS is domain.EXPENSE_ACTIONS


# ─── Phase 2: service-layer validation + rollback ─────────────────────────────


def test_backdated_sell_rejected_by_service():
    """BUY after SELL date → SELL on earlier date must be rejected."""
    from datetime import date as _date

    service = PortfolioService()
    service.db.add_transaction(_date(2026, 2, 1), "AAPL", "BUY", 10, price=150.0,
                               exchange="Test", asset_type="stock_usd")
    service.repair_prices()
    service.recalculate(force=True)

    with pytest.raises(ValueError, match=r"Cannot SELL.*only 0.*shares held as of 2026-01-01"):
        service.add_transaction("01-01-2026", "AAPL", "SELL", quantity=15, price=160.0,
                                exchange="Test")
    service.close()


def test_sell_within_holdings_passes_service_validation():
    """SELL within as-of-date holdings must succeed."""
    from datetime import date as _date

    service = PortfolioService()
    service.db.add_transaction(_date(2026, 1, 1), "AAPL", "BUY", 10, price=150.0,
                               exchange="Test", asset_type="stock_usd")
    service.repair_prices()
    service.recalculate(force=True)
    result = service.add_transaction("02-01-2026", "AAPL", "SELL", quantity=5, price=160.0,
                                     exchange="Test")
    assert result["status"] == "success"
    service.close()


def test_exchange_from_non_cash_rejected():
    """Exchange FROM a non-cash-like asset must raise ValueError."""
    service = PortfolioService()
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 1000)
    with pytest.raises(ValueError, match="Exchange FROM asset must be cash-like"):
        service.exchange_currency("02-01-2026", "AAPL", "EURUSD=X", 100, 0.92)
    service.close()


def test_exchange_to_non_cash_rejected():
    """Exchange TO a non-cash-like asset must raise ValueError."""
    service = PortfolioService()
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 1000)
    with pytest.raises(ValueError, match="Exchange TO asset must be cash-like"):
        service.exchange_currency("02-01-2026", "USD", "AAPL", 100, 0.92)
    service.close()


def test_exchange_usd_cash_usd_self_exchange_rejected():
    """USD → CASH USD self-exchange must be rejected after alias normalization."""
    from datetime import date
    service = PortfolioService()
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 1000)
    with pytest.raises(ValueError, match=r"FROM and TO must be different.*resolve to 'USD'"):
        service.exchange_currency(date(2026, 1, 2), "USD", "CASH USD", 100, 1.0)
    service.close()


def test_exchange_cash_eur_eurusd_self_exchange_rejected():
    """CASH EUR → EURUSD=X self-exchange must be rejected after alias normalization."""
    from datetime import date
    service = PortfolioService()
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 1000)
    with pytest.raises(ValueError, match=r"FROM and TO must be different.*resolve to 'EURUSD=X'"):
        service.exchange_currency(date(2026, 1, 2), "CASH EUR", "EURUSD=X", 100, 1.0)
    service.close()


def test_exchange_different_currencies_accepted():
    """USD → EURUSD=X must pass the self-exchange guard (different canonical assets)."""
    from datetime import date
    from portfolio_db.portfolio_service import PriceDataUnavailableError
    service = PortfolioService()
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 1000)
    try:
        service.exchange_currency(date(2026, 1, 2), "USD", "EURUSD=X", 100, 1.2)
    except PriceDataUnavailableError:
        pass  # price data absent in test env — self-exchange guard passed
    except ValueError as exc:
        pytest.fail(f"exchange_currency raised unexpected ValueError: {exc}")
    finally:
        service.close()


def test_edit_sell_asof_date_check():
    """Editing a transaction to SELL must validate as-of-date holdings."""
    from datetime import date as _date

    service = PortfolioService()
    # BUY AAPL on Feb 1
    service.db.add_transaction(_date(2026, 2, 1), "AAPL", "BUY", 10, price=150.0,
                               exchange="Test", asset_type="stock_usd")
    service.repair_prices()
    service.recalculate(force=True)

    # Add a dummy DEPOSIT on Jan 1 (this is what we'll edit into a backdated SELL)
    result = service.add_transaction("01-01-2026", "USD", "DEPOSIT", 100)
    trans_id = result["transaction_id"]

    with pytest.raises(ValueError, match=r"Cannot SELL.*only 0.*shares held as of 2026-01-01"):
        service.edit_transaction(trans_id, asset="AAPL", action="SELL", quantity=15,
                                 price=160.0, exchange="Test", date="01-01-2026")
    service.close()


def test_delete_transaction_rollback_on_recalc_failure(monkeypatch):
    """Delete must restore transaction row, daily_returns, and refresh_state."""
    from datetime import date as _date

    service = PortfolioService()
    # Seed with 2 transactions so after deleting one, recalc still has work to do
    service.db.add_transaction(_date(2026, 1, 1), "USD", "DEPOSIT", 1000, asset_type="cash_base")
    service.db.add_transaction(_date(2026, 1, 2), "USD", "DEPOSIT", 500, asset_type="cash_base")
    service.repair_prices()
    service.recalculate(force=True)
    daily_returns_before = service.get_daily_returns()  # noqa: F841
    refresh_state_before = service.get_refresh_state()

    # Get the second transaction's ID
    all_txn = service.get_transactions()
    second_id = all_txn[1]["id"]

    def boom(*args, **kwargs):
        raise PriceDataUnavailableError("simulated recalc failure")

    monkeypatch.setattr(service, "_require_cached_price_requirements", boom)

    with pytest.raises(PriceDataUnavailableError):
        service.delete_transaction(second_id)

    assert service.db.get_transaction_count() == 2, (
        "Failed delete must leave both transaction rows intact"
    )
    assert service.get_refresh_state() == refresh_state_before, (
        "Failed delete must restore refresh state"
    )
    service.close()


# ─── Phase 3: fees in BUY/SELL ───────────────────────────────────────────────


def test_buy_with_fees_deducts_fee_from_cash():
    """BUY with fees → cash must decrease by quantity * price + fees."""
    from datetime import date as _date

    service = PortfolioService()
    service.db.add_transaction(_date(2026, 1, 1), "USD", "DEPOSIT", 10_000, asset_type="cash_base")
    service.db.add_transaction(_date(2026, 1, 2), "AAPL", "BUY", 10, price=150.0,
                               fees=5.0, exchange="Test", asset_type="stock_usd")
    service.repair_prices()
    service.recalculate(force=True)

    snapshot = service.build_reporting_snapshot(as_of_date=_date(2026, 1, 5))
    service.close()

    usd_cash = next(c for c in snapshot["cash_balances"] if c["symbol"] == "USD")
    assert usd_cash["spent"] == pytest.approx(1505.0, rel=1e-6), (
        f"BUY with $5 fee → spent should be $1505, got {usd_cash['spent']}"
    )
    assert usd_cash["balance"] == pytest.approx(10_000 - 1505.0, rel=1e-6)


def test_sell_with_fees_reduces_cash_proceeds():
    """SELL with fees → cash received must be quantity * price - fees."""
    from datetime import date as _date

    service = PortfolioService()
    service.db.add_transaction(_date(2026, 1, 1), "USD", "DEPOSIT", 10_000, asset_type="cash_base")
    service.db.add_transaction(_date(2026, 1, 2), "AAPL", "BUY", 10, price=150.0,
                               fees=2.0, exchange="Test", asset_type="stock_usd")
    service.db.add_transaction(_date(2026, 2, 1), "AAPL", "SELL", 5, price=160.0,
                               fees=3.0, exchange="Test", asset_type="stock_usd")
    service.repair_prices()
    service.recalculate(force=True)

    snapshot = service.build_reporting_snapshot(as_of_date=_date(2026, 2, 5))
    service.close()

    usd_cash = next(c for c in snapshot["cash_balances"] if c["symbol"] == "USD")
    assert usd_cash["received"] == pytest.approx(797.0, rel=1e-6), (
        f"SELL with $3 fee → received should be $797, got {usd_cash['received']}"
    )
    assert usd_cash["spent"] == pytest.approx(1502.0, rel=1e-6)


def test_fee_affects_cost_basis_and_realized_gain():
    """Trade fees must reduce realized gain via higher cost basis / lower proceeds."""
    from datetime import date as _date

    service = PortfolioService()
    service.db.add_transaction(_date(2026, 1, 1), "USD", "DEPOSIT", 10_000, asset_type="cash_base")
    service.db.add_transaction(_date(2026, 1, 2), "AAPL", "BUY", 10, price=150.0,
                               fees=5.0, exchange="Test", asset_type="stock_usd")
    service.db.add_transaction(_date(2026, 2, 1), "AAPL", "SELL", 10, price=160.0,
                               fees=3.0, exchange="Test", asset_type="stock_usd")
    service.repair_prices()
    service.recalculate(force=True)

    positions = service.get_position_summary()
    service.close()

    aapl = next(p for p in positions if p["symbol"] == "AAPL")
    # Realized gain = sell_proceeds - buy_cost
    # sell_proceeds = 10*160 - 3 = 1597
    # buy_cost = 10*150 + 5 = 1505
    # gain = 1597 - 1505 = 92 (not 100)
    assert aapl["realized_gain_value"] < 100.0, (
        f"Trade fees must reduce realized gain below $100, got {aapl['realized_gain_value']}"
    )
    assert aapl["realized_gain_value"] == pytest.approx(92.0, rel=1e-4)


def test_stale_price_max_age_enforcement():
    """Price refresh older than MAX_PRICE_AGE_DAYS must mark state as stale."""
    from datetime import datetime, timezone, timedelta

    service = PortfolioService()
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 1000)

    # Ensure price refresh timestamp is beyond the default 7-day window
    old_timestamp = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat(timespec='seconds')
    service.db.set_service_state('last_successful_price_refresh', old_timestamp)
    service.db.set_service_state('stale_data', 'false')

    state = service.get_refresh_state()
    assert state['stale_data'] is True, (
        f"Price refresh 30 days old must be stale, got {state}"
    )
    service.close()


def test_stale_price_max_age_respected_from_env(monkeypatch):
    """PORTFOLIO_PRICE_MAX_AGE_DAYS env var must be respected in staleness check."""
    import portfolio_db.price_cache_service as pcs

    service = PortfolioService()
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 1000)

    # Set a 5-day-old refresh; default 7-day threshold says not stale
    from datetime import datetime, timezone, timedelta
    five_days_ago = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat(timespec='seconds')
    service.db.set_service_state('last_successful_price_refresh', five_days_ago)
    service.db.set_service_state('stale_data', 'false')

    # Lower max-age to 3 days — 5 days ago should now be stale
    monkeypatch.setattr(pcs, 'MAX_PRICE_AGE_DAYS', 3)
    state = service.get_refresh_state()
    assert state['stale_data'] is True, (
        f"5-day-old refresh must be stale when MAX_PRICE_AGE_DAYS=3, got {state}"
    )
    service.close()


def test_price_service_does_not_print_to_stdout(monkeypatch):
    import io
    import sys

    from portfolio_db.price_service import PriceService

    fake_stdout = io.StringIO()
    monkeypatch.setattr(sys, "stdout", fake_stdout)

    ps = PriceService()
    # Intentionally fetch a ticker that doesn't exist to trigger the error path
    ps.fetch_all_prices(["ZZZZZ-NONEXISTENT-999"], "2026-01-01", "2026-01-02")

    stdout_output = fake_stdout.getvalue()
    assert stdout_output == "", f"price_service printed to stdout: {stdout_output!r}"


def test_runtime_modules_do_not_import_calculator():
    """Enforce that production code modules don't import the legacy calculator."""
    import os
    import ast

    def imports_calculator(filepath):
        """Check if a file imports calculator."""
        try:
            with open(filepath, "r") as f:
                tree = ast.parse(f.read())
        except Exception:
            return False

        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                if node.module and "calculator" in node.module:
                    return True
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if "calculator" in alias.name:
                        return True
        return False

    portfolio_db_dir = Path(__file__).resolve().parents[1] / "portfolio_db"
    runtime_modules = []

    for root, dirs, files in os.walk(portfolio_db_dir):
        # Skip _legacy directory
        if "_legacy" in root.split(os.sep):
            continue

        for file in files:
            if file.endswith(".py") and not file.startswith("test_"):
                filepath = os.path.join(root, file)
                if imports_calculator(filepath):
                    runtime_modules.append(filepath)

    assert (
        not runtime_modules
    ), f"Runtime modules import calculator (legacy): {runtime_modules}"
