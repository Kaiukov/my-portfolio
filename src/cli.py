"""CLI interface for portfolio management."""

import json
import click

from src.csv_reader import read_csv
from src.portfolio import PortfolioAnalyzer
from src.prices import PriceFetcher


def get_analyzer(csv_file):
    """Load CSV and create analyzer."""
    transactions = read_csv(csv_file)
    if not transactions:
        return None, None
    return PortfolioAnalyzer(transactions, PriceFetcher()), transactions


def format_position(pos, fetcher):
    """Format position for JSON output."""
    usd_value = pos["current_value"]
    usd_cost_basis = pos["cost_basis"]

    if pos["currency"] != "USD":
        rate = fetcher.get_exchange_rate(pos["currency"], "USD")
        if rate:
            usd_value = pos["current_value"] * rate
            usd_cost_basis = pos["cost_basis"] * rate

    # CASH positions always have 0 P&L
    if pos["symbol"].startswith("CASH"):
        unrealized_pl = 0.0
        unrealized_pl_pct = 0.0
    else:
        unrealized_pl = float(pos["unrealized_pl"])
        unrealized_pl_pct = float(pos["unrealized_pl_pct"])

    return {
        "symbol": pos["symbol"],
        "asset_type": pos["asset_type"],
        "currency": pos["currency"],
        "quantity": str(pos["quantity"]),
        "current_price": float(pos["current_price"]),
        "value_usd": float(usd_value),
        "cost_basis_usd": float(usd_cost_basis),
        "unrealized_pl_usd": unrealized_pl,
        "unrealized_pl_pct": unrealized_pl_pct,
    }


@click.group()
def cli():
    """Portfolio tracking with FIFO cost basis."""
    pass


@cli.command()
@click.option('--csv', default='yfiance-transactions/transactions.csv', help='Path to CSV file')
def summary(csv):
    """Show portfolio summary with current values and P&L as JSON."""
    analyzer, _ = get_analyzer(csv)
    if not analyzer:
        print(json.dumps({"positions": [], "totals": {}}))
        return

    fetcher = PriceFetcher()
    positions = analyzer.get_current_positions()
    totals = analyzer.get_total_value()

    positions_data = [format_position(pos, fetcher) for pos in positions]

    output = {
        "positions": positions_data,
        "totals": {
            "total_investment": float(totals["total_investment"]),
            "total_value": float(totals["total_value"]),
            "total_pl": float(totals["total_pl"]),
            "total_pl_pct": float(totals["total_pl_pct"]),
        }
    }

    print(json.dumps(output, indent=2))


@cli.command()
@click.option('--csv', default='yfiance-transactions/transactions.csv', help='Path to CSV file')
def cash(csv):
    """Show cash balances only as JSON."""
    analyzer, _ = get_analyzer(csv)
    if not analyzer:
        print(json.dumps({"balances": [], "total_usd": 0.0}))
        return

    fetcher = PriceFetcher()
    positions = analyzer.get_current_positions()

    cash_positions = [pos for pos in positions if pos["symbol"].startswith("CASH")]
    cash_data = [format_position(pos, fetcher) for pos in cash_positions]

    total_usd = sum(float(pos["value_usd"]) for pos in cash_data)

    output = {
        "balances": cash_data,
        "total_usd": total_usd,
    }

    print(json.dumps(output, indent=2))


if __name__ == '__main__':
    cli()
