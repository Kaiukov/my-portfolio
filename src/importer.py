"""CSV import from Interactive Brokers format."""

import csv
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Optional

from src.models import Transaction, AssetType, TransactionType
from src.storage import TransactionStorage


class SimplifiedPortfolioImporter:
    """Imports transactions from simplified portfolio CSV format."""

    @staticmethod
    def import_csv(
        csv_path: str,
        storage: TransactionStorage,
        clear_first: bool = False,
    ) -> int:
        """
        Import transactions from simplified portfolio CSV.
        Expected columns: date, asset, asset_type, action, quantity, price, currency, fees, exchange

        Args:
            csv_path: Path to CSV file
            storage: TransactionStorage instance
            clear_first: Clear existing transactions before import

        Returns:
            Number of transactions imported
        """
        if clear_first:
            storage.clear_all()

        count = 0

        try:
            with open(csv_path, "r") as f:
                reader = csv.DictReader(f)

                for row in reader:
                    try:
                        # Parse required fields
                        date_str = row.get("date", "").strip()
                        asset = row.get("asset", "").strip()
                        asset_type_str = row.get("asset_type", "").strip()
                        action_str = row.get("action", "").strip()
                        quantity_str = row.get("quantity", "0").strip()
                        price_str = row.get("price", "0").strip()
                        currency = row.get("currency", "USD").strip() or "USD"
                        fees_str = row.get("fees", "0").strip()
                        exchange = row.get("exchange", "").strip()

                        # Validate required fields
                        if not date_str or not asset or not asset_type_str or not action_str:
                            continue

                        # Parse date (format: YYYY-MM-DD)
                        try:
                            txn_date = datetime.strptime(date_str, "%Y-%m-%d").date()
                        except ValueError:
                            continue

                        # Parse asset type
                        try:
                            asset_type = AssetType(asset_type_str.lower())
                        except ValueError:
                            continue

                        # Parse transaction type
                        try:
                            action = TransactionType(action_str.lower())
                        except ValueError:
                            continue

                        # Parse quantity and price
                        try:
                            quantity = Decimal(quantity_str or "0")
                            price = Decimal(price_str or "0")
                            fees = Decimal(fees_str or "0")
                        except Exception:
                            continue

                        # Validate quantity and price
                        if quantity <= 0:
                            continue

                        fees = abs(fees)  # Ensure fees are positive

                        # Create transaction
                        txn = Transaction(
                            date=txn_date,
                            asset=asset,
                            asset_type=asset_type,
                            action=action,
                            quantity=quantity,
                            price=price,
                            currency=currency,
                            fees=fees,
                            exchange=exchange,
                        )

                        storage.add_transaction(txn)
                        count += 1

                    except Exception:
                        # Skip problematic rows
                        continue

        except FileNotFoundError:
            print(f"Error: File not found: {csv_path}")
            return 0
        except Exception as e:
            print(f"Error reading CSV: {e}")
            return 0

        return count


