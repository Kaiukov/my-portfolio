"""Tests for the standard JSON response envelope across all CLI commands."""

import json
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

from portfolio_db.cli import cli  # noqa: E402
from portfolio_db.price_service import PriceService  # noqa: E402


def fake_price_fetch(symbols, start_date, end_date):
    index = pd.date_range(start=start_date, end=end_date, freq="D")
    prices = {}
    for symbol in symbols:
        value = {"EURUSD=X": 1.2, "GBPUSD=X": 1.35}.get(symbol, 100.0)
        prices[symbol] = pd.Series([value] * len(index), index=index)
    return prices


@pytest.fixture
def runner():
    return CliRunner()


@pytest.fixture(autouse=True)
def stub_price_fetch(monkeypatch):
    monkeypatch.setattr(PriceService, "fetch_all_prices", staticmethod(fake_price_fetch))


def _parse(result) -> dict:
    """Parse CLI output as JSON."""
    assert result.exit_code == 0, f"exit_code={result.exit_code}\n{result.output}"
    return json.loads(result.output)


def _assert_envelope(body: dict, command: str, ok: bool = True):
    """Assert standard envelope shape."""
    assert body["ok"] is ok
    assert body["command"] == command
    assert "meta" in body
    assert "generated_at" in body["meta"]
    if ok:
        assert "data" in body
        assert "error" not in body
    else:
        assert "error" in body
        assert "code" in body["error"]
        assert "message" in body["error"]


# ─── migrate ──────────────────────────────────────────────────────────────────

def test_migrate_envelope(runner, tmp_path):
    csv = tmp_path / "t.csv"
    csv.write_text(
        "date;asset;action;quantity;asset_type;price;currency;fees;exchange;dataSource\n"
        "01-07-2024;AAPL;BUY;10;stock;150.0;USD;0;;YAHOO\n"
    )
    result = runner.invoke(cli, ["migrate", "--csv", str(csv)])
    body = _parse(result)
    _assert_envelope(body, "migrate")
    assert body["data"]["rows_imported"] == 1


# ─── status ───────────────────────────────────────────────────────────────────

def _seeded_db():
    """Create a minimal seeded portfolio DB."""
    from portfolio_db.portfolio_service import PortfolioService
    svc = PortfolioService()
    svc.db.add_transaction(
        pd.Timestamp("2024-01-02").date(), "AAPL", "BUY", 10,
        asset_type="stock", price=150.0, currency="USD",
        fees=None, exchange="", data_source="YAHOO",
    )
    svc.db.add_transaction(
        pd.Timestamp("2024-01-02").date(), "USD", "DEPOSIT", 2000,
        asset_type="cash_base", price=None, currency="USD",
        fees=None, exchange="", data_source="",
    )
    svc.repair_prices()
    svc.recalculate(force=True)
    svc.close()


def test_status_envelope(runner):
    _seeded_db()
    result = runner.invoke(cli, ["status"])
    body = _parse(result)
    _assert_envelope(body, "status")
    data = body["data"]
    assert "portfolio_value" in data
    assert "as_of_date" in data
    assert "transactions" in data
    assert body["meta"]["count"] is None


# ─── transactions ─────────────────────────────────────────────────────────────

def test_transactions_envelope_and_pagination(runner):
    _seeded_db()
    result = runner.invoke(cli, ["transactions", "--limit", "1", "--offset", "0"])
    body = _parse(result)
    _assert_envelope(body, "transactions")
    assert isinstance(body["data"], list)
    assert body["meta"]["count"] == len(body["data"])
    pag = body["meta"]["pagination"]
    assert "limit" in pag
    assert "offset" in pag
    assert "total" in pag
    assert "has_more" in pag
    assert "next_offset" in pag


