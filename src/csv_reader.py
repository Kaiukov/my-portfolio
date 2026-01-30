"""Read transactions from CSV file."""

import csv
from datetime import datetime
from decimal import Decimal
from pathlib import Path

from src.models import Transaction, AssetType, TransactionType


def read_csv(csv_path: str) -> list[Transaction]:
    """Read transactions from CSV file."""
    path = Path(csv_path)
    if not path.exists():
        return []

    transactions = []

    with open(path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f, delimiter=';')

        for row in reader:
            try:
                date = datetime.strptime(row['date'], '%d-%m-%Y').date()

                txn = Transaction(
                    date=date,
                    asset=row['asset'],
                    asset_type=AssetType(row['asset_type'].lower()),
                    action=TransactionType(row['action'].lower()),
                    quantity=Decimal(row['quantity']),
                    price=Decimal(row['price']),
                    currency=row.get('currency', 'USD'),
                    fees=Decimal(row.get('fees', '0')),
                    exchange=row.get('exchange', ''),
                )
                transactions.append(txn)
            except (ValueError, KeyError) as e:
                continue

    return sorted(transactions, key=lambda t: t.date)
