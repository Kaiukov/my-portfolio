"""Centralized input validators for the portfolio CLI.

Every public function here either returns a valid value or calls
``response.error()`` and exits with code 1.  No function raises an
exception that the caller has to handle – validation failures are
fatal and self-explanatory.
"""

from __future__ import annotations

import os
from datetime import date
from typing import Optional

from portfolio_db.response import error as _error

# ──────────────────────────────────────────────────────────────────────────────
# Pagination
# ──────────────────────────────────────────────────────────────────────────────

MAX_LIMIT = 10_000


def validate_pagination(limit: int, offset: int, command: str) -> None:
    """Validate --limit and --offset values."""
    if limit <= 0:
        _error(
            command,
            "VALIDATION_ERROR",
            f"--limit must be a positive integer, got {limit!r}.\n"
            f"Expected: --limit <positive integer>\n"
            f"Example:  portfolio {command} --limit 50",
        )
    if limit > MAX_LIMIT:
        _error(
            command,
            "VALIDATION_ERROR",
            f"--limit {limit} exceeds the maximum of {MAX_LIMIT}.\n"
            f"Expected: --limit <1..{MAX_LIMIT}>\n"
            f"Example:  portfolio {command} --limit 50",
        )
    if offset < 0:
        _error(
            command,
            "VALIDATION_ERROR",
            f"--offset must be zero or a positive integer, got {offset!r}.\n"
            f"Expected: --offset <non-negative integer>\n"
            f"Example:  portfolio {command} --offset 0",
        )


# ──────────────────────────────────────────────────────────────────────────────
# Date range
# ──────────────────────────────────────────────────────────────────────────────


def validate_date_range(
    start: Optional[date],
    end: Optional[date],
    command: str,
    start_flag: str = "--start-date",
    end_flag: str = "--end-date",
) -> None:
    """Validate that start_date <= end_date when both are supplied."""
    if start is not None and end is not None and start > end:
        _error(
            command,
            "VALIDATION_ERROR",
            f"{start_flag} ({start}) must not be after {end_flag} ({end}).\n"
            f"Expected: {start_flag} YYYY-MM-DD <= {end_flag} YYYY-MM-DD\n"
            f"Example:  portfolio {command} {start_flag} 2026-01-01 {end_flag} 2026-03-31",
        )


# ──────────────────────────────────────────────────────────────────────────────
# Numeric ranges
# ──────────────────────────────────────────────────────────────────────────────


def validate_positive_float(value: float, flag: str, command: str) -> None:
    """Validate that a float option is strictly positive (> 0)."""
    if value <= 0:
        _error(
            command,
            "VALIDATION_ERROR",
            f"{flag} must be greater than zero, got {value!r}.\n"
            f"Expected: {flag} <positive number>\n"
            f"Example:  portfolio {command} {flag} 1.5",
        )


def validate_non_negative_float(value: float, flag: str, command: str) -> None:
    """Validate that a float option is >= 0."""
    if value < 0:
        _error(
            command,
            "VALIDATION_ERROR",
            f"{flag} must be zero or a positive number, got {value!r}.\n"
            f"Expected: {flag} <non-negative number>\n"
            f"Example:  portfolio {command} {flag} 0",
        )


def validate_positive_int(value: int, flag: str, command: str) -> None:
    """Validate that an integer option is strictly positive (> 0)."""
    if value <= 0:
        _error(
            command,
            "VALIDATION_ERROR",
            f"{flag} must be a positive integer, got {value!r}.\n"
            f"Expected: {flag} <positive integer>\n"
            f"Example:  portfolio {command} {flag} 1",
        )


# ──────────────────────────────────────────────────────────────────────────────
# File paths
# ──────────────────────────────────────────────────────────────────────────────


def validate_file_exists(path: str, flag: str, command: str) -> None:
    """Validate that a file path points to an existing regular file."""
    if not os.path.isfile(path):
        _error(
            command,
            "VALIDATION_ERROR",
            f"{flag} file not found: {path!r}.\n"
            f"Expected: {flag} <path to an existing file>\n"
            f"Example:  portfolio {command} {flag} ./transactions.csv",
        )


# ──────────────────────────────────────────────────────────────────────────────
# Non-empty string
# ──────────────────────────────────────────────────────────────────────────────


def validate_non_empty(value: Optional[str], flag: str, command: str, example: str = "") -> None:
    """Validate that an optional string is non-empty when provided."""
    if value is not None and not value.strip():
        hint = f"\nExample:  portfolio {command} {flag} {example}" if example else ""
        _error(
            command,
            "VALIDATION_ERROR",
            f"{flag} must not be empty.{hint}",
        )
