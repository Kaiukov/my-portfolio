"""Database setup and transaction management."""

import logging
import os
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import pandas as pd

log = logging.getLogger(__name__)

# Schemas where SQL functions have already been installed in this process.
# CREATE OR REPLACE FUNCTION is expensive; skip when functions are already present.
_sql_functions_installed: set[str] = set()


def is_postgres_url(target: str) -> bool:
    """Return True when target points to a PostgreSQL connection string."""
    return target.startswith(("postgres://", "postgresql://"))


def resolve_db_target() -> str:
    """Resolve PostgreSQL connection URL from environment or raise error."""
    env_target = os.getenv("PORTFOLIO_DB_URL")
    if not env_target:
        raise RuntimeError(
            "PORTFOLIO_DB_URL environment variable is not set. "
            "Set it to a PostgreSQL connection string (postgresql://... or postgres://...)"
        )
    return env_target


class _ConnectionAdapter:
    """Small connection wrapper for PostgreSQL usage."""

    def __init__(self, target: str, read_only: bool = False):
        if not is_postgres_url(target):
            raise ValueError(
                "PORTFOLIO_DB_URL must be a PostgreSQL connection string "
                "(postgresql:// or postgres://)"
            )

        import psycopg

        parsed = urlsplit(target)
        query_items = parse_qsl(parsed.query, keep_blank_values=True)
        query = {}
        schema_name = None
        for key, value in query_items:
            if key in {"schema", "search_path"}:
                schema_name = value
            else:
                query[key] = value
        clean_target = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment))
        self._conn = psycopg.connect(clean_target)
        self._conn.autocommit = False
        if schema_name:
            # Use psycopg's Identifier for safe quoting
            from psycopg import sql as psycopg_sql
            self._conn.execute(psycopg_sql.SQL('CREATE SCHEMA IF NOT EXISTS {}').format(psycopg_sql.Identifier(schema_name)))
            self._conn.execute(psycopg_sql.SQL('SET search_path TO {}').format(psycopg_sql.Identifier(schema_name)))
        self._read_only = read_only
        self._schema_name = schema_name or "public"

    def execute(self, sql: str, params=None):
        """Execute SQL with psycopg %s placeholders."""
        if params is None:
            return self._conn.execute(sql)
        return self._conn.execute(sql, params)

    def executemany(self, sql: str, params_seq):
        """Execute SQL once per row in params_seq using server-side batching."""
        with self._conn.cursor() as cur:
            cur.executemany(sql, params_seq)

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()


