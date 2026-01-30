"""CLI interface for portfolio_db."""

import json
import csv
import click
from datetime import datetime
from portfolio_db.portfolio_service import PortfolioService


def format_currency(value, decimals=2):
    """Format value as currency."""
    if value is None or value == 0:
        return "$0.00"
    return f"${value:,.{decimals}f}"


def format_percent_colored(value):
    """Format value as percentage with color."""
    if value > 0:
        return click.style(f"+{value:.2f}%", fg='green')
    elif value < 0:
        return click.style(f"{value:.2f}%", fg='red')
    else:
        return f"{value:.2f}%"


def format_number(value):
    """Format number with appropriate precision."""
    if value == 0 or value is None:
        return "0"
    if abs(value) < 0.01:
        return f"{value:.6f}"
    if abs(value) < 1:
        return f"{value:.4f}"
    if abs(value) < 100:
        return f"{value:.2f}"
    return f"{value:,.2f}"


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

        click.echo("\n" + "=" * 100)
        click.echo("PORTFOLIO DAILY RETURNS (WITH SEPARATED METRICS)")
        click.echo("=" * 100 + "\n")

        click.echo(f"{'Date':<12} {'Portfolio Value':>18} {'Daily %':>12} {'Invest %':>12} {'Cash Flow':>15}")
        click.echo("-" * 100)

        for ret in returns:
            date_str = ret['date']
            value = ret['portfolio_value']
            daily_ret = ret['portfolio_daily_return']
            invest_ret = ret['investment_return']
            cash_flow = ret['cash_flow_impact']
            click.echo(f"{date_str:<12} ${value:>16,.2f} {daily_ret:>11.2f}% {invest_ret:>11.2f}% ${cash_flow:>13,.2f}")

        click.echo("\n" + "=" * 100)
        stats = service.get_performance_stats()
        click.echo(f"Total days: {stats['total_days']}")
        click.echo(f"Start value: ${stats['start_value']:,.2f}")
        click.echo(f"End value: ${stats['end_value']:,.2f}")
        click.echo(f"Total gain: ${stats['total_gain']:,.2f}")
        click.echo(f"Avg daily return: {stats['avg_daily_return']:.4f}%")
        click.echo(f"Avg investment return: {stats['avg_investment_return']:.4f}%")
        click.echo(f"Total cash flow: ${stats['total_cash_flow']:,.2f}")
        click.echo("=" * 100)

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
    """Show portfolio status with separated return metrics."""
    service = PortfolioService(db)
    trans_count = service.db.get_transaction_count()
    returns = service.get_daily_returns()
    stats = service.get_performance_stats()

    click.echo(f"Transactions: {trans_count}")
    click.echo(f"Daily returns: {len(returns)}")
    click.echo(f"Start date: {stats['start_date']}")
    click.echo(f"End date: {stats['end_date']}")
    click.echo(f"Current value: ${stats['end_value']:,.2f}")
    click.echo(f"Total gain: ${stats['total_gain']:,.2f}")
    click.echo(f"Avg investment return: {stats['avg_investment_return']:.4f}%")
    click.echo(f"Total cash flow: ${stats['total_cash_flow']:,.2f}")

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
@click.option('--db', default='portfolio.db', help='Path to database file')
def verify_prices(db):
    """Verify prices table structure and storage."""
    service = PortfolioService(db)
    info = service.verify_prices_storage()

    click.echo("\n" + "=" * 70)
    click.echo("PRICES TABLE VERIFICATION")
    click.echo("=" * 70 + "\n")

    click.echo("Schema:")
    for col in info['schema']:
        pk_marker = " [PRIMARY KEY]" if col['is_primary_key'] else ""
        click.echo(f"  - {col['column']}: {col['type']}{pk_marker}")

    click.echo("\nStatistics:")
    click.echo(f"  Total records: {info['statistics']['total_records']:,}")
    click.echo(f"  Date range: {info['statistics']['min_date']} to {info['statistics']['max_date']}")
    click.echo(f"  Days: {info['statistics']['date_range_days']}")

    click.echo(f"\nUnique tickers: {len(info['ticker_breakdown'])}")
    if info['ticker_breakdown']:
        click.echo("  Top tickers by record count:")
        for ticker_info in info['ticker_breakdown'][:10]:
            click.echo(f"    - {ticker_info['ticker']}: {ticker_info['record_count']:,} records")

    click.echo("\nOptimization Notes:")
    for note in info['optimization_notes']:
        click.echo(f"  ✓ {note}")

    click.echo("\n" + "=" * 70)
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
            if result['recalc_type'] == 'cached':
                click.echo(f"✓ Using cached results (no recalculation needed)")
                click.echo(f"  Message: {result.get('message', 'Cached data is current')}")
            else:
                click.echo(f"✓ Recalculation completed")
                click.echo(f"  Type: {result['recalc_type'].upper()}")
                click.echo(f"  Rows affected: {result['rows_affected']}")
        else:
            click.echo(f"Error: {result.get('message', 'Unknown error')}", err=True)
    except Exception as e:
        click.echo(f"Error: {str(e)}", err=True)
    finally:
        service.close()


