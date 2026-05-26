from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest
from click.testing import CliRunner

from portfolio_db.cli import cli


@pytest.fixture
def runner():
    return CliRunner()


def _help_text(runner: CliRunner, args: list[str]) -> str:
    result = runner.invoke(cli, args + ["--help"])
    assert result.exit_code == 0, result.output
    return result.output


def test_top_level_help_describes_json_and_date_conventions(runner: CliRunner):
    text = _help_text(runner, [])
    assert "All commands emit JSON only." in text
    assert "Read/report commands use YYYY-MM-DD dates." in text
    assert "DD-MM-YYYY dates" in text
    assert "Read-only commands:" in text
    assert "Write / maintenance commands:" in text


def test_add_help_shows_required_exchange_and_correct_example(runner: CliRunner):
    text = _help_text(runner, ["add"])
    assert "--exchange TEXT" in text
    assert "required for all add" in text
    assert "--exchange Interactive" in text


def test_migrate_help_warns_about_destructive_import(runner: CliRunner):
    text = _help_text(runner, ["migrate"])
    assert "destructive" in text.lower()
    assert "semicolon-separated" in text
    assert "DD-MM-YYYY" in text


def test_recalculate_help_documents_force_and_dry_run(runner: CliRunner):
    text = _help_text(runner, ["recalculate"])
    assert "--force" in text
    assert "Ignore cache checks and recompute everything" in text
    assert "--dry-run" in text


def test_performance_help_documents_dynamic_benchmark_default(runner: CliRunner):
    text = _help_text(runner, ["performance"])
    assert "PORTFOLIO_BENCHMARK_TICKERS" in text
    assert "SPY" in text


def test_report_help_mentions_pagination_cap(runner: CliRunner):
    text = _help_text(runner, ["report"])
    assert "10,000" in text
    assert "YYYY-MM-DD" in text


def test_transactions_help_mentions_pagination_cap(runner: CliRunner):
    text = _help_text(runner, ["transactions"])
    assert "10,000" in text
    assert "YYYY-MM-DD" in text


def test_exchange_help_uses_cash_like_example(runner: CliRunner):
    text = _help_text(runner, ["exchange"])
    assert "EURUSD=X" in text
    assert "must be different" in text


def test_repair_prices_help_mentions_refresh_scope(runner: CliRunner):
    text = _help_text(runner, ["repair_prices"])
    assert "benchmark tickers" in text.lower()
    assert "today" in text.lower()


def test_summary_help_explains_filter_semantics(runner: CliRunner):
    text = _help_text(runner, ["summary"])
    assert "--filter [open|all]" in text
    assert "closed positions" in text.lower()


def test_health_help_mentions_read_only_diagnostic(runner: CliRunner):
    text = _help_text(runner, ["health"])
    assert "Read-only diagnostic" in text
    assert "degraded" in text


def test_mwr_reports_price_errors_as_price_data_error(tmp_path: Path, runner: CliRunner):
    from portfolio_db.portfolio_service import PortfolioService

    db_path = tmp_path / "portfolio.db"
    service = PortfolioService(str(db_path))
    service.db.add_transaction(
        date(2026, 1, 2),
        "USD",
        "DEPOSIT",
        1000.0,
        asset_type="cash_base",
    )
    service.db.add_transaction(
        date(2026, 1, 3),
        "AAPL",
        "BUY",
        1.0,
        asset_type="stock_usd",
        price=100.0,
    )
    service.close()

    result = runner.invoke(cli, ["mwr", "--db", str(db_path)])
    assert result.exit_code == 1, result.output
    body = json.loads(result.output)
    assert body["ok"] is False
    assert body["error"]["code"] == "PRICE_DATA_ERROR"
    assert "price" in body["error"]["message"].lower()
