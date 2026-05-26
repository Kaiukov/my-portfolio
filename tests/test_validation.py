"""Comprehensive input-validation tests for the portfolio CLI.

Every test exercises a specific invalid-input path and verifies:
- exit code is 1
- response is valid JSON with ok=False
- error code is correct
- error message is actionable (not vague)

Happy-path coverage is handled by the existing test suite; this module
focuses entirely on the validation/error surface.
"""

from __future__ import annotations

import json

import pandas as pd
import pytest
from click.testing import CliRunner

from portfolio_db.cli import cli
from portfolio_db.price_service import PriceService


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def runner():
    return CliRunner()


@pytest.fixture(autouse=True)
def stub_price_fetch(monkeypatch):
    def fake(symbols, start_date, end_date):
        index = pd.date_range(start=start_date, end=end_date, freq="D")
        prices = {}
        for symbol in symbols:
            value = {"EURUSD=X": 1.2, "GBPUSD=X": 1.35}.get(symbol, 100.0)
            prices[symbol] = pd.Series([value] * len(index), index=index)
        return prices

    monkeypatch.setattr(PriceService, "fetch_all_prices", staticmethod(fake))


def _seeded_db():
    from portfolio_db.portfolio_service import PortfolioService

    svc = PortfolioService()
    svc.db.add_transaction(
        pd.Timestamp("2024-01-02").date(), "AAPL", "BUY", 10,
        asset_type="stock", price=150.0, currency="USD",
        fees=None, exchange="Interactive", data_source="YAHOO",
    )
    svc.db.add_transaction(
        pd.Timestamp("2024-01-02").date(), "USD", "DEPOSIT", 2000,
        asset_type="cash_base", price=None, currency="USD",
        fees=None, exchange="Interactive", data_source="",
    )
    svc.repair_prices()
    svc.recalculate(force=True)
    svc.close()


def _parse_error(result) -> dict:
    """Assert exit code 1 and parse the JSON error envelope."""
    assert result.exit_code == 1, (
        f"Expected exit_code=1, got {result.exit_code}\n{result.output}"
    )
    body = json.loads(result.output)
    assert body["ok"] is False
    assert "error" in body
    assert "code" in body["error"]
    assert "message" in body["error"]
    # Message must not be vague
    msg = body["error"]["message"]
    assert msg not in ("invalid input", "bad command", "something went wrong"), (
        f"Vague error message: {msg!r}"
    )
    assert len(msg) > 10, f"Error message too short: {msg!r}"
    return body


# ──────────────────────────────────────────────────────────────────────────────
# migrate — CSV file must exist
# ──────────────────────────────────────────────────────────────────────────────


class TestMigrate:
    def test_missing_csv_file(self, runner):
        result = runner.invoke(cli, ["migrate", "--csv", "/nonexistent/file.csv"])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "not found" in body["error"]["message"].lower() or "file" in body["error"]["message"].lower()

    def test_valid_csv_works(self, runner, tmp_path):
        csv = tmp_path / "t.csv"
        csv.write_text(
            "date;asset;action;quantity;asset_type;price;currency;fees;exchange;dataSource\n"
            "01-07-2024;AAPL;BUY;10;stock;150.0;USD;0;;YAHOO\n"
        )
        result = runner.invoke(cli, ["migrate", "--csv", str(csv)])
        assert result.exit_code == 0


# ──────────────────────────────────────────────────────────────────────────────
# Pagination — report and transactions
# ──────────────────────────────────────────────────────────────────────────────


class TestPagination:
    @pytest.mark.parametrize("command", ["report", "transactions"])
    def test_limit_zero_rejected(self, runner, command):
        result = runner.invoke(cli, [command, "--limit", "0"])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "limit" in body["error"]["message"].lower()

    @pytest.mark.parametrize("command", ["report", "transactions"])
    def test_limit_negative_rejected(self, runner, command):
        result = runner.invoke(cli, [command, "--limit", "-1"])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "limit" in body["error"]["message"].lower()

    @pytest.mark.parametrize("command", ["report", "transactions"])
    def test_offset_negative_rejected(self, runner, command):
        result = runner.invoke(cli, [command, "--offset", "-5"])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "offset" in body["error"]["message"].lower()

    @pytest.mark.parametrize("command", ["report", "transactions"])
    def test_limit_too_large_rejected(self, runner, command):
        result = runner.invoke(cli, [command, "--limit", "99999"])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"

    @pytest.mark.parametrize("command", ["report", "transactions"])
    def test_valid_pagination_works(self, runner, command):
        _seeded_db()
        result = runner.invoke(cli, [command, "--limit", "10", "--offset", "0"])
        assert result.exit_code == 0


