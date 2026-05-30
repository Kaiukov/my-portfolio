"""Regression tests for correctness fixes extracted from PR #53.

Covers:
- daily_maintenance_check() correctly sets prices_need_fetch when prices table is empty
- edit_transaction() preserves fee_currency on forward path
- edit_transaction() rollback restores fee_currency, exchange, data_source, account
"""
import sys
from pathlib import Path
from unittest.mock import patch

import pandas as pd
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from portfolio_db.portfolio_service import PortfolioService  # noqa: E402
from portfolio_db.price_service import PriceService  # noqa: E402


def _fake_prices(symbols, start_date, end_date):
    index = pd.date_range(start=start_date, end=end_date, freq="D")
    fx = {"EURUSD=X": 1.1, "GBPUSD=X": 1.3}
    return {s: pd.Series([fx.get(s, 100.0)] * len(index), index=index) for s in symbols}


@pytest.fixture(autouse=True)
def stub_price_fetch(monkeypatch):
    monkeypatch.setattr(PriceService, "fetch_all_prices", staticmethod(_fake_prices))


def _seed_prices(db, tickers, start="2026-01-01", end="2026-12-31"):
    index = pd.date_range(start=start, end=end, freq="D")
    fx = {"EURUSD=X": 1.1, "GBPUSD=X": 1.3}
    rows = [(t, d.date(), fx.get(t, 100.0)) for t in tickers for d in index]
    db.bulk_insert_prices(rows)


@pytest.fixture
def service():
    svc = PortfolioService()
    yield svc
    svc.close()


def test_daily_maintenance_check_empty_prices_sets_flag(service):
    """Empty prices table must cause daily_maintenance_check() to set prices_need_fetch."""
    row = service.db.con.execute("SELECT COUNT(*) FROM prices").fetchone()
    assert row[0] == 0, "prices table must be empty for this test"

    service.db.con.execute("SELECT daily_maintenance_check()")
    service.db.con.commit()

    state = service.db.get_all_service_state()
    assert state.get("prices_need_fetch", {}).get("value") == "true", (
        "daily_maintenance_check() must set prices_need_fetch=true when prices table is empty"
    )


def test_daily_maintenance_check_fresh_prices_does_not_set_flag(service):
    """Recent prices must not cause daily_maintenance_check() to set prices_need_fetch."""
    from datetime import date
    today = date.today()
    service.db.bulk_insert_prices([("AAPL", today, 100.0)])

    service.db.con.execute("SELECT daily_maintenance_check()")
    service.db.con.commit()

    state = service.db.get_all_service_state()
    value = state.get("prices_need_fetch", {}).get("value")
    assert value != "true", (
        "daily_maintenance_check() must NOT set prices_need_fetch when prices are fresh"
    )


def test_edit_transaction_preserves_fee_currency(service):
    """Editing a transaction must not silently drop fee_currency."""
    _seed_prices(service.db, ["AAPL"])
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 5000)
    result = service.add_transaction(
        "05-01-2026", "AAPL", "BUY", 5, price=100, exchange="IBKR",
        fee_currency="EUR", fees=2.0,
    )
    trans_id = result["transaction_id"]

    orig = service.get_transaction_by_id(trans_id)
    assert orig["fee_currency"] == "EUR"

    service.edit_transaction(trans_id, quantity=4.0)
    updated = service.get_transaction_by_id(trans_id)
    assert updated["fee_currency"] == "EUR", (
        f"fee_currency was dropped after edit; got {updated['fee_currency']!r}"
    )
    assert float(updated["quantity"]) == 4.0


def test_edit_rollback_preserves_all_fields(service):
    """Rollback on failed recalculate must restore fee_currency, exchange, data_source, account."""
    _seed_prices(service.db, ["MSFT"])
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 10000)
    result = service.add_transaction(
        "05-01-2026", "MSFT", "BUY", 3, price=400, exchange="IBKR",
        fee_currency="GBP", fees=1.5, account="brokerage_a",
    )
    trans_id = result["transaction_id"]

    orig_row = service.db.get_transaction_by_id(trans_id)
    assert orig_row[9] == "GBP"
    assert orig_row[10] == "IBKR"
    assert orig_row[12] == "brokerage_a"

    with patch.object(service, "recalculate", side_effect=RuntimeError("forced failure")):
        with pytest.raises(RuntimeError, match="forced failure"):
            service.edit_transaction(trans_id, quantity=2.0)

    after_rollback = service.db.get_transaction_by_id(trans_id)
    assert after_rollback[9] == "GBP", (
        f"fee_currency not restored after rollback; got {after_rollback[9]!r}"
    )
    assert after_rollback[10] == "IBKR", (
        f"exchange not restored after rollback; got {after_rollback[10]!r}"
    )
    assert after_rollback[12] == "brokerage_a", (
        f"account not restored after rollback; got {after_rollback[12]!r}"
    )
    assert float(after_rollback[4]) == 3.0, (
        f"quantity not restored after rollback; got {after_rollback[4]!r}"
    )


def test_delete_rollback_preserves_fee_currency(service):
    """Re-insert after failed delete must restore fee_currency correctly."""
    _seed_prices(service.db, ["NVDA"])
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 5000)
    result = service.add_transaction(
        "05-01-2026", "NVDA", "BUY", 2, price=800, exchange="IBKR",
        fee_currency="EUR", fees=3.0,
    )
    trans_id = result["transaction_id"]

    orig_row = service.db.get_transaction_by_id(trans_id)
    assert orig_row[9] == "EUR"

    with patch.object(service, "recalculate", side_effect=RuntimeError("forced failure")):
        with pytest.raises(RuntimeError, match="forced failure"):
            service.delete_transaction(trans_id)

    restored = service.db.get_transaction_by_id(trans_id)
    assert restored is not None, "Transaction must be re-inserted after failed delete rollback"
    assert restored[9] == "EUR", (
        f"fee_currency not preserved in re_insert_transaction_row; got {restored[9]!r}"
    )
