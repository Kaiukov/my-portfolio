"""DuckDB database setup and transaction management."""

import duckdb
from datetime import datetime, timedelta
import pandas as pd
from pathlib import Path


class PortfolioDatabase:
    """DuckDB-based portfolio database."""

    def __init__(self, db_path: str = "portfolio.db"):
        """Initialize database connection."""
        self.db_path = db_path
        self.con = duckdb.connect(db_path)
        self._create_schema()

    def _create_schema(self):
        """Create database schema if not exists."""
        # Create sequences first
        self.con.execute("""
            CREATE SEQUENCE IF NOT EXISTS seq_transaction_id START 1 INCREMENT 1
        """)

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

        # Create daily returns table
        self.con.execute("""
            CREATE TABLE IF NOT EXISTS daily_returns (
                date DATE PRIMARY KEY,
                portfolio_value DOUBLE NOT NULL,
                portfolio_daily_return DOUBLE
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

    def get_transaction_count(self):
        """Get total transaction count."""
        result = self.con.execute("SELECT COUNT(*) FROM transactions").fetchone()
        return result[0] if result else 0

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

    def insert_daily_return(self, date_obj, portfolio_value: float, daily_return: float):
        """Insert daily return record."""
        self.con.execute(
            """
            INSERT OR REPLACE INTO daily_returns (date, portfolio_value, portfolio_daily_return)
            VALUES (?, ?, ?)
            """,
            [date_obj, portfolio_value, daily_return],
        )
        self.con.commit()

    def get_daily_returns(self):
        """Get all daily returns."""
        return self.con.execute(
            "SELECT date, portfolio_value, portfolio_daily_return FROM daily_returns ORDER BY date"
        ).fetchall()

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

    def close(self):
        """Close database connection."""
        self.con.close()
