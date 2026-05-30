"""Regression tests: SQL functions match expected fixture outputs."""
import sys
from datetime import date
from pathlib import Path

import pandas as pd
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from portfolio_db.portfolio_service import PortfolioService  # noqa: E402
from portfolio_db.price_service import PriceService  # noqa: E402


def _fake_prices(symbols, start_date, end_date):
    index = pd.date_range(start=start_date, end=end_date, freq="D")
    fx = {"EURUSD=X": 1.1, "GBPUSD=X": 1.3, "JPYUSD=X": 0.007,
          "CHFUSD=X": 1.05, "CADUSD=X": 0.75, "AUDUSD=X": 0.65,
          "HKDUSD=X": 0.13, "SGDUSD=X": 0.74}
    return {s: pd.Series([fx.get(s, 100.0)] * len(index), index=index)
            for s in symbols}


@pytest.fixture(autouse=True)
def stub_price_fetch(monkeypatch):
    monkeypatch.setattr(PriceService, "fetch_all_prices", staticmethod(_fake_prices))


def _seed_prices(db, tickers, start="2026-01-01", end="2026-12-31"):
    index = pd.date_range(start=start, end=end, freq="D")
    fx = {"EURUSD=X": 1.1, "GBPUSD=X": 1.3, "JPYUSD=X": 0.007}
    rows = [
        (ticker, d.date(), fx.get(ticker, 100.0))
        for ticker in tickers
        for d in index
    ]
    db.bulk_insert_prices(rows)


@pytest.fixture
def service():
    svc = PortfolioService()
    yield svc
    svc.close()


def test_discover_usd_only_portfolio(service):
    _seed_prices(service.db, ["AAPL"])
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 1000)
    service.add_transaction("05-01-2026", "AAPL", "BUY", 5, price=100, exchange="IBKR")

    result = service.db.discover_assets_and_currencies()
    assert "AAPL" in result["assets"]
    assert "USD" in result["assets"]
    assert result["fx_currencies"] == []


def test_discover_eur_stock_adds_fx(service):
    _seed_prices(service.db, ["VOW3.DE", "EURUSD=X"])
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 5000)
    service.add_transaction("05-01-2026", "VOW3.DE", "BUY", 10, price=180, exchange="IBKR")

    result = service.db.discover_assets_and_currencies()
    assert "VOW3.DE" in result["assets"]
    assert "EURUSD=X" in result["fx_currencies"]


def test_discover_gbp_stock_adds_fx(service):
    _seed_prices(service.db, ["SHEL.L", "GBPUSD=X"])
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 5000)
    service.add_transaction("05-01-2026", "SHEL.L", "BUY", 20, price=25, exchange="IBKR")

    result = service.db.discover_assets_and_currencies()
    assert "SHEL.L" in result["assets"]
    assert "GBPUSD=X" in result["fx_currencies"]


def test_discover_cash_fx_deposit_adds_fx(service):
    _seed_prices(service.db, ["EURUSD=X"])
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 1000)
    service.add_transaction("02-01-2026", "EURUSD=X", "DEPOSIT", 500)

    result = service.db.discover_assets_and_currencies()
    assert "EURUSD=X" in result["fx_currencies"]


def test_discover_mixed_portfolio(service):
    _seed_prices(service.db, ["AAPL", "VOW3.DE", "EURUSD=X", "SHEL.L", "GBPUSD=X"])
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 10000)
    service.add_transaction("05-01-2026", "AAPL", "BUY", 5, price=100, exchange="IBKR")
    service.add_transaction("06-01-2026", "VOW3.DE", "BUY", 3, price=180, exchange="IBKR")
    service.add_transaction("07-01-2026", "SHEL.L", "BUY", 10, price=25, exchange="IBKR")

    result = service.db.discover_assets_and_currencies()
    assert "AAPL" in result["assets"]
    assert "VOW3.DE" in result["assets"]
    assert "SHEL.L" in result["assets"]
    assert "EURUSD=X" in result["fx_currencies"]
    assert "GBPUSD=X" in result["fx_currencies"]
    assert len([fx for fx in result["fx_currencies"] if fx.startswith("USD")]) == 0


def test_checkpoints_usd_stock(service):
    _seed_prices(service.db, ["AAPL"])
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 5000)
    service.add_transaction("05-01-2026", "AAPL", "BUY", 5, price=100, exchange="IBKR")

    end = date(2026, 1, 20)
    checkpoints = service.db.get_required_price_checkpoints(end)

    assert "AAPL" in checkpoints
    assert date(2026, 1, 5) in checkpoints["AAPL"]
    assert end in checkpoints["AAPL"]
    assert "EURUSD=X" not in checkpoints
    assert "GBPUSD=X" not in checkpoints


def test_checkpoints_eur_stock_includes_fx(service):
    _seed_prices(service.db, ["VOW3.DE", "EURUSD=X"])
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 5000)
    service.add_transaction("10-01-2026", "VOW3.DE", "BUY", 3, price=180, exchange="IBKR")

    end = date(2026, 1, 25)
    checkpoints = service.db.get_required_price_checkpoints(end)

    assert "VOW3.DE" in checkpoints
    assert date(2026, 1, 10) in checkpoints["VOW3.DE"]
    assert end in checkpoints["VOW3.DE"]
    assert "EURUSD=X" in checkpoints
    assert date(2026, 1, 10) in checkpoints["EURUSD=X"]
    assert end in checkpoints["EURUSD=X"]


def test_checkpoints_end_date_always_included(service):
    _seed_prices(service.db, ["MSFT"])
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 5000)
    service.add_transaction("03-01-2026", "MSFT", "BUY", 2, price=400, exchange="IBKR")

    end = date(2026, 2, 28)
    checkpoints = service.db.get_required_price_checkpoints(end)
    assert "MSFT" in checkpoints
    assert end in checkpoints["MSFT"]


def test_checkpoints_sell_also_requires_price(service):
    _seed_prices(service.db, ["NVDA"])
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 5000)
    service.add_transaction("05-01-2026", "NVDA", "BUY", 1, price=800, exchange="IBKR")
    service.add_transaction("15-01-2026", "NVDA", "SELL", 1, price=900, exchange="IBKR")

    end = date(2026, 1, 20)
    checkpoints = service.db.get_required_price_checkpoints(end)
    assert "NVDA" in checkpoints
    assert date(2026, 1, 5) in checkpoints["NVDA"]
    assert date(2026, 1, 15) in checkpoints["NVDA"]
    assert end in checkpoints["NVDA"]


def test_checkpoints_empty_portfolio(service):
    end = date(2026, 1, 31)
    checkpoints = service.db.get_required_price_checkpoints(end)
    assert checkpoints == {}
