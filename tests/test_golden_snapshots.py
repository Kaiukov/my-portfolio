"""Golden snapshot tests with fixed DB fixtures and deterministic price data."""
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
from portfolio_db.portfolio_service import PortfolioService
from portfolio_db.price_service import PriceService

# ── Fixed prices ──────────────────────────────────────────────────────────────
# AAPL: $150 flat, EURUSD=X: 1.1 flat
FIXED_PRICES = {
    "AAPL": 150.0,
    "EURUSD=X": 1.1,
    "GBPUSD=X": 1.25,
    "UAHUSD=X": 0.025,
}


def fixed_price_fetch(symbols, start_date, end_date):
    index = pd.date_range(start=start_date, end=end_date, freq="D")
    return {
        sym: pd.Series([FIXED_PRICES.get(sym, 100.0)] * len(index), index=index)
        for sym in symbols
    }


@pytest.fixture(autouse=True)
def stub_prices(monkeypatch):
    monkeypatch.setattr(PriceService, "fetch_all_prices", staticmethod(fixed_price_fetch))


@pytest.fixture
def runner():
    return CliRunner()


@pytest.fixture
def golden_db(tmp_path: Path) -> str:
    """
    Fixed portfolio (inserted directly to bypass auto-recalc):
      2026-01-02  DEPOSIT  USD  10_000
      2026-01-03  BUY      AAPL  10 @ 150  (cost 1_500 USD)
      2026-01-05  DIVIDEND USD  50
      2026-01-06  FEE      USD  5
    """
    db_path = str(tmp_path / "golden.db")
    svc = PortfolioService(db_path)
    svc.db.add_transaction(date(2026, 1, 2), "USD", "DEPOSIT", 10_000, asset_type="cash_base")
    svc.db.add_transaction(date(2026, 1, 3), "AAPL", "BUY", 10, asset_type="stock_usd", price=150.0)
    svc.db.add_transaction(date(2026, 1, 5), "USD", "DIVIDEND", 50, asset_type="cash_base")
    svc.db.add_transaction(date(2026, 1, 6), "USD", "FEE", 5, asset_type="cash_base")
    svc.repair_prices()
    svc.recalculate(force=True)
    svc.close()
    return db_path


# ── Snapshot value assertions ─────────────────────────────────────────────────

def test_snapshot_portfolio_value(golden_db):
    """Portfolio value = cash + AAPL market value."""
    svc = PortfolioService(golden_db, read_only=True)
    snap = svc.build_reporting_snapshot()
    svc.close()

    # cash = 10_000 - 1_500 (spent on AAPL) + 50 (dividend) - 5 (fee) = 8_545
    # AAPL = 10 * 150 = 1_500
    assert snap["portfolio_value"] == pytest.approx(10_045.0, rel=1e-3)
    assert snap["deposits"] == pytest.approx(10_000.0)
    assert snap["net_contributions"] == pytest.approx(10_000.0)
    assert snap["dividends"] == pytest.approx(50.0)
    assert snap["fees"] == pytest.approx(5.0)


def test_cash_command_envelope(golden_db, runner):
    result = runner.invoke(cli, ["cash", "--db", golden_db])
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)

    assert data["ok"] is True
    assert data["command"] == "cash"
    assert "data" in data
    assert "as_of_date" in data["meta"]


def test_status_command_envelope(golden_db, runner):
    result = runner.invoke(cli, ["status", "--db", golden_db])
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)

    assert data["ok"] is True
    assert data["command"] == "status"
    body = data["data"]
    assert "portfolio_value" in body
    assert body["portfolio_value"] == pytest.approx(10_045.0, rel=1e-2)


def test_allocation_command_envelope(golden_db, runner):
    result = runner.invoke(cli, ["allocation", "--type", "all", "--db", golden_db])
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)

    assert data["ok"] is True
    assert data["command"] == "allocation"
    body = data["data"]
    assert "assets" in body or "cash" in body or "summary" in body


def test_summary_command_envelope(golden_db, runner):
    result = runner.invoke(cli, ["summary", "--db", golden_db])
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)

    assert data["ok"] is True
    assert data["command"] == "summary"
    positions = data["data"]
    assert isinstance(positions, list)
    symbols = [p["symbol"] for p in positions]
    assert "AAPL" in symbols


def test_performance_command_envelope(golden_db, runner):
    result = runner.invoke(cli, ["performance", "--db", golden_db])
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)

    assert data["ok"] is True
    assert data["command"] == "performance"
    body = data["data"]
    assert "period" in body
    assert "returns" in body
    assert "values" in body


def test_health_command_ok(golden_db, runner):
    result = runner.invoke(cli, ["health", "--db", golden_db])
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)

    assert data["ok"] is True
    body = data["data"]
    assert body["db_reachable"] is True
    assert body["status"] in ("ok", "degraded")
    assert "last_successful_recalc" in body
    assert "price_coverage_issues" in body


# ── Dry-run assertions ────────────────────────────────────────────────────────

def test_repair_prices_dry_run(golden_db, runner):
    result = runner.invoke(cli, ["repair_prices", "--dry-run", "--db", golden_db])
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)

    assert data["ok"] is True
    assert data["data"]["dry_run"] is True
    assert "would_repair" in data["data"]


def test_recalculate_dry_run(golden_db, runner):
    result = runner.invoke(cli, ["recalculate", "--dry-run", "--db", golden_db])
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)

    assert data["ok"] is True
    assert data["data"]["dry_run"] is True
    assert "last_recalc" in data["data"]
    assert "price_issues" in data["data"]


def test_edit_dry_run(golden_db, runner):
    result = runner.invoke(cli, ["edit", "--id", "1", "--quantity", "9999", "--dry-run", "--db", golden_db])
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)

    assert data["ok"] is True
    body = data["data"]
    assert body["dry_run"] is True
    assert body["transaction_id"] == 1
    assert "current" in body
    assert "proposed_changes" in body
    assert body["proposed_changes"]["quantity"] == "9999.0"

    # Verify DB was NOT modified
    svc = PortfolioService(golden_db, read_only=True)
    row = svc.db.get_transaction_by_id(1)
    svc.close()
    assert row[4] == pytest.approx(10_000.0)  # original quantity unchanged


# ── Multi-currency fixture ────────────────────────────────────────────────────

def test_multi_currency_snapshot(tmp_path):
    """Portfolio with EUR cash and USD cash returns correct total."""
    db_path = str(tmp_path / "multicurrency.db")
    svc = PortfolioService(db_path)
    svc.db.add_transaction(date(2026, 1, 2), "USD", "DEPOSIT", 5_000, asset_type="cash_base")
    svc.db.add_transaction(date(2026, 1, 2), "EURUSD=X", "DEPOSIT", 1_000, asset_type="cash_fx", currency="EUR")
    svc.repair_prices()
    svc.recalculate(force=True)
    snap = svc.build_reporting_snapshot()
    svc.close()

    # USD 5000 + EUR 1000 * 1.1 = 6100
    assert snap["portfolio_value"] == pytest.approx(6_100.0, rel=1e-2)


def test_empty_portfolio_snapshot(tmp_path):
    """Empty portfolio returns zero value without error."""
    db_path = str(tmp_path / "empty.db")
    svc = PortfolioService(db_path)
    snap = svc.build_reporting_snapshot()
    svc.close()

    assert snap["portfolio_value"] == pytest.approx(0.0)
    assert snap["deposits"] == pytest.approx(0.0)