@cli.command()
@click.option('--filter', type=click.Choice(['open', 'all']), default='all', help='Filter positions (open=held, all=including closed)')
@click.option('--export', default=None, help='Export to CSV file (e.g., portfolio.csv)')
@click.option('--db', default='portfolio.db', help='Path to database file')
def summary(filter, export, db):
    """Show portfolio position summary with gains/losses."""
    service = PortfolioService(db)

    try:
        include_closed = (filter == 'all')
        positions = service.get_position_summary(include_closed=include_closed)

        if not positions:
            click.echo("No positions found")
            service.close()
            return

        # Export to CSV if requested
        if export:
            try:
                with open(export, 'w', newline='') as csvfile:
                    fieldnames = [
                        'Symbol', 'Status', 'Shares', 'Last Price', 'AC/Share',
                        'Total Cost', 'Market Value',
                        'Day Gain %', 'Day Gain $', 'Total Gain %', 'Total Gain $',
                        'Realized Gain $', 'Realized Gain %'
                    ]
                    writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
                    writer.writeheader()

                    for pos in positions:
                        writer.writerow({
                            'Symbol': pos['symbol'],
                            'Status': pos['status'],
                            'Shares': f"{pos['shares']:.6f}".rstrip('0').rstrip('.'),
                            'Last Price': f"{pos['last_price']:.2f}" if pos['last_price'] else "0",
                            'AC/Share': f"{pos['avg_cost_per_share']:.2f}",
                            'Total Cost': f"{pos['total_cost']:.2f}",
                            'Market Value': f"{pos['market_value']:.2f}",
                            'Day Gain %': f"{pos['day_gain_pct']:.2f}",
                            'Day Gain $': f"{pos['day_gain_value']:.2f}",
                            'Total Gain %': f"{pos['total_gain_pct']:.2f}",
                            'Total Gain $': f"{pos['total_gain_value']:.2f}",
                            'Realized Gain $': f"{pos['realized_gain_value']:.2f}",
                            'Realized Gain %': f"{pos['realized_gain_pct']:.2f}",
                        })

                click.echo(f"✓ Exported {len(positions)} positions to {export}")
            except Exception as e:
                click.echo(f"Error exporting CSV: {str(e)}", err=True)
            finally:
                service.close()
            return

        # Display table
        click.echo("\n" + "=" * 200)
        click.echo("PORTFOLIO POSITION SUMMARY")
        click.echo("=" * 200 + "\n")

        # Compact table header
        header = (
            f"{'Symbol':<10} "
            f"{'Status':<6} "
            f"{'Shares':>11} "
            f"{'Price':>11} "
            f"{'AC/Sh':>10} "
            f"{'Cost':>12} "
            f"{'Market Val':>12} "
            f"{'Day %':>8} "
            f"{'Day $':>11} "
            f"{'Total %':>8} "
            f"{'Total $':>11} "
            f"{'Real Gain $':>12} "
            f"{'Real %':>8}"
        )
        click.echo(header)
        click.echo("-" * 200)

        # Table rows
        for pos in positions:
            symbol = pos['symbol']
            status = pos['status']
            shares = format_number(pos['shares'])
            last_price = format_currency(pos['last_price'], 2) if pos['last_price'] else "$0"
            avg_cost = format_currency(pos['avg_cost_per_share'], 2)
            total_cost = format_currency(pos['total_cost'], 0)
            market_value = format_currency(pos['market_value'], 0)
            day_gain_pct = format_percent_colored(pos['day_gain_pct'])
            day_gain_value = format_currency(pos['day_gain_value'], 0)
            total_gain_pct = format_percent_colored(pos['total_gain_pct'])
            total_gain_value = format_currency(pos['total_gain_value'], 0)
            realized_gain_value = format_currency(pos['realized_gain_value'], 0)
            realized_gain_pct = format_percent_colored(pos['realized_gain_pct'])

            click.echo(
                f"{symbol:<10} "
                f"{status:<6} "
                f"{shares:>11} "
                f"{last_price:>11} "
                f"{avg_cost:>10} "
                f"{total_cost:>12} "
                f"{market_value:>12} "
                f"{day_gain_pct:>8} "
                f"{day_gain_value:>11} "
                f"{total_gain_pct:>8} "
                f"{total_gain_value:>11} "
                f"{realized_gain_value:>12} "
                f"{realized_gain_pct:>8}"
            )

        click.echo("\n" + "=" * 200)

    except Exception as e:
        click.echo(f"Error: {str(e)}", err=True)
    finally:
        service.close()


if __name__ == '__main__':
    cli()
