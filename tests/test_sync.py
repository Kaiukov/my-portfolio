"""Tests for needs_recalc(), ensure_fresh(), and portfolio sync."""
import sys
from pathlib import Path
from click.testing import CliRunner

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from portfolio_db.portfolio_service import PortfolioService
from portfolio_db.cli import cli


def make_service():
    s = PortfolioService()
    s.add_transaction("01-01-2026", "USD", "DEPOSIT", 1000)
    return s


def test_needs_recalc_true_when_no_state():
    """needs_recalc() returns True when service_state has no timestamps."""
    s = PortfolioService()
    assert s.needs_recalc() is True
    s.close()


def test_needs_recalc_false_after_recalculate():
    """needs_recalc() returns False after recalculate sets last_successful_recalc."""
    s = make_service()
    s.recalculate()
    # After recalc with no price refresh newer than recalc → False
    assert s.needs_recalc() is False
    s.close()


def test_needs_recalc_true_after_price_refresh():
    """needs_recalc() returns True when price_refresh timestamp > last_recalc."""
    s = make_service()
    s.recalculate()
    assert s.needs_recalc() is False

    # Simulate price refresh happening after recalc
    from datetime import datetime, timezone, timedelta
    future = (datetime.now(timezone.utc) + timedelta(seconds=2)).isoformat()
    s.db.set_service_state("last_successful_price_refresh", future)
    assert s.needs_recalc() is True
    s.close()


def test_ensure_fresh_calls_recalculate_when_stale():
    """ensure_fresh() calls recalculate() exactly once when needs_recalc() is True."""
    from unittest.mock import patch
    from datetime import datetime, timezone, timedelta

    s = PortfolioService()
    past = (datetime.now(timezone.utc) - timedelta(seconds=10)).isoformat()
    s.db.set_service_state("last_successful_price_refresh", past)
    assert s.needs_recalc() is True

    with patch.object(s, "recalculate") as mock_recalc:
        s.ensure_fresh()
        mock_recalc.assert_called_once()
    s.close()


def test_ensure_fresh_skips_recalculate_when_fresh():
    """ensure_fresh() does NOT call recalculate() when last_recalc > last_price_refresh."""
    from unittest.mock import patch
    from datetime import datetime, timezone, timedelta

    s = PortfolioService()
    old = (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()
    recent = (datetime.now(timezone.utc) - timedelta(seconds=10)).isoformat()
    s.db.set_service_state("last_successful_price_refresh", old)
    s.db.set_service_state("last_successful_recalc", recent)
    assert s.needs_recalc() is False

    with patch.object(s, "recalculate") as mock_recalc:
        s.ensure_fresh()
        mock_recalc.assert_not_called()
    s.close()


def test_sync_command_noop_when_fresh():
    """portfolio sync emits synced=false when nothing needs doing."""
    s = make_service()
    s.recalculate()
    s.close()

    runner = CliRunner()
    result = runner.invoke(cli, ["sync"])
    assert result.exit_code == 0
    import json
    data = json.loads(result.output)
    assert data["ok"] is True
    assert data["data"]["synced"] is False
    assert data["data"]["actions"] == []


def test_sync_command_recalculates_when_stale():
    """portfolio sync CLI includes 'recalculate' in actions when needs_recalc() is True."""
    import json
    from datetime import datetime, timezone, timedelta

    s = make_service()
    # Simulate price refresh newer than last recalculation
    future = (datetime.now(timezone.utc) + timedelta(seconds=5)).isoformat()
    s.db.set_service_state("last_successful_price_refresh", future)
    s.db.set_service_state("needs_recalc", "true")
    assert s.needs_recalc() is True
    s.close()

    runner = CliRunner()
    result = runner.invoke(cli, ["sync"])
    assert result.exit_code == 0
    data = json.loads(result.output)
    assert data["ok"] is True
    assert "recalculate" in data["data"]["actions"]
    assert data["data"]["synced"] is True
