"""CLI interface for portfolio_db."""

import json
import click
from portfolio_db.portfolio_service import PortfolioService


@click.group()
def cli():
    """Portfolio tracking with DuckDB."""
    pass


@cli.command()
@click.option('--csv', default='yfiance-transactions/transactions.csv', help='Path to CSV file')
@click.option('--db', default='portfolio.db', help='Path to database file')
def migrate(csv, db):
    """Migrate transactions from CSV to DuckDB."""
    service = PortfolioService(db)
    service.setup_from_csv(csv)
    print(f"Migrated {service.db.get_transaction_count()} transactions")
    service.close()


@cli.command()
@click.option('--format', type=click.Choice(['json', 'table']), default='json')
@click.option('--db', default='portfolio.db', help='Path to database file')
def report(format, db):
    """Show daily returns report."""
    service = PortfolioService(db)
    returns = service.get_daily_returns()

    if format == 'json':
        # Output pure JSON for shell redirection
        click.echo(json.dumps(returns, indent=2))
    else:
        # Table format
        if not returns:
            click.echo("No data")
            service.close()
            return

        click.echo("\n" + "=" * 70)
        click.echo("PORTFOLIO DAILY RETURNS")
        click.echo("=" * 70 + "\n")

        click.echo(f"{'Date':<12} {'Portfolio Value':>20} {'Daily Return %':>15}")
        click.echo("-" * 70)

        for ret in returns:
            date_str = ret['date']
            value = ret['portfolio_value']
            daily_ret = ret['portfolio_daily_return']
            click.echo(f"{date_str:<12} ${value:>18,.2f} {daily_ret:>14.2f}%")

        click.echo("\n" + "=" * 70)
        stats = service.get_performance_stats()
        click.echo(f"Total days: {stats['total_days']}")
        click.echo(f"Start value: ${stats['start_value']:,.2f}")
        click.echo(f"End value: ${stats['end_value']:,.2f}")
        click.echo(f"Total gain: ${stats['total_gain']:,.2f}")
        click.echo(f"Avg daily return: {stats['avg_daily_return']:.4f}%")
        click.echo("=" * 70)

    service.close()


@cli.command()
@click.option('--format', type=click.Choice(['json', 'table']), default='json')
@click.option('--db', default='portfolio.db', help='Path to database file')
def transactions(format, db):
    """List all transactions."""
    service = PortfolioService(db)
    trans = service.get_transactions()

    if format == 'json':
        # Output pure JSON for shell redirection
        click.echo(json.dumps(trans, indent=2))
    else:
        # Table format
        if not trans:
            click.echo("No transactions")
            service.close()
            return

        click.echo(f"\n{'Date':<12} {'Asset':<15} {'Action':<10} {'Qty':>10} {'Type':<10}")
        click.echo("-" * 70)

        for t in trans:
            click.echo(
                f"{t['date']:<12} {t['asset']:<15} {t['action']:<10} "
                f"{t['quantity']:>10.6f} {t['asset_type']:<10}"
            )

    service.close()


@cli.command()
@click.option('--db', default='portfolio.db', help='Path to database file')
def status(db):
    """Show portfolio status."""
    service = PortfolioService(db)
    trans_count = service.db.get_transaction_count()
    returns = service.get_daily_returns()
    stats = service.get_performance_stats()

    click.echo(f"Transactions: {trans_count}")
    click.echo(f"Daily returns: {len(returns)}")
    click.echo(f"Start date: {stats['start_date']}")
    click.echo(f"End date: {stats['end_date']}")
    click.echo(f"Current value: ${stats['end_value']:,.2f}")

    service.close()


if __name__ == '__main__':
    cli()
