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
        raise RuntimeError("PORTFOLIO_DB_URL is required for PostgreSQL-only tests")

    schema_name = f"pytest_{os.getpid()}_{uuid.uuid4().hex[:10]}"
    test_url = _append_query_param(base_url, "schema", schema_name)

    with psycopg.connect(base_url) as conn:
        conn.execute(f'DROP SCHEMA IF EXISTS "{schema_name}" CASCADE')
        conn.execute(f'CREATE SCHEMA "{schema_name}"')
        conn.commit()

    os.environ["PORTFOLIO_DB_URL"] = test_url
    yield


@pytest.fixture(autouse=True)
def postgres_schema_isolation():
    """Clear the test schema before each test."""
    test_url = os.getenv("PORTFOLIO_DB_URL")
    if not test_url:
        raise RuntimeError("PORTFOLIO_DB_URL is required for PostgreSQL-only tests")

    # Extract schema name from query parameters
    parsed = urlsplit(test_url)
    query_items = parse_qsl(parsed.query, keep_blank_values=True)
    schema_name = None
    for key, value in query_items:
        if key in {"schema", "search_path"}:
            schema_name = value
            break

    # Connect without the schema parameter (psycopg doesn't understand it)
    base_url = _remove_query_param(test_url, "schema")
    base_url = _remove_query_param(base_url, "search_path")

    with psycopg.connect(base_url) as conn:
        # Set the schema if one was specified
        if schema_name:
            conn.execute(f'SET search_path TO "{schema_name}"')

        conn.execute(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = current_schema()
                ) THEN
                    EXECUTE (
                        SELECT 'TRUNCATE TABLE ' || string_agg(quote_ident(table_name), ', ')
                             || ' RESTART IDENTITY CASCADE'
                        FROM information_schema.tables
                        WHERE table_schema = current_schema()
                    );
                END IF;
            END $$;
            """
        )
        conn.commit()

    yield