# ──────────────────────────────────────────────────────────────────────────────
# Date parsing
# ──────────────────────────────────────────────────────────────────────────────


class TestDateParsing:
    def test_invalid_start_date_format(self, runner):
        result = runner.invoke(cli, ["transactions", "--start-date", "not-a-date"])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "YYYY-MM-DD" in body["error"]["message"]

    def test_wrong_date_format_yyyymmdd_without_dashes(self, runner):
        result = runner.invoke(cli, ["transactions", "--start-date", "20260101"])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"

    def test_start_after_end_rejected(self, runner):
        result = runner.invoke(cli, [
            "transactions",
            "--start-date", "2026-12-31", "--end-date", "2026-01-01",
        ])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "start" in body["error"]["message"].lower() or "end" in body["error"]["message"].lower()

    def test_date_range_same_day_allowed(self, runner):
        _seeded_db()
        result = runner.invoke(cli, [
            "transactions",
            "--start-date", "2024-01-01", "--end-date", "2024-01-01",
        ])
        assert result.exit_code == 0

    def test_invalid_add_date_format(self, runner):
        """--date for add uses DD-MM-YYYY, not YYYY-MM-DD."""
        result = runner.invoke(cli, [
            "add",
            "--date", "2026-01-01",  # wrong format
            "--asset", "AAPL", "--action", "BUY",
            "--quantity", "10", "--price", "150",
            "--exchange", "Interactive",
        ])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "DD-MM-YYYY" in body["error"]["message"]

    def test_repair_prices_date_range_consistency(self, runner):
        result = runner.invoke(cli, [
            "repair_prices",
            "--start-date", "2026-06-01", "--end-date", "2026-01-01",
        ])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"


# ──────────────────────────────────────────────────────────────────────────────
# add — required flags and value validation
# ──────────────────────────────────────────────────────────────────────────────


