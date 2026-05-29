import os
import uuid
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import pytest
import psycopg
import sys


REPO_ROOT = Path(__file__).resolve().parents[1]
repo_str = str(REPO_ROOT)

if repo_str not in sys.path:
    sys.path.insert(0, repo_str)


def _load_dotenv_value(key: str) -> str | None:
    env_path = REPO_ROOT / ".env"
    if not env_path.exists():
        return None

    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        if name.strip() == key:
            return value.strip().strip('"').strip("'")
    return None


def _append_query_param(url: str, key: str, value: str) -> str:
    parsed = urlsplit(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query[key] = value
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment))


def _remove_query_param(url: str, key: str) -> str:
    parsed = urlsplit(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.pop(key, None)
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment))


@pytest.fixture(scope="session", autouse=True)
def postgres_test_schema():
    """Create one isolated PostgreSQL schema for the full test session."""
    base_url = os.getenv("PORTFOLIO_DB_URL") or _load_dotenv_value("PORTFOLIO_DB_URL")
    if not base_url:
        pytest.skip("PORTFOLIO_DB_URL not set — skipping PostgreSQL tests")
        return

    schema_name = f"pytest_{os.getpid()}_{uuid.uuid4().hex[:10]}"
    test_url = _append_query_param(base_url, "schema", schema_name)

    with psycopg.connect(base_url) as conn:
        conn.execute(f'DROP SCHEMA IF EXISTS "{schema_name}" CASCADE')
        conn.execute(f'CREATE SCHEMA "{schema_name}"')
        conn.commit()

    os.environ["PORTFOLIO_DB_URL"] = test_url

    # Persistent connection reused for every pre/post-test truncation.
    # Avoids opening 2 TCP connections per test (454 connections for 227 tests).
    cleanup_conn = psycopg.connect(base_url)
    cleanup_conn.execute(f'SET search_path TO "{schema_name}"')
    cleanup_conn.commit()

    yield {"base_url": base_url, "schema_name": schema_name, "cleanup_conn": cleanup_conn}

    cleanup_conn.close()
    with psycopg.connect(base_url) as conn:
        conn.execute(f'DROP SCHEMA IF EXISTS "{schema_name}" CASCADE')
        conn.commit()


@pytest.fixture(autouse=True)
def postgres_schema_isolation(postgres_test_schema):
    """Clear the test schema before and after each test."""
    if postgres_test_schema is None:
        yield
        return

    conn: psycopg.Connection = postgres_test_schema["cleanup_conn"]

    # Lazily built once per session — table list is stable after first test.
    _truncate_schema(conn)
    try:
        yield
    finally:
        _truncate_schema(conn)


# Cached TRUNCATE statement: built after first schema population, reused for all
# subsequent tests. Avoids an information_schema.tables query per test.
_truncate_sql: str | None = None


def _truncate_schema(conn: "psycopg.Connection") -> None:
    global _truncate_sql

    if _truncate_sql is None:
        row = conn.execute(
            "SELECT string_agg(quote_ident(table_name), ', ' ORDER BY table_name) "
            "FROM information_schema.tables "
            "WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'"
        ).fetchone()
        if row and row[0]:
            _truncate_sql = f"TRUNCATE TABLE {row[0]} RESTART IDENTITY CASCADE"

    if _truncate_sql:
        conn.execute(_truncate_sql)
        conn.commit()
