"""Standard JSON response envelope for all CLI commands."""

import json
import sys
from datetime import datetime, timezone


def _now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def success(command: str, data, count: int | None = None, pagination: dict | None = None, extra_meta: dict | None = None) -> None:
    """Print a success envelope and exit 0."""
    meta = {"generated_at": _now_utc(), "count": count}
    if pagination is not None:
        meta["pagination"] = pagination
    if extra_meta is not None:
        meta.update(extra_meta)
    envelope = {"ok": True, "command": command, "data": data, "meta": meta}
    try:
        print(json.dumps(envelope, indent=2, default=str))
    except (TypeError, ValueError) as e:
        # Fallback for non-serializable data
        envelope["data"] = {"error": "Response data contains non-serializable content", "raw_type": str(type(data))}
        print(json.dumps(envelope, indent=2))


def error(command: str, code: str, message: str) -> None:
    """Print an error envelope and exit 1."""
    meta = {"generated_at": _now_utc(), "count": None}
    envelope = {
        "ok": False,
        "command": command,
        "error": {"code": code, "message": message},
        "meta": meta,
    }
    print(json.dumps(envelope, indent=2))
    sys.exit(1)


def build_pagination(limit: int, offset: int, total: int) -> dict:
    """Build pagination metadata block."""
    has_more = (offset + limit) < total
    return {
        "limit": limit,
        "offset": offset,
        "total": total,
        "has_more": has_more,
        "next_offset": offset + limit if has_more else None,
    }
