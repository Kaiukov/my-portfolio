
"""DuckDB database setup and management for portfolio tracking."""

import duckdb
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, List, Tuple
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class PortfolioDatabase:
    """Manage DuckDB connection and schema for portfolio data."""

    def __init__(self, db_path: str = "portfolio.db"):
        self.db_path = Path(db_path)
        self.connection = self._connect()
        self._setup_schema()

    def _connect(self) -> duckdb.DuckDBPyConnection:
        """Establish DuckDB connection."""
        conn = duckdb.connect(str(self.db_path))
        logger.info(f"✓ Connected to {self.db_path}")
        return conn

    def _setup_schema(self):
        """Create database schema if not exists."""
        self.connection.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                date DATE NOT NULL,
                asset VARCHAR NOT NULL,
                action VARCHAR NOT NULL,
                quantity DOUBLE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (date, asset, action, quantity)
            );
        """)

        self.connection.execute("""
            CREATE TABLE IF NOT EXISTS prices (
                date DATE NOT NULL,
                ticker VARCHAR NOT NULL,
                price DOUBLE NOT NULL,
                source VARCHAR DEFAULT 'yfinance',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (date, ticker)
            );
        """)

        self.connection.execute("""
            CREATE TABLE IF NOT EXISTS daily_returns (
                date DATE NOT NULL PRIMARY KEY,
                portfolio_value DOUBLE NOT NULL,
                daily_return_pct DOUBLE,
                calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        self.connection.execute("""
            CREATE TABLE IF NOT EXISTS refresh_log (
                id UINTEGER PRIMARY KEY DEFAULT nextval('seq_refresh_id'),
                refresh_type VARCHAR NOT NULL,
                reason VARCHAR,
                rows_affected UINTEGER,
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP
            );
        """)

        self.connection.execute("""
            CREATE SEQUENCE IF NOT EXISTS seq_refresh_id START 1;
        """)

        logger.info("✓ Schema initialized")

    def migrate_from_csv(self, csv_path: str):
        """Import transactions from CSV file."""
        logger.info(f"Migrating from {csv_path}...")

        # Clear existing transactions
        self.connection.execute("DELETE FROM transactions;")

        # Import with proper date parsing
        self.connection.execute(f"""
            INSERT INTO transactions (date, asset, action, quantity)
            SELECT
                strptime(date, '%d-%m-%Y')::DATE as date,
                asset,
                UPPER(action) as action,
                CAST(quantity AS DOUBLE) as quantity
            FROM read_csv_auto('{csv_path}', sep=';')
        """)

        count = self.connection.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
        logger.info(f"✓ Imported {count} transactions")

    def insert_prices(self, prices_data: dict):
        """Insert price data. prices_data format: {ticker: [(date, price), ...]}"""
        for ticker, prices in prices_data.items():
            for date, price in prices:
                try:
                    self.connection.execute(
                        "INSERT OR IGNORE INTO prices (date, ticker, price) VALUES (?, ?, ?)",
                        [date, ticker, price]
                    )
                except Exception as e:
                    logger.warning(f"Error inserting price for {ticker} on {date}: {e}")

    def get_transactions_count(self) -> int:
        """Get total transaction count."""
        result = self.connection.execute("SELECT COUNT(*) FROM transactions").fetchone()
        return result[0] if result else 0

    def get_date_range(self) -> Tuple[Optional[datetime], Optional[datetime]]:
        """Get portfolio date range."""
        result = self.connection.execute("""
            SELECT MIN(date), MAX(date) FROM transactions
        """).fetchone()
        return result if result and result[0] else (None, None)

    def get_unique_assets(self) -> List[str]:
        """Get all unique assets including CASH-* variants."""
        result = self.connection.execute("""
            SELECT DISTINCT asset FROM transactions ORDER BY asset
        """).fetchall()
        return [row[0] for row in result]

    def get_cash_assets(self) -> List[str]:
        """Get all CASH-* assets."""
        result = self.connection.execute("""
            SELECT DISTINCT asset FROM transactions
            WHERE asset LIKE 'CASH-%'
            ORDER BY asset
        """).fetchall()
        return [row[0] for row in result]

    def get_last_modified(self) -> Optional[datetime]:
        """Get last transaction modification date."""
        result = self.connection.execute("""
            SELECT MAX(created_at) FROM transactions
        """).fetchone()
        return result[0] if result and result[0] else None

    def get_daily_returns(self, start_date: Optional[str] = None,
                         end_date: Optional[str] = None) -> List[dict]:
        """Fetch calculated daily returns - matches portfolio_daily_returns.json structure."""
        query = "SELECT date, portfolio_value, daily_return_pct FROM daily_returns"

        filters = []
        if start_date:
            filters.append(f"date >= '{start_date}'")
        if end_date:
            filters.append(f"date <= '{end_date}'")

        if filters:
            query += " WHERE " + " AND ".join(filters)

        query += " ORDER BY date"

        results = self.connection.execute(query).fetchall()
        return [
            {
                'date': str(row[0]),
                'portfolio_value': float(row[1]),
                'portfolio_daily_return': float(row[2]) if row[2] is not None else 0.0
            }
            for row in results
        ]

    def clear_daily_returns(self):
        """Clear daily returns table for recalculation."""
        self.connection.execute("DELETE FROM daily_returns;")
        logger.info("✓ Cleared daily returns cache")

    def log_refresh(self, refresh_type: str, reason: str, rows_affected: int):
        """Log refresh operation."""
        self.connection.execute("""
            INSERT INTO refresh_log (refresh_type, reason, rows_affected, completed_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        """, [refresh_type, reason, rows_affected])

    def close(self):
        """Close database connection."""
        if self.connection:
            self.connection.close()
            logger.info("✓ Database connection closed")
