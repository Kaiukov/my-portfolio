"""Transaction storage and persistence."""

import json
from datetime import date
from decimal import Decimal
from pathlib import Path

from src.models import Transaction, AssetType, TransactionType


class TransactionStorage:
    """Handles loading and saving transactions to JSON."""

    def __init__(self, data_file: str = "data/transactions.json"):
        self.data_file = Path(data_file)
        self._ensure_directory()

    def _ensure_directory(self):
        """Create data directory if it doesn't exist."""
        self.data_file.parent.mkdir(parents=True, exist_ok=True)

    def load_transactions(self) -> list[Transaction]:
        """Load all transactions from storage."""
        if not self.data_file.exists():
            return []

        try:
            with open(self.data_file, "r") as f:
                data = json.load(f)

            transactions = []
            for item in data:
                txn = Transaction(
                    date=date.fromisoformat(item["date"]),
                    asset=item["asset"],
                    asset_type=AssetType(item["asset_type"]),
                    action=TransactionType(item["action"]),
                    quantity=Decimal(str(item["quantity"])),
                    price=Decimal(str(item["price"])),
                    currency=item.get("currency", "USD"),
                    fees=Decimal(str(item.get("fees", "0"))),
                    exchange=item.get("exchange", ""),
                )
                transactions.append(txn)

            return sorted(transactions, key=lambda t: t.date)
        except Exception as e:
            print(f"Error loading transactions: {e}")
            return []

    def save_transactions(self, transactions: list[Transaction]):
        """Save transactions to storage."""
        self._ensure_directory()

        data = []
        for txn in transactions:
            data.append({
                "date": txn.date.isoformat(),
                "asset": txn.asset,
                "asset_type": txn.asset_type.value,
                "action": txn.action.value,
                "quantity": str(txn.quantity),
                "price": str(txn.price),
                "currency": txn.currency,
                "fees": str(txn.fees),
                "exchange": txn.exchange,
            })

        with open(self.data_file, "w") as f:
            json.dump(data, f, indent=2)
