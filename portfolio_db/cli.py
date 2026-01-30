"""CLI interface for portfolio_db."""

import json
import click
from datetime import datetime
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


@cli.command()
@click.option('--date', required=True, help='Transaction date (DD-MM-YYYY)')
@click.option('--asset', required=True, help='Asset symbol')
@click.option('--action', required=True, type=click.Choice(['BUY', 'SELL', 'DEPOSIT'], case_sensitive=False), help='Transaction action')
@click.option('--quantity', required=True, type=float, help='Transaction quantity')
@click.option('--price', type=float, default=None, help='Asset price (optional)')
@click.option('--currency', default='USD', help='Currency code (default USD)')
@click.option('--fees', type=float, default=None, help='Transaction fees (optional)')
@click.option('--exchange', default='', help='Exchange name (optional)')
@click.option('--db', default='portfolio.db', help='Path to database file')
def add(date, asset, action, quantity, price, currency, fees, exchange, db):
    """Add transaction and auto-recalculate returns."""
    try:
        # Parse and validate date
        date_obj = datetime.strptime(date, '%d-%m-%Y').date()
    except ValueError:
        click.echo(f"Error: Invalid date format. Use DD-MM-YYYY", err=True)
        return

    service = PortfolioService(db)
    try:
        result = service.add_transaction(
            date_obj=date_obj,
            asset=asset,
            action=action.upper(),
            quantity=quantity,
            price=price,
            currency=currency,
            fees=fees,
            exchange=exchange
        )

        click.echo(f"✓ Transaction added (ID: {result['transaction_id']})")
        click.echo(f"✓ {result['recalc_type'].upper()} recalculation triggered from {result['from_date']}")
    except Exception as e:
        click.echo(f"Error: {str(e)}", err=True)
    finally:
        service.close()


@cli.command()
@click.option('--force', is_flag=True, help='Force full recalculation (ignore optimization)')
@click.option('--from-date', default=None, help='Recalculate from date (DD-MM-YYYY, None = full recalc)')
@click.option('--db', default='portfolio.db', help='Path to database file')
def recalculate(force, from_date, db):
    """Recalculate portfolio returns."""
    from_date_obj = None

    if from_date:
        try:
            from_date_obj = datetime.strptime(from_date, '%d-%m-%Y').date()
        except ValueError:
            click.echo(f"Error: Invalid date format. Use DD-MM-YYYY", err=True)
            return

    service = PortfolioService(db)
    try:
        result = service.recalculate(from_date=from_date_obj, force=force)

        if result['status'] == 'success':
            click.echo(f"✓ Recalculation completed")
            click.echo(f"  Type: {result['recalc_type'].upper()}")
            click.echo(f"  Rows affected: {result['rows_affected']}")
        else:
            click.echo(f"Error: {result.get('message', 'Unknown error')}", err=True)
    except Exception as e:
        click.echo(f"Error: {str(e)}", err=True)
    finally:
        service.close()


if __name__ == '__main__':
    cli()
