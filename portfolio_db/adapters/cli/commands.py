"""CLI adapter — thin re-export of the canonical portfolio_db.cli implementation.

Canonical implementation lives in portfolio_db/cli.py.
This module exists so that portfolio_db.adapters.cli.commands.cli is importable
by future adapter code without duplicating any logic.
"""
from portfolio_db.cli import cli  # noqa: F401
