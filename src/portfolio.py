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
        """Calculate current positions using FIFO cost basis with proper cash tracking."""
        positions: Dict[str, Position] = {}

        for txn in self.transactions:
            # Determine position key and currency based on transaction type
            asset_key = None

            if txn.action in [TransactionType.DEPOSIT, TransactionType.WITHDRAWAL]:
                # DEPOSIT/WITHDRAWAL: extract currency from asset name (e.g., "CASH EUR" -> EUR)
                # Format is typically "CASH {CURRENCY}" or just "CASH"
                parts = txn.asset.split()
                if len(parts) > 1:
                    cash_currency = parts[1]
                else:
                    cash_currency = txn.currency or "USD"
                cash_key = f"CASH-{cash_currency}"
            else:
                # BUY/SELL transactions
                asset_key = txn.asset
                cash_currency = txn.currency
                cash_key = f"CASH-{cash_currency}"

            # Initialize CASH position if needed
            if cash_key not in positions:
                positions[cash_key] = Position(cash_key, AssetType.CASH, cash_currency)

            # Process transaction
            if txn.action == TransactionType.DEPOSIT:
                # DEPOSIT: only increase CASH
                # quantity represents the cash amount deposited
                # price represents the FX rate at deposit time (1.0 for USD, FX rate for other currencies)
                cash_pos = positions[cash_key]
                fx_rate = txn.price if txn.price else Decimal("1")
                cash_pos.add_lot(txn.date, txn.quantity, fx_rate, Decimal("0"))

            elif txn.action == TransactionType.WITHDRAWAL:
                # WITHDRAWAL: only decrease CASH
                # quantity represents the cash amount withdrawn
                cash_pos = positions[cash_key]
                cash_pos.sell_quantity(txn.quantity, Decimal("1"))

            elif txn.action == TransactionType.BUY:
                # BUY: add asset + subtract cash
                # Initialize asset position if needed
                if asset_key not in positions:
                    positions[asset_key] = Position(asset_key, txn.asset_type, txn.currency)

                # Add asset to position
                asset_pos = positions[asset_key]
                asset_pos.add_lot(txn.date, txn.quantity, txn.price, txn.fees)

                # Subtract cash (quantity * price + fees)
                cash_spent = txn.quantity * txn.price + txn.fees
                cash_pos = positions[cash_key]
                cash_pos.sell_quantity(cash_spent, Decimal("1"))

            elif txn.action == TransactionType.SELL:
                # SELL: remove asset + add cash
                # Initialize asset position if needed (should normally exist)
                if asset_key not in positions:
                    positions[asset_key] = Position(asset_key, txn.asset_type, txn.currency)

                # Remove asset using FIFO
                asset_pos = positions[asset_key]
                asset_pos.sell_quantity(txn.quantity, txn.price)

                # Add cash (quantity * price - fees)
                cash_received = txn.quantity * txn.price - txn.fees
                cash_pos = positions[cash_key]
                cash_pos.add_lot(txn.date, cash_received, Decimal("1"), Decimal("0"))

        # Return positions with quantity > 0 or CASH positions
        return {k: v for k, v in positions.items() if v.quantity > 0 or v.asset_type == AssetType.CASH}

    def get_current_positions(self) -> List[Dict]:
        """Get all positions with current prices and P&L."""
        positions = self.calculate_positions()
        result = []

        for symbol, pos in sorted(positions.items()):
            # CASH positions
            if pos.symbol.startswith("CASH-"):
                # Extract currency from symbol (e.g., "CASH-EUR" -> "EUR")
                currency = pos.symbol.split("-")[1] if "-" in pos.symbol else "USD"
                if currency != "USD":
                    # Fetch exchange rate for foreign cash (e.g., EUR -> USD)
                    rate = self.fetcher.get_exchange_rate(currency, "USD")
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
            # Handle USD conversion based on position type
            # For CASH positions, cost_basis is already in USD (includes FX at deposit time)
            # For other assets, need to convert to USD if currency != USD

            if pos["asset_type"] == "cash":
                # CASH: cost_basis already includes FX conversion
                usd_value = pos["current_value"]
                usd_cost_basis = pos["cost_basis"]
            else:
                # Asset: convert to USD if needed
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
