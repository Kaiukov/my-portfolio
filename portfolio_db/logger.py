"""Structured JSON logger for portfolio operations.

Writes one JSON object per line to PORTFOLIO_LOG_PATH (default: logs/portfolio.log).
stdout is reserved for CLI JSON output — never log there.
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def _default_log_path() -> Path:
    repo_root = Path(__file__).resolve().parents[1]
    return repo_root / "logs" / "portfolio.log"


def _log_path() -> Path:
    env = os.environ.get("PORTFOLIO_LOG_PATH")
    return Path(env) if env else _default_log_path()


def _write(entry: dict) -> None:
    path = _log_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, default=str) + "\n")
    except Exception as exc:
        # Never crash the app because of logging; surface to stderr only
        print(f"[portfolio-logger] failed to write log: {exc}", file=sys.stderr)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── Public API ─────────────────────────────────────────────────────────────────

def price_refresh(tickers: list, rows_loaded: int, rows_per_ticker: dict) -> None:
    _write({
        "ts": _now(), "event": "price_refresh", "level": "info",
        "tickers": tickers, "rows_loaded": rows_loaded,
        "rows_per_ticker": rows_per_ticker,
    })


def price_refresh_skipped(reason: str) -> None:
    _write({"ts": _now(), "event": "price_refresh_skipped", "level": "info", "reason": reason})


def price_coverage_failure(ticker: str, issues: list) -> None:
    _write({
        "ts": _now(), "event": "price_coverage_failure", "level": "error",
        "ticker": ticker, "issues": issues,
    })


def recalc_start(from_date, recalc_type: str, force: bool) -> None:
    _write({
        "ts": _now(), "event": "recalc_start", "level": "info",
        "from_date": str(from_date) if from_date else None,
        "recalc_type": recalc_type, "force": force,
    })


def recalc_done(recalc_type: str, rows_affected: int, from_date=None) -> None:
    _write({
        "ts": _now(), "event": "recalc_done", "level": "info",
        "recalc_type": recalc_type, "rows_affected": rows_affected,
        "from_date": str(from_date) if from_date else None,
    })


def recalc_failure(error: str, from_date=None) -> None:
    _write({
        "ts": _now(), "event": "recalc_failure", "level": "error",
        "error": error, "from_date": str(from_date) if from_date else None,
    })


def transaction_add(transaction_id: int, asset: str, action: str,
                    quantity: float, date, recalc_type: str) -> None:
    _write({
        "ts": _now(), "event": "transaction_add", "level": "info",
        "transaction_id": transaction_id, "asset": asset, "action": action,
        "quantity": quantity, "date": str(date), "recalc_type": recalc_type,
    })


def transaction_edit(transaction_id: int, changed_fields: list,
                     from_date, recalc_type: str) -> None:
    _write({
        "ts": _now(), "event": "transaction_edit", "level": "info",
        "transaction_id": transaction_id, "changed_fields": changed_fields,
        "recalc_from": str(from_date), "recalc_type": recalc_type,
    })


def transaction_delete(transaction_id: int, asset: str, action: str,
                       date, recalc_type: str) -> None:
    _write({
        "ts": _now(), "event": "transaction_delete", "level": "info",
        "transaction_id": transaction_id, "asset": asset, "action": action,
        "date": str(date), "recalc_type": recalc_type,
    })


def backup_created(source: str, destination: str, size_bytes: int) -> None:
    _write({"ts": _now(), "event": "backup_created", "level": "info",
            "source": source, "destination": destination, "size_bytes": size_bytes})


def failure(event: str, error: str, **context) -> None:
    _write({"ts": _now(), "event": event, "level": "error", "error": error, **context})
