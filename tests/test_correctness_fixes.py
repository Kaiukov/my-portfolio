"""Regression tests for correctness fixes in PR #53 / issue #56.

Covers:
- daily_maintenance_check() correctly sets prices_need_fetch when prices table is empty
- edit_transaction() preserves fee_currency on forward path
- edit_transaction() rollback restores fee_currency, exchange, data_source, account
- adapters/cli/commands.py is a thin re-export, not a duplicate
- cron db-install --dry-run only references daily_maintenance_check()
"""
import json
import sys
from pathlib import Path
from unittest.mock import patch

import pandas as pd
import pytest
from click.testing import CliRunner

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from portfolio_db.cli import cli  # noqa: E402
from portfolio_db.portfolio_service import PortfolioService  # noqa: E402
from portfolio_db.price_service import PriceService  # noqa: E402


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# 1. daily_maintenance_check() with empty prices table
# ---------------------------------------------------------------------------

def test_daily_maintenance_check_empty_prices_sets_flag(service):
    """Empty prices table must cause daily_maintenance_check() to set prices_need_fetch."""
    # Verify prices table is empty (fresh schema)
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
    # Insert a price for today
    service.db.bulk_insert_prices([("AAPL", today, 100.0)])

    service.db.con.execute("SELECT daily_maintenance_check()")
    service.db.con.commit()

    state = service.db.get_all_service_state()
    # prices_need_fetch should not be set (or should be false)
    value = state.get("prices_need_fetch", {}).get("value")
    assert value != "true", (
        "daily_maintenance_check() must NOT set prices_need_fetch when prices are fresh"
    )


# ---------------------------------------------------------------------------
# 2. edit_transaction() preserves fee_currency
# ---------------------------------------------------------------------------

def test_edit_transaction_preserves_fee_currency(service):
    """Editing a transaction must not silently drop fee_currency."""
    _seed_prices(service.db, ["AAPL"])
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 5000)
    result = service.add_transaction(
        "05-01-2026", "AAPL", "BUY", 5, price=100, exchange="IBKR",
        fee_currency="EUR", fees=2.0,
    )
    trans_id = result["transaction_id"]

    # Verify fee_currency was stored
    orig = service.get_transaction_by_id(trans_id)
    assert orig["fee_currency"] == "EUR"

    # Edit quantity only — fee_currency must survive
    service.edit_transaction(trans_id, quantity=4.0)
    updated = service.get_transaction_by_id(trans_id)
    assert updated["fee_currency"] == "EUR", (
        f"fee_currency was dropped after edit; got {updated['fee_currency']!r}"
    )
    assert float(updated["quantity"]) == 4.0


# ---------------------------------------------------------------------------
# 3. edit_transaction() rollback restores fee_currency, exchange, data_source, account
# ---------------------------------------------------------------------------

def test_edit_rollback_preserves_all_fields(service):
    """Rollback on failed recalculate must restore fee_currency, exchange, data_source, account."""
    _seed_prices(service.db, ["MSFT"])
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 10000)
    result = service.add_transaction(
        "05-01-2026", "MSFT", "BUY", 3, price=400, exchange="IBKR",
        fee_currency="GBP", fees=1.5, account="brokerage_a",
    )
    trans_id = result["transaction_id"]

    # Verify original values are stored
    orig_row = service.db.get_transaction_by_id(trans_id)
    # Indices: 0=id,1=date,2=asset,3=action,4=qty,5=asset_type,
    #          6=price,7=currency,8=fees,9=fee_currency,10=exchange,
    #          11=data_source,12=account,13=created_at,14=updated_at
    assert orig_row[9] == "GBP"    # fee_currency
    assert orig_row[10] == "IBKR"  # exchange
    assert orig_row[12] == "brokerage_a"  # account

    # Force recalculate to fail so rollback path triggers
    with patch.object(service, "recalculate", side_effect=RuntimeError("forced failure")):
        with pytest.raises(RuntimeError, match="forced failure"):
            service.edit_transaction(trans_id, quantity=2.0)

    # Verify rollback restored the original row completely
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
    # Quantity must be the ORIGINAL value (rollback worked)
    assert float(after_rollback[4]) == 3.0, (
        f"quantity not restored after rollback; got {after_rollback[4]!r}"
    )


# ---------------------------------------------------------------------------
# 4. adapters/cli/commands.py is a thin re-export
# ---------------------------------------------------------------------------

def test_adapters_cli_commands_is_thin_wrapper():
    """adapters/cli/commands.py must only re-export cli, not duplicate implementation."""
    commands_path = REPO_ROOT / "portfolio_db" / "adapters" / "cli" / "commands.py"
    src = commands_path.read_text()
    # Must import from portfolio_db.cli
    assert "from portfolio_db.cli import cli" in src, (
        "adapters/cli/commands.py must re-export cli from portfolio_db.cli"
    )
    # Must be short — not a full implementation
    assert len(src.splitlines()) < 20, (
        f"adapters/cli/commands.py must be a thin wrapper (< 20 lines); got {len(src.splitlines())}"
    )


def test_adapters_cli_commands_exposes_same_cli():
    """portfolio_db.adapters.cli.commands.cli must be the same object as portfolio_db.cli.cli."""
    from portfolio_db.cli import cli as canonical_cli
    from portfolio_db.adapters.cli.commands import cli as adapter_cli
    assert canonical_cli is adapter_cli, (
        "adapters/cli/commands.cli must be the same object as portfolio_db.cli.cli"
    )


# ---------------------------------------------------------------------------
# 5. cron db-install --dry-run only references daily_maintenance_check()
# ---------------------------------------------------------------------------

def test_cron_db_install_dry_run_scope():
    """cron db-install --dry-run must only reference daily_maintenance_check() SQL."""
    runner = CliRunner()
    result = runner.invoke(cli, ["cron", "db-install", "--dry-run"])
    assert result.exit_code == 0
    data = json.loads(result.output)
    assert data["ok"] is True
    would_execute = data["data"].get("would_execute", [])
    assert len(would_execute) > 0, "dry_run must include would_execute"
    for stmt in would_execute:
        assert "daily_maintenance_check" in stmt, (
            f"cron db-install must only install daily_maintenance_check(); got: {stmt!r}"
        )
        # Must NOT claim to install Python-side scheduled work
        assert "repair_prices" not in stmt
        assert "recalculate" not in stmt
        assert "sync" not in stmt


# ---------------------------------------------------------------------------
# 6. delete_transaction() rollback preserves fee_currency via re_insert_transaction_row
# ---------------------------------------------------------------------------

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
    assert orig_row[9] == "EUR"  # fee_currency

    # Force recalculate to fail so rollback re-inserts the deleted row
    with patch.object(service, "recalculate", side_effect=RuntimeError("forced failure")):
        with pytest.raises(RuntimeError, match="forced failure"):
            service.delete_transaction(trans_id)

    # Transaction must be re-inserted with original fee_currency
    restored = service.db.get_transaction_by_id(trans_id)
    assert restored is not None, "Transaction must be re-inserted after failed delete rollback"
    assert restored[9] == "EUR", (
        f"fee_currency not preserved in re_insert_transaction_row; got {restored[9]!r}"
    )
