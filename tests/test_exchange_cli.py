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

from portfolio_db.cli import cli
from portfolio_db.portfolio_service import PortfolioService
from portfolio_db.price_service import PriceService


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


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "portfolio.db"


@pytest.fixture(autouse=True)
def stub_price_fetch(monkeypatch):
    monkeypatch.setattr(PriceService, "fetch_all_prices", staticmethod(fake_price_fetch))


def test_exchange_invalid_asset_returns_validation_error(runner, db_path: Path):
    service = PortfolioService(str(db_path))
    service.add_transaction("01-01-2026", "USD", "DEPOSIT", 5000, exchange="test")
    service.close()

    result = runner.invoke(
        cli,
        [
            "exchange",
            "--date",
            "02-01-2026",
            "--from",
            "USD",
            "--to",
            "EUR",
            "--quantity",
            "1000",
            "--rate",
            "0.92",
            "--db",
            str(db_path),
        ],
    )

    assert result.exit_code == 1, result.output
    body = json.loads(result.output)
    assert body["ok"] is False
    assert body["command"] == "exchange"
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert "not a recognized cash asset" in body["error"]["message"]