class TestAdd:
    def test_missing_exchange(self, runner):
        result = runner.invoke(cli, [
            "add",
            "--date", "01-01-2026", "--asset", "AAPL", "--action", "BUY",
            "--quantity", "10", "--price", "150",
            # --exchange omitted
        ])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "exchange" in body["error"]["message"].lower()

    def test_empty_exchange_rejected(self, runner):
        result = runner.invoke(cli, [
            "add",
            "--date", "01-01-2026", "--asset", "AAPL", "--action", "BUY",
            "--quantity", "10", "--price", "150", "--exchange", "   ",
        ])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"

    def test_zero_quantity_rejected(self, runner):
        result = runner.invoke(cli, [
            "add",
            "--date", "01-01-2026", "--asset", "AAPL", "--action", "BUY",
            "--quantity", "0", "--price", "150", "--exchange", "Interactive",
        ])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "quantity" in body["error"]["message"].lower()

    def test_negative_quantity_rejected(self, runner):
        result = runner.invoke(cli, [
            "add",
            "--date", "01-01-2026", "--asset", "AAPL", "--action", "BUY",
            "--quantity", "-5", "--price", "150", "--exchange", "Interactive",
        ])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "quantity" in body["error"]["message"].lower()

    def test_zero_price_rejected(self, runner):
        result = runner.invoke(cli, [
            "add",
            "--date", "01-01-2026", "--asset", "AAPL", "--action", "BUY",
            "--quantity", "10", "--price", "0", "--exchange", "Interactive",
        ])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "price" in body["error"]["message"].lower()

    def test_negative_price_rejected(self, runner):
        result = runner.invoke(cli, [
            "add",
            "--date", "01-01-2026", "--asset", "AAPL", "--action", "BUY",
            "--quantity", "10", "--price", "-10", "--exchange", "Interactive",
        ])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"

    def test_negative_fees_rejected(self, runner):
        result = runner.invoke(cli, [
            "add",
            "--date", "01-01-2026", "--asset", "AAPL", "--action", "BUY",
            "--quantity", "10", "--price", "150", "--fees", "-1",
            "--exchange", "Interactive",
        ])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "fees" in body["error"]["message"].lower()

    def test_zero_fees_allowed(self, runner):
        """Fees of 0 is valid."""
        _seeded_db()
        result = runner.invoke(cli, [
            "add",
            "--date", "01-01-2026", "--asset", "USD", "--action", "DEPOSIT",
            "--quantity", "500", "--fees", "0",
            "--exchange", "Interactive",
        ])
        assert result.exit_code == 0

    def test_invalid_action(self, runner):
        result = runner.invoke(cli, [
            "add",
            "--date", "01-01-2026", "--asset", "AAPL", "--action", "HODL",
            "--quantity", "10", "--price", "150", "--exchange", "Interactive",
        ])
        # Click rejects unknown Choice values — exit code != 0
        assert result.exit_code != 0

    def test_transfer_requires_account(self, runner):
        _seeded_db()
        result = runner.invoke(cli, [
            "add",
            "--date", "01-01-2026", "--asset", "USD", "--action", "TRANSFER",
            "--quantity", "500", "--exchange", "Interactive",
            # --account omitted
        ])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "account" in body["error"]["message"].lower()

    def test_transfer_with_account_succeeds(self, runner):
        _seeded_db()
        result = runner.invoke(cli, [
            "add",
            "--date", "01-01-2026", "--asset", "USD", "--action", "TRANSFER",
            "--quantity", "500", "--exchange", "Interactive", "--account", "broker_b",
        ])
        assert result.exit_code == 0

    def test_missing_required_date(self, runner):
        result = runner.invoke(cli, [
            "add",
            "--asset", "AAPL", "--action", "BUY",
            "--quantity", "10", "--price", "150", "--exchange", "Interactive",
        ])
        # Click enforces required=True — exit != 0
        assert result.exit_code != 0

    def test_missing_required_asset(self, runner):
        result = runner.invoke(cli, [
            "add",
            "--date", "01-01-2026", "--action", "BUY",
            "--quantity", "10", "--price", "150", "--exchange", "Interactive",
        ])
        assert result.exit_code != 0

    def test_missing_required_action(self, runner):
        result = runner.invoke(cli, [
            "add",
            "--date", "01-01-2026", "--asset", "AAPL",
            "--quantity", "10", "--price", "150", "--exchange", "Interactive",
        ])
        assert result.exit_code != 0

    def test_missing_required_quantity(self, runner):
        result = runner.invoke(cli, [
            "add",
            "--date", "01-01-2026", "--asset", "AAPL", "--action", "BUY",
            "--price", "150", "--exchange", "Interactive",
        ])
        assert result.exit_code != 0


# ──────────────────────────────────────────────────────────────────────────────
# edit — ID validation and missing-update check
# ──────────────────────────────────────────────────────────────────────────────


class TestEdit:
    def test_no_fields_to_update(self, runner):
        result = runner.invoke(cli, ["edit", "--id", "1"])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "field" in body["error"]["message"].lower() or "update" in body["error"]["message"].lower()

    def test_id_zero_rejected(self, runner):
        result = runner.invoke(cli, ["edit", "--id", "0", "--price", "10"])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "--id" in body["error"]["message"]

    def test_id_negative_rejected(self, runner):
        result = runner.invoke(cli, ["edit", "--id", "-5", "--price", "10"])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"

    def test_nonexistent_id_returns_not_found(self, runner):
        _seeded_db()
        result = runner.invoke(cli, ["edit", "--id", "9999", "--price", "200"])
        body = _parse_error(result)
        assert body["error"]["code"] == "NOT_FOUND"

    def test_nonexistent_id_dry_run_returns_not_found(self, runner):
        _seeded_db()
        result = runner.invoke(cli, ["edit", "--id", "9999", "--price", "200", "--dry-run"])
        body = _parse_error(result)
        assert body["error"]["code"] == "NOT_FOUND"

    def test_zero_quantity_in_edit_rejected(self, runner):
        _seeded_db()
        result = runner.invoke(cli, ["edit", "--id", "1", "--quantity", "0"])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"

    def test_negative_price_in_edit_rejected(self, runner):
        _seeded_db()
        result = runner.invoke(cli, ["edit", "--id", "1", "--price", "-1"])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"

    def test_negative_fees_in_edit_rejected(self, runner):
        _seeded_db()
        result = runner.invoke(cli, ["edit", "--id", "1", "--fees", "-0.5"])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"

    def test_missing_id_flag(self, runner):
        result = runner.invoke(cli, ["edit", "--price", "200"])
        assert result.exit_code != 0


