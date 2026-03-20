"""DuckDB database setup and transaction management."""

import duckdb
from datetime import datetime, timedelta
import pandas as pd
from pathlib import Path


class PortfolioDatabase:
    """DuckDB-based portfolio database."""

    def __init__(self, db_path: str = "portfolio.db", read_only: bool = False):
        """Initialize database connection."""
        self.db_path = db_path
        self.read_only = read_only
        self.con = duckdb.connect(db_path, read_only=read_only)
        if not read_only:
            self._create_schema()

    def _create_schema(self):
        """Create database schema if not exists."""
        # Create sequences first
        self.con.execute("""
            CREATE SEQUENCE IF NOT EXISTS seq_transaction_id START 1 INCREMENT 1
        """)

        # Migrate existing daily_returns table if needed
        self._migrate_daily_returns_schema()

        # Migrate CASH format to Yahoo format
        self._migrate_cash_format()

        # Create transactions table
        self.con.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY DEFAULT nextval('seq_transaction_id'),
                date DATE NOT NULL,
                asset VARCHAR NOT NULL,
                action VARCHAR NOT NULL,
                quantity DOUBLE NOT NULL,
                asset_type VARCHAR,
                price DOUBLE,
                currency VARCHAR,
                fees DOUBLE,
                exchange VARCHAR,
                data_source VARCHAR
            )
        """)

        # Create prices table
        self.con.execute("""
            CREATE TABLE IF NOT EXISTS prices (
                date DATE NOT NULL,
                ticker VARCHAR NOT NULL,
                price DOUBLE NOT NULL,
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
                portfolio_value DOUBLE NOT NULL,
                portfolio_daily_return DOUBLE,
                investment_return DOUBLE,
                cash_flow_impact DOUBLE,
                adjusted_base DOUBLE
            )
        """)

        # Create refresh log table
        self.con.execute("""
            CREATE TABLE IF NOT EXISTS refresh_log (
                refresh_id INTEGER PRIMARY KEY DEFAULT nextval('seq_transaction_id'),
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

        self.con.commit()

    def migrate_from_csv(self, csv_path: str):
        """Migrate transactions from CSV file."""
        # Read CSV with pandas to handle date parsing
        df = pd.read_csv(csv_path, sep=';')

        # Parse dates
        df['date'] = pd.to_datetime(df['date'], format='%d-%m-%Y')

        # Insert into DuckDB
        for _, row in df.iterrows():
            self.con.execute(
                """
                INSERT INTO transactions
                (date, asset, action, quantity, asset_type, price, currency, fees, exchange, data_source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    row.get('exchange', ''),
                    row.get('dataSource', ''),
                ],
            )

        self.con.commit()

    def get_transactions(self):
        """Get all transactions."""
        return self.con.execute(
            "SELECT * FROM transactions ORDER BY date, id"
        ).fetchall()

    def get_transactions_paginated(self, limit: int, offset: int, start_date=None, end_date=None):
        """Get transactions with optional date filter and pagination, ordered DESC then reversed."""
        params = []
        where = []
        if start_date:
            where.append("date >= ?")
            params.append(start_date)
        if end_date:
            where.append("date <= ?")
            params.append(end_date)
        where_clause = ("WHERE " + " AND ".join(where)) if where else ""

        count_row = self.con.execute(
            f"SELECT COUNT(*) FROM transactions {where_clause}", params
        ).fetchone()
        total = count_row[0] if count_row else 0

        params_page = params + [limit, offset]
        rows = self.con.execute(
            f"SELECT * FROM transactions {where_clause} ORDER BY date DESC, id DESC LIMIT ? OFFSET ?",
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
        table_exists = self.con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='daily_returns'"
        ).fetchone()

        if not table_exists:
            return  # Table doesn't exist yet, will be created by normal schema

        # Check which columns exist
        columns = self.con.execute("PRAGMA table_info(daily_returns)").fetchall()
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
            table_exists = self.con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='transactions'"
            ).fetchone()

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

    def clear_transactions(self):
        """Clear all transactions."""
        self.con.execute("DELETE FROM transactions")
        self.con.commit()

    def get_price(self, ticker: str, date_obj) -> float:
        """Get price for ticker on specific date."""
        result = self.con.execute(
            "SELECT price FROM prices WHERE ticker = ? AND date = ? LIMIT 1",
            [ticker, date_obj],
        ).fetchone()
        return float(result[0]) if result else None

    def insert_price(self, ticker: str, date_obj, price: float):
        """Insert price for ticker on specific date."""
        self.con.execute(
            """
            INSERT OR REPLACE INTO prices (ticker, date, price)
            VALUES (?, ?, ?)
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
            INSERT OR REPLACE INTO daily_returns
            (date, portfolio_value, portfolio_daily_return, investment_return, cash_flow_impact, adjusted_base)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [date_obj, portfolio_value, daily_return, investment_return, cash_flow_impact, adjusted_base],
        )
        self.con.commit()

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
            where.append("date >= ?")
            params.append(start_date)
        if end_date:
            where.append("date <= ?")
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
                ORDER BY date DESC LIMIT ? OFFSET ?""",
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

    def add_transaction(self, date, asset, action, quantity, asset_type=None, price=None, currency='USD', fees=None, exchange='', data_source='') -> tuple:
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
            (date, asset, action, quantity, asset_type, price, currency, fees, exchange, data_source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            """,
            [date, asset, action.upper(), quantity, asset_type, price, currency, fees, exchange, data_source],
        ).fetchone()
        self.con.commit()
        trans_id = result[0] if result else None

        return (trans_id, is_old)

    def get_last_transaction_date(self):
        """Get date of most recent transaction."""
        result = self.con.execute(
            "SELECT MAX(date) FROM transactions"
        ).fetchone()
        return result[0] if result and result[0] else None

    def get_daily_returns_from_date(self, start_date):
        """Get daily returns from specific date onwards with separated metrics."""
        return self.con.execute(
            """SELECT date, portfolio_value, portfolio_daily_return, investment_return,
                      cash_flow_impact, adjusted_base FROM daily_returns WHERE date >= ? ORDER BY date""",
            [start_date],
        ).fetchall()

    def delete_daily_returns_from_date(self, start_date):
        """Delete daily returns from specific date onwards."""
        self.con.execute(
            "DELETE FROM daily_returns WHERE date >= ?",
            [start_date],
        )
        self.con.commit()

    def log_refresh(self, refresh_type: str, rows_affected: int):
        """Log recalculation event to refresh_log table."""
        from datetime import date
        self.con.execute(
            """
            INSERT INTO refresh_log (refresh_date, refresh_type, rows_affected)
            VALUES (?, ?, ?)
            """,
            [date.today(), refresh_type, rows_affected],
        )
        self.con.commit()

    def get_cache(self, cache_key: str):
        """Get cache entry if exists."""
        result = self.con.execute(
            "SELECT cache_key, last_calc_date, transaction_count FROM recalc_cache WHERE cache_key = ?",
            [cache_key],
        ).fetchone()
        return result

    def set_cache(self, cache_key: str, last_calc_date, transaction_count: int, prices_hash: str = None):
        """Store cache entry."""
        self.con.execute(
            """
            INSERT OR REPLACE INTO recalc_cache (cache_key, last_calc_date, transaction_count, prices_hash)
            VALUES (?, ?, ?, ?)
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
        schema_result = self.con.execute(
            "PRAGMA table_info(prices)"
        ).fetchall()

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

    def delete_transaction_by_id(self, transaction_id: int) -> bool:
        """Delete a transaction by ID."""
        # Check if transaction exists
        result = self.con.execute(
            "SELECT id FROM transactions WHERE id = ?",
            [transaction_id]
        ).fetchone()

        if not result:
            raise ValueError(f"Transaction ID {transaction_id} not found")

        # Delete the transaction
        self.con.execute(
            "DELETE FROM transactions WHERE id = ?",
            [transaction_id]
        )
        self.con.commit()
        return True

    def close(self):
        """Close database connection."""
        self.con.close()
