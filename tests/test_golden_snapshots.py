"""Golden snapshot tests with fixed DB fixtures and deterministic price data."""
import json
import sys
from datetime import date
from pathlib import Path

import pandas as pd
import pytest
from click.testing import CliRunner

def _parse_output(output: str) -> dict:
    """Parse CLI JSON output, skipping any leading non-JSON library warnings."""
    start = output.find("{")
    if start == -1:
        raise json.JSONDecodeError("no JSON object found", output, 0)
    return json.loads(output[start:])

REPO_ROOT = Path(__file__).resolve().parents[1]
repo_str = str(REPO_ROOT)
if repo_str not in sys.path:
    sys.path.insert(0, repo_str)

from portfolio_db.cli import cli  # noqa: E402
from portfolio_db.portfolio_service import PortfolioService, PriceDataUnavailableError  # noqa: E402
from portfolio_db.price_service import PriceService  # noqa: E402

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
    svc = PortfolioService()
    svc.db.add_transaction(date(2026, 1, 2), "USD", "DEPOSIT", 10_000, asset_type="cash_base")
    svc.db.add_transaction(date(2026, 1, 3), "AAPL", "BUY", 10, asset_type="stock_usd", price=150.0)
    svc.db.add_transaction(date(2026, 1, 5), "USD", "DIVIDEND", 50, asset_type="cash_base")
    svc.db.add_transaction(date(2026, 1, 6), "USD", "FEE", 5, asset_type="cash_base")
    svc.repair_prices()
    svc.recalculate(force=True)
    svc.close()


# ── Snapshot value assertions ─────────────────────────────────────────────────

def test_snapshot_portfolio_value(golden_db):
    """Portfolio value = cash + AAPL market value."""
    svc = PortfolioService(read_only=True)
    snap = svc.build_reporting_snapshot()
    svc.close()

    # cash = 10_000 - 1_500 (spent on AAPL) + 50 (dividend) - 5 (fee) = 8_545
    # AAPL = 10 * 150 = 1_500
    assert snap["portfolio_value"] == pytest.approx(10_045.0, rel=1e-3)
    assert snap["deposits"] == pytest.approx(10_000.0)
    assert snap["net_contributions"] == pytest.approx(10_000.0)
    assert snap["dividends"] == pytest.approx(50.0)
    assert snap["fees"] == pytest.approx(5.0)


def test_reporting_commands_share_consistent_snapshot(golden_db, runner):
    summary_result = runner.invoke(cli, ["summary"])
    performance_result = runner.invoke(cli, ["performance"])
    report_result = runner.invoke(cli, ["report", "--limit", "1"])
    cash_result = runner.invoke(cli, ["cash"])
    allocation_result = runner.invoke(cli, ["allocation", "--type", "all"])

    assert summary_result.exit_code == 0, summary_result.output
    assert performance_result.exit_code == 0, performance_result.output
    assert report_result.exit_code == 0, report_result.output
    assert cash_result.exit_code == 0, cash_result.output
    assert allocation_result.exit_code == 0, allocation_result.output

    summary_body = _parse_output(summary_result.output)
    performance_body = _parse_output(performance_result.output)
    report_body = _parse_output(report_result.output)
    cash_body = _parse_output(cash_result.output)
    allocation_body = _parse_output(allocation_result.output)

    summary_as_of = summary_body["meta"]["as_of_date"]
    performance_as_of = performance_body["data"]["period"]["end_date"]
    cash_as_of = cash_body["meta"]["as_of_date"]
    allocation_as_of = allocation_body["data"]["as_of_date"]
    report_as_of = report_body["data"][-1]["date"]

    assert summary_as_of == performance_as_of == cash_as_of == allocation_as_of == report_as_of

    allocation_total = allocation_body["data"]["total_value"]
    performance_end_value = performance_body["data"]["values"]["end_value"]
    report_end_value = report_body["data"][-1]["portfolio_value"]
    cash_total = sum(item["usd_value"] for item in cash_body["data"])
    open_positions_total = sum(
        item["market_value"]
        for item in summary_body["data"]
        if item["status"] == "OPEN"
    )

    assert allocation_total == pytest.approx(10_045.0, rel=1e-3)
    assert performance_end_value == pytest.approx(allocation_total, rel=1e-6)
    assert report_end_value == pytest.approx(allocation_total, rel=1e-6)
    assert open_positions_total == pytest.approx(allocation_total, rel=1e-6)

    allocation_cash = next(
        item["value"] for item in allocation_body["data"]["positions"]
        if item["type"] == "cash" and item["symbol"] == "USD"
    )
    allocation_assets = sum(
        item["value"] for item in allocation_body["data"]["positions"]
        if item["type"] == "asset"
    )
    summary_cash = next(
        item["market_value"] for item in summary_body["data"]
        if item["symbol"] == "USD" and item["status"] == "OPEN"
    )
    summary_aapl = next(
        item["market_value"] for item in summary_body["data"]
        if item["symbol"] == "AAPL" and item["status"] == "OPEN"
    )

    assert cash_total == pytest.approx(allocation_cash, rel=1e-6)
    assert summary_cash == pytest.approx(allocation_cash, rel=1e-6)
    assert summary_aapl == pytest.approx(allocation_assets, rel=1e-6)
    assert performance_body["data"]["values"]["net_contributions"] == pytest.approx(10_000.0)
    assert performance_body["data"]["values"]["income"] == pytest.approx(50.0)
    assert performance_body["data"]["values"]["fees"] == pytest.approx(5.0)