# ──────────────────────────────────────────────────────────────────────────────
# delete — ID validation and confirm requirement
# ──────────────────────────────────────────────────────────────────────────────


class TestDelete:
    def test_missing_confirm_rejected(self, runner):
        _seeded_db()
        result = runner.invoke(cli, ["delete", "--id", "1"])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "confirm" in body["error"]["message"].lower()

    def test_id_zero_rejected(self, runner):
        result = runner.invoke(cli, ["delete", "--id", "0", "--confirm"])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "--id" in body["error"]["message"]

    def test_id_negative_rejected(self, runner):
        result = runner.invoke(cli, ["delete", "--id", "-3", "--confirm"])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"

    def test_nonexistent_id_not_found(self, runner):
        _seeded_db()
        result = runner.invoke(cli, ["delete", "--id", "9999", "--confirm"])
        body = _parse_error(result)
        assert body["error"]["code"] == "NOT_FOUND"

    def test_dry_run_nonexistent_id(self, runner):
        _seeded_db()
        result = runner.invoke(cli, ["delete", "--id", "9999", "--dry-run"])
        body = _parse_error(result)
        assert body["error"]["code"] == "NOT_FOUND"

    def test_dry_run_does_not_require_confirm(self, runner):
        _seeded_db()
        result = runner.invoke(cli, ["delete", "--id", "1", "--dry-run"])
        assert result.exit_code == 0

    def test_missing_id_flag(self, runner):
        result = runner.invoke(cli, ["delete", "--confirm"])
        assert result.exit_code != 0


# ──────────────────────────────────────────────────────────────────────────────
# exchange — numeric validation and same-asset conflict
# ──────────────────────────────────────────────────────────────────────────────


class TestExchange:
    def test_same_from_and_to_rejected(self, runner):
        result = runner.invoke(cli, [
            "exchange",
            "--date", "01-01-2026", "--from", "USD", "--to", "USD",
            "--quantity", "1000", "--rate", "1.0",
        ])
        body = _parse_error(result)
        assert body["error"]["code"] == "CONFLICT"
        assert "from" in body["error"]["message"].lower() or "to" in body["error"]["message"].lower()

    def test_same_from_and_to_case_insensitive(self, runner):
        result = runner.invoke(cli, [
            "exchange",
            "--date", "01-01-2026", "--from", "usd", "--to", "USD",
            "--quantity", "1000", "--rate", "1.0",
        ])
        body = _parse_error(result)
        assert body["error"]["code"] == "CONFLICT"

    def test_zero_quantity_rejected(self, runner):
        result = runner.invoke(cli, [
            "exchange",
            "--date", "01-01-2026", "--from", "USD", "--to", "EURUSD=X",
            "--quantity", "0", "--rate", "0.92",
        ])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "quantity" in body["error"]["message"].lower()

    def test_negative_quantity_rejected(self, runner):
        result = runner.invoke(cli, [
            "exchange",
            "--date", "01-01-2026", "--from", "USD", "--to", "EURUSD=X",
            "--quantity", "-100", "--rate", "0.92",
        ])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"

    def test_zero_rate_rejected(self, runner):
        result = runner.invoke(cli, [
            "exchange",
            "--date", "01-01-2026", "--from", "USD", "--to", "EURUSD=X",
            "--quantity", "1000", "--rate", "0",
        ])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "rate" in body["error"]["message"].lower()

    def test_negative_rate_rejected(self, runner):
        result = runner.invoke(cli, [
            "exchange",
            "--date", "01-01-2026", "--from", "USD", "--to", "EURUSD=X",
            "--quantity", "1000", "--rate", "-0.5",
        ])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"

    def test_missing_date(self, runner):
        result = runner.invoke(cli, [
            "exchange",
            "--from", "USD", "--to", "EURUSD=X",
            "--quantity", "1000", "--rate", "0.92",
        ])
        assert result.exit_code != 0

    def test_missing_rate(self, runner):
        result = runner.invoke(cli, [
            "exchange",
            "--date", "01-01-2026", "--from", "USD", "--to", "EURUSD=X",
            "--quantity", "1000",
        ])
        assert result.exit_code != 0

    def test_invalid_date_format(self, runner):
        result = runner.invoke(cli, [
            "exchange",
            "--date", "2026-01-01",  # wrong format: should be DD-MM-YYYY
            "--from", "USD", "--to", "EURUSD=X",
            "--quantity", "1000", "--rate", "0.92",
        ])
        body = _parse_error(result)
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "DD-MM-YYYY" in body["error"]["message"]


