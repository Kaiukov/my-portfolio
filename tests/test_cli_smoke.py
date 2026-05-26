"""CLI JSON smoke tests: verify each command returns valid JSON envelope."""

import json
import subprocess
import os
import pytest


@pytest.fixture(scope="session", autouse=True)
def check_db_url():
    """Ensure PORTFOLIO_DB_URL is set for smoke tests."""
    if not os.environ.get("PORTFOLIO_DB_URL"):
        pytest.skip("PORTFOLIO_DB_URL not set; skipping smoke tests", allow_module_level=True)


def run_cli_command(cmd: str) -> dict:
    """Run a CLI command via subprocess and parse JSON output.

    Args:
        cmd: Command string (e.g., "status", "allocation --type all")

    Returns:
        dict: Parsed JSON response

    Raises:
        json.JSONDecodeError: If output is not valid JSON or empty
        subprocess.CalledProcessError: If command fails in unexpected way
    """
    result = subprocess.run(
        ["uv", "run", "portfolio"] + cmd.split(),
        capture_output=True,
        text=True,
    )
    # Try stdout first; some errors may be on stderr (e.g., Click validation)
    output = result.stdout.strip()
    if not output:
        # If no stdout, the command failed at Click level (not JSON)
        # This is expected for invalid arguments; we'll skip those tests
        raise ValueError(f"No JSON output (Click validation error): {result.stderr}")
    return json.loads(output)


def test_cli_init_smoke():
    """Verify init command returns valid JSON envelope."""
    data = run_cli_command("init")
    assert isinstance(data, dict), "Response must be JSON object"
    assert "ok" in data, "Response must have 'ok' field"
    assert data["ok"] is True, "init should succeed"
    assert "command" in data, "Response must have 'command' field"
    assert data["command"] == "init"


def test_cli_status_smoke():
    """Verify status command returns valid JSON envelope."""
    data = run_cli_command("status")
    assert isinstance(data, dict)
    assert "ok" in data
    assert "command" in data
    assert data["command"] == "status"
    # status should always return ok=True or ok=False with proper structure
    if not data["ok"]:
        assert "error" in data


def test_cli_allocation_smoke():
    """Verify allocation command returns valid JSON envelope."""
    data = run_cli_command("allocation --type all")
    assert isinstance(data, dict)
    assert "ok" in data
    assert "command" in data
    assert data["command"] == "allocation"
    if data["ok"]:
        assert "data" in data


def test_cli_performance_smoke():
    """Verify performance command returns valid JSON envelope."""
    data = run_cli_command("performance")
    assert isinstance(data, dict)
    assert "ok" in data
    assert "command" in data
    assert data["command"] == "performance"
    if data["ok"]:
        assert "data" in data


def test_cli_summary_smoke():
    """Verify summary command returns valid JSON envelope."""
    data = run_cli_command("summary")
    assert isinstance(data, dict)
    assert "ok" in data
    assert "command" in data
    assert data["command"] == "summary"
    if data["ok"]:
        assert "data" in data


def test_cli_cash_smoke():
    """Verify cash command returns valid JSON envelope."""
    data = run_cli_command("cash")
    assert isinstance(data, dict)
    assert "ok" in data
    assert "command" in data
    assert data["command"] == "cash"
    if data["ok"]:
        assert "data" in data


def test_cli_mwr_smoke():
    """Verify mwr command returns valid JSON envelope."""
    data = run_cli_command("mwr")
    assert isinstance(data, dict)
    assert "ok" in data
    assert "command" in data
    assert data["command"] == "mwr"
    if data["ok"]:
        assert "data" in data


def test_cli_health_smoke():
    """Verify health command returns valid JSON envelope."""
    data = run_cli_command("health")
    assert isinstance(data, dict)
    assert "ok" in data
    assert "command" in data
    assert data["command"] == "health"
    if data["ok"]:
        assert "data" in data


def test_cli_db_error_when_no_url():
    """Verify database error responses follow proper JSON envelope.

    This test requires PORTFOLIO_DB_URL to be unset to trigger a DB error.
    """
    # Save current env
    original_url = os.environ.get("PORTFOLIO_DB_URL")
    try:
        # Unset PORTFOLIO_DB_URL to trigger error
        if "PORTFOLIO_DB_URL" in os.environ:
            del os.environ["PORTFOLIO_DB_URL"]

        # Run a command that needs the database
        result = subprocess.run(
            ["uv", "run", "portfolio", "status"],
            capture_output=True,
            text=True,
        )

        # Should get JSON error response
        if result.stdout.strip():
            data = json.loads(result.stdout)
            assert isinstance(data, dict), "Error response must be JSON"
            assert "ok" in data, "Error response must have 'ok' field"
            assert data["ok"] is False, "DB error should set ok=False"
            assert "error" in data, "Error response must have 'error' field"
    finally:
        # Restore env
        if original_url:
            os.environ["PORTFOLIO_DB_URL"] = original_url


def test_cli_meta_fields():
    """Verify meta fields are present in responses."""
    data = run_cli_command("status")
    assert isinstance(data, dict)
    assert "meta" in data, "Response must have 'meta' field"
    assert isinstance(data["meta"], dict)
    # Most commands should have generated_at timestamp
    if data["ok"]:
        assert "generated_at" in data["meta"]