class InteractiveBrokersImporter:
    """Imports transactions from Interactive Brokers CSV format."""

    # Map of currency suffixes to currency codes
    CURRENCY_SUFFIXES = {
        ".DE": "EUR",   # Deutsche Börse
        ".L": "GBP",    # London Stock Exchange
        ".MI": "EUR",   # Borsa Italiana
        ".PA": "EUR",   # Euronext Paris
    }

    # Crypto symbols
    CRYPTO_SYMBOLS = {"BTC", "ETH", "BNB", "XRP", "ADA", "DOGE", "SOL", "PAXG"}

    @staticmethod
    def detect_asset_type(symbol: str) -> Optional[AssetType]:
        """Detect asset type from symbol."""
        if symbol == "$$CASH_TX":
            return AssetType.CASH

        # Check if crypto (contains hyphen and ends with USD/EUR/GBP)
        if "-" in symbol:
            base = symbol.split("-")[0]
            if base.upper() in InteractiveBrokersImporter.CRYPTO_SYMBOLS:
                return AssetType.CRYPTO

        # Check for currency suffixes (European stocks)
        for suffix in InteractiveBrokersImporter.CURRENCY_SUFFIXES:
            if symbol.endswith(suffix):
                return AssetType.STOCK

        # Default to STOCK (includes ETFs - can't distinguish in CSV)
        return AssetType.STOCK

    @staticmethod
    def detect_currency(symbol: str) -> str:
        """Detect currency from symbol."""
        # Handle crypto symbols (BTC-USD, ETH-EUR, etc.)
        if "-" in symbol:
            parts = symbol.split("-")
            if len(parts) == 2:
                return parts[1].upper()

        # Check for European stock suffixes
        for suffix, currency in InteractiveBrokersImporter.CURRENCY_SUFFIXES.items():
            if symbol.endswith(suffix):
                return currency

        # Default to USD
        return "USD"

    @staticmethod
    def parse_transaction_type(type_str: str) -> Optional[TransactionType]:
        """Parse transaction type from CSV value."""
        type_str = type_str.strip().upper()
        mapping = {
            "BUY": TransactionType.BUY,
            "SELL": TransactionType.SELL,
            "DEPOSIT": TransactionType.DEPOSIT,
            "WITHDRAWAL": TransactionType.WITHDRAWAL,
            "FEE": TransactionType.WITHDRAWAL,  # Fees treated as withdrawal
        }
        return mapping.get(type_str)

    @staticmethod
    def import_csv(
        csv_path: str,
        storage: TransactionStorage,
        clear_first: bool = False,
    ) -> int:
        """
        Import transactions from Interactive Brokers CSV.

        Args:
            csv_path: Path to CSV file
            storage: TransactionStorage instance
            clear_first: Clear existing transactions before import

        Returns:
            Number of transactions imported
        """
        if clear_first:
            storage.clear_all()

        count = 0
        existing_count = storage.get_transaction_count()

        try:
            with open(csv_path, "r") as f:
                reader = csv.DictReader(f)

                for row in reader:
                    try:
                        # Parse required fields
                        symbol = row.get("Symbol", "").strip()
                        if not symbol:
                            continue

                        # Parse date (format: YYYYMMDD)
                        date_str = row.get("Trade Date", "").strip()
                        if not date_str or date_str == "Trade Date":
                            continue

                        try:
                            txn_date = datetime.strptime(date_str, "%Y%m%d").date()
                        except ValueError:
                            continue

                        # Parse transaction type
                        txn_type_str = row.get("Transaction Type", "").strip()
                        txn_type = InteractiveBrokersImporter.parse_transaction_type(txn_type_str)
                        if not txn_type:
                            continue

                        # Parse quantity and price
                        quantity_str = row.get("Quantity", "0").strip()
                        price_str = row.get("Purchase Price", "0").strip()

                        try:
                            quantity = Decimal(quantity_str or "0")
                            price = Decimal(price_str or "0")
                        except Exception:
                            continue

                        if quantity <= 0:
                            continue

                        # Parse fees
                        fees_str = row.get("Commission", "0").strip()
                        try:
                            fees = Decimal(fees_str or "0")
                        except Exception:
                            fees = Decimal("0")

                        fees = abs(fees)  # Ensure fees are positive

                        # Detect asset type and currency
                        asset_type = InteractiveBrokersImporter.detect_asset_type(symbol)
                        if asset_type is None:
                            continue

                        currency = InteractiveBrokersImporter.detect_currency(symbol)

                        # Get exchange name
                        exchange = row.get("Comment", "").strip()

                        # Convert $$CASH_TX to CASH for consistency
                        if symbol == "$$CASH_TX":
                            symbol = "CASH"

                        # Create transaction
                        txn = Transaction(
                            date=txn_date,
                            asset=symbol,
                            asset_type=asset_type,
                            action=txn_type,
                            quantity=quantity,
                            price=price,
                            currency=currency,
                            fees=fees,
                            exchange=exchange,
                        )

                        storage.add_transaction(txn)
                        count += 1

                    except Exception as e:
                        # Skip problematic rows
                        continue

        except FileNotFoundError:
            print(f"Error: File not found: {csv_path}")
            return 0
        except Exception as e:
            print(f"Error reading CSV: {e}")
            return 0

        return count