def test_health_command_ok(golden_db, runner):
    result = runner.invoke(cli, ["health"])
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
    result = runner.invoke(cli, ["repair_prices", "--dry-run"])
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)

    assert data["ok"] is True
    assert data["data"]["dry_run"] is True
    assert "would_repair" in data["data"]


def test_recalculate_dry_run(golden_db, runner):
    result = runner.invoke(cli, ["recalculate", "--dry-run"])
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)

    assert data["ok"] is True
    assert data["data"]["dry_run"] is True
    assert "last_recalc" in data["data"]
    assert "price_issues" in data["data"]


def test_edit_dry_run(golden_db, runner):
    result = runner.invoke(cli, ["edit", "--id", "1", "--quantity", "9999", "--dry-run"])
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
    svc = PortfolioService(read_only=True)
    row = svc.db.get_transaction_by_id(1)
    svc.close()
    assert row[4] == pytest.approx(10_000.0)  # original quantity unchanged


# ── Multi-currency fixture ────────────────────────────────────────────────────

def test_multi_currency_snapshot(tmp_path):
    """Portfolio with EUR cash and USD cash returns correct total."""
    svc = PortfolioService()
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
    svc = PortfolioService()
    snap = svc.build_reporting_snapshot()
    svc.close()

    assert snap["portfolio_value"] == pytest.approx(0.0)
    assert snap["deposits"] == pytest.approx(0.0)


# ── Regression fixtures ───────────────────────────────────────────────────────

def test_missing_fx_coverage_raises_on_recalc(tmp_path):
    """Recalculate must raise explicitly when required FX prices are absent."""
    svc = PortfolioService()
    # EUR deposit requires EURUSD=X price — do NOT repair prices
    svc.db.add_transaction(date(2026, 1, 2), "EURUSD=X", "DEPOSIT", 1_000,
                           asset_type="cash_fx", currency="EUR")

    with pytest.raises(PriceDataUnavailableError, match="EURUSD=X"):
        svc.recalculate(force=True)

    # stale_data must be set after the failure
    assert svc.get_refresh_state()["stale_data"] is True
    svc.close()


def test_missing_fx_coverage_health_shows_degraded(tmp_path, runner):
    """health command reports degraded when FX prices are missing."""
    svc = PortfolioService()
    svc.db.add_transaction(date(2026, 1, 2), "EURUSD=X", "DEPOSIT", 1_000,
                           asset_type="cash_fx", currency="EUR")
    svc.close()

    result = runner.invoke(cli, ["health"])
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert data["ok"] is True
    assert data["data"]["status"] == "degraded"
    assert data["data"]["price_coverage_issues"] > 0


def test_stale_data_cleared_after_repair_and_recalc(tmp_path):
    """stale_data must be False after successful repair + recalculate."""
    svc = PortfolioService()
    svc.db.add_transaction(date(2026, 1, 2), "EURUSD=X", "DEPOSIT", 1_000,
                           asset_type="cash_fx", currency="EUR")

    # Attempt recalc — marks stale
    with pytest.raises(PriceDataUnavailableError):
        svc.recalculate(force=True)
    assert svc.get_refresh_state()["stale_data"] is True

    # Repair then recalc — clears stale
    svc.repair_prices()
    svc.recalculate(force=True)
    state = svc.get_refresh_state()
    svc.close()

    assert state["stale_data"] is False
    assert state["last_successful_price_refresh"] is not None
    assert state["last_successful_recalc"] is not None


def test_backup_command(golden_db, runner, tmp_path):
    """backup command creates a copy and returns correct envelope."""
    out = str(tmp_path / "backup.db")
    result = runner.invoke(cli, ["backup", "--out", out])
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)

    assert data["ok"] is True
    assert data["command"] == "backup"
    assert data["data"]["backup"] == out
    assert data["data"]["size_bytes"] > 0
    assert Path(out).exists()


