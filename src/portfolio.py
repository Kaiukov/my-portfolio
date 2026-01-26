"""Portfolio analysis with FIFO cost basis calculation."""

from decimal import Decimal
from datetime import date
from typing import Dict, List, Optional

from src.models import Transaction, Position, AssetType, TransactionType
from src.storage import TransactionStorage
from src.prices import PriceFetcher


class PortfolioAnalyzer:
    """Analyzes portfolio using FIFO cost basis calculation."""

    def __init__(self, storage: TransactionStorage, fetcher: PriceFetcher):
        self.storage = storage
        self.fetcher = fetcher

    def calculate_positions(self) -> Dict[str, Position]:
        """
        Calculate current positions using FIFO cost basis.

        Returns:
            Dictionary mapping symbol to Position object
        """
        positions: Dict[str, Position] = {}
        transactions = self.storage.load_transactions()

        for txn in transactions:
            key = txn.asset if txn.asset_type != AssetType.CASH else f"{txn.asset}-{txn.currency}"

            # Initialize position if new
            if key not in positions:
                positions[key] = Position(key, txn.asset_type, txn.currency)

            pos = positions[key]

            if txn.action in [TransactionType.BUY, TransactionType.DEPOSIT]:
                # Add to position
                pos.add_lot(txn.date, txn.quantity, txn.price, txn.fees)

            elif txn.action in [TransactionType.SELL, TransactionType.WITHDRAWAL]:
                if txn.asset_type == AssetType.CASH:
                    # For CASH: allow overdrafts (negative balance)
                    pos.quantity -= txn.quantity
                else:
                    # For other assets: use FIFO selling
                    pos.sell_quantity(txn.quantity, txn.price)

        # Remove positions with zero quantity (but allow CASH positions including negative balances)
        return {
            k: v
            for k, v in positions.items()
            if v.quantity > 0 or v.asset_type == AssetType.CASH
        }

    def get_current_positions(self) -> List[Dict]:
        """
        Get all positions enriched with current prices and P&L.

        Returns:
            List of position dictionaries with price and P&L data
        """
        positions = self.calculate_positions()
        result = []

        for symbol, pos in sorted(positions.items()):
            # Get current price
            current_price = self.fetcher.get_price(pos.symbol, pos.asset_type)
            if current_price is None:
                current_price = pos.average_cost_per_unit()  # Fallback to cost basis

            # Calculate values
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
                "average_cost_per_unit": pos.average_cost_per_unit(),
                "unrealized_pl": unrealized_pl,
                "unrealized_pl_pct": unrealized_pl_pct,
                "realized_pl": pos.realized_pl,
            })

        return result

    def get_cash_balances(self) -> Dict[str, Dict]:
        """
        Get cash balances by currency.

        Returns:
            Dictionary mapping currency to balance info with USD conversion
        """
        positions = self.calculate_positions()
        cash_by_currency: Dict[str, Decimal] = {}

        # Collect cash balances by currency
        for symbol, pos in positions.items():
            if pos.asset_type == AssetType.CASH:
                # Extract currency from symbol (CASH-USD -> USD)
                currency = symbol.split("-")[1] if "-" in symbol else "USD"
                cash_by_currency[currency] = pos.quantity

        # Add USD conversion rates
        result = {}
        total_usd = Decimal("0")

        for currency, amount in sorted(cash_by_currency.items()):
            # Get exchange rate
            rate = self.fetcher.get_exchange_rate(currency, "USD")
            if rate is None:
                rate = Decimal("1") if currency == "USD" else Decimal("0")

            usd_value = amount * rate
            result[currency] = {
                "quantity": amount,
                "usd_value": usd_value,
                "usd_rate": rate,
            }
            total_usd += usd_value

        result["_total_usd"] = total_usd
        return result

    def get_total_value(self) -> Dict[str, Decimal]:
        """
        Calculate total portfolio value in USD.

        Returns:
            Dictionary with various totals (investment, cash, value, P&L)
        """
        positions = self.get_current_positions()
        cash_balances = self.get_cash_balances()

        # Calculate totals from non-cash positions
        total_cost_basis = Decimal("0")
        total_current_value = Decimal("0")
        total_unrealized_pl = Decimal("0")
        total_realized_pl = Decimal("0")

        for pos in positions:
            # Skip CASH positions - they're handled separately
            if pos["asset_type"] == "cash":
                continue

            total_cost_basis += pos["cost_basis"]
            total_current_value += pos["current_value"]
            total_unrealized_pl += pos["unrealized_pl"]
            total_realized_pl += pos["realized_pl"]

        # Add cash balances to current value
        total_cash_usd = cash_balances.pop("_total_usd", Decimal("0"))
        total_current_value += total_cash_usd

        total_pl = total_unrealized_pl + total_realized_pl
        total_pl_pct = (
            (total_pl / total_cost_basis * 100)
            if total_cost_basis > 0
            else Decimal("0")
        )

        return {
            "total_investment": total_cost_basis,
            "total_cash": total_cash_usd,
            "total_value": total_current_value,
            "total_unrealized_pl": total_unrealized_pl,
            "total_realized_pl": total_realized_pl,
            "total_pl": total_pl,
            "total_pl_pct": total_pl_pct,
        }

    def get_allocation(self) -> Dict[str, Dict]:
        """
        Get portfolio allocation by asset type.

        Returns:
            Dictionary with allocation percentages and values
        """
        positions = self.get_current_positions()
        totals = self.get_total_value()

        allocation: Dict[str, Dict] = {
            "crypto": {"value": Decimal("0"), "pct": Decimal("0")},
            "stock": {"value": Decimal("0"), "pct": Decimal("0")},
            "etf": {"value": Decimal("0"), "pct": Decimal("0")},
            "cash": {"value": Decimal("0"), "pct": Decimal("0")},
        }

        for pos in positions:
            asset_type = pos["asset_type"]
            if asset_type in allocation:
                allocation[asset_type]["value"] += pos["current_value"]

        # Calculate percentages
        total_value = totals["total_value"]
        if total_value > 0:
            for asset_type in allocation:
                pct = (allocation[asset_type]["value"] / total_value * 100)
                allocation[asset_type]["pct"] = pct

        # Add cash
        total_cash = totals["total_cash"]
        allocation["cash"]["value"] = total_cash
        if total_value > 0:
            allocation["cash"]["pct"] = total_cash / total_value * 100

        return allocation
