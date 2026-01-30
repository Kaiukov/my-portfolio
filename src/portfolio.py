"""Portfolio analysis with FIFO cost basis calculation."""

from decimal import Decimal
from typing import Dict, List

from src.models import Transaction, Position, AssetType, TransactionType


class PortfolioAnalyzer:
    """Analyzes portfolio using FIFO cost basis calculation."""

    def __init__(self, transactions: List[Transaction], price_fetcher):
        self.transactions = transactions
        self.fetcher = price_fetcher

    def calculate_positions(self) -> Dict[str, Position]:
        """Calculate current positions using FIFO cost basis."""
        positions: Dict[str, Position] = {}

        for txn in self.transactions:
            key = txn.asset if txn.asset_type != AssetType.CASH else f"{txn.asset}-{txn.currency}"

            if key not in positions:
                positions[key] = Position(key, txn.asset_type, txn.currency)

            pos = positions[key]

            if txn.action in [TransactionType.BUY, TransactionType.DEPOSIT]:
                pos.add_lot(txn.date, txn.quantity, txn.price, txn.fees)
            elif txn.action in [TransactionType.SELL, TransactionType.WITHDRAWAL]:
                if txn.asset_type == AssetType.CASH:
                    pos.quantity -= txn.quantity
                else:
                    pos.sell_quantity(txn.quantity, txn.price)

        return {k: v for k, v in positions.items() if v.quantity > 0 or v.asset_type == AssetType.CASH}

    def get_current_positions(self) -> List[Dict]:
        """Get all positions with current prices and P&L."""
        positions = self.calculate_positions()
        result = []

        for symbol, pos in sorted(positions.items()):
            # CASH positions
            if pos.symbol.startswith("CASH"):
                parts = pos.symbol.split()
                if len(parts) > 1 and parts[1] != "USD":
                    # Fetch exchange rate for foreign cash (e.g. CASH EUR -> EUR=X)
                    rate = self.fetcher.get_exchange_rate(parts[1], "USD")
                    current_price = rate if rate else Decimal("1.0")
                else:
                    current_price = Decimal("1.0")
            else:
                current_price = self.fetcher.get_price(pos.symbol, pos.asset_type)
                if current_price is None:
                    current_price = pos.average_cost_per_unit()

            cost_basis = pos.cost_basis()
            current_value = pos.quantity * current_price
            unrealized_pl = current_value - cost_basis
            unrealized_pl_pct = (
                (unrealized_pl / cost_basis * 100)
                if cost_basis > 0
                else Decimal("0")
            )

            result.append({
                "symbol": pos.symbol,
                "asset_type": pos.asset_type.value,
                "currency": pos.currency,
                "quantity": pos.quantity,
                "current_price": current_price,
                "current_value": current_value,
                "cost_basis": cost_basis,
                "unrealized_pl": unrealized_pl,
                "unrealized_pl_pct": unrealized_pl_pct,
                "realized_pl": pos.realized_pl,
            })

        return result

    def get_total_value(self) -> Dict[str, Decimal]:
        """Calculate total portfolio value in USD."""
        positions = self.get_current_positions()

        total_cost_basis = Decimal("0")
        total_current_value = Decimal("0")
        total_unrealized_pl = Decimal("0")
        total_realized_pl = Decimal("0")

        for pos in positions:
            # Convert to USD if needed
            usd_value = pos["current_value"]
            usd_cost_basis = pos["cost_basis"]

            if pos["currency"] != "USD":
                rate = self.fetcher.get_exchange_rate(pos["currency"], "USD")
                if rate:
                    usd_value = pos["current_value"] * rate
                    usd_cost_basis = pos["cost_basis"] * rate

            total_cost_basis += usd_cost_basis
            total_current_value += usd_value

            if pos["asset_type"] != "cash":
                total_unrealized_pl += pos["unrealized_pl"]
                total_realized_pl += pos["realized_pl"]

        total_pl = total_unrealized_pl + total_realized_pl
        total_pl_pct = (
            (total_pl / total_cost_basis * 100)
            if total_cost_basis > 0
            else Decimal("0")
        )

        return {
            "total_investment": total_cost_basis,
            "total_value": total_current_value,
            "total_pl": total_pl,
            "total_pl_pct": total_pl_pct,
        }