# ──────────────────────────────────────────────────────────────────────────────
# backup — PostgreSQL backup ignores the legacy file path
# ──────────────────────────────────────────────────────────────────────────────


class TestBackup:
    def test_legacy_db_path_is_ignored_for_postgres_backup(self, runner, tmp_path):
        result = runner.invoke(cli, ["backup", str(tmp_path / "nonexistent.db")])
        assert result.exit_code == 0
        body = json.loads(result.output)
        assert body["ok"] is True
        assert body["command"] == "backup"
        assert body["data"]["mode"] == "sql_dump"

    def test_valid_backup_works(self, runner):
        _seeded_db()
        result = runner.invoke(cli, ["backup"])
        assert result.exit_code == 0


# ──────────────────────────────────────────────────────────────────────────────
# Error envelope shape — all errors must be consistent
# ──────────────────────────────────────────────────────────────────────────────


class TestErrorEnvelopeShape:
    """All validation errors must follow the standard envelope schema."""

    def _assert_envelope_shape(self, result):
        body = _parse_error(result)
        assert body["ok"] is False
        assert "command" in body
        assert "meta" in body
        assert "generated_at" in body["meta"]
        assert body["meta"]["count"] is None
        return body

    def test_invalid_date_envelope(self, runner):
        result = runner.invoke(cli, ["transactions", "--start-date", "bad"])
        self._assert_envelope_shape(result)

    def test_limit_zero_envelope(self, runner):
        result = runner.invoke(cli, ["report", "--limit", "0"])
        self._assert_envelope_shape(result)

    def test_missing_exchange_envelope(self, runner):
        result = runner.invoke(cli, [
            "add",
            "--date", "01-01-2026", "--asset", "AAPL", "--action", "BUY",
            "--quantity", "10", "--price", "150",
        ])
        self._assert_envelope_shape(result)

    def test_delete_missing_confirm_envelope(self, runner):
        _seeded_db()
        result = runner.invoke(cli, ["delete", "--id", "1"])
        self._assert_envelope_shape(result)


# ──────────────────────────────────────────────────────────────────────────────
# Exit code regression — all validation errors must return code 1
# ──────────────────────────────────────────────────────────────────────────────


class TestExitCodes:
    def test_invalid_date_exits_1(self, runner):
        result = runner.invoke(cli, ["transactions", "--start-date", "bad"])
        assert result.exit_code == 1

    def test_limit_zero_exits_1(self, runner):
        result = runner.invoke(cli, ["report", "--limit", "0"])
        assert result.exit_code == 1

    def test_missing_exchange_exits_1(self, runner):
        result = runner.invoke(cli, [
            "add",
            "--date", "01-01-2026", "--asset", "AAPL", "--action", "BUY",
            "--quantity", "10", "--price", "150",
        ])
        assert result.exit_code == 1

    def test_same_exchange_assets_exits_1(self, runner):
        result = runner.invoke(cli, [
            "exchange",
            "--date", "01-01-2026", "--from", "USD", "--to", "USD",
            "--quantity", "1000", "--rate", "1.0",
        ])
        assert result.exit_code == 1

    def test_delete_without_confirm_exits_1(self, runner):
        _seeded_db()
        result = runner.invoke(cli, ["delete", "--id", "1"])
        assert result.exit_code == 1

    def test_valid_command_exits_0(self, runner):
        _seeded_db()
        result = runner.invoke(cli, ["transactions"])
        assert result.exit_code == 0