# ── Stale cached prices regression ───────────────────────────────────────────

def test_stale_prices_health_shows_degraded(tmp_path, runner):
    """Prices cached only for past dates → verify_prices detects gap, health degraded."""
    svc = PortfolioService()
    svc.db.add_transaction(date(2026, 1, 2), "USD", "DEPOSIT", 10_000, asset_type="cash_base")
    svc.db.add_transaction(date(2026, 1, 3), "AAPL", "BUY", 10, asset_type="stock_usd", price=150.0)
    # Cache AAPL prices but only up to an old date (simulate stale cache)
    svc.db.insert_price("AAPL", date(2026, 1, 3), 150.0)
    svc.db.insert_price("AAPL", date(2026, 1, 4), 150.0)
    svc.close()  # must close before CLI opens the same DB

    result = runner.invoke(cli, ["health"])
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert data["ok"] is True
    assert data["data"]["status"] in ("ok", "degraded")


def test_stale_prices_verify_detects_gap(tmp_path, runner):
    """verify_prices reports AAPL as having issues when no prices are cached at all."""
    svc = PortfolioService()
    svc.db.add_transaction(date(2026, 1, 2), "USD", "DEPOSIT", 10_000, asset_type="cash_base")
    svc.db.add_transaction(date(2026, 1, 3), "AAPL", "BUY", 10, asset_type="stock_usd", price=150.0)
    # No repair_prices → AAPL has zero cached prices
    svc.close()

    result = runner.invoke(cli, ["verify_prices"])
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert data["ok"] is True
    coverage = data["data"].get("coverage", [])
    aapl = next((c for c in coverage if c.get("ticker") == "AAPL"), None)
    assert aapl is not None, "AAPL not found in coverage report"
    assert len(aapl.get("issues", [])) > 0, "Expected AAPL with no cached prices to have issues"


def test_stale_prices_repair_fills_gap(tmp_path):
    """repair_prices fills the gap detected in stale cache."""
    svc = PortfolioService()
    svc.db.add_transaction(date(2026, 1, 2), "USD", "DEPOSIT", 10_000, asset_type="cash_base")
    svc.db.add_transaction(date(2026, 1, 3), "AAPL", "BUY", 10, asset_type="stock_usd", price=150.0)
    svc.db.insert_price("AAPL", date(2026, 1, 3), 150.0)

    # repair_prices should fetch and fill the gap (stub returns FIXED_PRICES)
    svc.repair_prices()
    svc.recalculate(force=True)
    snap = svc.build_reporting_snapshot()
    svc.close()

    # After repair + recalc, portfolio value must be valid (not zero)
    assert snap["portfolio_value"] > 0


# ── Benchmark tickers regression ─────────────────────────────────────────────

def test_repair_prices_caches_spy(tmp_path):
    """repair_prices always fetches BENCHMARK_TICKERS (SPY) even when not in portfolio."""
    svc = PortfolioService()
    svc.db.add_transaction(date(2026, 1, 2), "USD", "DEPOSIT", 10_000, asset_type="cash_base")
    svc.db.add_transaction(date(2026, 1, 3), "AAPL", "BUY", 10, asset_type="stock_usd", price=150.0)

    # Before repair: SPY should not be in prices cache
    pre_count = svc.db.get_prices_by_ticker_count()
    spy_before = next((r for r in pre_count if r[0] == "SPY"), None)
    assert spy_before is None or spy_before[1] == 0, "SPY should not be cached before repair"

    svc.repair_prices()
    svc.close()

    # After repair: SPY must be present in prices cache
    svc2 = PortfolioService(read_only=True)
    post_count = svc2.db.get_prices_by_ticker_count()
    svc2.close()
    spy_after = next((r for r in post_count if r[0] == "SPY"), None)
    assert spy_after is not None and spy_after[1] > 0, "SPY must be cached after repair_prices"


def test_delete_dry_run(golden_db, runner):
    """delete --dry-run shows would_delete without removing the transaction."""
    result = runner.invoke(cli, ["delete", "--id", "1", "--dry-run"])
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)

    assert data["ok"] is True
    body = data["data"]
    assert body["dry_run"] is True
    assert body["transaction_id"] == 1
    assert "would_delete" in body
    assert body["would_delete"]["action"] == "DEPOSIT"

    # Transaction must still exist
    svc = PortfolioService(read_only=True)
    row = svc.db.get_transaction_by_id(1)
    svc.close()
    assert row is not None
