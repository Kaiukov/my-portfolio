"""DuckDB to PostgreSQL migration service."""

from datetime import datetime
from pathlib import Path


def migrate_duckdb_to_postgres(
    duckdb_path: str,
    postgres_target: str,
    dry_run: bool = False,
) -> dict:
    """Migrate data from DuckDB to PostgreSQL.

    Args:
        duckdb_path: Path to DuckDB file (e.g., ~/portfolio.duckdb)
        postgres_target: PostgreSQL connection URL
        dry_run: If True, validate but don't insert

    Returns:
        dict: Migration results with status, rows migrated, errors (if any)
    """
    # Try to import duckdb; it's optional
    try:
        import duckdb
    except ImportError:
        return {
            "ok": False,
            "error": "DuckDB not installed. Install with: pip install duckdb",
            "rows_migrated": {},
        }

    # Validate paths
    duckdb_file = Path(duckdb_path).expanduser()
    if not duckdb_file.exists():
        return {
            "ok": False,
            "error": f"DuckDB file not found: {duckdb_file}",
            "rows_migrated": {},
        }

    # Connect to both databases
    try:
        duck_con = duckdb.connect(str(duckdb_file), read_only=True)
    except Exception as e:
        return {
            "ok": False,
            "error": f"Failed to connect to DuckDB: {e}",
            "rows_migrated": {},
        }

    try:
        # Import PostgreSQL adapter only here to avoid hard dependency
        from portfolio_db.database import is_postgres_url, _ConnectionAdapter

        if not is_postgres_url(postgres_target):
            return {
                "ok": False,
                "error": "postgres_target must be a PostgreSQL URL (postgresql:// or postgres://)",
                "rows_migrated": {},
            }

        pg_con = _ConnectionAdapter(postgres_target, read_only=False)
    except Exception as e:
        duck_con.close()
        return {
            "ok": False,
            "error": f"Failed to connect to PostgreSQL: {e}",
            "rows_migrated": {},
        }

    # Define tables to migrate (order matters for FK constraints)
    tables = [
        ("transactions", ["id", "date", "asset", "action", "quantity", "asset_type", "price", "currency", "fees", "exchange", "data_source", "account", "created_at", "updated_at"]),
        ("prices", ["date", "ticker", "price"]),
        ("daily_returns", ["date", "portfolio_value", "portfolio_daily_return", "investment_return", "cash_flow_impact", "adjusted_base"]),
        ("refresh_log", ["refresh_id", "refresh_date", "refresh_type", "rows_affected", "timestamp"]),
        ("recalc_cache", ["cache_key", "last_calc_date", "transaction_count", "prices_hash", "timestamp"]),
        ("service_state", ["state_key", "state_value", "updated_at"]),
        ("repair_log", ["repair_id", "ticker", "start_date", "end_date", "status", "rows_loaded", "message", "timestamp"]),
    ]

    rows_migrated = {}
    errors = []

    # Pre-fetch DuckDB table list once
    duck_tables = duck_con.execute(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'"
    ).fetchall()
    duck_table_names = {t[0] for t in duck_tables}

    try:
        for table_name, columns in tables:
            if table_name not in duck_table_names:
                rows_migrated[table_name] = {"status": "skipped", "reason": "table not found in DuckDB"}
                continue

            query = f"SELECT {', '.join(columns)} FROM {table_name}"
            rows = duck_con.execute(query).fetchall()
            row_count = len(rows)

            if dry_run:
                rows_migrated[table_name] = {"status": "dry_run", "rows": row_count}
                continue

            try:
                # TRUNCATE in its own commit to avoid long-running open tx
                pg_con._conn.execute(f"TRUNCATE TABLE {table_name} CASCADE")
                pg_con._conn.commit()

                if rows:
                    col_names = ", ".join(columns)
                    with pg_con._conn.cursor() as cur:
                        with cur.copy(f"COPY {table_name} ({col_names}) FROM STDIN") as copy:
                            for row in rows:
                                copy.write_row(row)
                    pg_con._conn.commit()

                rows_migrated[table_name] = {"status": "migrated", "rows": row_count}
            except Exception as e:
                pg_con._conn.rollback()
                errors.append(f"{table_name}: {str(e)}")
                rows_migrated[table_name] = {"status": "error", "error": str(e)}

        if not dry_run:
            # Reset sequences for identity columns
            sequence_resets = [
                ("transactions", "id"),
                ("refresh_log", "refresh_id"),
                ("repair_log", "repair_id"),
            ]
            for table_name, col_name in sequence_resets:
                try:
                    result = pg_con.execute(f"SELECT MAX({col_name}) FROM {table_name}").fetchone()
                    max_id = result[0] if result and result[0] else 0
                    pg_con.execute(f"SELECT setval('{table_name}_{col_name}_seq', {max_id + 1}, false)")
                    pg_con._conn.commit()
                except Exception:
                    pg_con._conn.rollback()

        duck_con.close()
        pg_con.close()

        return {
            "ok": len(errors) == 0,
            "rows_migrated": rows_migrated,
            "errors": errors if errors else None,
            "dry_run": dry_run,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    except Exception as e:
        pg_con._conn.rollback()
        duck_con.close()
        pg_con.close()
        return {
            "ok": False,
            "error": f"Migration failed: {str(e)}",
            "rows_migrated": rows_migrated,
            "errors": errors,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }
