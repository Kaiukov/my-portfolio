"""CLI interface for portfolio management."""

import json
from datetime import date
from decimal import Decimal
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

from src.models import AssetType, TransactionType, Transaction
from src.storage import TransactionStorage
from src.prices import PriceFetcher
from src.portfolio import PortfolioAnalyzer
from src.importer import InteractiveBrokersImporter, SimplifiedPortfolioImporter
from src.metrics_validator import MetricsValidator

app = typer.Typer(help="Portfolio tracking with FIFO cost basis")
console = Console()

# Global instances
storage = TransactionStorage()
fetcher = PriceFetcher()
analyzer = PortfolioAnalyzer(storage, fetcher)


@app.command()
def import_csv(
    csv_file: str = typer.Argument(..., help="Path to CSV file (simplified portfolio or Interactive Brokers format)"),
    clear_first: bool = typer.Option(False, "--clear-first", help="Clear existing transactions before import"),
    format: str = typer.Option("auto", "--format", help="CSV format: 'auto', 'simplified', or 'ib'"),
):
    """Import transactions from CSV file (simplified portfolio or Interactive Brokers format)."""
    count = 0

    if format == "auto":
        # Try simplified format first (more common)
        count = SimplifiedPortfolioImporter.import_csv(csv_file, storage, clear_first)
        if count > 0:
            console.print(f"[green]✓[/green] Imported {count} transactions from {csv_file} (simplified format)")
        else:
            # Fall back to Interactive Brokers format
            count = InteractiveBrokersImporter.import_csv(csv_file, storage, clear_first)
            if count > 0:
                console.print(f"[green]✓[/green] Imported {count} transactions from {csv_file} (Interactive Brokers format)")
            else:
                console.print(f"[yellow]⚠[/yellow] No transactions imported from {csv_file}")
    elif format == "simplified":
        count = SimplifiedPortfolioImporter.import_csv(csv_file, storage, clear_first)
        console.print(f"[green]✓[/green] Imported {count} transactions from {csv_file} (simplified format)")
    elif format == "ib":
        count = InteractiveBrokersImporter.import_csv(csv_file, storage, clear_first)
        console.print(f"[green]✓[/green] Imported {count} transactions from {csv_file} (Interactive Brokers format)")
    else:
        console.print(f"[red]✗ Error:[/red] Unknown format: {format}")
        raise typer.Exit(1)


@app.command()
def add(
    symbol: str = typer.Argument(..., help="Asset symbol (e.g., BTC-USD, AAPL)"),
    quantity: str = typer.Argument(..., help="Quantity"),
    price: str = typer.Option(..., "--price", help="Price per unit"),
    currency: str = typer.Option("USD", "--currency", help="Currency (USD, EUR, GBP)"),
    asset_type: str = typer.Option(..., "--asset-type", help="Asset type (crypto, stock, etf, cash)"),
    action: str = typer.Option("buy", "--action", help="Transaction action (buy, sell, deposit, withdrawal)"),
    fees: str = typer.Option("0", "--fees", help="Transaction fees"),
    txn_date: Optional[str] = typer.Option(None, "--date", help="Transaction date (YYYY-MM-DD), default today"),
    exchange: str = typer.Option("", "--exchange", help="Exchange/broker name"),
):
    """Add a transaction to portfolio."""
    try:
        # Parse date or use today
        if txn_date:
            txn_date_obj = date.fromisoformat(txn_date)
        else:
            txn_date_obj = date.today()

        txn = Transaction(
            date=txn_date_obj,
            asset=symbol,
            asset_type=AssetType(asset_type),
            action=TransactionType(action),
            quantity=Decimal(quantity),
            price=Decimal(price),
            currency=currency,
            fees=Decimal(fees),
            exchange=exchange,
        )

        storage.add_transaction(txn)
        console.print(f"[green]✓[/green] Added {quantity} {symbol} @ {price} {currency} ({action})")

        # Auto-deduct CASH when buying non-CASH assets
        if action == "buy" and asset_type != "cash":
            cash_amount = Decimal(quantity) * Decimal(price) + Decimal(fees)
            cash_txn = Transaction(
                date=txn_date_obj,
                asset="CASH",
                asset_type=AssetType.CASH,
                action=TransactionType.WITHDRAWAL,
                quantity=cash_amount,
                price=Decimal("1"),
                currency=currency,
                fees=Decimal("0"),
                exchange="",
            )
            storage.add_transaction(cash_txn)
            console.print(f"[dim]  Auto-deducted {cash_amount} {currency} from CASH[/dim]")

        # Auto-deposit CASH when selling non-CASH assets
        elif action == "sell" and asset_type != "cash":
            cash_amount = Decimal(quantity) * Decimal(price) - Decimal(fees)
            cash_txn = Transaction(
                date=txn_date_obj,
                asset="CASH",
                asset_type=AssetType.CASH,
                action=TransactionType.DEPOSIT,
                quantity=cash_amount,
                price=Decimal("1"),
                currency=currency,
                fees=Decimal("0"),
                exchange="",
            )
            storage.add_transaction(cash_txn)
            console.print(f"[dim]  Auto-deposited {cash_amount} {currency} to CASH[/dim]")

    except Exception as e:
        console.print(f"[red]✗ Error:[/red] {e}")
        raise typer.Exit(1)


@app.command()
def list(
    asset_type: Optional[str] = typer.Option(None, "--type", help="Filter by asset type"),
    symbol: Optional[str] = typer.Option(None, "--symbol", help="Filter by symbol"),
):
    """List all transactions."""
    transactions = storage.load_transactions()

    # Apply filters
    if asset_type:
        transactions = [t for t in transactions if t.asset_type.value == asset_type]
    if symbol:
        transactions = [t for t in transactions if t.asset == symbol]

    if not transactions:
        console.print("[yellow]No transactions found[/yellow]")
        return

    # Create table
    table = Table(title="Transactions")
    table.add_column("Date", style="cyan")
    table.add_column("Asset", style="magenta")
    table.add_column("Type", style="green")
    table.add_column("Action", style="yellow")
    table.add_column("Quantity", justify="right")
    table.add_column("Price", justify="right")
    table.add_column("Currency")
    table.add_column("Fees", justify="right")
    table.add_column("Exchange")

    for txn in transactions:
        table.add_row(
            str(txn.date),
            txn.asset,
            txn.asset_type.value,
            txn.action.value,
            f"{txn.quantity:,.8f}".rstrip("0").rstrip("."),
            f"{txn.price:,.2f}",
            txn.currency,
            f"{txn.fees:,.2f}",
            txn.exchange,
        )

    console.print(table)


@app.command()
def summary(
    output: str = typer.Option("table", "--output", help="Output format (table or terminal)"),
    json_output: bool = typer.Option(False, "--json", help="Output as JSON (LLM-ready format)"),
):
    """Show portfolio summary with current values and P&L."""
    positions = analyzer.get_current_positions()

    if not positions:
        if json_output:
            print(json.dumps({"positions": [], "totals": {}}))
            return
        console.print("[yellow]No positions found[/yellow]")
        return

    if json_output or output == "terminal":
        # JSON output to terminal
        totals = analyzer.get_total_value()

        positions_data = []
        for pos in positions:
            # Convert non-USD value to USD for display
            usd_value = pos["current_value"]
            usd_cost_basis = pos["cost_basis"]

            if pos["currency"] != "USD":
                rate = fetcher.get_exchange_rate(pos["currency"], "USD")
                if rate:
                    usd_value = pos["current_value"] * rate
                    usd_cost_basis = pos["cost_basis"] * rate

            positions_data.append({
                "symbol": pos["symbol"],
                "asset_type": pos["asset_type"],
                "currency": pos["currency"],
                "quantity": str(pos["quantity"]),
                "current_price": float(pos["current_price"]),
                "value_usd": float(usd_value),
                "cost_basis_usd": float(usd_cost_basis),
                "unrealized_pl_usd": float(pos["unrealized_pl"]),
                "unrealized_pl_pct": float(pos["unrealized_pl_pct"]),
            })

        summary_data = {
            "positions": positions_data,
            "totals": {
                "total_investment": float(totals["total_investment"]),
                "total_cash": float(totals["total_cash"]),
                "total_value": float(totals["total_value"]),
                "total_pl": float(totals["total_pl"]),
                "total_pl_pct": float(totals["total_pl_pct"]),
            }
        }

        console.print(json.dumps(summary_data, indent=2))
        return

    # Create table
    table = Table(title="Portfolio Summary")
    table.add_column("Asset", style="cyan")
    table.add_column("Type", style="magenta")
    table.add_column("Currency")
    table.add_column("Quantity", justify="right")
    table.add_column("Current Price", justify="right")
    table.add_column("Value (USD)", justify="right", style="green")
    table.add_column("Cost Basis (USD)", justify="right")
    table.add_column("P&L (USD)", justify="right")
    table.add_column("P&L %", justify="right")

    for pos in positions:
        # Convert non-USD value to USD for display
        usd_value = pos["current_value"]
        usd_cost_basis = pos["cost_basis"]

        if pos["currency"] != "USD":
            rate = fetcher.get_exchange_rate(pos["currency"], "USD")
            if rate:
                usd_value = pos["current_value"] * rate
                usd_cost_basis = pos["cost_basis"] * rate

        pl_color = "green" if pos["unrealized_pl"] >= 0 else "red"
        pl_str = f"[{pl_color}]{pos['unrealized_pl']:+,.2f}[/{pl_color}]"
        pl_pct_str = f"[{pl_color}]{pos['unrealized_pl_pct']:+.2f}%[/{pl_color}]"

        table.add_row(
            pos["symbol"],
            pos["asset_type"],
            pos["currency"],
            f"{pos['quantity']:,.8f}".rstrip("0").rstrip("."),
            f"{pos['current_price']:,.2f}",
            f"{usd_value:,.2f}",
            f"{usd_cost_basis:,.2f}",
            pl_str,
            pl_pct_str,
        )

    console.print(table)

    # Print totals
    totals = analyzer.get_total_value()
    console.print()
    console.print("[bold]Portfolio Totals[/bold]")
    console.print(f"Total Investment (Cost Basis): [cyan]${totals['total_investment']:,.2f}[/cyan]")
    console.print(f"Total Cash: [cyan]${totals['total_cash']:,.2f}[/cyan]")
    console.print(f"Total Value: [bold green]${totals['total_value']:,.2f}[/bold green]")

    if totals["total_pl"] >= 0:
        console.print(f"Total P&L: [green]+${totals['total_pl']:,.2f} ({totals['total_pl_pct']:.2f}%)[/green]")
    else:
        console.print(f"Total P&L: [red]${totals['total_pl']:,.2f} ({totals['total_pl_pct']:.2f}%)[/red]")


@app.command()
def dividend(
    amount: str = typer.Argument(..., help="Dividend amount"),
    currency: str = typer.Option("USD", "--currency", help="Currency (USD, EUR, GBP, etc.)"),
    symbol: Optional[str] = typer.Option(None, "--symbol", help="Asset symbol dividend came from (optional)"),
    txn_date: Optional[str] = typer.Option(None, "--date", help="Transaction date (YYYY-MM-DD), default today"),
):
    """Add dividend deposit to cash balance."""
    try:
        # Parse date or use today
        if txn_date:
            txn_date_obj = date.fromisoformat(txn_date)
        else:
            txn_date_obj = date.today()

        dividend_amount = Decimal(amount)

        # Create CASH deposit transaction
        txn = Transaction(
            date=txn_date_obj,
            asset="CASH",
            asset_type=AssetType.CASH,
            action=TransactionType.DEPOSIT,
            quantity=dividend_amount,
            price=Decimal("1"),
            currency=currency,
            fees=Decimal("0"),
            exchange="dividend" + (f" ({symbol})" if symbol else ""),
        )

        storage.add_transaction(txn)
        console.print(f"[green]✓[/green] Added dividend: +{amount} {currency} to CASH{f' from {symbol}' if symbol else ''}")

    except Exception as e:
        console.print(f"[red]✗ Error:[/red] {e}")
        raise typer.Exit(1)


@app.command()
def cash(
    json_output: bool = typer.Option(False, "--json", help="Output as JSON (LLM-ready format)"),
):
    """Show cash balances by currency."""
    cash_balances = analyzer.get_cash_balances()

    if not cash_balances or "_total_usd" not in cash_balances:
        if json_output:
            print(json.dumps({"balances": [], "total_usd": 0}))
            return
        console.print("[yellow]No cash positions found[/yellow]")
        return

    total_usd = cash_balances.pop("_total_usd")

    if json_output:
        balances_data = []
        for currency in sorted(cash_balances.keys()):
            bal = cash_balances[currency]
            balances_data.append({
                "currency": currency,
                "quantity": float(bal["quantity"]),
                "usd_value": float(bal["usd_value"]),
                "usd_rate": float(bal["usd_rate"]),
            })
        print(json.dumps({
            "balances": balances_data,
            "total_usd": float(total_usd),
        }))
        return

    # Create table
    table = Table(title="Cash Balances")
    table.add_column("Currency", style="cyan")
    table.add_column("Quantity", justify="right")
    table.add_column("USD Value", justify="right", style="green")
    table.add_column("USD Rate", justify="right")

    for currency in sorted(cash_balances.keys()):
        bal = cash_balances[currency]
        table.add_row(
            currency,
            f"{bal['quantity']:,.8f}".rstrip("0").rstrip("."),
            f"${bal['usd_value']:,.2f}",
            f"{bal['usd_rate']:.4f}",
        )

    console.print(table)
    console.print(f"\n[bold]Total Cash (USD): [bold green]${total_usd:,.2f}[/bold green][/bold]")


@app.command()
def allocation(
    json_output: bool = typer.Option(False, "--json", help="Output as JSON (LLM-ready format)"),
):
    """Show portfolio allocation by asset type."""
    alloc = analyzer.get_allocation()
    totals = analyzer.get_total_value()

    if json_output:
        allocation_data = []
        for asset_type in ["crypto", "stock", "etf", "cash"]:
            if asset_type in alloc:
                data = alloc[asset_type]
                allocation_data.append({
                    "asset_type": asset_type,
                    "value_usd": float(data["value"]),
                    "percentage": float(data["pct"]),
                })
        print(json.dumps({
            "allocation": allocation_data,
            "total_value_usd": float(totals["total_value"]),
        }))
        return

    # Create table
    table = Table(title="Asset Allocation")
    table.add_column("Asset Type", style="cyan")
    table.add_column("Value (USD)", justify="right", style="green")
    table.add_column("% of Portfolio", justify="right")

    for asset_type in ["crypto", "stock", "etf", "cash"]:
        if asset_type in alloc:
            data = alloc[asset_type]
            table.add_row(
                asset_type.capitalize(),
                f"${data['value']:,.2f}",
                f"{data['pct']:.2f}%",
            )

    console.print(table)


@app.command()
def performance(
    json_output: bool = typer.Option(False, "--json", help="Output as JSON (LLM-ready format)"),
    benchmark: str = typer.Option("SPY", "--benchmark", help="Benchmark symbol (SPY, QQQ, IMOEX)"),
):
    """Show comprehensive portfolio performance metrics with professional analysis."""
    # Get benchmark data
    benchmark_data = fetcher.get_benchmark_performance(benchmark)
    benchmark_return_pct = benchmark_data["return_pct"] if benchmark_data else None
    risk_free_rate = fetcher.get_risk_free_rate()

    # Get all metrics
    return_metrics = analyzer.get_return_metrics(
        benchmark_return_pct=Decimal(str(benchmark_return_pct)) if benchmark_return_pct else None
    )
    risk_metrics = analyzer.get_risk_metrics(
        benchmark_return_pct=Decimal(str(benchmark_return_pct)) if benchmark_return_pct else None,
        risk_free_rate=risk_free_rate,
    )
    structural_metrics = analyzer.get_structural_metrics(
        benchmark_return_pct=Decimal(str(benchmark_return_pct)) if benchmark_return_pct else None
    )
    totals = analyzer.get_total_value()
    alloc = analyzer.get_allocation()

    if json_output:
        # JSON output for LLM analysis
        output = {
            "timestamp": date.today().isoformat(),
            "portfolio": {
                "total_value_usd": float(totals["total_value"]),
                "total_cost_basis": float(totals["total_investment"]),
                "total_cash": float(totals["total_cash"]),
                "inception_date": return_metrics.get("start_date", "").isoformat() if return_metrics.get("start_date") else None,
                "years_invested": float(return_metrics.get("years_invested", 0)),
            },
            "returns": {
                "absolute_return_pct": float(return_metrics.get("absolute_return_pct", 0)),
                "absolute_return_usd": float(return_metrics.get("absolute_return_usd", 0)),
                "cagr_pct": float(return_metrics.get("cagr_pct", 0)),
                "twr_pct": float(return_metrics.get("twr_pct", 0)),
                "mwr_pct": float(return_metrics.get("mwr_pct", 0)),
                "relative_return_pct": float(return_metrics.get("relative_return_pct", 0)) if "relative_return_pct" in return_metrics else None,
            },
            "risk": {
                "volatility_pct": float(risk_metrics.get("volatility_pct", 0)),
                "max_drawdown_pct": float(risk_metrics.get("max_drawdown", {}).get("max_drawdown_pct", 0)),
                "beta": float(risk_metrics.get("beta", 0)),
                "sharpe_ratio": float(risk_metrics.get("sharpe_ratio", 0)),
                "sortino_ratio": float(risk_metrics.get("sortino_ratio", 0)),
                "alpha_pct": float(risk_metrics.get("alpha_pct", 0)) if "alpha_pct" in risk_metrics else None,
            },
            "structure": {
                "allocation": {
                    "crypto": float(alloc["crypto"]["pct"]),
                    "stock": float(alloc["stock"]["pct"]),
                    "etf": float(alloc["etf"]["pct"]),
                    "cash": float(alloc["cash"]["pct"]),
                },
                "turnover": {
                    "annual_pct": float(structural_metrics["turnover"]["annual_turnover_pct"]),
                    "trades_per_month": float(structural_metrics["turnover"]["trades_per_month"]),
                    "style": structural_metrics["turnover"]["trading_style"],
                },
                "diversification_index": float(structural_metrics["diversification"]["total_index"]),
                "tracking_error_pct": float(structural_metrics.get("tracking_error_pct", 0)) if "tracking_error_pct" in structural_metrics else None,
            },
            "benchmark": {
                "symbol": benchmark,
                "return_pct": benchmark_return_pct,
            },
            "risk_free_rate_pct": float(risk_free_rate) * 100,
        }
        print(json.dumps(output, indent=2))
        return

    # Terminal output with rich formatting
    console.print()
    console.print("[bold]📊 PORTFOLIO PERFORMANCE REPORT[/bold]")
    console.print(f"Report Date: [cyan]{date.today().isoformat()}[/cyan]")
    console.print()

    # RETURN METRICS
    console.print("[bold]📈 RETURN METRICS[/bold]")
    return_table = Table(show_header=True, header_style="bold magenta")
    return_table.add_column("Metric", style="cyan", width=20)
    return_table.add_column("Value", justify="right", style="green", width=15)
    return_table.add_column("Interpretation", width=40)

    abs_ret = return_metrics.get("absolute_return_pct", 0)
    return_table.add_row(
        "Absolute Return",
        f"[green]{abs_ret:+.2f}%[/green]" if abs_ret >= 0 else f"[red]{abs_ret:+.2f}%[/red]",
        "Total profit/loss on investment"
    )

    cagr = return_metrics.get("cagr_pct", 0)
    return_table.add_row(
        "CAGR",
        f"[green]{cagr:+.2f}%[/green]" if cagr >= 0 else f"[red]{cagr:+.2f}%[/red]",
        "Annualized compound growth"
    )

    twr = return_metrics.get("twr_pct", 0)
    return_table.add_row(
        "TWR",
        f"[green]{twr:+.2f}%[/green]" if twr >= 0 else f"[red]{twr:+.2f}%[/red]",
        "Excludes cash flow timing"
    )

    mwr = return_metrics.get("mwr_pct", 0)
    return_table.add_row(
        "MWR",
        f"[green]{mwr:+.2f}%[/green]" if mwr >= 0 else f"[red]{mwr:+.2f}%[/red]",
        "Includes cash flow timing"
    )

    if "relative_return_pct" in return_metrics:
        rel_ret = return_metrics["relative_return_pct"]
        return_table.add_row(
            "Relative Return",
            f"[green]{rel_ret:+.2f}%[/green]" if rel_ret >= 0 else f"[red]{rel_ret:+.2f}%[/red]",
            f"vs {benchmark} benchmark"
        )

    console.print(return_table)
    console.print()

    # RISK METRICS
    console.print("[bold]🛡️ RISK METRICS[/bold]")
    risk_table = Table(show_header=True, header_style="bold magenta")
    risk_table.add_column("Metric", style="cyan", width=20)
    risk_table.add_column("Value", justify="right", style="green", width=15)
    risk_table.add_column("Interpretation", width=40)

    volatility = risk_metrics.get("volatility_pct", 0)
    risk_table.add_row(
        "Volatility",
        f"{volatility:.2f}%",
        "Annual price fluctuation"
    )

    max_dd = risk_metrics.get("max_drawdown", {}).get("max_drawdown_pct", 0)
    risk_table.add_row(
        "Max Drawdown",
        f"[red]{max_dd:.2f}%[/red]",
        "Deepest peak-to-trough decline"
    )

    beta = risk_metrics.get("beta", 1.0)
    beta_interp = "More volatile" if beta > 1 else "Less volatile" if beta < 1 else "In line"
    risk_table.add_row(
        "Beta",
        f"{beta:.2f}",
        f"{beta_interp} than market"
    )

    sharpe = risk_metrics.get("sharpe_ratio", 0)
    sharpe_color = "[green]" if sharpe > 1 else "[yellow]"
    sharpe_status = "Good" if sharpe > 1 else "Fair"
    risk_table.add_row(
        "Sharpe Ratio",
        f"{sharpe_color}{sharpe:.2f}[/{sharpe_color}]",
        f"{sharpe_status} risk-adjusted return"
    )

    sortino = risk_metrics.get("sortino_ratio", 0)
    risk_table.add_row(
        "Sortino Ratio",
        f"{sortino:.2f}",
        "Return per downside risk"
    )

    if "alpha_pct" in risk_metrics:
        alpha = risk_metrics["alpha_pct"]
        alpha_color = "[green]" if alpha > 0 else "[red]"
        risk_table.add_row(
            "Alpha",
            f"{alpha_color}{alpha:+.2f}%[/{alpha_color}]",
            "Excess return vs benchmark"
        )

    console.print(risk_table)
    console.print()

    # STRUCTURAL METRICS
    console.print("[bold]🎯 STRUCTURAL METRICS[/bold]")
    structural_table = Table(show_header=True, header_style="bold magenta")
    structural_table.add_column("Metric", style="cyan", width=20)
    structural_table.add_column("Value", justify="right", style="green", width=15)
    structural_table.add_column("Interpretation", width=40)

    turnover_pct = structural_metrics["turnover"]["annual_turnover_pct"]
    trading_style = structural_metrics["turnover"]["trading_style"]
    structural_table.add_row(
        "Annual Turnover",
        f"{turnover_pct:.1f}%",
        f"{trading_style.replace('_', ' ').title()} trading"
    )

    div_index = structural_metrics["diversification"]["total_index"]
    div_interp = structural_metrics["diversification"]["interpretation"]
    structural_table.add_row(
        "Diversification",
        f"{div_index:.2f}",
        f"{div_interp.title()} diversification"
    )

    # Allocation
    console.print()
    console.print("[bold]💼 ALLOCATION[/bold]")
    alloc_text = (
        f"Crypto: [cyan]{alloc['crypto']['pct']:.1f}%[/cyan] | "
        f"Stocks: [cyan]{alloc['stock']['pct']:.1f}%[/cyan] | "
        f"ETFs: [cyan]{alloc['etf']['pct']:.1f}%[/cyan] | "
        f"Cash: [cyan]{alloc['cash']['pct']:.1f}%[/cyan]"
    )
    console.print(alloc_text)

    console.print()
    structural_table.add_row(
        "Tracking Error",
        f"{structural_metrics.get('tracking_error_pct', 0):.1f}%",
        "Deviation from benchmark"
    )

    console.print(structural_table)
    console.print()

    # PORTFOLIO SUMMARY
    console.print("[bold]📝 PORTFOLIO SUMMARY[/bold]")
    summary_table = Table(show_header=True, header_style="bold cyan")
    summary_table.add_column("", width=25)
    summary_table.add_column("USD Value", justify="right", style="green", width=20)

    summary_table.add_row("Total Investment", f"${totals['total_investment']:,.2f}")
    summary_table.add_row("Total Cash", f"${totals['total_cash']:,.2f}")
    summary_table.add_row("Total Value", f"[bold]${totals['total_value']:,.2f}[/bold]")
    summary_table.add_row("Total P&L", f"${totals['total_pl']:,.2f} ({totals['total_pl_pct']:+.2f}%)")

    console.print(summary_table)
    console.print()

    # METRICS VALIDATION
    validator = MetricsValidator()
    all_metrics = {
        **return_metrics,
        **risk_metrics,
        **structural_metrics,
        "total_investment": float(totals["total_investment"]),
        "total_cash": float(totals["total_cash"]),
        "total_value": float(totals["total_value"]),
        "allocation": alloc,
    }
    warnings = validator.validate_all(all_metrics)

    if warnings:
        console.print()
        console.print("[bold]" + "="*80 + "[/bold]")
        console.print("[bold]⚠️  METRICS CONSISTENCY WARNINGS[/bold]")
        console.print("[bold]" + "="*80 + "[/bold]")

        for warning in warnings:
            severity_emoji = {
                "critical": "🔴",
                "warning": "🟡",
                "info": "🔵"
            }
            console.print()
            console.print(f"{severity_emoji[warning.severity]} [bold]{warning.message}[/bold]")
            console.print(f"   {warning.explanation}")


@app.command()
def export(
    format: str = typer.Option("json", "--format", help="Export format (json or csv)"),
    output: Optional[str] = typer.Option(None, "--output", help="Output file path"),
):
    """Export transactions to file."""
    import json
    import csv

    transactions = storage.load_transactions()

    if not transactions:
        console.print("[yellow]No transactions to export[/yellow]")
        return

    if format == "json":
        output_file = output or "transactions.json"
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

        with open(output_file, "w") as f:
            json.dump(data, f, indent=2)

        console.print(f"[green]✓[/green] Exported {len(transactions)} transactions to {output_file}")

    elif format == "csv":
        output_file = output or "transactions.csv"
        with open(output_file, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=[
                "date", "asset", "asset_type", "action", "quantity", "price",
                "currency", "fees", "exchange"
            ])
            writer.writeheader()

            for txn in transactions:
                writer.writerow({
                    "date": txn.date.isoformat(),
                    "asset": txn.asset,
                    "asset_type": txn.asset_type.value,
                    "action": txn.action.value,
                    "quantity": txn.quantity,
                    "price": txn.price,
                    "currency": txn.currency,
                    "fees": txn.fees,
                    "exchange": txn.exchange,
                })

        console.print(f"[green]✓[/green] Exported {len(transactions)} transactions to {output_file}")

    else:
        console.print(f"[red]✗ Error:[/red] Unknown format: {format}")
        raise typer.Exit(1)


def main():
    """Main entry point."""
    app()


if __name__ == "__main__":
    main()
