"""Data models for portfolio tracking."""

from datetime import date
from decimal import Decimal
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class AssetType(str, Enum):
    """Asset types in portfolio."""
    CRYPTO = "crypto"
    STOCK = "stock"
    ETF = "etf"
    CASH = "cash"


class TransactionType(str, Enum):
    """Transaction types."""
    BUY = "buy"
    SELL = "sell"
    DEPOSIT = "deposit"
    WITHDRAWAL = "withdrawal"


class Transaction(BaseModel):
    """Transaction record with FIFO tracking."""
    date: date
    asset: str  # e.g., "BTC-USD", "AAPL", "CASH"
    asset_type: AssetType
    action: TransactionType
    quantity: Decimal = Field(gt=0)
    price: Decimal = Field(ge=0)
    currency: str = "USD"  # USD, EUR, GBP, etc.
    fees: Decimal = Field(default=Decimal("0"), ge=0)
    exchange: str = ""  # Interactive Brokers, Freedom Finance, etc.

    def total_cost(self) -> Decimal:
        """Calculate total cost including fees."""
        return self.quantity * self.price + self.fees


class Lot:
    """Single purchase lot for FIFO tracking."""
    def __init__(
        self,
        date: date,
        quantity: Decimal,
        price: Decimal,
        fees: Decimal = Decimal("0"),
    ):
        self.date = date
        self.quantity = quantity
        self.price = price
        self.fees = fees
        self.remaining = quantity

    def cost_basis(self) -> Decimal:
        """Total cost of this lot including fees."""
        return self.quantity * self.price + self.fees

    def average_cost_per_unit(self) -> Decimal:
        """Average cost per unit for this lot."""
        if self.quantity == 0:
            return Decimal("0")
        return self.cost_basis() / self.quantity


class Position:
    """Current position with FIFO cost basis tracking."""
    def __init__(
        self,
        symbol: str,
        asset_type: AssetType,
        currency: str,
    ):
        self.symbol = symbol
        self.asset_type = asset_type
        self.currency = currency
        self.quantity = Decimal("0")
        self.lots: list[Lot] = []
        self.realized_pl = Decimal("0")

    def add_lot(self, date: date, quantity: Decimal, price: Decimal, fees: Decimal = Decimal("0")):
        """Add a new lot to this position."""
        self.quantity += quantity
        self.lots.append(Lot(date, quantity, price, fees))

    def remove_quantity(self, quantity: Decimal) -> Decimal:
        """
        Remove quantity using FIFO (oldest lots first).
        Returns realized P&L from the sale.
        """
        remaining = quantity
        sale_pl = Decimal("0")

        for lot in self.lots:
            if remaining <= 0:
                break

            if lot.remaining > 0:
                removed = min(lot.remaining, remaining)
                # Calculate P&L for this portion
                # (For actual sales, price would need to be provided separately)
                lot.remaining -= removed
                remaining -= removed
                self.quantity -= removed

        return sale_pl

    def sell_quantity(self, quantity: Decimal, sale_price: Decimal) -> Decimal:
        """
        Sell quantity using FIFO and calculate realized P&L.
        Returns realized P&L from the sale.
        """
        remaining = quantity
        sale_pl = Decimal("0")

        for lot in self.lots:
            if remaining <= 0:
                break

            if lot.remaining > 0:
                removed = min(lot.remaining, remaining)
                # Calculate P&L: (sale_price - cost_per_unit) * removed
                cost_per_unit = lot.average_cost_per_unit()
                lot_pl = (sale_price - cost_per_unit) * removed
                sale_pl += lot_pl
                lot.remaining -= removed
                remaining -= removed
                self.quantity -= removed
                self.realized_pl += lot_pl

        return sale_pl

    def cost_basis(self) -> Decimal:
        """Total cost basis of remaining quantity."""
        return sum(lot.average_cost_per_unit() * lot.remaining for lot in self.lots)

    def average_cost_per_unit(self) -> Decimal:
        """Average cost per unit of remaining quantity."""
        if self.quantity == 0:
            return Decimal("0")
        return self.cost_basis() / self.quantity
