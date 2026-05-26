"""Local portfolio_db package for the my-portfolio workspace."""

from __future__ import annotations

import os
from pathlib import Path

__version__ = "0.1.0"
_WORKSPACE = "my-portfolio"  # sentinel — distinguishes from sibling repos


def _iter_dotenv_candidates() -> list[Path]:
    """Return `.env` files to consider, starting from the current working directory."""
    candidates: list[Path] = []
    current = Path.cwd().resolve()

    for directory in (current, *current.parents):
        candidate = directory / ".env"
        if candidate.exists():
            candidates.append(candidate)
            break

    return candidates


def _load_dotenv_file(path: Path) -> None:
    """Load a simple KEY=VALUE `.env` file without overwriting existing environment."""
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].lstrip()
        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue

        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]

        os.environ.setdefault(key, value)


def _load_dotenv() -> None:
    """Populate environment variables from a local `.env` file if one exists."""
    for candidate in _iter_dotenv_candidates():
        _load_dotenv_file(candidate)
        break


_load_dotenv()