def test_transactions_date_filter(runner):
    _seeded_db()
    result = runner.invoke(cli, [
        "transactions",
        "--start-date", "2025-01-01", "--end-date", "2025-12-31",
    ])
    body = _parse(result)
    _assert_envelope(body, "transactions")
    assert body["data"] == []
    assert body["meta"]["pagination"]["total"] == 0


# ─── report ───────────────────────────────────────────────────────────────────

def test_report_envelope_and_pagination(runner):
    _seeded_db()
    result = runner.invoke(cli, ["report", "--limit", "10"])
    body = _parse(result)
    _assert_envelope(body, "report")
    assert isinstance(body["data"], list)
    assert "pagination" in body["meta"]
    if body["data"]:
        row = body["data"][0]
        assert "date" in row
        assert "portfolio_value" in row


# ─── allocation ───────────────────────────────────────────────────────────────

def test_allocation_envelope(runner):
    _seeded_db()
    result = runner.invoke(cli, ["allocation"])
    body = _parse(result)
    _assert_envelope(body, "allocation")
    data = body["data"]
    assert data["as_of_date"] is not None
    assert "positions" in data
    assert "total_value" in data
    assert data["total_value"] > 0
    assert any(position["symbol"] == "AAPL" for position in data["positions"])


# ─── cash ─────────────────────────────────────────────────────────────────────

def test_cash_envelope(runner):
    _seeded_db()
    result = runner.invoke(cli, ["cash"])
    body = _parse(result)
    _assert_envelope(body, "cash")
    assert isinstance(body["data"], list)
    assert "as_of_date" in body["meta"]
    assert body["meta"]["count"] == len(body["data"])


# ─── summary ──────────────────────────────────────────────────────────────────

def test_summary_envelope(runner):
    _seeded_db()
    result = runner.invoke(cli, ["summary"])
    body = _parse(result)
    _assert_envelope(body, "summary")
    assert isinstance(body["data"], list)
    assert "as_of_date" in body["meta"]
    assert body["meta"]["count"] == len(body["data"])


# ─── performance ──────────────────────────────────────────────────────────────

def test_performance_envelope(runner):
    _seeded_db()
    result = runner.invoke(cli, ["performance"])
    body = _parse(result)
    _assert_envelope(body, "performance")
    data = body["data"]
    assert "period" in data
    assert "values" in data
    assert "returns" in data
    assert "risk_metrics" in data
    # Verify metric value shape: {"value": float, "assessment": str}
    twr = data["returns"]["time_weighted_return_pct"]
    assert "value" in twr
    assert "assessment" in twr
    assert data["concentration"]["num_positions"] > 0


# ─── recalculate ──────────────────────────────────────────────────────────────

def test_recalculate_envelope(runner):
    _seeded_db()
    result = runner.invoke(cli, ["recalculate", "--force"])
    body = _parse(result)
    _assert_envelope(body, "recalculate")
    assert "rows_affected" in body["data"]
    assert "from_date" in body["data"]
    assert "forced" in body["data"]


# ─── verify_prices ────────────────────────────────────────────────────────────

def test_verify_prices_envelope(runner):
    _seeded_db()
    result = runner.invoke(cli, ["verify_prices"])
    body = _parse(result)
    _assert_envelope(body, "verify_prices")
    data = body["data"]
    assert "total_rows" in data
    assert "unique_tickers" in data
    assert "date_range" in data
    assert "issues" in data


# ─── error envelope ───────────────────────────────────────────────────────────

def test_error_envelope_on_invalid_date(runner):
    result = runner.invoke(cli, ["transactions", "--start-date", "not-a-date"])
    assert result.exit_code == 1
    body = json.loads(result.output)
    assert body["ok"] is False
    assert "error" in body
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert "meta" in body
    assert "generated_at" in body["meta"]


def test_error_envelope_has_generated_at(runner):
    result = runner.invoke(cli, ["transactions", "--start-date", "bad"])
    body = json.loads(result.output)
    assert body["meta"]["generated_at"].endswith("Z")
    assert body["meta"]["count"] is None
