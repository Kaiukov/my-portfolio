"""Validator for checking metrics consistency and identifying data quality issues."""

from decimal import Decimal
from typing import Dict, List
from dataclasses import dataclass


@dataclass
class ValidationWarning:
    """Represents a metrics consistency issue."""
    severity: str  # "critical", "warning", "info"
    metric: str
    message: str
    explanation: str


class MetricsValidator:
    """Validate logical consistency of portfolio metrics."""

    def validate_all(self, metrics: Dict) -> List[ValidationWarning]:
        """Run all validation checks and return list of issues found."""
        warnings = []

        warnings.extend(self._check_sharpe_vs_drawdown(metrics))
        warnings.extend(self._check_sortino_vs_sharpe(metrics))
        warnings.extend(self._check_return_vs_drawdown_symmetry(metrics))
        warnings.extend(self._check_diversification_vs_drawdown(metrics))
        warnings.extend(self._check_volatility_vs_drawdown(metrics))
        warnings.extend(self._check_turnover_consistency(metrics))
        warnings.extend(self._check_cost_basis_vs_value(metrics))

        return warnings

    def _check_sharpe_vs_drawdown(self, metrics: Dict) -> List[ValidationWarning]:
        """High Sharpe with catastrophic drawdown = problem."""
        sharpe = float(metrics.get("sharpe_ratio", 0) or 0)
        drawdown = float(metrics.get("max_drawdown_pct", 0) or 0)
        drawdown = abs(drawdown)

        if sharpe > 3.0 and drawdown > 50:
            return [ValidationWarning(
                severity="critical",
                metric="sharpe_vs_drawdown",
                message=f"🔴 High Sharpe ({sharpe:.2f}) inconsistent with large drawdown ({drawdown:.1f}%)",
                explanation=(
                    "Sharpe >3 indicates smooth, low-risk returns. "
                    f"But max drawdown of {drawdown:.1f}% indicates catastrophic loss. "
                    "Suggests: (1) synthetic/incorrect volatility data, "
                    "(2) metrics from different time periods, or "
                    "(3) recent crash not in historical volatility."
                )
            )]
        return []

    def _check_sortino_vs_sharpe(self, metrics: Dict) -> List[ValidationWarning]:
        """Sortino >> Sharpe suggests data issues."""
        sortino = float(metrics.get("sortino_ratio", 0) or 0)
        sharpe = float(metrics.get("sharpe_ratio", 1) or 1)

        if sharpe > 0:
            ratio = sortino / sharpe
        else:
            return []

        if ratio > 10:
            return [ValidationWarning(
                severity="critical",
                metric="sortino_vs_sharpe",
                message=f"🔴 Sortino ({sortino:.1f}) is {ratio:.0f}x higher than Sharpe ({sharpe:.2f})",
                explanation=(
                    "Sortino typically 1.2-2x Sharpe ratio. "
                    f"Ratio of {ratio:.0f}x indicates: "
                    "(1) almost zero downside volatility (unrealistic), "
                    "(2) synthetic returns with no negative days, or "
                    "(3) calculation error in downside deviation."
                )
            )]
        return []

    def _check_return_vs_drawdown_symmetry(self, metrics: Dict) -> List[ValidationWarning]:
        """Return = -Drawdown suggests 'paper profit' scenario."""
        abs_return = float(metrics.get("absolute_return_pct", 0) or 0)
        drawdown = float(metrics.get("max_drawdown_pct", 0) or 0)

        # Check if values are nearly symmetric (within 1%)
        if abs(abs_return + drawdown) < 1.0:
            return [ValidationWarning(
                severity="warning",
                metric="return_drawdown_symmetry",
                message=f"📊 Return (+{abs_return:.1f}%) mirrors Drawdown ({drawdown:.1f}%)",
                explanation=(
                    "Symmetric return and drawdown suggest portfolio gained significantly "
                    "then lost nearly all gains back to cost basis. "
                    "All profit was unrealized 'paper profit' - consider profit-taking strategy."
                )
            )]
        return []

    def _check_diversification_vs_drawdown(self, metrics: Dict) -> List[ValidationWarning]:
        """High diversification + large drawdown = hidden correlation."""
        div_index = float(metrics.get("diversification_index", 0) or 0)
        drawdown = float(metrics.get("max_drawdown_pct", 0) or 0)
        drawdown = abs(drawdown)

        allocation = metrics.get("allocation", {})
        cash_pct = 0
        if isinstance(allocation, dict):
            cash_data = allocation.get("cash", {})
            if isinstance(cash_data, dict):
                cash_pct = float(cash_data.get("pct", 0) or 0)

        if div_index > 0.85 and drawdown > 50 and cash_pct < 50:
            return [ValidationWarning(
                severity="critical",
                metric="diversification_vs_drawdown",
                message=f"🔴 High diversification ({div_index:.2f}) with {drawdown:.1f}% drawdown",
                explanation=(
                    f"Portfolio has {cash_pct:.1f}% cash and high diversification, "
                    f"yet lost {drawdown:.1f}% from peak. "
                    "Suggests: (1) assets highly correlated in crashes, "
                    "(2) diversification metric excludes cash, or "
                    "(3) use of leverage/margin amplified losses."
                )
            )]
        return []

    def _check_volatility_vs_drawdown(self, metrics: Dict) -> List[ValidationWarning]:
        """Low volatility + large drawdown = synthetic data."""
        volatility = float(metrics.get("volatility", 0) or 0)
        drawdown = float(metrics.get("max_drawdown_pct", 0) or 0)
        drawdown = abs(drawdown)

        if volatility < 15 and drawdown > 50:
            return [ValidationWarning(
                severity="warning",
                metric="volatility_vs_drawdown",
                message=f"⚠️ Low volatility ({volatility:.1f}%) inconsistent with {drawdown:.1f}% drawdown",
                explanation=(
                    "Portfolios with <15% volatility rarely experience >50% drawdowns. "
                    "Suggests volatility from synthetic/estimated data, not actual history."
                )
            )]
        return []

    def _check_turnover_consistency(self, metrics: Dict) -> List[ValidationWarning]:
        """Very low turnover suggests buy-and-hold."""
        turnover = float(metrics.get("annual_turnover_pct", 0) or 0)
        drawdown = float(metrics.get("max_drawdown_pct", 0) or 0)
        drawdown = abs(drawdown)

        if turnover < 5 and drawdown > 60:
            return [ValidationWarning(
                severity="info",
                metric="turnover_strategy",
                message=f"📌 Buy-and-hold ({turnover:.1f}% turnover) with {drawdown:.1f}% drawdown",
                explanation=(
                    "Low turnover indicates buy-and-hold approach. "
                    f"Large {drawdown:.1f}% drawdown suggests strategy lacked: "
                    "(1) stop-losses, (2) portfolio rebalancing, or "
                    "(3) profit-taking discipline."
                )
            )]
        return []

    def _check_cost_basis_vs_value(self, metrics: Dict) -> List[ValidationWarning]:
        """Check if cost basis and value relationship makes sense."""
        total_investment = float(metrics.get("total_investment", 0) or 0)
        total_value = float(metrics.get("total_value", 0) or 0)
        total_cash = float(metrics.get("total_cash", 0) or 0)

        # Cost basis should include all deposits (including cash)
        # If total_investment < total_cash, that's a problem
        if total_investment > 0 and total_cash > 0:
            cash_pct_of_investment = (total_cash / total_investment) * 100
            if cash_pct_of_investment > 80:
                return [ValidationWarning(
                    severity="info",
                    metric="cost_basis_composition",
                    message=f"💰 Cash is {cash_pct_of_investment:.0f}% of total investment",
                    explanation=(
                        f"High cash allocation ({cash_pct_of_investment:.0f}%) means most of "
                        "'total investment' is idle cash rather than invested assets. "
                        "Consider deploying for better returns or acknowledge defensive positioning."
                    )
                )]
        return []