class PortfolioDatabase:
    """Portfolio database backed by PostgreSQL only."""

    def __init__(self, db_path: str = None, read_only: bool = False):
        """Initialize database connection.

        Args:
            db_path: PostgreSQL URL from PORTFOLIO_DB_URL env var, or test schema path.
            read_only: Enforce read-only mode (for verification).

        Raises:
            RuntimeError: If PORTFOLIO_DB_URL env var is not set.
        """
        # Resolve PostgreSQL target, will error if PORTFOLIO_DB_URL not set
        target = resolve_db_target()
        self.db_path = target
        self.read_only = read_only
        self.con = _ConnectionAdapter(target, read_only=read_only)
        if not read_only:
            self._create_schema()

    def _table_exists(self, table_name: str) -> bool:
        """Return True when a table exists in the current schema."""
        row = self.con.execute(
            """
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = current_schema()
              AND table_name = %s
            """,
            [table_name],
        ).fetchone()
        return bool(row)

    def _table_info(self, table_name: str):
        """Return column metadata in a PRAGMA-like shape."""
        return self.con.execute(
            """
            SELECT
                c.ordinal_position - 1 AS cid,
                c.column_name,
                c.data_type,
                CASE WHEN c.is_nullable = 'NO' THEN 1 ELSE 0 END AS notnull,
                c.column_default AS dflt_value,
                CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END AS pk
            FROM information_schema.columns c
            LEFT JOIN (
                SELECT kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                 AND tc.table_schema = kcu.table_schema
                 AND tc.table_name = kcu.table_name
                WHERE tc.table_schema = current_schema()
                  AND tc.table_name = %s
                  AND tc.constraint_type = 'PRIMARY KEY'
            ) pk ON pk.column_name = c.column_name
            WHERE c.table_schema = current_schema()
              AND c.table_name = %s
            ORDER BY c.ordinal_position
            """,
            [table_name, table_name],
        ).fetchall()

    def _create_schema(self):
        """Create database schema if not exists."""
        # Migrate existing daily_returns table if needed
        self._migrate_daily_returns_schema()

        # Migrate CASH format to Yahoo format
        self._migrate_cash_format()

        # Migrate transactions to add audit/account columns
        self._migrate_transaction_audit_columns()

        # Create transactions table
        self.con.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                date DATE NOT NULL,
                asset VARCHAR NOT NULL,
                action VARCHAR NOT NULL,
                quantity DOUBLE PRECISION NOT NULL,
                asset_type VARCHAR,
                price DOUBLE PRECISION,
                currency VARCHAR,
                fees DOUBLE PRECISION,
                fee_currency VARCHAR(10),
                exchange VARCHAR,
                data_source VARCHAR,
                account VARCHAR,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP
            )
        """)

        # Create prices table
        self.con.execute("""
            CREATE TABLE IF NOT EXISTS prices (
                date DATE NOT NULL,
                ticker VARCHAR NOT NULL,
                price DOUBLE PRECISION NOT NULL,
                PRIMARY KEY (date, ticker)
            )
        """)

        # Create index on ticker for faster lookups
        self.con.execute("""
            CREATE INDEX IF NOT EXISTS idx_prices_ticker ON prices (ticker)
        """)

        # Create daily returns table with separated return metrics
        self.con.execute("""
            CREATE TABLE IF NOT EXISTS daily_returns (
                date DATE PRIMARY KEY,
                portfolio_value DOUBLE PRECISION NOT NULL,
                portfolio_daily_return DOUBLE PRECISION,
                investment_return DOUBLE PRECISION,
                cash_flow_impact DOUBLE PRECISION,
                adjusted_base DOUBLE PRECISION
            )
        """)

        # Create refresh log table
        self.con.execute("""
            CREATE TABLE IF NOT EXISTS refresh_log (
                refresh_id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                refresh_date DATE NOT NULL,
                refresh_type VARCHAR NOT NULL,
                rows_affected INTEGER,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Create recalculation cache table
        self.con.execute("""
            CREATE TABLE IF NOT EXISTS recalc_cache (
                cache_key VARCHAR PRIMARY KEY,
                last_calc_date DATE NOT NULL,
                transaction_count INTEGER NOT NULL,
                prices_hash VARCHAR,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Create service state table for explicit refresh/recalc freshness
        self.con.execute("""
            CREATE TABLE IF NOT EXISTS service_state (
                state_key VARCHAR PRIMARY KEY,
                state_value VARCHAR,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Create repair log table for operator visibility
        self.con.execute("""
            CREATE TABLE IF NOT EXISTS repair_log (
                repair_id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                ticker VARCHAR NOT NULL,
                start_date DATE,
                end_date DATE,
                status VARCHAR NOT NULL,
                rows_loaded INTEGER DEFAULT 0,
                message VARCHAR,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Create SQL functions once per schema per process — CREATE OR REPLACE is
        # expensive (plpgsql compile). TRUNCATE between tests keeps functions alive.
        schema = self.con._schema_name
        if schema not in _sql_functions_installed:
            self._create_sql_helpers()
            self._create_daily_returns_refresh_function()
            self._create_maintenance_functions()
            _sql_functions_installed.add(schema)

        self.con.commit()

    def _create_sql_helpers(self):
        """Create SQL helper functions used by database-side calculations."""
        self.con.execute("""
            CREATE OR REPLACE FUNCTION get_asset_type_sql(ticker TEXT)
            RETURNS TEXT
            LANGUAGE sql
            IMMUTABLE
            AS $$
                SELECT CASE
                    WHEN ticker = 'USD' THEN 'cash_base'
                    WHEN ticker IN ('EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'HKD', 'SGD', 'JPY') THEN 'cash_fx'
                    WHEN RIGHT(ticker, 5) = 'USD=X' THEN 'cash_fx'
                    WHEN RIGHT(ticker, 4) = '-USD' THEN 'crypto'
                    WHEN RIGHT(ticker, 2) = '.L' THEN 'stock_gbp'
                    WHEN RIGHT(ticker, 3) = '.DE' THEN 'stock_eur'
                    WHEN RIGHT(ticker, 2) = '.T' THEN 'stock_jpy'
                    WHEN RIGHT(ticker, 3) = '.SW' THEN 'stock_chf'
                    WHEN RIGHT(ticker, 3) = '.TO' THEN 'stock_cad'
                    WHEN RIGHT(ticker, 3) = '.AX' THEN 'stock_aud'
                    WHEN RIGHT(ticker, 3) = '.HK' THEN 'stock_hkd'
                    WHEN RIGHT(ticker, 3) = '.SG' THEN 'stock_sgd'
                    ELSE 'stock_usd'
                END
            $$;
        """)

        self.con.execute("""
            CREATE OR REPLACE FUNCTION is_cash_like_sql(asset TEXT)
            RETURNS BOOLEAN
            LANGUAGE sql
            IMMUTABLE
            AS $$
                SELECT get_asset_type_sql(asset) IN ('cash_base', 'cash_fx')
                    OR asset LIKE 'CASH %%'
            $$;
        """)

        self.con.execute("""
            CREATE OR REPLACE FUNCTION normalize_cash_asset_sql(asset TEXT, asset_type TEXT)
            RETURNS TEXT
            LANGUAGE sql
            IMMUTABLE
            AS $$
                SELECT CASE
                    WHEN asset_type = 'cash_base' OR asset = 'CASH USD' THEN 'USD'
                    WHEN asset = 'EUR' THEN 'EURUSD=X'
                    WHEN asset = 'GBP' THEN 'GBPUSD=X'
                    WHEN asset = 'CHF' THEN 'CHFUSD=X'
                    WHEN asset = 'CAD' THEN 'CADUSD=X'
                    WHEN asset = 'AUD' THEN 'AUDUSD=X'
                    WHEN asset = 'HKD' THEN 'HKDUSD=X'
                    WHEN asset = 'SGD' THEN 'SGDUSD=X'
                    WHEN asset = 'JPY' THEN 'JPYUSD=X'
                    WHEN asset_type = 'cash_fx' THEN asset
                    WHEN asset = 'CASH EUR' THEN 'EURUSD=X'
                    WHEN asset = 'CASH GBP' THEN 'GBPUSD=X'
                    WHEN asset = 'CASH UAH' THEN 'UAHUSD=X'
                    ELSE asset
                END
            $$;
        """)

        self.con.execute("""
            CREATE OR REPLACE FUNCTION get_cash_key_for_asset_sql(asset TEXT, asset_type TEXT)
            RETURNS TEXT
            LANGUAGE sql
            IMMUTABLE
            AS $$
                SELECT CASE
                    WHEN asset_type = 'cash_fx' THEN asset
                    WHEN asset_type = 'stock_eur' THEN 'EURUSD=X'
                    WHEN asset_type = 'stock_gbp' THEN 'GBPUSD=X'
                    WHEN asset_type = 'stock_jpy' THEN 'JPYUSD=X'
                    WHEN asset_type = 'stock_chf' THEN 'CHFUSD=X'
                    WHEN asset_type = 'stock_cad' THEN 'CADUSD=X'
                    WHEN asset_type = 'stock_aud' THEN 'AUDUSD=X'
                    WHEN asset_type = 'stock_hkd' THEN 'HKDUSD=X'
                    WHEN asset_type = 'stock_sgd' THEN 'SGDUSD=X'
                    WHEN asset = 'CASH EUR' THEN 'EURUSD=X'
                    WHEN asset = 'CASH GBP' THEN 'GBPUSD=X'
                    WHEN asset = 'CASH UAH' THEN 'UAHUSD=X'
                    ELSE 'USD'
                END
            $$;
        """)

        self.con.execute("""
            CREATE OR REPLACE FUNCTION cash_currency_for_asset_type_sql(asset_type TEXT)
            RETURNS TEXT
            LANGUAGE sql
            IMMUTABLE
            AS $$
                SELECT CASE
                    WHEN asset_type = 'cash_base' OR asset = 'USD' THEN 'USD'
                    WHEN asset = 'EUR' THEN 'EURUSD=X'
                    WHEN asset = 'GBP' THEN 'GBPUSD=X'
                    WHEN asset = 'CHF' THEN 'CHFUSD=X'
                    WHEN asset = 'CAD' THEN 'CADUSD=X'
                    WHEN asset = 'AUD' THEN 'AUDUSD=X'
                    WHEN asset = 'HKD' THEN 'HKDUSD=X'
                    WHEN asset = 'SGD' THEN 'SGDUSD=X'
                    WHEN asset = 'JPY' THEN 'JPYUSD=X'
                    WHEN asset_type = 'stock_eur' THEN 'EURUSD=X'
                    WHEN asset_type = 'stock_gbp' THEN 'GBPUSD=X'
                    WHEN asset_type = 'stock_jpy' THEN 'JPYUSD=X'
                    WHEN asset_type = 'stock_chf' THEN 'CHFUSD=X'
                    WHEN asset_type = 'stock_cad' THEN 'CADUSD=X'
                    WHEN asset_type = 'stock_aud' THEN 'AUDUSD=X'
                    WHEN asset_type = 'stock_hkd' THEN 'HKDUSD=X'
                    WHEN asset_type = 'stock_sgd' THEN 'SGDUSD=X'
                    ELSE 'USD'
                END
            $$;
        """)

        self.con.execute("""
            CREATE OR REPLACE FUNCTION cash_display_currency_sql(symbol TEXT)
            RETURNS TEXT
            LANGUAGE sql
            IMMUTABLE
            AS $$
                SELECT CASE
                    WHEN symbol = 'USD' THEN 'USD'
                    WHEN symbol = 'EURUSD=X' THEN 'EUR'
                    WHEN symbol = 'GBPUSD=X' THEN 'GBP'
                    WHEN symbol = 'UAHUSD=X' THEN 'UAH'
                    WHEN symbol = 'JPYUSD=X' THEN 'JPY'
                    WHEN symbol = 'CHFUSD=X' THEN 'CHF'
                    WHEN symbol = 'CADUSD=X' THEN 'CAD'
                    WHEN symbol = 'AUDUSD=X' THEN 'AUD'
                    WHEN symbol = 'HKDUSD=X' THEN 'HKD'
                    WHEN symbol = 'SGDUSD=X' THEN 'SGD'
                    ELSE symbol
                END
            $$;
        """)

        self.con.execute("""
            CREATE OR REPLACE FUNCTION price_asof_sql(p_ticker TEXT, p_as_of_date DATE)
            RETURNS DOUBLE PRECISION
            LANGUAGE sql
            STABLE
            AS $$
                SELECT p.price
                FROM prices p
                WHERE p.ticker = p_ticker
                  AND p.date <= p_as_of_date
                ORDER BY p.date DESC
                LIMIT 1
            $$;
        """)

        self.con.execute("""
            CREATE OR REPLACE FUNCTION cash_amount_to_usd_sql(p_asset TEXT, p_quantity DOUBLE PRECISION, p_as_of_date DATE)
            RETURNS DOUBLE PRECISION
            LANGUAGE sql
            STABLE
            AS $$
                SELECT CASE
                    WHEN normalize_cash_asset_sql(p_asset, get_asset_type_sql(p_asset)) = 'USD' THEN p_quantity
                    ELSE p_quantity * price_asof_sql(
                        normalize_cash_asset_sql(p_asset, get_asset_type_sql(p_asset)),
                        p_as_of_date
                    )
                END
            $$;
        """)

        self.con.execute("""
            CREATE OR REPLACE FUNCTION asset_market_value_usd_sql(p_asset TEXT, p_quantity DOUBLE PRECISION, p_as_of_date DATE)
            RETURNS DOUBLE PRECISION
            LANGUAGE sql
            STABLE
            AS $$
                SELECT CASE
                    WHEN get_asset_type_sql(p_asset) = 'cash_base' THEN p_quantity
                    WHEN get_asset_type_sql(p_asset) = 'cash_fx' THEN p_quantity * price_asof_sql(p_asset, p_as_of_date)
                    WHEN get_asset_type_sql(p_asset) IN (
                        'stock_eur', 'stock_gbp', 'stock_jpy', 'stock_chf',
                        'stock_cad', 'stock_aud', 'stock_hkd', 'stock_sgd'
                    ) THEN p_quantity * price_asof_sql(p_asset, p_as_of_date) * price_asof_sql(
                        cash_currency_for_asset_type_sql(get_asset_type_sql(p_asset)),
                        p_as_of_date
                    )
                    ELSE p_quantity * price_asof_sql(p_asset, p_as_of_date)
                END
            $$;
        """)

        self.con.execute("""
            CREATE OR REPLACE FUNCTION discover_required_tickers_sql()
            RETURNS TABLE(ticker TEXT, ticker_category TEXT)
            LANGUAGE sql
            STABLE
            AS $$
                SELECT ticker, ticker_category
                FROM (
                    SELECT t.asset AS ticker, 'asset'::TEXT AS ticker_category
                    FROM transactions t

                    UNION

                    SELECT CASE
                        WHEN t.currency = 'EUR' THEN 'EURUSD=X'
                        WHEN t.currency = 'GBP' THEN 'GBPUSD=X'
                        WHEN t.currency = 'UAH' THEN 'UAHUSD=X'
                        WHEN t.currency = 'JPY' THEN 'JPYUSD=X'
                        WHEN t.currency = 'CHF' THEN 'CHFUSD=X'
                        WHEN t.currency = 'CAD' THEN 'CADUSD=X'
                        WHEN t.currency = 'AUD' THEN 'AUDUSD=X'
                        WHEN t.currency = 'HKD' THEN 'HKDUSD=X'
                        WHEN t.currency = 'SGD' THEN 'SGDUSD=X'
                    END, 'fx'::TEXT
                    FROM transactions t
                    WHERE t.currency IS NOT NULL AND t.currency != 'USD'

                    UNION

                    SELECT cash_currency_for_asset_type_sql(get_asset_type_sql(t.asset)), 'fx'::TEXT
                    FROM transactions t
                    WHERE get_asset_type_sql(t.asset) IN (
                        'stock_eur', 'stock_gbp', 'stock_jpy', 'stock_chf',
                        'stock_cad', 'stock_aud', 'stock_hkd', 'stock_sgd'
                    )

                    UNION

                    SELECT t.asset, 'fx'::TEXT
                    FROM transactions t
                    WHERE get_asset_type_sql(t.asset) = 'cash_fx'

                    UNION

                    SELECT CASE
                        WHEN t.asset = 'CASH EUR' THEN 'EURUSD=X'
                        WHEN t.asset = 'CASH GBP' THEN 'GBPUSD=X'
                        WHEN t.asset = 'CASH UAH' THEN 'UAHUSD=X'
                    END, 'fx'::TEXT
                    FROM transactions t
                    WHERE t.asset IN ('CASH EUR', 'CASH GBP', 'CASH UAH')
                ) sub
                WHERE ticker IS NOT NULL
            $$;
        """)

    def _create_daily_returns_refresh_function(self):
        """Create the PostgreSQL function that rebuilds daily_returns."""
        self.con.execute("""
            CREATE OR REPLACE FUNCTION refresh_daily_returns_sql(p_from_date DATE DEFAULT NULL)
            RETURNS INTEGER
            LANGUAGE plpgsql
            AS $$
            DECLARE
                v_min_date DATE;
                v_max_date DATE;
                v_date DATE;
                v_prev_value DOUBLE PRECISION := 0;
                v_portfolio_value DOUBLE PRECISION := 0;
                v_cash_flow_impact DOUBLE PRECISION := 0;
                v_portfolio_daily_return DOUBLE PRECISION := 0;
                v_investment_return DOUBLE PRECISION := 0;
                v_adjusted_base DOUBLE PRECISION := 0;
                v_rows INTEGER := 0;
                tx RECORD;
                h RECORD;
                v_asset_type TEXT;
                v_cash_key TEXT;
                v_asset_value DOUBLE PRECISION;
            BEGIN
                IF p_from_date IS NULL THEN
                    DELETE FROM daily_returns;
                ELSE
                    DELETE FROM daily_returns WHERE date >= p_from_date;
                END IF;

                SELECT MIN(date), MAX(date)
                  INTO v_min_date, v_max_date
                FROM transactions;

                IF v_min_date IS NULL THEN
                    RETURN 0;
                END IF;

                IF v_max_date < CURRENT_DATE THEN
                    v_max_date := CURRENT_DATE;
                END IF;

                CREATE TEMP TABLE holdings (
                    asset TEXT PRIMARY KEY,
                    qty DOUBLE PRECISION NOT NULL DEFAULT 0
                ) ON COMMIT DROP;

                INSERT INTO holdings (asset, qty)
                SELECT DISTINCT asset, 0
                FROM transactions
                ON CONFLICT (asset) DO NOTHING;

                INSERT INTO holdings (asset, qty)
                SELECT DISTINCT get_cash_key_for_asset_sql(asset, get_asset_type_sql(asset)), 0
                FROM transactions
                ON CONFLICT (asset) DO NOTHING;

                FOR v_date IN
                    SELECT generate_series(v_min_date, v_max_date, interval '1 day')::date
                LOOP
                    FOR tx IN
                        SELECT id, asset, action, quantity, price, fees, asset_type
                        FROM transactions
                        WHERE date = v_date
                        ORDER BY id
                    LOOP
                        v_asset_type := get_asset_type_sql(tx.asset);
                        v_cash_key := get_cash_key_for_asset_sql(tx.asset, v_asset_type);

                        INSERT INTO holdings (asset, qty)
                        VALUES (tx.asset, 0)
                        ON CONFLICT (asset) DO NOTHING;
                        INSERT INTO holdings (asset, qty)
                        VALUES (v_cash_key, 0)
                        ON CONFLICT (asset) DO NOTHING;

                        CASE upper(tx.action)
                            WHEN 'BUY' THEN
                                UPDATE holdings
                                SET qty = qty + tx.quantity
                                WHERE asset = tx.asset;

                                IF NOT is_cash_like_sql(tx.asset) AND tx.price IS NOT NULL THEN
                                    UPDATE holdings
                                    SET qty = qty - (tx.quantity * tx.price + COALESCE(tx.fees, 0))
                                    WHERE asset = v_cash_key;
                                END IF;
                            WHEN 'SELL' THEN
                                UPDATE holdings
                                SET qty = qty - tx.quantity
                                WHERE asset = tx.asset;

                                IF NOT is_cash_like_sql(tx.asset) AND tx.price IS NOT NULL THEN
                                    UPDATE holdings
                                    SET qty = qty + (tx.quantity * tx.price - COALESCE(tx.fees, 0))
                                    WHERE asset = v_cash_key;
                                END IF;
                            WHEN 'DEPOSIT', 'TRANSFER', 'DIVIDEND', 'INTEREST', 'EXCHANGE_TO' THEN
                                UPDATE holdings
                                SET qty = qty + tx.quantity
                                WHERE asset = v_cash_key;
                            WHEN 'WITHDRAW', 'FEE', 'TAX' THEN
                                UPDATE holdings
                                SET qty = qty - tx.quantity
                                WHERE asset = v_cash_key;
                            WHEN 'EXCHANGE_FROM' THEN
                                UPDATE holdings
                                SET qty = qty + tx.quantity
                                WHERE asset = v_cash_key;
                            ELSE
                                NULL;
                        END CASE;
                    END LOOP;

                    v_portfolio_value := 0;
                    FOR h IN
                        SELECT asset, qty
                        FROM holdings
                        WHERE qty <> 0
                        ORDER BY asset
                    LOOP
                        v_asset_value := asset_market_value_usd_sql(h.asset, h.qty, v_date);
                        IF h.qty <> 0 AND v_asset_value IS NULL THEN
                            RAISE EXCEPTION USING MESSAGE = 'Price unavailable for ' || h.asset || ' as of ' || v_date;
                        END IF;
                        v_portfolio_value := v_portfolio_value + COALESCE(v_asset_value, 0);
                    END LOOP;

                    v_cash_flow_impact := 0;
                    FOR tx IN
                        SELECT asset, action, quantity, asset_type
                        FROM transactions
                        WHERE date = v_date
                    LOOP
                        v_asset_type := get_asset_type_sql(tx.asset);
                        IF is_cash_like_sql(tx.asset) THEN
                            IF upper(tx.action) = 'DEPOSIT' THEN
                                v_cash_flow_impact := v_cash_flow_impact + cash_amount_to_usd_sql(tx.asset, tx.quantity, v_date);
                            ELSIF upper(tx.action) = 'WITHDRAW' THEN
                                v_cash_flow_impact := v_cash_flow_impact - cash_amount_to_usd_sql(tx.asset, tx.quantity, v_date);
                            END IF;
                        END IF;
                    END LOOP;

                    IF v_rows = 0 THEN
                        v_portfolio_daily_return := 0;
                        v_investment_return := 0;
                        v_adjusted_base := v_portfolio_value;
                        v_cash_flow_impact := 0;
                    ELSE
                        IF v_prev_value > 0 THEN
                            v_portfolio_daily_return := ((v_portfolio_value - v_prev_value) / v_prev_value) * 100;
                        ELSE
                            v_portfolio_daily_return := 0;
                        END IF;

                        IF v_adjusted_base > 0 THEN
                            v_investment_return := ((v_portfolio_value - v_prev_value - v_cash_flow_impact) / v_adjusted_base) * 100;
                        ELSE
                            v_investment_return := 0;
                        END IF;

                        v_adjusted_base := v_adjusted_base + v_cash_flow_impact;
                    END IF;

                    INSERT INTO daily_returns (
                        date,
                        portfolio_value,
                        portfolio_daily_return,
                        investment_return,
                        cash_flow_impact,
                        adjusted_base
                    )
                    VALUES (
                        v_date,
                        v_portfolio_value,
                        v_portfolio_daily_return,
                        v_investment_return,
                        v_cash_flow_impact,
                        v_adjusted_base
                    )
                    ON CONFLICT (date) DO UPDATE SET
                        portfolio_value = EXCLUDED.portfolio_value,
                        portfolio_daily_return = EXCLUDED.portfolio_daily_return,
                        investment_return = EXCLUDED.investment_return,
                        cash_flow_impact = EXCLUDED.cash_flow_impact,
                        adjusted_base = EXCLUDED.adjusted_base;

                    v_prev_value := v_portfolio_value;
                    v_rows := v_rows + 1;
                END LOOP;

                RETURN v_rows;
            END;
            $$;
        """)

    def _create_maintenance_functions(self):
        """Create lazy-recalc helper functions."""
        self.con.execute("""
            CREATE OR REPLACE FUNCTION needs_recalc()
            RETURNS BOOLEAN
            LANGUAGE sql
            STABLE
            AS $$
                SELECT CASE
                    WHEN (SELECT state_value FROM service_state
                          WHERE state_key = 'last_successful_recalc') IS NULL
                        THEN TRUE
                    WHEN (SELECT state_value FROM service_state
                          WHERE state_key = 'last_successful_price_refresh') IS NULL
                        THEN FALSE
                    ELSE
                        (SELECT state_value::timestamptz FROM service_state
                         WHERE state_key = 'last_successful_price_refresh')
                        >
                        (SELECT state_value::timestamptz FROM service_state
                         WHERE state_key = 'last_successful_recalc')
                END
            $$;
        """)

        self.con.execute("""
            CREATE OR REPLACE FUNCTION daily_maintenance_check()
            RETURNS VOID
            LANGUAGE plpgsql
            AS $$
            BEGIN
                IF COALESCE((SELECT MAX(date) FROM prices), DATE '1900-01-01') < CURRENT_DATE - 1 THEN
                    INSERT INTO service_state (state_key, state_value, updated_at)
                    VALUES ('prices_need_fetch', 'true', CURRENT_TIMESTAMP)
                    ON CONFLICT (state_key)
                    DO UPDATE SET state_value = 'true', updated_at = CURRENT_TIMESTAMP;
                END IF;

                IF needs_recalc() THEN
                    INSERT INTO service_state (state_key, state_value, updated_at)
                    VALUES ('needs_recalc', 'true', CURRENT_TIMESTAMP)
                    ON CONFLICT (state_key)
                    DO UPDATE SET state_value = 'true', updated_at = CURRENT_TIMESTAMP;
                END IF;
            END;
            $$;
        """)

        self.con.execute("""
            CREATE OR REPLACE FUNCTION get_required_price_checkpoints_sql(p_end_date DATE)
            RETURNS TABLE(ticker TEXT, checkpoint_date DATE)
            LANGUAGE sql
            STABLE
            AS $$
                SELECT DISTINCT t.asset::TEXT, t.date
                FROM transactions t
                WHERE t.action IN ('BUY', 'SELL')
                  AND get_asset_type_sql(t.asset) NOT IN ('cash_base', 'cash_fx')
                  AND t.asset NOT LIKE 'CASH %'

                UNION

                SELECT DISTINCT t.asset::TEXT, p_end_date
                FROM transactions t
                WHERE t.action IN ('BUY', 'SELL')
                  AND get_asset_type_sql(t.asset) NOT IN ('cash_base', 'cash_fx')
                  AND t.asset NOT LIKE 'CASH %'

                UNION

                SELECT DISTINCT
                    cash_currency_for_asset_type_sql(get_asset_type_sql(t.asset))::TEXT,
                    t.date
                FROM transactions t
                WHERE t.action IN ('BUY', 'SELL')
                  AND get_asset_type_sql(t.asset) IN (
                      'stock_eur', 'stock_gbp', 'stock_jpy', 'stock_chf',
                      'stock_cad', 'stock_aud', 'stock_hkd', 'stock_sgd'
                  )

                UNION

                SELECT DISTINCT
                    cash_currency_for_asset_type_sql(get_asset_type_sql(t.asset))::TEXT,
                    p_end_date
                FROM transactions t
                WHERE t.action IN ('BUY', 'SELL')
                  AND get_asset_type_sql(t.asset) IN (
                      'stock_eur', 'stock_gbp', 'stock_jpy', 'stock_chf',
                      'stock_cad', 'stock_aud', 'stock_hkd', 'stock_sgd'
                  )

                UNION

                SELECT DISTINCT
                    normalize_cash_asset_sql(t.asset, get_asset_type_sql(t.asset))::TEXT,
                    t.date
                FROM transactions t
                WHERE (get_asset_type_sql(t.asset) = 'cash_fx'
                   OR (t.asset LIKE 'CASH %' AND t.asset != 'CASH USD'))
                  AND normalize_cash_asset_sql(t.asset, get_asset_type_sql(t.asset)) != 'USD'

                UNION

                SELECT DISTINCT
                    normalize_cash_asset_sql(t.asset, get_asset_type_sql(t.asset))::TEXT,
                    p_end_date
                FROM transactions t
                WHERE (get_asset_type_sql(t.asset) = 'cash_fx'
                   OR (t.asset LIKE 'CASH %' AND t.asset != 'CASH USD'))
                  AND normalize_cash_asset_sql(t.asset, get_asset_type_sql(t.asset)) != 'USD'
            $$;
        """)

    def migrate_from_csv(self, csv_path: str):
        """Migrate transactions from CSV file."""
        # Read CSV with pandas to handle date parsing
        df = pd.read_csv(csv_path, sep=';')

        # Parse dates
        df['date'] = pd.to_datetime(df['date'], format='%d-%m-%Y')

        # Insert into PostgreSQL
        for _, row in df.iterrows():
            self.con.execute(
                """
                INSERT INTO transactions
                (date, asset, action, quantity, asset_type, price, currency, fees, fee_currency, exchange, data_source)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    row['date'].date(),
                    row['asset'],
                    row['action'].upper(),
                    float(row['quantity']),
                    row.get('asset_type', ''),
                    float(row['price']) if pd.notna(row.get('price')) else None,
                    row.get('currency', ''),
                    float(row['fees']) if pd.notna(row.get('fees')) else None,
                    row.get('fee_currency', ''),
                    row.get('exchange', ''),
                    row.get('dataSource', ''),
                ],
            )

        self.con.commit()

    def get_transactions(self):
        """Get all transactions."""
        return self.con.execute(
            """SELECT id, date, asset, action, quantity, asset_type, price, currency, fees, fee_currency, exchange, data_source,
                      account, created_at, updated_at
               FROM transactions ORDER BY date, id"""
        ).fetchall()

    def get_transactions_paginated(self, limit: int, offset: int, start_date=None, end_date=None):
        """Get transactions with optional date filter and pagination, ordered DESC then reversed."""
        params = []
        where = []
        if start_date:
            where.append("date >= %s")
            params.append(start_date)
        if end_date:
            where.append("date <= %s")
            params.append(end_date)
        where_clause = ("WHERE " + " AND ".join(where)) if where else ""

        count_row = self.con.execute(
            f"SELECT COUNT(*) FROM transactions {where_clause}", params
        ).fetchone()
        total = count_row[0] if count_row else 0

        params_page = params + [limit, offset]
        rows = self.con.execute(
            f"""SELECT id, date, asset, action, quantity, asset_type, price, currency, fees, fee_currency, exchange, data_source,
                       account, created_at, updated_at
                FROM transactions {where_clause} ORDER BY date DESC, id DESC LIMIT %s OFFSET %s""",
            params_page,
        ).fetchall()
        rows = list(reversed(rows))
        return rows, total

    def get_transaction_count(self):
        """Get total transaction count."""
        result = self.con.execute("SELECT COUNT(*) FROM transactions").fetchone()
        return result[0] if result else 0

    def get_unique_assets(self):
        """Get all unique assets from transactions."""
        result = self.con.execute("SELECT DISTINCT asset FROM transactions ORDER BY asset").fetchall()
        return [row[0] for row in result]

    def get_unique_currencies(self):
        """Get all unique currencies from transactions."""
        result = self.con.execute("SELECT DISTINCT currency FROM transactions WHERE currency IS NOT NULL ORDER BY currency").fetchall()
        return [row[0] for row in result if row[0] is not None]

    def _migrate_daily_returns_schema(self):
        """Migrate daily_returns table to include new columns if needed."""
        # Check if table exists
        table_exists = self._table_exists("daily_returns")

        if not table_exists:
            return  # Table doesn't exist yet, will be created by normal schema

        # Check which columns exist
        columns = self._table_info("daily_returns")
        column_names = {col[1] for col in columns}

        # Add missing columns
        missing_cols = {
            'investment_return': 'DOUBLE',
            'cash_flow_impact': 'DOUBLE',
            'adjusted_base': 'DOUBLE'
        }

        for col_name, col_type in missing_cols.items():
            if col_name not in column_names:
                try:
                    self.con.execute(f"ALTER TABLE daily_returns ADD COLUMN {col_name} {col_type}")
                except Exception:
                    pass  # Column might already exist

        self.con.commit()

    def _migrate_cash_format(self):
        """Migrate CASH format to Yahoo Finance format."""
        try:
            # Check if transactions table exists
            table_exists = self._table_exists("transactions")

            if not table_exists:
                return  # Table doesn't exist yet

            # Migrate CASH USD -> USD
            self.con.execute("""
                UPDATE transactions SET asset = 'USD' WHERE asset = 'CASH USD'
            """)

            # Migrate CASH EUR -> EURUSD=X
            self.con.execute("""
                UPDATE transactions SET asset = 'EURUSD=X' WHERE asset = 'CASH EUR'
            """)

            # Migrate CASH GBP -> GBPUSD=X
            self.con.execute("""
                UPDATE transactions SET asset = 'GBPUSD=X' WHERE asset = 'CASH GBP'
            """)

            # Migrate CASH UAH -> UAHUSD=X
            self.con.execute("""
                UPDATE transactions SET asset = 'UAHUSD=X' WHERE asset = 'CASH UAH'
            """)

            self.con.commit()
        except Exception:
            # Table might not exist yet on first run - this is expected
            # No action needed - schema will be created by _create_schema()
            pass

    def _migrate_transaction_audit_columns(self):
        """Add account, created_at, updated_at columns to transactions if missing."""
        try:
            table_exists = self._table_exists("transactions")
            if not table_exists:
                return

            columns = self._table_info("transactions")
            existing = {col[1] for col in columns}

            for col_name, col_def in [
                ('account', 'VARCHAR'),
                ('created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'),
                ('updated_at', 'TIMESTAMP'),
                ('fee_currency', 'VARCHAR(10)'),
            ]:
                if col_name not in existing:
                    self.con.execute(f"ALTER TABLE transactions ADD COLUMN IF NOT EXISTS {col_name} {col_def}")

            self.con.commit()
        except Exception as e:
            log.warning('_migrate_transaction_audit_columns failed: %s', e)

    def clear_transactions(self):
        """Clear all transactions."""
        self.con.execute("DELETE FROM transactions")
        self.con.commit()

    def get_price(self, ticker: str, date_obj) -> float:
        """Get price for ticker on specific date."""
        result = self.con.execute(
            "SELECT price FROM prices WHERE ticker = %s AND date = %s LIMIT 1",
            [ticker, date_obj],
        ).fetchone()
        return float(result[0]) if result else None

    def bulk_insert_prices(self, rows: list[tuple]) -> int:
        """Upsert (ticker, date, price) tuples in a single transaction.

        Args:
            rows: list of (ticker, date, price) tuples.
        Returns:
            Number of rows upserted.
        """
        if not rows:
            return 0
        self.con.executemany(
            """
            INSERT INTO prices (ticker, date, price)
            VALUES (%s, %s, %s)
            ON CONFLICT (date, ticker) DO UPDATE SET
                price = EXCLUDED.price
            """,
            rows,
        )
        self.con.commit()
        return len(rows)

    def insert_price(self, ticker: str, date_obj, price: float):
        """Insert price for ticker on specific date."""
        self.con.execute(
            """
            INSERT INTO prices (ticker, date, price)
            VALUES (%s, %s, %s)
            ON CONFLICT (date, ticker) DO UPDATE SET
                price = EXCLUDED.price
            """,
            [ticker, date_obj, price],
        )
        self.con.commit()

    def insert_daily_return(self, date_obj, portfolio_value: float, daily_return: float,
                           investment_return: float = None, cash_flow_impact: float = None,
                           adjusted_base: float = None):
        """Insert daily return record with separated return metrics."""
        self.con.execute(
            """
            INSERT INTO daily_returns
            (date, portfolio_value, portfolio_daily_return, investment_return, cash_flow_impact, adjusted_base)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (date) DO UPDATE SET
                portfolio_value = EXCLUDED.portfolio_value,
                portfolio_daily_return = EXCLUDED.portfolio_daily_return,
                investment_return = EXCLUDED.investment_return,
                cash_flow_impact = EXCLUDED.cash_flow_impact,
                adjusted_base = EXCLUDED.adjusted_base
            """,
            [date_obj, portfolio_value, daily_return, investment_return, cash_flow_impact, adjusted_base],
        )
        self.con.commit()

    _DAILY_RETURN_COLUMNS = ('date', 'portfolio_value', 'portfolio_daily_return',
                             'investment_return', 'cash_flow_impact', 'adjusted_base')

    def _normalize_daily_return_rows(self, rows) -> list[dict]:
        """Normalize calculator dicts or DB tuples into one bulk-insert shape."""
        cols = self._DAILY_RETURN_COLUMNS
        normalized = []
        for row in rows:
            if isinstance(row, dict):
                normalized.append({c: row.get(c) for c in cols})
            else:
                normalized.append(dict(zip(cols, row)))
        return normalized

    def replace_daily_returns(self, rows, start_date=None):
        """Replace all or part of daily_returns in one transaction."""
        batch_rows = self._normalize_daily_return_rows(rows)

        self.con.execute("BEGIN TRANSACTION")
        try:
            if start_date is None:
                self.con.execute("DELETE FROM daily_returns")
            else:
                self.con.execute(
                    "DELETE FROM daily_returns WHERE date >= %s",
                    [start_date],
                )

            if batch_rows:
                for row in batch_rows:
                    self.con.execute(
                        """
                        INSERT INTO daily_returns
                        (date, portfolio_value, portfolio_daily_return, investment_return, cash_flow_impact, adjusted_base)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (date) DO UPDATE SET
                            portfolio_value = EXCLUDED.portfolio_value,
                            portfolio_daily_return = EXCLUDED.portfolio_daily_return,
                            investment_return = EXCLUDED.investment_return,
                            cash_flow_impact = EXCLUDED.cash_flow_impact,
                            adjusted_base = EXCLUDED.adjusted_base
                        """,
                        [
                            row['date'],
                            row['portfolio_value'],
                            row['portfolio_daily_return'],
                            row['investment_return'],
                            row['cash_flow_impact'],
                            row['adjusted_base'],
                        ],
                    )

            self.con.commit()
        except Exception:
            self.con.rollback()
            raise

    def refresh_daily_returns_sql(self, from_date=None) -> int:
        """Rebuild daily_returns using the PostgreSQL stored procedure."""
        try:
            row = self.con.execute(
                "SELECT refresh_daily_returns_sql(%s)",
                [from_date],
            ).fetchone()
            self.con.commit()
            return int(row[0]) if row and row[0] is not None else 0
        except Exception as exc:
            self.con.rollback()
            message = str(exc).strip()
            raise ValueError(message) from exc

    def get_daily_returns(self):
        """Get all daily returns with separated metrics."""
        return self.con.execute(
            """SELECT date, portfolio_value, portfolio_daily_return, investment_return,
                      cash_flow_impact, adjusted_base FROM daily_returns ORDER BY date"""
        ).fetchall()

    def get_daily_returns_paginated(self, limit: int, offset: int, start_date=None, end_date=None):
        """Get daily returns with optional date filter and pagination, ordered DESC then reversed."""
        params = []
        where = []
        if start_date:
            where.append("date >= %s")
            params.append(start_date)
        if end_date:
            where.append("date <= %s")
            params.append(end_date)
        where_clause = ("WHERE " + " AND ".join(where)) if where else ""

        count_row = self.con.execute(
            f"SELECT COUNT(*) FROM daily_returns {where_clause}", params
        ).fetchone()
        total = count_row[0] if count_row else 0

        params_page = params + [limit, offset]
        rows = self.con.execute(
            f"""SELECT date, portfolio_value, portfolio_daily_return, investment_return,
                       cash_flow_impact, adjusted_base
                FROM daily_returns {where_clause}
                ORDER BY date DESC LIMIT %s OFFSET %s""",
            params_page,
        ).fetchall()
        rows = list(reversed(rows))
        return rows, total

    def clear_daily_returns(self):
        """Clear all daily returns."""
        self.con.execute("DELETE FROM daily_returns")
        self.con.commit()

    def get_date_range(self):
        """Get min and max dates from transactions."""
        result = self.con.execute(
            "SELECT MIN(date), MAX(date) FROM transactions"
        ).fetchone()
        return result if result else (None, None)

    def get_first_transaction_date(self):
        """Get the date of the first transaction."""
        result = self.con.execute(
            "SELECT MIN(date) FROM transactions"
        ).fetchone()
        return result[0] if result and result[0] else None

    def get_last_transaction_date(self):
        """Get the date of the last transaction."""
        result = self.con.execute(
            "SELECT MAX(date) FROM transactions"
        ).fetchone()
        return result[0] if result and result[0] else None

    def add_transaction(self, date, asset, action, quantity, asset_type=None, price=None, currency='USD', fees=None, fee_currency='', exchange='', data_source='', account=None) -> tuple:
        """
        Add single transaction and return (transaction_id, is_old_transaction).
        is_old_transaction = True if transaction date < last existing transaction date.
        """
        # Get last transaction date before insert
        last_date_result = self.con.execute(
            "SELECT MAX(date) FROM transactions"
        ).fetchone()
        last_date = last_date_result[0] if last_date_result and last_date_result[0] else None

        # Determine if this is an old transaction
        is_old = last_date is not None and date < last_date

        # Insert transaction
        result = self.con.execute(
            """
            INSERT INTO transactions
            (date, asset, action, quantity, asset_type, price, currency, fees, fee_currency, exchange, data_source, account)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            [date, asset, action.upper(), quantity, asset_type, price, currency, fees, fee_currency, exchange, data_source, account],
        ).fetchone()
        self.con.commit()
        trans_id = result[0] if result else None

        return (trans_id, is_old)

    def get_transaction_by_id(self, transaction_id: int):
        """Get a single transaction row by id."""
        return self.con.execute(
            """
            SELECT id, date, asset, action, quantity, asset_type, price, currency, fees, fee_currency, exchange, data_source,
                   account, created_at, updated_at
            FROM transactions
            WHERE id = %s
            """,
            [transaction_id],
        ).fetchone()

    def update_transaction(
        self,
        transaction_id: int,
        *,
        date,
        asset,
        action,
        quantity,
        asset_type=None,
        price=None,
        currency='USD',
        fees=None,
        exchange='',
        data_source='',
        account=None,
        fee_currency='',
    ):
        """Update a transaction row and return the refreshed record."""
        self.con.execute(
            """
            UPDATE transactions
            SET date = %s, asset = %s, action = %s, quantity = %s, asset_type = %s, price = %s,
                currency = %s, fees = %s, fee_currency = %s, exchange = %s, data_source = %s, account = %s,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = %s
            """,
            [date, asset, action.upper(), quantity, asset_type, price, currency, fees, fee_currency, exchange, data_source, account, transaction_id],
        )
        self.con.commit()
        return self.get_transaction_by_id(transaction_id)

    def get_transactions_in_range(self, start_date, end_date):
        """Get all transactions within an inclusive date range."""
        return self.con.execute(
            """
            SELECT id, date, asset, action, quantity, asset_type, price, currency, fees, fee_currency, exchange, data_source,
                   account, created_at, updated_at
            FROM transactions
            WHERE date >= %s AND date <= %s
            ORDER BY date, id
            """,
            [start_date, end_date],
        ).fetchall()

    def get_daily_returns_from_date(self, start_date):
        """Get daily returns from specific date onwards with separated metrics."""
        return self.con.execute(
            """SELECT date, portfolio_value, portfolio_daily_return, investment_return,
                      cash_flow_impact, adjusted_base FROM daily_returns WHERE date >= %s ORDER BY date""",
            [start_date],
        ).fetchall()

    def get_performance_stats_sql(self, as_of_date, benchmark_ticker: str, risk_free_rate_annual: float, from_date=None) -> dict:
        """Compute performance statistics directly in PostgreSQL."""
        row = self.con.execute(
            """
            WITH params AS (
                SELECT
                    %s::date AS as_of_date,
                    %s::text AS benchmark_ticker,
                    %s::double precision AS risk_free_rate,
                    %s::date AS from_date
            ),
            dr AS (
                SELECT d.date, d.portfolio_value, d.investment_return
                FROM daily_returns d
                CROSS JOIN params p
                WHERE d.portfolio_value > 0
                  AND (p.as_of_date IS NULL OR d.date <= p.as_of_date)
                  AND (p.from_date IS NULL OR d.date >= p.from_date)
                ORDER BY d.date
            ),
            dr_bounds AS (
                SELECT
                    COUNT(*)::integer AS total_days,
                    MIN(date) AS start_date,
                    MAX(date) AS end_date,
                    (ARRAY_AGG(portfolio_value ORDER BY date))[1] AS start_value,
                    (ARRAY_AGG(portfolio_value ORDER BY date DESC))[1] AS end_value,
                    AVG(investment_return) AS avg_daily_return,
                    STDDEV_POP(investment_return) AS std_dev,
                    PERCENTILE_CONT(0.05) WITHIN GROUP (ORDER BY investment_return) AS var_95,
                    PERCENTILE_CONT(0.01) WITHIN GROUP (ORDER BY investment_return) AS var_99,
                    EXP(SUM(LN(GREATEST(1.0 + investment_return / 100.0, 1e-12)))) - 1 AS twr
                FROM dr
            ),
            drawdowns AS (
                SELECT
                    date,
                    portfolio_value,
                    MAX(portfolio_value) OVER (
                        ORDER BY date
                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                    ) AS running_max
                FROM dr
            ),
            drawdown_values AS (
                SELECT
                    date,
                    CASE
                        WHEN running_max > 0 THEN ((running_max - portfolio_value) / running_max) * 100.0
                        ELSE 0.0
                    END AS drawdown
                FROM drawdowns
            ),
            drawdown_periods AS (
                SELECT grp, COUNT(*)::double precision AS duration
                FROM (
                    SELECT
                        date,
                        drawdown,
                        SUM(CASE WHEN drawdown = 0 THEN 1 ELSE 0 END) OVER (
                            ORDER BY date
                            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                        ) AS grp
                    FROM drawdown_values
                    WHERE drawdown > 0
                ) x
                GROUP BY grp
            ),
            drawdown_stats AS (
                SELECT
                    MAX(drawdown) AS max_drawdown,
                    AVG(drawdown) FILTER (WHERE drawdown > 0) AS avg_drawdown,
                    (SELECT AVG(duration) FROM drawdown_periods) AS avg_drawdown_duration
                FROM drawdown_values
            ),
            bench_prices AS (
                SELECT
                    p.date,
                    p.price,
                    LAG(p.price) OVER (ORDER BY p.date) AS prev_price
                FROM prices p
                CROSS JOIN params prm
                WHERE p.ticker = prm.benchmark_ticker
                  AND (prm.as_of_date IS NULL OR p.date <= prm.as_of_date)
                ORDER BY p.date
            ),
            bench_returns AS (
                SELECT
                    date,
                    ((price - prev_price) / prev_price) * 100.0 AS return_pct
                FROM bench_prices
                WHERE prev_price > 0
            ),
            bench_bounds AS (
                SELECT
                    (ARRAY_AGG(price ORDER BY date))[1] AS spy_start,
                    (ARRAY_AGG(price ORDER BY date DESC))[1] AS spy_end
                FROM bench_prices
            ),
            aligned AS (
                SELECT
                    d.date,
                    d.investment_return AS port_ret,
                    b.return_pct AS bench_ret
                FROM dr d
                INNER JOIN bench_returns b USING (date)
            ),
            aligned_avg AS (
                SELECT
                    AVG(port_ret) AS avg_port,
                    AVG(bench_ret) AS avg_spy
                FROM aligned
            ),
            aligned_metrics AS (
                SELECT
                    COUNT(*)::integer AS aligned_days,
                    AVG((a.port_ret - avg.avg_port) * (a.bench_ret - avg.avg_spy)) AS covariance,
                    AVG(POWER(a.bench_ret - avg.avg_spy, 2)) AS variance_market,
                    AVG(a.port_ret - a.bench_ret) AS avg_excess_daily,
                    SQRT(AVG(POWER(a.port_ret - a.bench_ret, 2))) AS tracking_error_daily,
                    SUM(CASE WHEN a.bench_ret > 0 THEN a.port_ret ELSE 0 END) AS up_port_sum,
                    SUM(CASE WHEN a.bench_ret > 0 THEN a.bench_ret ELSE 0 END) AS up_bench_sum,
                    SUM(CASE WHEN a.bench_ret < 0 THEN a.port_ret ELSE 0 END) AS down_port_sum,
                    SUM(CASE WHEN a.bench_ret < 0 THEN a.bench_ret ELSE 0 END) AS down_bench_sum
                FROM aligned a
                CROSS JOIN aligned_avg avg
            ),
            monthly_returns AS (
                SELECT
                    date_trunc('month', date)::date AS month_start,
                    EXP(SUM(LN(GREATEST(1.0 + investment_return / 100.0, 1e-12)))) - 1 AS month_return
                FROM dr
                GROUP BY 1
            ),
            monthly_median AS (
                SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY month_return) AS median_monthly_return
                FROM monthly_returns
            )
            SELECT
                dr_bounds.total_days,
                dr_bounds.start_date,
                dr_bounds.end_date,
                dr_bounds.start_value,
                dr_bounds.end_value,
                (dr_bounds.end_value - dr_bounds.start_value) AS total_gain,
                dr_bounds.avg_daily_return,
                dr_bounds.std_dev,
                dr_bounds.var_95,
                dr_bounds.var_99,
                drawdown_stats.max_drawdown,
                COALESCE(drawdown_stats.avg_drawdown, 0.0) AS avg_drawdown,
                COALESCE(drawdown_stats.avg_drawdown_duration, 0.0) AS avg_drawdown_duration,
                COALESCE(dr_bounds.twr * 100.0, 0.0) AS time_weighted_return_pct,
                COALESCE(dr_bounds.twr * 100.0, 0.0) AS total_return_pct,
                COALESCE(dr_bounds.twr, 0.0) AS twr_decimal,
                COALESCE(monthly_median.median_monthly_return * 100.0, 0.0) AS median_monthly_return,
                CASE
                    WHEN dr_bounds.start_date IS NOT NULL AND dr_bounds.end_date IS NOT NULL AND dr_bounds.end_date > dr_bounds.start_date THEN
                        ((dr_bounds.twr + 1.0) ^ (1.0 / ((dr_bounds.end_date - dr_bounds.start_date)::double precision / 365.25)) - 1.0) * 100.0
                    ELSE 0.0
                END AS cagr,
                COALESCE(aligned_metrics.aligned_days, 0) AS aligned_days,
                COALESCE(aligned_metrics.covariance, 0.0) AS covariance,
                COALESCE(aligned_metrics.variance_market, 0.0) AS variance_market,
                COALESCE(aligned_metrics.avg_excess_daily, 0.0) AS avg_excess_daily,
                COALESCE(aligned_metrics.tracking_error_daily, 0.0) AS tracking_error_daily,
                COALESCE(aligned_metrics.up_port_sum, 0.0) AS up_port_sum,
                COALESCE(aligned_metrics.up_bench_sum, 0.0) AS up_bench_sum,
                COALESCE(aligned_metrics.down_port_sum, 0.0) AS down_port_sum,
                COALESCE(aligned_metrics.down_bench_sum, 0.0) AS down_bench_sum,
                COALESCE(bench_bounds.spy_start, 0.0) AS spy_start,
                COALESCE(bench_bounds.spy_end, 0.0) AS spy_end
            FROM dr_bounds
            CROSS JOIN drawdown_stats
            CROSS JOIN aligned_metrics
            CROSS JOIN monthly_median
            CROSS JOIN bench_bounds
            """,
            [as_of_date, benchmark_ticker, risk_free_rate_annual, from_date],
        ).fetchone()

        if not row:
            return {}

        (
            total_days,
            start_date,
            end_date,
            start_value,
            end_value,
            total_gain,
            avg_daily_return,
            std_dev,
            var_95,
            var_99,
            max_drawdown,
            avg_drawdown,
            avg_drawdown_duration,
            time_weighted_return_pct,
            total_return_pct,
            twr_decimal,
            median_monthly_return,
            cagr,
            aligned_days,
            covariance,
            variance_market,
            avg_excess_daily,
            tracking_error_daily,
            up_port_sum,
            up_bench_sum,
            down_port_sum,
            down_bench_sum,
            spy_start,
            spy_end,
        ) = row

        rf = float(risk_free_rate_annual or 0.0)
        cagr_decimal = float(cagr) / 100.0
        hist_volatility = float(std_dev or 0.0) * (252 ** 0.5)
        cvar_95 = float(var_95 or 0.0)
        cvar_99 = float(var_99 or 0.0)

        tail_95 = self.con.execute(
            """
            WITH dr AS (
                SELECT investment_return
                FROM daily_returns
                WHERE portfolio_value > 0
                  AND (%s::date IS NULL OR date <= %s::date)
            ),
            threshold AS (
                SELECT PERCENTILE_CONT(0.05) WITHIN GROUP (ORDER BY investment_return) AS p95,
                       PERCENTILE_CONT(0.01) WITHIN GROUP (ORDER BY investment_return) AS p99
                FROM dr
            )
            SELECT
                COALESCE((SELECT AVG(investment_return) FROM dr, threshold WHERE investment_return <= threshold.p95), 0.0),
                COALESCE((SELECT AVG(investment_return) FROM dr, threshold WHERE investment_return <= threshold.p99), 0.0)
            """,
            [as_of_date, as_of_date],
        ).fetchone()
        if tail_95:
            cvar_95, cvar_99 = tail_95

        target_daily_pct = (rf / 252.0) * 100.0
        downside_row = self.con.execute(
            """
            WITH dr AS (
                SELECT investment_return
                FROM daily_returns
                WHERE portfolio_value > 0
                  AND (%s::date IS NULL OR date <= %s::date)
            )
            SELECT COALESCE(SQRT(AVG(POWER(investment_return - %s, 2)) FILTER (WHERE investment_return < %s)), 0.0)
            FROM dr
            """,
            [as_of_date, as_of_date, target_daily_pct, target_daily_pct],
        ).fetchone()
        downside_deviation_daily = float(downside_row[0]) if downside_row and downside_row[0] is not None else 0.0
        sortino_ratio = 0.0
        if downside_deviation_daily > 0:
            sortino_ratio = ((float(avg_daily_return or 0.0) - target_daily_pct) / downside_deviation_daily) * (252 ** 0.5)

        beta = float(covariance or 0.0) / float(variance_market or 0.0) if float(variance_market or 0.0) > 0 else 0.0
        spy_total_return = ((float(spy_end or 0.0) - float(spy_start or 0.0)) / float(spy_start or 0.0)) if float(spy_start or 0.0) > 0 else 0.0
        spy_twr_pct = spy_total_return * 100.0
        spy_cagr = 0.0
        if float(spy_start or 0.0) > 0 and float(spy_end or 0.0) > 0 and start_date and end_date and end_date > start_date and spy_total_return > -1:
            years = (end_date - start_date).days / 365.25
            if years > 0:
                spy_cagr = ((1.0 + spy_total_return) ** (1.0 / years) - 1.0)
        tracking_error_annual = float(tracking_error_daily or 0.0) * (252 ** 0.5) / 100.0
        avg_excess_annual = float(avg_excess_daily or 0.0) * 252.0 / 100.0
        information_ratio = (avg_excess_annual / tracking_error_annual) if tracking_error_annual > 0 else 0.0
        sharpe_ratio = ((cagr_decimal - rf) / (hist_volatility / 100.0)) if hist_volatility > 0 else 0.0
        treynor_ratio = ((cagr_decimal - rf) / beta) if beta != 0 else 0.0
        jensens_alpha = (cagr_decimal - (rf + beta * (spy_cagr - rf))) * 100.0
        relative_return = (cagr_decimal - spy_cagr) * 100.0
        up_capture = (float(up_port_sum or 0.0) / float(up_bench_sum or 0.0)) if float(up_bench_sum or 0.0) != 0 else 0.0
        down_capture = (float(down_port_sum or 0.0) / float(down_bench_sum or 0.0)) if float(down_bench_sum or 0.0) != 0 else 0.0

        return {
            'total_days': int(total_days or 0),
            'start_date': start_date,
            'end_date': end_date,
            'start_value': float(start_value or 0.0),
            'end_value': float(end_value or 0.0),
            'total_gain': float(total_gain or 0.0),
            'net_gain': float(total_gain or 0.0),
            'deposits': 0.0,
            'withdrawals': 0.0,
            'net_contributions': 0.0,
            'dividends': 0.0,
            'interest': 0.0,
            'fees': 0.0,
            'taxes': 0.0,
            'income': 0.0,
            'realized_gain': 0.0,
            'unrealized_gain': 0.0,
            'time_weighted_return_pct': float(time_weighted_return_pct or 0.0),
            'total_cash_flow': 0.0,
            'total_invested': 0.0,
            'total_return_pct': float(total_return_pct or 0.0),
            'avg_daily_return': float(avg_daily_return or 0.0),
            'median_monthly_return': float(median_monthly_return or 0.0),
            'cagr': float(cagr or 0.0),
            'avg_investment_return': float(avg_daily_return or 0.0),
            'std_dev': float(std_dev or 0.0),
            'hist_volatility': float(hist_volatility or 0.0),
            'beta': float(beta or 0.0),
            'sharpe_ratio': float(sharpe_ratio or 0.0),
            'sortino_ratio': float(sortino_ratio or 0.0),
            'treynor_ratio': float(treynor_ratio or 0.0),
            'information_ratio': float(information_ratio or 0.0),
            'jensens_alpha': float(jensens_alpha or 0.0),
            'relative_return': float(relative_return or 0.0),
            'tracking_error': float(tracking_error_annual * 100.0 if tracking_error_annual else 0.0),
            'var_95': float(var_95 or 0.0),
            'var_99': float(var_99 or 0.0),
            'cvar_95': float(cvar_95 or 0.0),
            'cvar_99': float(cvar_99 or 0.0),
            'max_drawdown': float(max_drawdown or 0.0),
            'avg_drawdown': float(avg_drawdown or 0.0),
            'avg_drawdown_duration': float(avg_drawdown_duration or 0.0),
            'spy_twr_pct': float(spy_twr_pct or 0.0),
            'spy_cagr_pct': float(spy_cagr * 100.0 if spy_cagr else 0.0),
            'up_capture_ratio': float(up_capture or 0.0),
            'down_capture_ratio': float(down_capture or 0.0),
        }

    def get_position_snapshot_rows(self, as_of_date, include_closed: bool = True):
        """Return position snapshot rows computed in PostgreSQL."""
        rows = self.con.execute(
            """
            WITH tx AS (
                SELECT
                    id,
                    date,
                    asset,
                    upper(action) AS action,
                    quantity,
                    asset_type,
                    price,
                    fees,
                    get_asset_type_sql(asset) AS resolved_asset_type
                FROM transactions
                WHERE date <= %s
            ),
            trades AS (
                SELECT
                    asset,
                    MIN(date) FILTER (WHERE action = 'BUY') AS first_buy_date,
                    SUM(CASE WHEN action = 'BUY' THEN quantity ELSE -quantity END) AS shares,
                    SUM(CASE WHEN action = 'BUY' THEN quantity ELSE 0 END) AS buy_quantity,
                    SUM(CASE WHEN action = 'BUY' THEN quantity * price + COALESCE(fees, 0) ELSE 0 END) AS buy_cost,
                    SUM(CASE WHEN action = 'SELL' THEN quantity ELSE 0 END) AS sell_quantity,
                    SUM(CASE WHEN action = 'SELL' THEN quantity * price - COALESCE(fees, 0) ELSE 0 END) AS sell_proceeds,
                    MAX(price) FILTER (WHERE price IS NOT NULL) AS last_price_from_trans,
                    MAX(resolved_asset_type) AS asset_type
                FROM tx
                WHERE action IN ('BUY', 'SELL')
                GROUP BY asset
            ),
            priced AS (
                SELECT
                    t.*,
                    latest.price AS latest_price,
                    prev.price AS prev_price,
                    fx_latest.price AS fx_latest_price,
                    fx_prev.price AS fx_prev_price
                FROM trades t
                LEFT JOIN LATERAL (
                    SELECT p.price
                    FROM prices p
                    WHERE p.ticker = t.asset AND p.date <= %s
                    ORDER BY p.date DESC
                    LIMIT 1
                ) latest ON TRUE
                LEFT JOIN LATERAL (
                    SELECT p.price
                    FROM prices p
                    WHERE p.ticker = t.asset AND p.date <= %s
                    ORDER BY p.date DESC
                    OFFSET 1
                    LIMIT 1
                ) prev ON TRUE
                LEFT JOIN LATERAL (
                    SELECT p.price
                    FROM prices p
                    WHERE p.ticker = cash_currency_for_asset_type_sql(t.asset_type) AND p.date <= %s
                    ORDER BY p.date DESC
                    LIMIT 1
                ) fx_latest ON TRUE
                LEFT JOIN LATERAL (
                    SELECT p.price
                    FROM prices p
                    WHERE p.ticker = cash_currency_for_asset_type_sql(t.asset_type) AND p.date <= %s
                    ORDER BY p.date DESC
                    OFFSET 1
                    LIMIT 1
                ) fx_prev ON TRUE
            )
            SELECT
                asset AS symbol,
                CASE WHEN shares > 0 THEN 'OPEN' ELSE 'CLOSED' END AS status,
                CASE WHEN ABS(shares) < 0.01 THEN 0.0 ELSE shares END AS shares,
                CASE
                    WHEN asset_type IN ('stock_eur', 'stock_gbp', 'stock_jpy', 'stock_chf', 'stock_cad', 'stock_aud', 'stock_hkd', 'stock_sgd')
                        THEN COALESCE(latest_price, last_price_from_trans) * COALESCE(fx_latest_price, 1.0)
                    ELSE COALESCE(latest_price, last_price_from_trans)
                END AS last_price,
                CASE WHEN buy_quantity > 0 THEN buy_cost / buy_quantity ELSE 0.0 END AS avg_cost_per_share,
                CASE WHEN shares > 0 THEN shares * (CASE WHEN buy_quantity > 0 THEN buy_cost / buy_quantity ELSE 0.0 END) ELSE 0.0 END AS total_cost,
                CASE
                    WHEN shares > 0 THEN shares * (
                        CASE
                            WHEN asset_type IN ('stock_eur', 'stock_gbp', 'stock_jpy', 'stock_chf', 'stock_cad', 'stock_aud', 'stock_hkd', 'stock_sgd')
                                THEN COALESCE(latest_price, last_price_from_trans) * COALESCE(fx_latest_price, 1.0)
                            ELSE COALESCE(latest_price, last_price_from_trans)
                        END
                    )
                    ELSE 0.0
                END AS market_value,
                0.0 AS dividend_income,
                CASE
                    WHEN shares > 0
                     AND latest_price IS NOT NULL
                     AND prev_price IS NOT NULL
                    THEN
                        (
                            (
                                CASE
                                    WHEN asset_type IN ('stock_eur', 'stock_gbp', 'stock_jpy', 'stock_chf', 'stock_cad', 'stock_aud', 'stock_hkd', 'stock_sgd')
                                        THEN COALESCE(latest_price, last_price_from_trans) * COALESCE(fx_latest_price, 1.0)
                                    ELSE COALESCE(latest_price, last_price_from_trans)
                                END
                                -
                                CASE
                                    WHEN asset_type IN ('stock_eur', 'stock_gbp', 'stock_jpy', 'stock_chf', 'stock_cad', 'stock_aud', 'stock_hkd', 'stock_sgd')
                                        THEN prev_price * COALESCE(fx_prev_price, 1.0)
                                    ELSE prev_price
                                END
                            )
                            /
                            NULLIF(
                                CASE
                                    WHEN asset_type IN ('stock_eur', 'stock_gbp', 'stock_jpy', 'stock_chf', 'stock_cad', 'stock_aud', 'stock_hkd', 'stock_sgd')
                                        THEN prev_price * COALESCE(fx_prev_price, 1.0)
                                    ELSE prev_price
                                END,
                                0
                            )
                        ) * 100.0
                    ELSE 0.0
                END AS day_gain_pct,
                CASE
                    WHEN shares > 0
                     AND latest_price IS NOT NULL
                     AND prev_price IS NOT NULL
                    THEN shares * (
                        (
                            CASE
                                WHEN asset_type IN ('stock_eur', 'stock_gbp', 'stock_jpy', 'stock_chf', 'stock_cad', 'stock_aud', 'stock_hkd', 'stock_sgd')
                                    THEN COALESCE(latest_price, last_price_from_trans) * COALESCE(fx_latest_price, 1.0)
                                ELSE COALESCE(latest_price, last_price_from_trans)
                            END
                            -
                            CASE
                                WHEN asset_type IN ('stock_eur', 'stock_gbp', 'stock_jpy', 'stock_chf', 'stock_cad', 'stock_aud', 'stock_hkd', 'stock_sgd')
                                    THEN prev_price * COALESCE(fx_prev_price, 1.0)
                                ELSE prev_price
                            END
                        )
                    )
                    ELSE 0.0
                END AS day_gain_value,
                CASE
                    WHEN shares > 0 THEN (
                        (
                            CASE
                                WHEN asset_type IN ('stock_eur', 'stock_gbp', 'stock_jpy', 'stock_chf', 'stock_cad', 'stock_aud', 'stock_hkd', 'stock_sgd')
                                    THEN COALESCE(latest_price, last_price_from_trans) * COALESCE(fx_latest_price, 1.0)
                                ELSE COALESCE(latest_price, last_price_from_trans)
                            END
                            * shares - (CASE WHEN buy_quantity > 0 THEN buy_cost / buy_quantity ELSE 0.0 END) * shares
                        ) / NULLIF((CASE WHEN buy_quantity > 0 THEN buy_cost / buy_quantity ELSE 0.0 END) * shares, 0)
                    ) * 100.0
                    ELSE 0.0
                END AS total_gain_pct,
                CASE
                    WHEN shares > 0 THEN
                        (
                            CASE
                                WHEN asset_type IN ('stock_eur', 'stock_gbp', 'stock_jpy', 'stock_chf', 'stock_cad', 'stock_aud', 'stock_hkd', 'stock_sgd')
                                    THEN COALESCE(latest_price, last_price_from_trans) * COALESCE(fx_latest_price, 1.0)
                                ELSE COALESCE(latest_price, last_price_from_trans)
                            END
                            * shares - (CASE WHEN buy_quantity > 0 THEN buy_cost / buy_quantity ELSE 0.0 END) * shares
                        )
                    ELSE 0.0
                END AS total_gain_value,
                CASE WHEN sell_quantity > 0 THEN sell_proceeds - (sell_quantity * CASE WHEN buy_quantity > 0 THEN buy_cost / buy_quantity ELSE 0.0 END) ELSE 0.0 END AS realized_gain_value,
                CASE WHEN sell_quantity > 0 AND buy_quantity > 0 THEN
                    (
                        sell_proceeds - (sell_quantity * (buy_cost / buy_quantity))
                    ) / NULLIF(sell_quantity * (buy_cost / buy_quantity), 0) * 100.0
                ELSE 0.0 END AS realized_gain_pct
            FROM priced
            WHERE %s::boolean OR shares <> 0
            ORDER BY market_value DESC, symbol
            """,
            [as_of_date, as_of_date, as_of_date, as_of_date, as_of_date, include_closed],
        ).fetchall()
        return rows

    def get_cash_snapshot_rows(self, as_of_date):
        """Return cash snapshot rows computed in PostgreSQL."""
        rows = self.con.execute(
            """
            WITH tx AS (
                SELECT
                    id,
                    date,
                    asset,
                    upper(action) AS action,
                    quantity,
                    price,
                    fees,
                    get_asset_type_sql(asset) AS resolved_asset_type
                FROM transactions
                WHERE date <= %s
            ),
            contribs AS (
                SELECT
                    CASE
                        WHEN upper(action) IN ('BUY', 'SELL') THEN get_cash_key_for_asset_sql(asset, resolved_asset_type)
                        WHEN upper(action) IN ('DEPOSIT', 'TRANSFER', 'DIVIDEND', 'INTEREST', 'WITHDRAW', 'FEE', 'TAX', 'EXCHANGE_FROM', 'EXCHANGE_TO')
                            AND (resolved_asset_type IN ('cash_base', 'cash_fx') OR asset LIKE 'CASH %%')
                            THEN normalize_cash_asset_sql(asset, resolved_asset_type)
                        ELSE NULL
                    END AS symbol,
                    SUM(CASE WHEN upper(action) = 'DEPOSIT' THEN quantity ELSE 0 END) AS deposits,
                    SUM(CASE WHEN upper(action) = 'TRANSFER' THEN quantity ELSE 0 END) AS transfers_in,
                    SUM(CASE WHEN upper(action) = 'WITHDRAW' THEN quantity ELSE 0 END) AS withdrawals,
                    SUM(CASE WHEN upper(action) = 'BUY' THEN quantity * price + COALESCE(fees, 0) ELSE 0 END) AS spent,
                    SUM(CASE WHEN upper(action) = 'SELL' THEN quantity * price - COALESCE(fees, 0) ELSE 0 END) AS received,
                    SUM(CASE WHEN upper(action) = 'DIVIDEND' THEN quantity ELSE 0 END) AS dividends,
                    SUM(CASE WHEN upper(action) = 'INTEREST' THEN quantity ELSE 0 END) AS interest,
                    SUM(CASE WHEN upper(action) = 'FEE' THEN quantity ELSE 0 END) AS fees,
                    SUM(CASE WHEN upper(action) = 'TAX' THEN quantity ELSE 0 END) AS taxes,
                    SUM(
                        CASE
                            WHEN upper(action) = 'DEPOSIT' THEN quantity
                            WHEN upper(action) = 'TRANSFER' THEN quantity
                            WHEN upper(action) = 'WITHDRAW' THEN -quantity
                            WHEN upper(action) = 'DIVIDEND' THEN quantity
                            WHEN upper(action) = 'INTEREST' THEN quantity
                            WHEN upper(action) = 'BUY' THEN -(quantity * price + COALESCE(fees, 0))
                            WHEN upper(action) = 'SELL' THEN quantity * price - COALESCE(fees, 0)
                            WHEN upper(action) = 'FEE' THEN -quantity
                            WHEN upper(action) = 'TAX' THEN -quantity
                            WHEN upper(action) = 'EXCHANGE_FROM' THEN quantity
                            WHEN upper(action) = 'EXCHANGE_TO' THEN quantity
                            ELSE 0
                        END
                    ) AS balance
                FROM tx
                GROUP BY symbol
            ),
            filtered AS (
                SELECT *
                FROM contribs
                WHERE symbol IS NOT NULL
            ),
            priced AS (
                SELECT
                    c.*,
                    CASE
                        WHEN symbol = 'USD' THEN 1.0
                        ELSE (
                            SELECT p.price
                            FROM prices p
                            WHERE p.ticker = c.symbol AND p.date <= %s
                            ORDER BY p.date DESC
                            LIMIT 1
                        )
                    END AS fx_rate,
                    (
                        SELECT p.price
                        FROM prices p
                        WHERE p.ticker = c.symbol AND p.date <= %s
                        ORDER BY p.date DESC
                        LIMIT 1
                    ) AS latest_px,
                    (
                        SELECT p.price
                        FROM prices p
                        WHERE p.ticker = c.symbol AND p.date <= %s
                        ORDER BY p.date DESC
                        OFFSET 1
                        LIMIT 1
                    ) AS prev_px
                FROM filtered c
            )
            SELECT
                symbol,
                CASE
                    WHEN symbol = 'USD' THEN 'USD'
                    WHEN symbol = 'EURUSD=X' THEN 'EUR'
                    WHEN symbol = 'GBPUSD=X' THEN 'GBP'
                    WHEN symbol = 'UAHUSD=X' THEN 'UAH'
                    WHEN symbol = 'JPYUSD=X' THEN 'JPY'
                    WHEN symbol = 'CHFUSD=X' THEN 'CHF'
                    WHEN symbol = 'CADUSD=X' THEN 'CAD'
                    WHEN symbol = 'AUDUSD=X' THEN 'AUD'
                    WHEN symbol = 'HKDUSD=X' THEN 'HKD'
                    WHEN symbol = 'SGDUSD=X' THEN 'SGD'
                    ELSE symbol
                END AS currency,
                balance,
                balance * COALESCE(fx_rate, 1.0) AS market_value,
                balance * COALESCE(fx_rate, 1.0) AS usd_value,
                COALESCE(fx_rate, 1.0) AS last_price,
                COALESCE(fx_rate, 1.0) AS fx_rate,
                deposits,
                transfers_in,
                withdrawals,
                spent,
                received,
                dividends,
                interest,
                fees,
                taxes,
                CASE
                    WHEN symbol <> 'USD' AND latest_px IS NOT NULL AND prev_px IS NOT NULL AND prev_px > 0
                    THEN ((latest_px - prev_px) / prev_px) * 100.0
                    ELSE 0.0
                END AS day_gain_pct,
                CASE
                    WHEN symbol <> 'USD' AND latest_px IS NOT NULL AND prev_px IS NOT NULL
                    THEN balance * (latest_px - prev_px)
                    ELSE 0.0
                END AS day_gain_value
            FROM priced
            ORDER BY market_value DESC, symbol
            """,
            [as_of_date, as_of_date, as_of_date, as_of_date],
        ).fetchall()
        return rows

    def get_allocation_rows(self, as_of_date, allocation_type: str = 'all'):
        """Return allocation rows computed from PostgreSQL-sourced snapshot rows."""
        allocation_mode = allocation_type if allocation_type in ('all', 'assets', 'cash') else 'all'
        summary_symbol = 'portfolio' if allocation_mode == 'all' else allocation_mode
        position_rows = self.get_position_snapshot_rows(as_of_date, include_closed=False)
        cash_rows = self.get_cash_snapshot_rows(as_of_date)

        source_rows = []
        for row in position_rows:
            source_rows.append({
                'symbol': row[0],
                'type': 'asset',
                'value': float(row[6] or 0.0),
                'original_currency_value': None,
                'fx_rate': None,
            })
        for row in cash_rows:
            source_rows.append({
                'symbol': row[0],
                'type': 'cash',
                'value': float(row[3] or 0.0),
                'original_currency_value': float(row[2] or 0.0),
                'fx_rate': float(row[6] or 1.0),
            })

        if not source_rows:
            return {
                'positions': [],
                'summary': [],
                'total_value': 0.0,
            }

        values_sql = ", ".join(["(%s, %s, %s, %s, %s)"] * len(source_rows))
        params = []
        for row in source_rows:
            params.extend([
                row['symbol'],
                row['type'],
                row['value'],
                row['original_currency_value'],
                row['fx_rate'],
            ])

        rows = self.con.execute(
            f"""
            WITH input(symbol, type, value, original_currency_value, fx_rate) AS (
                VALUES {values_sql}
            ),
            totals AS (
                SELECT
                    COALESCE(SUM(value), 0.0) AS total_value,
                    COALESCE(SUM(value) FILTER (WHERE type = 'asset'), 0.0) AS assets_value,
                    COALESCE(SUM(value) FILTER (WHERE type = 'cash'), 0.0) AS cash_value
                FROM input
            ),
            selected AS (
                SELECT *
                FROM input
                WHERE (
                    '{allocation_mode}' = 'all'
                    OR ('{allocation_mode}' = 'assets' AND type = 'asset')
                    OR ('{allocation_mode}' = 'cash' AND type = 'cash')
                )
            ),
            detailed AS (
                SELECT
                    symbol,
                    type,
                    value,
                    CASE
                        WHEN '{allocation_mode}' = 'all' THEN value / NULLIF(t.total_value, 0) * 100.0
                        WHEN type = 'asset' THEN value / NULLIF(t.assets_value, 0) * 100.0
                        ELSE value / NULLIF(t.cash_value, 0) * 100.0
                    END AS percentage,
                    original_currency_value,
                    fx_rate
                FROM selected
                CROSS JOIN totals t
            ),
            summary AS (
                SELECT
                    '{summary_symbol}' AS symbol,
                    'summary'::text AS type,
                    CASE WHEN '{allocation_mode}' = 'assets' THEN t.assets_value
                         WHEN '{allocation_mode}' = 'cash' THEN t.cash_value
                         ELSE t.total_value END AS value,
                    CASE
                        WHEN '{allocation_mode}' = 'all' THEN 100.0
                        WHEN '{allocation_mode}' = 'assets' THEN CASE WHEN t.assets_value > 0 THEN 100.0 ELSE 0.0 END
                        WHEN '{allocation_mode}' = 'cash' THEN CASE WHEN t.cash_value > 0 THEN 100.0 ELSE 0.0 END
                        ELSE 0.0
                    END AS percentage,
                    NULL::double precision AS original_currency_value,
                    NULL::double precision AS fx_rate
                FROM totals t
                WHERE '{allocation_mode}' = 'all' OR '{allocation_mode}' IN ('assets', 'cash')
            )
            SELECT symbol, type, value, percentage, original_currency_value, fx_rate
            FROM detailed
            UNION ALL
            SELECT symbol, type, value, percentage, original_currency_value, fx_rate
            FROM summary
            ORDER BY type DESC, value DESC, symbol
            """,
            params,
        ).fetchall()

        detailed = [row for row in rows if row[1] != 'summary']
        summary = [row for row in rows if row[1] == 'summary']
        total_value = 0.0
        if summary:
            total_value = float(summary[-1][2] or 0.0)
        else:
            total_value = float(sum(row[2] or 0.0 for row in detailed))
        return {
            'positions': detailed,
            'summary': summary,
            'total_value': total_value,
        }

    def get_contribution_by_position_rows(self, as_of_date):
        """Return per-position contribution rows computed in PostgreSQL."""
        position_rows = self.get_position_snapshot_rows(as_of_date, include_closed=True)
        cash_rows = self.get_cash_snapshot_rows(as_of_date)
        if not position_rows and not cash_rows:
            return []

        position_source = []
        for row in position_rows:
            position_source.append({
                'symbol': row[0],
                'status': row[1],
                'market_value': float(row[6] or 0.0),
                'unrealized_gain': float(row[11] or 0.0),
                'realized_gain': float(row[12] or 0.0),
            })
        for row in cash_rows:
            position_source.append({
                'symbol': row[0],
                'status': 'OPEN' if float(row[2] or 0.0) != 0 else 'CLOSED',
                'market_value': float(row[3] or 0.0),
                'unrealized_gain': 0.0,
                'realized_gain': 0.0,
            })

        cash_source = [
            {
                'deposits': float(row[7] or 0.0),
                'withdrawals': float(row[9] or 0.0),
            }
            for row in cash_rows
        ]

        if not position_source:
            return []

        position_values_sql = ", ".join(["(%s, %s, %s, %s, %s)"] * len(position_source))
        position_params = []
        for row in position_source:
            position_params.extend([
                row['symbol'],
                row['status'],
                row['market_value'],
                row['unrealized_gain'],
                row['realized_gain'],
            ])

        cash_values_sql = ", ".join(["(%s, %s)"] * len(cash_source)) if cash_source else None
        cash_params = []
        for row in cash_source:
            cash_params.extend([
                row['deposits'],
                row['withdrawals'],
            ])

        cash_values_clause = (
            f"VALUES {cash_values_sql}"
            if cash_values_sql is not None
            else "SELECT 0.0::double precision AS deposits, 0.0::double precision AS withdrawals WHERE FALSE"
        )

        sql = """
            WITH positions_input(symbol, status, market_value, unrealized_gain, realized_gain) AS (
                VALUES {position_values_sql}
            ),
            cash_input(deposits, withdrawals) AS (
                {cash_values_clause}
            ),
            totals AS (
                SELECT COALESCE(SUM(market_value), 0.0) AS portfolio_value
                FROM positions_input
            ),
            cash_totals AS (
                SELECT COALESCE(SUM(deposits), 0.0) - COALESCE(SUM(withdrawals), 0.0) AS net_contributions
                FROM cash_input
            )
            SELECT
                p.symbol,
                p.status,
                p.market_value,
                CASE
                    WHEN t.portfolio_value > 0 THEN ROUND((((p.market_value / t.portfolio_value) * 100.0))::numeric, 4)
                    ELSE 0.0
                END AS weight_pct,
                p.unrealized_gain,
                p.realized_gain,
                (p.unrealized_gain + p.realized_gain) AS total_gain,
                CASE
                    WHEN c.net_contributions > 0 THEN ROUND(((((p.unrealized_gain + p.realized_gain) / c.net_contributions) * 100.0))::numeric, 4)
                    ELSE 0.0
                END AS contribution_to_gain_pct
            FROM positions_input p
            CROSS JOIN totals t
            CROSS JOIN cash_totals c
            ORDER BY ABS(p.unrealized_gain + p.realized_gain) DESC, p.symbol
        """.format(position_values_sql=position_values_sql, cash_values_clause=cash_values_clause)

        params = position_params + cash_params

        rows = self.con.execute(sql, params).fetchall()
        return [
            {
                'symbol': row[0],
                'status': row[1],
                'market_value': float(row[2] or 0.0),
                'weight_pct': float(row[3] or 0.0),
                'unrealized_gain': float(row[4] or 0.0),
                'realized_gain': float(row[5] or 0.0),
                'total_gain': float(row[6] or 0.0),
                'contribution_to_gain_pct': float(row[7] or 0.0),
            }
            for row in rows
        ]

    def get_reporting_totals_sql(self, as_of_date) -> dict:
        """Return reporting totals computed from PostgreSQL-backed snapshot rows."""
        position_rows = self.get_position_snapshot_rows(as_of_date, include_closed=True)
        cash_rows = self.get_cash_snapshot_rows(as_of_date)
        if not position_rows and not cash_rows:
            return {
                'portfolio_value': 0.0,
                'deposits': 0.0,
                'transfers_in': 0.0,
                'withdrawals': 0.0,
                'net_contributions': 0.0,
                'dividends': 0.0,
                'interest': 0.0,
                'fees': 0.0,
                'taxes': 0.0,
                'income': 0.0,
                'realized_gain': 0.0,
                'unrealized_gain': 0.0,
                'total_profit': 0.0,
            }

        position_source = []
        for row in position_rows:
            position_source.append({
                'market_value': float(row[6] or 0.0),
                'realized_gain': float(row[12] or 0.0),
                'unrealized_gain': float(row[11] or 0.0),
            })
        for row in cash_rows:
            position_source.append({
                'market_value': float(row[3] or 0.0),
                'realized_gain': 0.0,
                'unrealized_gain': 0.0,
            })

        cash_source = [
            {
                'deposits': float(row[7] or 0.0),
                'transfers_in': float(row[8] or 0.0),
                'withdrawals': float(row[9] or 0.0),
                'dividends': float(row[12] or 0.0),
                'interest': float(row[13] or 0.0),
                'fees': float(row[14] or 0.0),
                'taxes': float(row[15] or 0.0),
            }
            for row in cash_rows
        ]

        position_values_sql = ", ".join(["(%s, %s, %s)"] * len(position_source))
        position_params = []
        for row in position_source:
            position_params.extend([
                row['market_value'],
                row['realized_gain'],
                row['unrealized_gain'],
            ])

        cash_values_sql = ", ".join(["(%s, %s, %s, %s, %s, %s, %s)"] * len(cash_source))
        cash_params = []
        for row in cash_source:
            cash_params.extend([
                row['deposits'],
                row['transfers_in'],
                row['withdrawals'],
                row['dividends'],
                row['interest'],
                row['fees'],
                row['taxes'],
            ])

        cash_values_clause = (
            f"VALUES {cash_values_sql}"
            if cash_source
            else "SELECT 0.0::double precision AS deposits, 0.0::double precision AS transfers_in, 0.0::double precision AS withdrawals, 0.0::double precision AS dividends, 0.0::double precision AS interest, 0.0::double precision AS fees, 0.0::double precision AS taxes WHERE FALSE"
        )

        rows = self.con.execute(
            f"""
            WITH positions_input(market_value, realized_gain, unrealized_gain) AS (
                VALUES {position_values_sql}
            ),
            cash_input(deposits, transfers_in, withdrawals, dividends, interest, fees, taxes) AS (
                {cash_values_clause}
            ),
            position_totals AS (
                SELECT
                    COALESCE(SUM(market_value), 0.0) AS portfolio_value,
                    COALESCE(SUM(realized_gain), 0.0) AS realized_gain,
                    COALESCE(SUM(unrealized_gain), 0.0) AS unrealized_gain
                FROM positions_input
            ),
            cash_totals AS (
                SELECT
                    COALESCE(SUM(deposits), 0.0) AS deposits,
                    COALESCE(SUM(transfers_in), 0.0) AS transfers_in,
                    COALESCE(SUM(withdrawals), 0.0) AS withdrawals,
                    COALESCE(SUM(dividends), 0.0) AS dividends,
                    COALESCE(SUM(interest), 0.0) AS interest,
                    COALESCE(SUM(fees), 0.0) AS fees,
                    COALESCE(SUM(taxes), 0.0) AS taxes
                FROM cash_input
            )
            SELECT
                p.portfolio_value,
                c.deposits,
                c.transfers_in,
                c.withdrawals,
                c.deposits - c.withdrawals AS net_contributions,
                c.dividends,
                c.interest,
                c.fees,
                c.taxes,
                c.dividends + c.interest AS income,
                p.realized_gain,
                p.unrealized_gain,
                p.realized_gain + p.unrealized_gain + (c.dividends + c.interest) - c.fees - c.taxes AS total_profit
            FROM position_totals p
            CROSS JOIN cash_totals c
            """,
            position_params + cash_params,
        ).fetchone()

        return {
            'portfolio_value': float(rows[0] or 0.0),
            'deposits': float(rows[1] or 0.0),
            'transfers_in': float(rows[2] or 0.0),
            'withdrawals': float(rows[3] or 0.0),
            'net_contributions': float(rows[4] or 0.0),
            'dividends': float(rows[5] or 0.0),
            'interest': float(rows[6] or 0.0),
            'fees': float(rows[7] or 0.0),
            'taxes': float(rows[8] or 0.0),
            'income': float(rows[9] or 0.0),
            'realized_gain': float(rows[10] or 0.0),
            'unrealized_gain': float(rows[11] or 0.0),
            'total_profit': float(rows[12] or 0.0),
        }

    def get_concentration_metrics_sql(self, as_of_date) -> dict:
        """Return concentration metrics computed from PostgreSQL-backed allocation rows."""
        allocation = self.get_allocation_rows(as_of_date, allocation_type='all')
        positions = [row for row in allocation['positions'] if row[1] in ('asset', 'cash')]
        total_value = float(allocation['total_value'] or 0.0)
        if total_value <= 0 or not positions:
            return {'hhi': 0.0, 'weighted_avg_exposure': 0.0, 'num_positions': 0}
        hhi = sum((float(row[2]) / total_value) ** 2 for row in positions)
        weighted_avg_exposure = sum(float(row[2]) / total_value for row in positions) / len(positions)
        return {
            'hhi': hhi,
            'weighted_avg_exposure': weighted_avg_exposure,
            'num_positions': len(positions),
        }

    def calculate_xirr_sql(self, as_of_date, terminal_value: float) -> float:
        """Calculate XIRR directly in PostgreSQL."""
        row = self.con.execute(
            """
            WITH flows AS (
                SELECT
                    date AS flow_date,
                    CASE
                        WHEN upper(action) = 'DEPOSIT' THEN -quantity
                        ELSE quantity
                    END AS amount
                FROM transactions
                WHERE date <= %s AND upper(action) IN ('DEPOSIT', 'WITHDRAW')
                UNION ALL
                SELECT %s::date AS flow_date, %s::double precision AS amount
            ),
            ordered AS (
                SELECT flow_date, amount
                FROM flows
                ORDER BY flow_date
            )
            SELECT
                ARRAY_AGG(flow_date ORDER BY flow_date),
                ARRAY_AGG(amount ORDER BY flow_date)
            FROM ordered
            """,
            [as_of_date, as_of_date, terminal_value],
        ).fetchone()

        if not row or not row[0] or len(row[0]) < 2:
            return 0.0

        dates = list(row[0])
        amounts = [float(v) for v in row[1]]
        if all(a <= 0 for a in amounts) or all(a >= 0 for a in amounts):
            return 0.0

        ref_date = dates[0]
        rate = 0.1

        def npv_for(candidate_rate: float) -> float:
            total = 0.0
            for amt, flow_date in zip(amounts, dates):
                day_diff = (flow_date - ref_date).days
                exponent = day_diff / 365.25
                denom = (1 + candidate_rate) ** exponent
                if denom == 0:
                    continue
                total += amt / denom
            return total

        for _ in range(200):
            npv = 0.0
            dnpv = 0.0
            for amt, flow_date in zip(amounts, dates):
                day_diff = (flow_date - ref_date).days
                exponent = day_diff / 365.25
                denom = (1 + rate) ** exponent
                if denom == 0:
                    continue
                npv += amt / denom
                dnpv += (-day_diff / 365.25) * amt / ((1 + rate) ** (exponent + 1))
            if abs(dnpv) < 1e-12:
                break
            new_rate = rate - npv / dnpv
            if new_rate <= -1:
                new_rate = -0.9999
            if abs(new_rate - rate) < 1e-7:
                rate = new_rate
                break
            rate = new_rate

        final_npv = npv_for(rate)
        if abs(final_npv) < 1.0:
            return round(float(rate), 8)

        # Newton can diverge for real-world portfolios with negative IRR or
        # very flat gradients. Fall back to a bracketed bisection search so we
        # still return a stable answer when a root exists in the admissible
        # range.
        low = -0.9999
        high = 0.1
        low_npv = npv_for(low)
        high_npv = npv_for(high)

        # Expand the upper bound until the sign changes or the search space is
        # clearly exhausted.
        expansion = 0
        while low_npv * high_npv > 0 and high < 1e6 and expansion < 60:
            high *= 2
            high_npv = npv_for(high)
            expansion += 1

        if low_npv * high_npv > 0:
            return 0.0

        for _ in range(200):
            mid = (low + high) / 2
            mid_npv = npv_for(mid)
            if abs(mid_npv) < 1.0 or abs(high - low) < 1e-7:
                return round(float(mid), 8)
            if low_npv * mid_npv <= 0:
                high = mid
                high_npv = mid_npv
            else:
                low = mid
                low_npv = mid_npv

        return round(float((low + high) / 2), 8)

    def delete_daily_returns_from_date(self, start_date):
        """Delete daily returns from specific date onwards."""
        self.con.execute(
            "DELETE FROM daily_returns WHERE date >= %s",
            [start_date],
        )
        self.con.commit()

    def log_refresh(self, refresh_type: str, rows_affected: int):
        """Log recalculation event to refresh_log table."""
        from datetime import date
        self.con.execute(
            """
            INSERT INTO refresh_log (refresh_date, refresh_type, rows_affected)
            VALUES (%s, %s, %s)
            """,
            [date.today(), refresh_type, rows_affected],
        )
        self.con.commit()

    def get_cache(self, cache_key: str):
        """Get cache entry if exists."""
        result = self.con.execute(
            "SELECT cache_key, last_calc_date, transaction_count FROM recalc_cache WHERE cache_key = %s",
            [cache_key],
        ).fetchone()
        return result

    def set_cache(self, cache_key: str, last_calc_date, transaction_count: int, prices_hash: str = None):
        """Store cache entry."""
        self.con.execute(
            """
            INSERT INTO recalc_cache (cache_key, last_calc_date, transaction_count, prices_hash)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (cache_key) DO UPDATE SET
                last_calc_date = EXCLUDED.last_calc_date,
                transaction_count = EXCLUDED.transaction_count,
                prices_hash = EXCLUDED.prices_hash,
                timestamp = CURRENT_TIMESTAMP
            """,
            [cache_key, last_calc_date, transaction_count, prices_hash],
        )
        self.con.commit()

    def clear_cache(self):
        """Clear all cache entries."""
        self.con.execute("DELETE FROM recalc_cache")
        self.con.commit()

    def get_prices_table_info(self):
        """Get information about prices table structure and statistics."""
        # Get table schema
        schema_result = self._table_info("prices")

        # Get record count
        count_result = self.con.execute(
            "SELECT COUNT(*) FROM prices"
        ).fetchone()

        # Get date range
        date_range_result = self.con.execute(
            "SELECT MIN(date), MAX(date) FROM prices"
        ).fetchone()

        return {
            'schema': schema_result,
            'total_records': count_result[0] if count_result else 0,
            'min_date': date_range_result[0] if date_range_result and date_range_result[0] else None,
            'max_date': date_range_result[1] if date_range_result and date_range_result[1] else None,
        }

    def get_prices_by_ticker_count(self):
        """Get count of prices per ticker for storage analysis."""
        result = self.con.execute(
            "SELECT ticker, COUNT(*) as record_count FROM prices GROUP BY ticker ORDER BY record_count DESC"
        ).fetchall()
        return result

    def get_price_coverage(self, ticker: str, start_date=None, end_date=None) -> dict:
        """Get cached coverage stats for one ticker and date range."""
        where = ["ticker = %s"]
        params = [ticker]
        if start_date is not None:
            where.append("date >= %s")
            params.append(start_date)
        if end_date is not None:
            where.append("date <= %s")
            params.append(end_date)

        row = self.con.execute(
            f"""
            SELECT
                COUNT(*) AS row_count,
                MIN(date) AS first_date,
                MAX(date) AS last_date
            FROM prices
            WHERE {' AND '.join(where)}
            """,
            params,
        ).fetchone()

        return {
            'ticker': ticker,
            'row_count': int(row[0]) if row and row[0] is not None else 0,
            'first_date': row[1] if row else None,
            'last_date': row[2] if row else None,
        }

    def get_price_series(self, tickers: list[str], start_date=None, end_date=None) -> dict:
        """Load cached prices as per-ticker pandas Series."""
        if not tickers:
            return {}

        placeholders = ", ".join(["%s"] * len(tickers))
        params = list(tickers)
        where = [f"ticker IN ({placeholders})"]

        if start_date is not None:
            where.append("date >= %s")
            params.append(start_date)
        if end_date is not None:
            where.append("date <= %s")
            params.append(end_date)

        rows = self.con.execute(
            f"""
            SELECT date, ticker, price
            FROM prices
            WHERE {' AND '.join(where)}
            ORDER BY date, ticker
            """,
            params,
        ).fetchall()

        if not rows:
            return {}

        by_ticker = {}
        for date_obj, ticker, price in rows:
            by_ticker.setdefault(ticker, []).append((pd.Timestamp(date_obj), float(price)))

        return {
            ticker: pd.Series(
                [value for _, value in entries],
                index=pd.DatetimeIndex([date_idx for date_idx, _ in entries]),
            ).sort_index()
            for ticker, entries in by_ticker.items()
        }

    def delete_transaction_by_id(self, transaction_id: int) -> bool:
        """Delete a transaction by ID."""
        # Check if transaction exists
        result = self.con.execute(
            "SELECT id FROM transactions WHERE id = %s",
            [transaction_id]
        ).fetchone()

        if not result:
            raise ValueError(f"Transaction ID {transaction_id} not found")

        # Delete the transaction
        self.con.execute(
            "DELETE FROM transactions WHERE id = %s",
            [transaction_id]
        )
        self.con.commit()
        return True

    def set_service_state(self, state_key: str, state_value):
        """Store a service state value as a string."""
        serialized = None if state_value is None else str(state_value)
        self.con.execute(
            """
            INSERT INTO service_state (state_key, state_value, updated_at)
            VALUES (%s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (state_key) DO UPDATE SET
                state_value = excluded.state_value,
                updated_at = excluded.updated_at
            """,
            [state_key, serialized],
        )
        self.con.commit()

    def get_service_state(self, state_key: str):
        """Get one service state value."""
        row = self.con.execute(
            "SELECT state_value, updated_at FROM service_state WHERE state_key = %s",
            [state_key],
        ).fetchone()
        if not row:
            return None
        return {'value': row[0], 'updated_at': row[1]}

    def get_all_service_state(self) -> dict:
        """Get all service state values."""
        rows = self.con.execute(
            "SELECT state_key, state_value, updated_at FROM service_state ORDER BY state_key"
        ).fetchall()
        return {
            key: {'value': value, 'updated_at': updated_at}
            for key, value, updated_at in rows
        }

    def log_price_repair(self, ticker: str, *, start_date=None, end_date=None, status: str, rows_loaded: int = 0, message: str = None):
        """Persist one repair attempt."""
        self.con.execute(
            """
            INSERT INTO repair_log (ticker, start_date, end_date, status, rows_loaded, message)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            [ticker, start_date, end_date, status, rows_loaded, message],
        )
        self.con.commit()

    def get_latest_repair_logs(self, limit: int = 50):
        """Return recent repair attempts."""
        return self.con.execute(
            """
            SELECT repair_id, ticker, start_date, end_date, status, rows_loaded, message, timestamp
            FROM repair_log
            ORDER BY timestamp DESC, repair_id DESC
            LIMIT %s
            """,
            [limit],
        ).fetchall()

    def re_insert_transaction_row(self, trans: tuple) -> None:
        """Re-insert a previously deleted transaction row for rollback.

        trans is the full tuple returned by get_transaction_by_id:
        (id, date, asset, action, quantity, asset_type, price, currency,
         fees, fee_currency, exchange, data_source, account, created_at, updated_at)
        """
        self.con.execute(
            """
            INSERT INTO transactions
            (id, date, asset, action, quantity, asset_type, price, currency,
             fees, fee_currency, exchange, data_source, account, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            [trans[0], trans[1], trans[2], trans[3], trans[4],
             trans[5], trans[6], trans[7], trans[8], trans[9],
             trans[10], trans[11], trans[12], trans[13], trans[14]],
        )
        self.con.commit()

    def get_net_holdings_as_of(self, asset: str, as_of_date, exclude_id: int = None) -> float:
        """Return net BUY-minus-SELL quantity for asset up to and including as_of_date.

        exclude_id: skip this transaction row (used by edit_transaction to exclude self).
        """
        if exclude_id is not None:
            row = self.con.execute(
                """
                SELECT COALESCE(SUM(CASE WHEN action = 'BUY' THEN quantity
                                         WHEN action = 'SELL' THEN -quantity
                                         ELSE 0 END), 0)
                FROM transactions
                WHERE asset = %s AND date <= %s AND id != %s
                """,
                [asset, as_of_date, exclude_id],
            ).fetchone()
        else:
            row = self.con.execute(
                """
                SELECT COALESCE(SUM(CASE WHEN action = 'BUY' THEN quantity
                                         WHEN action = 'SELL' THEN -quantity
                                         ELSE 0 END), 0)
                FROM transactions
                WHERE asset = %s AND date <= %s
                """,
                [asset, as_of_date],
            ).fetchone()
        return float(row[0]) if row else 0.0

    def count_transactions_excluding(self, exclude_id: int) -> int:
        """Return count of all transactions except the one with exclude_id."""
        row = self.con.execute(
            "SELECT COUNT(*) FROM transactions WHERE id != %s",
            [exclude_id],
        ).fetchone()
        return int(row[0]) if row else 0

    def get_earliest_other_transaction_date(self, exclude_id: int):
        """Return the earliest transaction date ignoring exclude_id, or None."""
        row = self.con.execute(
            "SELECT MIN(date) FROM transactions WHERE id != %s",
            [exclude_id],
        ).fetchone()
        return row[0] if row else None

    def dump_sql_backup(self, dst: Path) -> None:
        """Write a restorable SQL backup when pg_dump is unavailable.

        Uses psycopg's Identifier quoting to safely handle table/column names.
        Called by the CLI backup command as the pg_dump fallback.
        """
        from psycopg import sql as pgsql  # noqa: PLC0415

        table_columns = [
            ("transactions", ["id", "date", "asset", "action", "quantity", "asset_type", "price", "currency", "fees", "exchange", "data_source", "account", "created_at", "updated_at"]),
            ("prices", ["date", "ticker", "price"]),
            ("daily_returns", ["date", "portfolio_value", "portfolio_daily_return", "investment_return", "cash_flow_impact", "adjusted_base"]),
            ("refresh_log", ["refresh_id", "refresh_date", "refresh_type", "rows_affected", "timestamp"]),
            ("recalc_cache", ["cache_key", "last_calc_date", "transaction_count", "prices_hash", "timestamp"]),
            ("service_state", ["state_key", "state_value", "updated_at"]),
            ("repair_log", ["repair_id", "ticker", "start_date", "end_date", "status", "rows_loaded", "message", "timestamp"]),
        ]

        def _sql_literal(value) -> str:
            from datetime import datetime, date as date_cls
            if value is None:
                return "NULL"
            if isinstance(value, bool):
                return "TRUE" if value else "FALSE"
            if isinstance(value, datetime):
                return f"TIMESTAMP '{value.strftime('%Y-%m-%d %H:%M:%S.%f')}'"
            if isinstance(value, date_cls):
                return f"DATE '{value.isoformat()}'"
            if isinstance(value, (int, float)):
                if isinstance(value, float) and value != value:
                    return "NULL"
                return repr(value)
            return "'" + str(value).replace("'", "''") + "'"

        with dst.open("w", encoding="utf-8") as fp:
            fp.write("-- PostgreSQL backup generated by portfolio backup\n")
            fp.write("BEGIN;\n")
            for table, columns in table_columns:
                if not self._table_exists(table):
                    continue
                delete_stmt = pgsql.SQL("DELETE FROM {};").format(pgsql.Identifier(table))
                fp.write(delete_stmt.as_string(self.con._conn) + "\n")

                col_list = pgsql.SQL(", ").join([pgsql.Identifier(col) for col in columns])
                select_stmt = pgsql.SQL("SELECT {} FROM {} ORDER BY 1").format(
                    col_list,
                    pgsql.Identifier(table),
                )
                rows = self.con.execute(
                    select_stmt.as_string(self.con._conn)
                ).fetchall()
                for row in rows:
                    values = ", ".join(_sql_literal(v) for v in row)
                    insert_stmt = pgsql.SQL("INSERT INTO {} ({}) VALUES ({});").format(
                        pgsql.Identifier(table),
                        pgsql.SQL(", ").join([pgsql.Identifier(col) for col in columns]),
                        pgsql.SQL(values),
                    )
                    fp.write(insert_stmt.as_string(self.con._conn) + "\n")
            fp.write("COMMIT;\n")

    def needs_recalc(self) -> bool:
        """Return True if last price refresh is newer than last recalculation."""
        row = self.con.execute("SELECT needs_recalc()").fetchone()
        return bool(row[0]) if row else True

    def discover_assets_and_currencies(self) -> dict:
        """Discover all assets and required FX currencies from transactions via SQL."""
        rows = self.con.execute(
            "SELECT ticker, ticker_category FROM discover_required_tickers_sql()"
        ).fetchall()
        assets = []
        fx_currencies = []
        for ticker, category in rows:
            if category == 'asset':
                assets.append(ticker)
            else:
                fx_currencies.append(ticker)
        return {'assets': sorted(assets), 'fx_currencies': sorted(fx_currencies)}

    def get_required_price_checkpoints(self, end_date) -> dict:
        """Return per-ticker required price checkpoint dates up to end_date."""
        rows = self.con.execute(
            "SELECT ticker, checkpoint_date FROM get_required_price_checkpoints_sql(%s)",
            [end_date],
        ).fetchall()
        result: dict = {}
        for ticker, checkpoint_date in rows:
            result.setdefault(ticker, set()).add(checkpoint_date)
        return {ticker: sorted(dates) for ticker, dates in result.items()}

    def close(self):
        """Close database connection."""
        self.con.close()
