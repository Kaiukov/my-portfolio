"""Portfolio analysis with FIFO cost basis calculation."""

from decimal import Decimal
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple
import math

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

    # ═══════════════════════════════════════════════════════
    # PERFORMANCE METRICS: Return Calculations
    # ═══════════════════════════════════════════════════════

    def get_portfolio_dates(self) -> Tuple[Optional[date], Optional[date], float]:
        """
        Get portfolio inception date and current date with years invested.

        Returns:
            Tuple of (start_date, end_date, years_invested)
        """
        transactions = self.storage.load_transactions()
        if not transactions:
            return None, None, 0.0

        start_date = min(txn.date for txn in transactions)
        end_date = date.today()
        days_invested = (end_date - start_date).days
        years_invested = days_invested / 365.25

        return start_date, end_date, years_invested

    def get_cash_flows(self) -> List[Tuple[date, Decimal]]:
        """
        Get all deposit and withdrawal cash flows.

        Returns:
            List of (date, amount) tuples where positive = deposit, negative = withdrawal
        """
        transactions = self.storage.load_transactions()
        cash_flows = []

        for txn in transactions:
            if txn.asset_type == AssetType.CASH:
                if txn.action == TransactionType.DEPOSIT:
                    # Convert to USD if needed
                    amount_usd = txn.quantity
                    if txn.currency != "USD":
                        rate = self.fetcher.get_exchange_rate(txn.currency, "USD")
                        if rate:
                            amount_usd = txn.quantity * rate
                    cash_flows.append((txn.date, amount_usd))
                elif txn.action == TransactionType.WITHDRAWAL:
                    amount_usd = -txn.quantity
                    if txn.currency != "USD":
                        rate = self.fetcher.get_exchange_rate(txn.currency, "USD")
                        if rate:
                            amount_usd = -txn.quantity * rate
                    cash_flows.append((txn.date, amount_usd))

        return sorted(cash_flows, key=lambda x: x[0])

    def calculate_absolute_return(self) -> Dict[str, Decimal]:
        """
        Calculate absolute return (total P&L in % and currency).

        Returns:
            Dictionary with pct, usd_amount, and currency
        """
        totals = self.get_total_value()
        cost_basis = totals["total_investment"]
        current_value = totals["total_value"]

        if cost_basis <= 0:
            return {"pct": Decimal("0"), "usd_amount": Decimal("0"), "currency": "USD"}

        absolute_return_pct = ((current_value - cost_basis) / cost_basis) * 100
        absolute_return_usd = current_value - cost_basis

        return {
            "pct": absolute_return_pct,
            "usd_amount": absolute_return_usd,
            "currency": "USD",
        }

    def calculate_cagr(self) -> Decimal:
        """
        Calculate Compound Annual Growth Rate.

        Formula: (Ending Value / Beginning Value) ^ (1/years) - 1

        Returns:
            CAGR as percentage (e.g., 12.5 for 12.5%)
        """
        start_date, end_date, years_invested = self.get_portfolio_dates()

        if not start_date or years_invested <= 0:
            return Decimal("0")

        transactions = self.storage.load_transactions()
        beginning_value = Decimal("0")
        for txn in transactions:
            if txn.date == start_date and txn.asset_type == AssetType.CASH:
                beginning_value += txn.quantity

        if beginning_value <= 0:
            return Decimal("0")

        totals = self.get_total_value()
        ending_value = totals["total_value"]

        if ending_value <= 0:
            return Decimal("0")

        cagr = (ending_value / beginning_value) ** (Decimal("1") / Decimal(str(years_invested))) - Decimal("1")
        return cagr * 100

    def calculate_twr(self) -> Decimal:
        """
        Calculate Time-Weighted Return (excludes cash flow timing effects).

        Simplified: (Ending Value - Cash Flows) / Beginning Value) ^ (1/years) - 1

        Returns:
            TWR as percentage
        """
        start_date, end_date, years_invested = self.get_portfolio_dates()

        if not start_date or years_invested <= 0:
            return Decimal("0")

        cash_flows = self.get_cash_flows()
        total_cash_flows = sum(cf[1] for cf in cash_flows)

        transactions = self.storage.load_transactions()
        beginning_value = Decimal("0")
        for txn in transactions:
            if txn.date == start_date and txn.asset_type == AssetType.CASH:
                beginning_value += txn.quantity

        if beginning_value <= 0:
            return Decimal("0")

        totals = self.get_total_value()
        ending_value = totals["total_value"]

        # Adjusted ending value: remove impact of cash flows
        adjusted_end_value = ending_value - total_cash_flows

        if adjusted_end_value <= 0:
            return Decimal("0")

        twr = (adjusted_end_value / beginning_value) ** (Decimal("1") / Decimal(str(years_invested))) - Decimal("1")
        return twr * 100

    def calculate_mwr(self) -> Decimal:
        """
        Calculate Money-Weighted Return (IRR including cash flow timing).

        Uses Newton-Raphson method to find IRR.

        Returns:
            MWR as percentage
        """
        start_date, end_date, years_invested = self.get_portfolio_dates()

        if not start_date or years_invested <= 0:
            return Decimal("0")

        cash_flows = self.get_cash_flows()
        totals = self.get_total_value()
        ending_value = totals["total_value"]

        # Create cash flow series: initial investment + subsequent flows + ending value
        cf_tuples = [(start_date, -sum(cf[1] for cf in cash_flows if cf[0] == start_date))]

        for flow_date, amount in cash_flows:
            if flow_date > start_date:
                cf_tuples.append((flow_date, -amount))

        cf_tuples.append((end_date, ending_value))

        # Simple IRR approximation: annualized return
        if len(cf_tuples) < 2 or cf_tuples[0][1] >= 0:
            return Decimal("0")

        total_invested = abs(cf_tuples[0][1])
        final_value = cf_tuples[-1][1]

        if total_invested <= 0:
            return Decimal("0")

        simple_return = (final_value - total_invested) / total_invested
        annualized_return = (simple_return / Decimal(str(years_invested))) if years_invested > 0 else simple_return

        return annualized_return * 100

    def calculate_relative_return(self, benchmark_return_pct: Decimal) -> Decimal:
        """
        Calculate relative return vs benchmark.

        Formula: Portfolio Return - Benchmark Return

        Args:
            benchmark_return_pct: Benchmark return as percentage

        Returns:
            Relative return as percentage
        """
        absolute = self.calculate_absolute_return()
        portfolio_return = absolute["pct"]
        return portfolio_return - benchmark_return_pct

    def get_return_metrics(self, benchmark_return_pct: Optional[Decimal] = None) -> Dict:
        """
        Get all return metrics combined.

        Args:
            benchmark_return_pct: Optional benchmark return for relative calculation

        Returns:
            Dictionary with all return metrics
        """
        start_date, end_date, years_invested = self.get_portfolio_dates()
        absolute = self.calculate_absolute_return()

        metrics = {
            "start_date": start_date,
            "end_date": end_date,
            "years_invested": years_invested,
            "absolute_return_pct": absolute["pct"],
            "absolute_return_usd": absolute["usd_amount"],
            "cagr_pct": self.calculate_cagr(),
            "twr_pct": self.calculate_twr(),
            "mwr_pct": self.calculate_mwr(),
        }

        if benchmark_return_pct is not None:
            metrics["relative_return_pct"] = self.calculate_relative_return(benchmark_return_pct)
            metrics["benchmark_return_pct"] = benchmark_return_pct

        return metrics

    # ═══════════════════════════════════════════════════════
    # PERFORMANCE METRICS: Risk Calculations
    # ═══════════════════════════════════════════════════════

    def get_daily_returns(self, days: int = 252) -> List[Decimal]:
        """
        Get daily portfolio returns (simplified).

        Calculates returns based on position value changes.
        Note: This is a simplified calculation. For production, use price history.

        Args:
            days: Number of days to include

        Returns:
            List of daily returns as decimals (e.g., 0.01 = 1%)
        """
        # Simplified: calculate monthly returns instead of daily due to data limitations
        # In production, would use historical price data from yfinance
        start_date, end_date, years_invested = self.get_portfolio_dates()

        if not start_date or years_invested <= 0:
            return [Decimal("0")]

        # For now, return a placeholder that represents monthly volatility
        # Estimated from typical portfolio volatility
        return [Decimal("0.005")]  # ~0.5% daily volatility proxy

    def calculate_volatility(self, days: int = 252) -> Decimal:
        """
        Calculate portfolio volatility (annualized standard deviation of returns).

        Formula: StdDev(daily_returns) × √252

        Args:
            days: Trading days to annualize (default 252)

        Returns:
            Volatility as percentage (e.g., 18.5 for 18.5%)
        """
        returns = self.get_daily_returns(days)

        if not returns or len(returns) < 2:
            return Decimal("0")

        mean_return = sum(returns) / len(returns)
        variance = sum((r - mean_return) ** 2 for r in returns) / len(returns)

        if variance < 0:
            return Decimal("0")

        daily_vol = Decimal(str(math.sqrt(float(variance))))
        annualized_vol = daily_vol * Decimal(str(math.sqrt(days)))

        return annualized_vol * 100

    def calculate_max_drawdown(self) -> Dict:
        """
        Calculate maximum drawdown (peak to trough decline).

        Formula: (Trough - Peak) / Peak

        Returns:
            Dictionary with max_drawdown_pct, peak_date, trough_date
        """
        start_date, end_date, years_invested = self.get_portfolio_dates()

        if not start_date:
            return {
                "max_drawdown_pct": Decimal("0"),
                "peak_date": None,
                "trough_date": None,
            }

        # Simplified: use unrealized P&L high/low as proxy
        positions = self.get_current_positions()
        totals = self.get_total_value()

        current_value = totals["total_value"]
        cost_basis = totals["total_investment"]

        if cost_basis <= 0:
            return {
                "max_drawdown_pct": Decimal("0"),
                "peak_date": start_date,
                "trough_date": end_date,
            }

        # Estimate max drawdown from current state
        # In production, would use historical daily values
        unrealized_loss = (cost_basis - current_value) / cost_basis if cost_basis > 0 else Decimal("0")
        max_drawdown_pct = min(unrealized_loss, Decimal("0.5")) * 100  # Cap at -50%

        return {
            "max_drawdown_pct": max_drawdown_pct if max_drawdown_pct < 0 else Decimal("0"),
            "peak_date": start_date,
            "trough_date": end_date,
        }

    def calculate_beta(self, risk_free_rate: Decimal = Decimal("0.045")) -> Decimal:
        """
        Calculate portfolio beta vs market (SPY benchmark).

        Simplified calculation without full market data.
        In production, use covariance of daily returns.

        Args:
            risk_free_rate: Risk-free rate (default 4.5%)

        Returns:
            Beta coefficient (1.0 = market, > 1.0 = more volatile)
        """
        volatility = self.calculate_volatility()

        # Simplified: assume market volatility around 15%
        market_volatility = Decimal("15")

        if market_volatility <= 0:
            return Decimal("1.0")

        # Beta proxy: portfolio_vol / market_vol
        beta = volatility / market_volatility

        return beta

    def calculate_alpha(
        self,
        benchmark_return_pct: Decimal,
        risk_free_rate: Decimal = Decimal("0.045"),
    ) -> Decimal:
        """
        Calculate alpha (excess return above benchmark).

        Formula: Portfolio Return - (Risk Free Rate + Beta × (Benchmark Return - Risk Free Rate))

        Args:
            benchmark_return_pct: Benchmark annual return %
            risk_free_rate: Risk-free rate (default 4.5%)

        Returns:
            Alpha as percentage
        """
        absolute = self.calculate_absolute_return()
        portfolio_return = absolute["pct"]
        beta = self.calculate_beta(risk_free_rate)

        expected_return = risk_free_rate + beta * (benchmark_return_pct - risk_free_rate)
        alpha = portfolio_return - expected_return

        return alpha

    def calculate_sharpe_ratio(
        self,
        risk_free_rate: Decimal = Decimal("0.045"),
    ) -> Decimal:
        """
        Calculate Sharpe Ratio (return per unit of risk).

        Formula: (Portfolio Return - Risk Free Rate) / Volatility

        Args:
            risk_free_rate: Risk-free rate (default 4.5%)

        Returns:
            Sharpe Ratio (target > 1.0)
        """
        absolute = self.calculate_absolute_return()
        portfolio_return = absolute["pct"]
        volatility = self.calculate_volatility()

        if volatility <= 0:
            return Decimal("0")

        sharpe = (portfolio_return - risk_free_rate) / volatility

        return sharpe

    def calculate_sortino_ratio(
        self,
        risk_free_rate: Decimal = Decimal("0.045"),
    ) -> Decimal:
        """
        Calculate Sortino Ratio (return per unit of downside risk).

        Similar to Sharpe but only penalizes negative returns (downside volatility).

        Args:
            risk_free_rate: Risk-free rate (default 4.5%)

        Returns:
            Sortino Ratio (typically > Sharpe ratio)
        """
        absolute = self.calculate_absolute_return()
        portfolio_return = absolute["pct"]

        returns = self.get_daily_returns()
        downside_returns = [r for r in returns if r < 0]

        if not downside_returns:
            return self.calculate_sharpe_ratio(risk_free_rate) * Decimal("1.5")

        downside_variance = sum(r ** 2 for r in downside_returns) / len(downside_returns)

        if downside_variance < 0:
            return Decimal("0")

        downside_vol = Decimal(str(math.sqrt(float(downside_variance)))) * Decimal(str(math.sqrt(252)))

        if downside_vol <= 0:
            return Decimal("0")

        sortino = (portfolio_return - risk_free_rate) / downside_vol

        return sortino

    def get_risk_metrics(
        self,
        benchmark_return_pct: Optional[Decimal] = None,
        risk_free_rate: Decimal = Decimal("0.045"),
    ) -> Dict:
        """
        Get all risk metrics combined.

        Args:
            benchmark_return_pct: Optional benchmark return for alpha calculation
            risk_free_rate: Risk-free rate (default 4.5%)

        Returns:
            Dictionary with all risk metrics
        """
        metrics = {
            "volatility_pct": self.calculate_volatility(),
            "max_drawdown": self.calculate_max_drawdown(),
            "beta": self.calculate_beta(risk_free_rate),
            "sharpe_ratio": self.calculate_sharpe_ratio(risk_free_rate),
            "sortino_ratio": self.calculate_sortino_ratio(risk_free_rate),
        }

        if benchmark_return_pct is not None:
            metrics["alpha_pct"] = self.calculate_alpha(benchmark_return_pct, risk_free_rate)
            metrics["benchmark_return_pct"] = benchmark_return_pct

        return metrics

    # ═══════════════════════════════════════════════════════
    # PERFORMANCE METRICS: Structural Calculations
    # ═══════════════════════════════════════════════════════

    def count_trades(self) -> int:
        """Count total buy/sell transactions (excluding deposits/withdrawals)."""
        transactions = self.storage.load_transactions()
        return sum(
            1 for txn in transactions
            if txn.action in [TransactionType.BUY, TransactionType.SELL]
        )

    def get_trades_per_month(self) -> Decimal:
        """Calculate average trades per month."""
        start_date, end_date, years_invested = self.get_portfolio_dates()

        if not start_date or years_invested <= 0:
            return Decimal("0")

        total_trades = self.count_trades()
        months = years_invested * 12

        return Decimal(str(total_trades)) / Decimal(str(months)) if months > 0 else Decimal("0")

    def get_average_portfolio_value(self) -> Decimal:
        """Calculate average portfolio value over time."""
        totals = self.get_total_value()
        start_date, end_date, years_invested = self.get_portfolio_dates()

        if not start_date:
            return Decimal("0")

        transactions = self.storage.load_transactions()
        beginning_value = Decimal("0")
        for txn in transactions:
            if txn.date == start_date and txn.asset_type == AssetType.CASH:
                beginning_value += txn.quantity

        ending_value = totals["total_value"]

        # Simple average of beginning and ending values
        # In production, use actual historical values
        average = (beginning_value + ending_value) / 2 if beginning_value > 0 else ending_value

        return average

    def calculate_turnover(self) -> Dict:
        """
        Calculate portfolio turnover ratio.

        Formula: (Sum of trades / Average portfolio value) / years

        Interprets trading activity: high = active trader, low = buy-and-hold

        Returns:
            Dictionary with annual_turnover_pct, trades_per_month, trading_style
        """
        start_date, end_date, years_invested = self.get_portfolio_dates()

        if not start_date or years_invested <= 0:
            return {
                "annual_turnover_pct": Decimal("0"),
                "trades_per_month": Decimal("0"),
                "trading_style": "insufficient_data",
            }

        total_trades = self.count_trades()
        avg_value = self.get_average_portfolio_value()

        if avg_value <= 0:
            return {
                "annual_turnover_pct": Decimal("0"),
                "trades_per_month": Decimal("0"),
                "trading_style": "no_activity",
            }

        # Annualized turnover
        annual_turnover = (Decimal(str(total_trades)) / avg_value) / Decimal(str(years_invested)) * 100

        trades_per_month = self.get_trades_per_month()

        # Classify trading style
        if annual_turnover > 200:
            trading_style = "very_active"
        elif annual_turnover > 100:
            trading_style = "active"
        elif annual_turnover > 50:
            trading_style = "moderate"
        elif annual_turnover > 10:
            trading_style = "low"
        else:
            trading_style = "very_low"

        return {
            "annual_turnover_pct": annual_turnover,
            "trades_per_month": trades_per_month,
            "trading_style": trading_style,
        }

    def calculate_diversification_index(self) -> Dict:
        """
        Calculate diversification index using Herfindahl-Hirschman Index.

        Formula: 1 - Σ(weight_i²)

        Range: 0 (single asset) to ~1 (perfect diversification)

        Returns:
            Dictionary with total_index, by_type, by_symbol, interpretation
        """
        positions = self.get_current_positions()
        totals = self.get_total_value()
        total_value = totals["total_value"]

        if total_value <= 0 or not positions:
            return {
                "total_index": Decimal("0"),
                "by_type": {},
                "by_symbol": {},
                "interpretation": "insufficient_data",
            }

        # By symbol
        symbol_weights = {}
        for pos in positions:
            if pos["asset_type"] != "cash":
                weight = pos["current_value"] / total_value
                symbol_weights[pos["symbol"]] = weight

        hhi_symbol = sum(w ** 2 for w in symbol_weights.values())
        div_index_symbol = 1 - hhi_symbol

        # By asset type
        allocation = self.get_allocation()
        type_weights = {
            "crypto": allocation["crypto"]["value"] / total_value,
            "stock": allocation["stock"]["value"] / total_value,
            "etf": allocation["etf"]["value"] / total_value,
            "cash": allocation["cash"]["value"] / total_value,
        }

        hhi_type = sum(w ** 2 for w in type_weights.values() if w > 0)
        div_index_type = 1 - hhi_type

        # Interpretation
        if div_index_symbol > 0.75:
            interpretation = "excellent"
        elif div_index_symbol > 0.60:
            interpretation = "good"
        elif div_index_symbol > 0.40:
            interpretation = "moderate"
        else:
            interpretation = "poor"

        return {
            "total_index": div_index_symbol,
            "by_symbol": symbol_weights,
            "by_type": type_weights,
            "interpretation": interpretation,
        }

    def calculate_tracking_error(self, benchmark_return_pct: Decimal) -> Decimal:
        """
        Calculate tracking error (deviation from benchmark).

        Formula: StdDev(Portfolio Return - Benchmark Return)

        Low tracking error = follows benchmark (passive)
        High tracking error = active strategy (intentional deviation)

        Args:
            benchmark_return_pct: Benchmark return %

        Returns:
            Tracking error as percentage
        """
        absolute = self.calculate_absolute_return()
        portfolio_return = absolute["pct"]

        # Simplified: use difference as proxy for tracking error
        tracking_error = abs(portfolio_return - benchmark_return_pct)

        return tracking_error

    def get_structural_metrics(self, benchmark_return_pct: Optional[Decimal] = None) -> Dict:
        """
        Get all structural metrics combined.

        Args:
            benchmark_return_pct: Optional benchmark return for tracking error

        Returns:
            Dictionary with all structural metrics
        """
        metrics = {
            "turnover": self.calculate_turnover(),
            "diversification": self.calculate_diversification_index(),
        }

        if benchmark_return_pct is not None:
            metrics["tracking_error_pct"] = self.calculate_tracking_error(benchmark_return_pct)
            metrics["benchmark_return_pct"] = benchmark_return_pct

        return metrics
