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
@click.option('--type', type=click.Choice(['assets', 'cash', 'all']), default='all', help='Allocation type: assets only, cash only, or both')
@click.option('--export', default=None, help='Export to CSV file (e.g., allocation.csv)')
@click.option('--db', default='portfolio.db', help='Path to database file')
def allocation(type, export, db):
    """Show portfolio allocation breakdown."""
    service = PortfolioService(db)

    try:
        data = service.get_allocation(allocation_type=type)
        positions = data['positions']
        summary = data['summary']
        total_value = data['total_value']

        if not positions:
            click.echo("No positions found")
            service.close()
            return

        # Export to CSV if requested
        if export:
            try:
                with open(export, 'w', newline='') as csvfile:
                    fieldnames = ['Symbol', 'Type', 'Value', 'Percentage']
                    writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
                    writer.writeheader()

                    for pos in positions:
                        writer.writerow({
                            'Symbol': pos['symbol'],
                            'Type': pos['type'],
                            'Value': f"{pos['value']:.2f}",
                            'Percentage': f"{pos['percentage']:.2f}",
                        })

                    # Add summary rows
                    for s in summary:
                        writer.writerow({
                            'Symbol': s['symbol'],
                            'Type': s['type'],
                            'Value': f"{s['value']:.2f}",
                            'Percentage': f"{s['percentage']:.2f}",
                        })

                click.echo(f"✓ Exported allocation to {export}")
            except Exception as e:
                click.echo(f"Error exporting CSV: {str(e)}", err=True)
            finally:
                service.close()
            return

        # Display table
        click.echo("\n" + "=" * 120)
        click.echo(f"PORTFOLIO ALLOCATION - {type.upper()}")
        click.echo("=" * 120 + "\n")

        # Table header
        header = (
            f"{'Symbol':<20} "
            f"{'Type':<10} "
            f"{'Value':>15} "
            f"{'Percentage':>15}"
        )
        click.echo(header)
        click.echo("-" * 120)

        # Table rows
        for pos in positions:
            symbol = pos['symbol']
            pos_type = pos['type']
            value = format_currency(pos['value'], 2)
            percentage = f"{pos['percentage']:.2f}%"

            click.echo(
                f"{symbol:<20} "
                f"{pos_type:<10} "
                f"{value:>15} "
                f"{percentage:>15}"
            )

        # Summary section
        click.echo("\n" + "-" * 120)
        for s in summary:
            symbol = s['symbol']
            s_type = s['type']
            value = format_currency(s['value'], 2)
            percentage = f"{s['percentage']:.2f}%"

            click.echo(
                f"{symbol:<20} "
                f"{s_type:<10} "
                f"{value:>15} "
                f"{percentage:>15}"
            )

        click.echo("\n" + "=" * 120)

    except Exception as e:
        click.echo(f"Error: {str(e)}", err=True)
    finally:
        service.close()


@cli.command()
@click.option('--db', default='portfolio.db', help='Path to database file')
def cash(db):
    """Show actual cash balances with breakdown (converted to USD)."""
    service = PortfolioService(db)

    try:
        cash_balances = service.get_actual_cash_balances()

        # Fetch FX rates from yfinance
        fx_rates = {'EURUSD=X': 1.0, 'GBPUSD=X': 1.0}
        try:
            import yfinance as yf
            from datetime import date, timedelta

            end_date = date.today()
            start_date = end_date - timedelta(days=7)

            for ticker in ['EURUSD=X', 'GBPUSD=X']:
                try:
                    data = yf.Ticker(ticker).history(start=start_date, end=end_date)
                    if not data.empty:
                        fx_rates[ticker] = float(data['Close'].iloc[-1])
                except:
                    pass
        except:
            pass

        click.echo("\n" + "=" * 110)
        click.echo("ACTUAL CASH BALANCES (USD EQUIVALENT)")
        click.echo("=" * 110 + "\n")

        click.echo(f"{'Currency':<15} {'Balance (USD equiv)':>20} {'Deposits':>18} {'Spent on BUY':>18} {'Received from SELL':>20}")
        click.echo("-" * 110)

        total_balance_usd = 0.0
        for currency, data in cash_balances.items():
            balance = data['balance']
            deposits = data['deposits']
            spent = data['spent']
            received = data['received']

            # Skip if no activity at all
            if balance == 0 and deposits == 0 and spent == 0 and received == 0:
                continue

            # Convert to USD for FX pairs
            if currency == 'EURUSD=X':
                fx_rate = fx_rates['EURUSD=X']
                balance_usd = balance * fx_rate
                deposits_usd = deposits * fx_rate
                spent_usd = spent * fx_rate
                received_usd = received * fx_rate
                currency_display = f"EUR (rate: {fx_rate:.4f})"
            elif currency == 'GBPUSD=X':
                fx_rate = fx_rates['GBPUSD=X']
                balance_usd = balance * fx_rate
                deposits_usd = deposits * fx_rate
                spent_usd = spent * fx_rate
                received_usd = received * fx_rate
                currency_display = f"GBP (rate: {fx_rate:.4f})"
            else:
                balance_usd = balance
                deposits_usd = deposits
                spent_usd = spent
                received_usd = received
                currency_display = currency

            balance_str = format_currency(balance_usd)
            deposits_str = format_currency(deposits_usd)
            spent_str = format_currency(spent_usd)
            received_str = format_currency(received_usd)

            click.echo(
                f"{currency_display:<15} {balance_str:>20} {deposits_str:>18} "
                f"{spent_str:>18} {received_str:>20}"
            )

            # Add to total (all in USD)
            total_balance_usd += balance_usd

        click.echo("-" * 110)
        click.echo(f"{'TOTAL CASH (USD)':<15} {format_currency(total_balance_usd):>20}")
        click.echo("\n" + "=" * 110)

    except Exception as e:
        click.echo(f"Error: {str(e)}", err=True)
        import traceback
        traceback.print_exc()
    finally:
        service.close()


@cli.command()
@click.option('--id', required=True, type=int, help='Transaction ID to delete')
@click.option('--confirm', is_flag=True, help='Skip confirmation prompt')
@click.option('--db', default='portfolio.db', help='Path to database file')
def delete(id, confirm, db):
    """Delete transaction by ID and auto-recalculate returns."""
    service = PortfolioService(db)

    try:
        # Get transaction to confirm
        trans = service.db.con.execute(
            "SELECT id, date, asset, action, quantity, price FROM transactions WHERE id = ?",
            [id]
        ).fetchone()

        if not trans:
            click.echo(f"Error: Transaction ID {id} not found", err=True)
            service.close()
            return

        # Show transaction details
        click.echo(f"\nTransaction to delete (ID: {trans[0]}):")
        click.echo(f"  Date:     {trans[1]}")
        click.echo(f"  Asset:    {trans[2]}")
        click.echo(f"  Action:   {trans[3]}")
        click.echo(f"  Quantity: {trans[4]}")
        click.echo(f"  Price:    {trans[5]}")

        # Ask for confirmation
        if not confirm:
            if not click.confirm("\nAre you sure you want to delete this transaction?"):
                click.echo("Cancelled")
                service.close()
                return

        # Delete and recalculate
        result = service.delete_transaction(id)

        click.echo(f"\n✓ Transaction deleted (ID: {result['transaction_id']})")
        click.echo(f"✓ {result['recalc_type'].upper()} recalculation triggered from {result['from_date']}")
        click.echo(f"✓ {result['rows_affected']} daily returns recalculated")

    except Exception as e:
        click.echo(f"Error: {str(e)}", err=True)
    finally:
        service.close()


@cli.command()
@click.option('--db', default='portfolio.db', help='Path to database file')
@click.option('--table', 'table_output', is_flag=True, help='Output as human-readable table')
def performance(db, table_output):
    """Show performance metrics (JSON by default, use --table for readable format)."""
    import json
    service = PortfolioService(db)
    stats = service.get_performance_stats()
    concentration = service.get_concentration_metrics()

    # Helper for metric evaluation
    def eval_metric(name, value):
        return service.evaluate_metric(name, value)

    if table_output:
        # Human-readable table output
        click.echo("\n" + "=" * 80)
        click.echo("PORTFOLIO PERFORMANCE METRICS")
        click.echo("=" * 80 + "\n")

        click.echo(f"{'Period:':<30} {stats['start_date']} to {stats['end_date']}")
        click.echo(f"{'Total days:':<30} {stats['total_days']}")
        click.echo("-" * 80)

        click.echo(f"{'Start Value:':<30} ${stats['start_value']:,.2f}")
        click.echo(f"{'End Value:':<30} ${stats['end_value']:,.2f}")
        click.echo(f"{'Total Gain:':<30} ${stats['total_gain']:,.2f}")
        click.echo(f"{'Cash Flow (deposits):':<30} ${stats['total_cash_flow']:,.2f}")
        click.echo(f"{'Net Gain (excl. deposits):':<30} ${stats['net_gain']:,.2f}")
        click.echo("-" * 80)

        click.echo(f"{'Total Return:':<30} {stats['total_return_pct']:>10.2f}%   {eval_metric('total_return_pct', stats['total_return_pct'])}")
        click.echo(f"{'CAGR (annual):':<30} {stats['cagr']:>10.2f}%   {eval_metric('cagr', stats['cagr'])}")
        click.echo(f"{'Avg Daily Return:':<30} {stats['avg_daily_return']:>10.4f}%   {eval_metric('avg_daily_return', stats['avg_daily_return'])}")
        click.echo(f"{'Avg Monthly Return:':<30} {stats['avg_monthly_return']:>10.2f}%   {eval_metric('avg_monthly_return', stats['avg_monthly_return'])}")
        click.echo("-" * 80)
        click.echo(f"{'Standard Deviation:':<30} {stats['std_dev']:>10.4f}%   {eval_metric('std_dev', stats['std_dev'])}")
        click.echo(f"{'Historical Volatility (ann):':<30} {stats['hist_volatility']:>10.4f}%   {eval_metric('hist_volatility', stats['hist_volatility'])}")
        click.echo(f"{'Sharpe Ratio:':<30} {stats['sharpe_ratio']:>10.4f}   {eval_metric('sharpe_ratio', stats['sharpe_ratio'])}")
        click.echo(f"{'Sortino Ratio:':<30} {stats['sortino_ratio']:>10.4f}   {eval_metric('sortino_ratio', stats['sortino_ratio'])}")
        click.echo(f"{'Treynor Ratio:':<30} {stats['treynor_ratio']:>10.4f}   {eval_metric('treynor_ratio', stats['treynor_ratio'])}")
        click.echo(f"{'Information Ratio:':<30} {stats['information_ratio']:>10.4f}   {eval_metric('information_ratio', stats['information_ratio'])}")
        click.echo(f"{'Jensens Alpha:':<30} {stats['jensens_alpha']:>10.4f}%   {eval_metric('jensens_alpha', stats['jensens_alpha'])}")
        click.echo(f"{'Beta (β) vs SPY:':<30} {stats['beta']:>10.4f}   {eval_metric('beta', stats['beta'])}")
        click.echo("-" * 80)
        click.echo(f"{'VaR 95% (daily):':<30} {stats['var_95']:>10.4f}%   {eval_metric('var_95', stats['var_95'])}")
        click.echo(f"{'VaR 99% (daily):':<30} {stats['var_99']:>10.4f}%   {eval_metric('var_99', stats['var_99'])}")
        click.echo(f"{'CVaR 95% (daily):':<30} {stats['cvar_95']:>10.4f}%   {eval_metric('cvar_95', stats['cvar_95'])}")
        click.echo(f"{'CVaR 99% (daily):':<30} {stats['cvar_99']:>10.4f}%   {eval_metric('cvar_99', stats['cvar_99'])}")
        click.echo(f"{'Max Drawdown:':<30} {stats['max_drawdown']:>10.4f}%   {eval_metric('max_drawdown', stats['max_drawdown'])}")
        click.echo(f"{'Avg Drawdown:':<30} {stats['avg_drawdown']:>10.4f}%   {eval_metric('avg_drawdown', stats['avg_drawdown'])}")
        click.echo(f"{'Avg Drawdown Duration:':<30} {stats['avg_drawdown_duration']:>10.1f} days   {eval_metric('avg_drawdown_duration', stats['avg_drawdown_duration'])}")

        click.echo("\n" + "=" * 80)
        click.echo("CONCENTRATION")
        click.echo("=" * 80 + "\n")

        click.echo(f"{'HHI (Herfindahl Index):':<30} {concentration['hhi']:>10.4f}   {eval_metric('hhi', concentration['hhi'])}")
        click.echo(f"{'Weighted Avg Exposure:':<30} {concentration['weighted_avg_exposure']:>10.4f}   {eval_metric('weighted_avg_exposure', concentration['weighted_avg_exposure'])}")
        click.echo(f"{'Number of Positions:':<30} {concentration['num_positions']:>10}")

        click.echo("\n" + "=" * 80)
    else:
        # JSON output (default)
        result = {
            "period": {
                "start_date": stats['start_date'],
                "end_date": stats['end_date'],
                "total_days": stats['total_days']
            },
            "values": {
                "start_value": stats['start_value'],
                "end_value": stats['end_value'],
                "total_gain": stats['total_gain'],
                "net_gain": stats['net_gain'],
                "cash_flow": stats['total_cash_flow']
            },
            "returns": {
                "total_return_pct": [stats['total_return_pct'], eval_metric('total_return_pct', stats['total_return_pct'])],
                "cagr_pct": [stats['cagr'], eval_metric('cagr', stats['cagr'])],
                "avg_daily_return_pct": [stats['avg_daily_return'], eval_metric('avg_daily_return', stats['avg_daily_return'])],
                "avg_monthly_return_pct": [stats['avg_monthly_return'], eval_metric('avg_monthly_return', stats['avg_monthly_return'])]
            },
            "risk_metrics": {
                "std_dev_pct": [stats['std_dev'], eval_metric('std_dev', stats['std_dev'])],
                "hist_volatility_pct": [stats['hist_volatility'], eval_metric('hist_volatility', stats['hist_volatility'])],
                "beta": [stats['beta'], eval_metric('beta', stats['beta'])],
                "sharpe_ratio": [stats['sharpe_ratio'], eval_metric('sharpe_ratio', stats['sharpe_ratio'])],
                "sortino_ratio": [stats['sortino_ratio'], eval_metric('sortino_ratio', stats['sortino_ratio'])],
                "treynor_ratio": [stats['treynor_ratio'], eval_metric('treynor_ratio', stats['treynor_ratio'])],
                "information_ratio": [stats['information_ratio'], eval_metric('information_ratio', stats['information_ratio'])],
                "jensens_alpha": [stats['jensens_alpha'], eval_metric('jensens_alpha', stats['jensens_alpha'])]
            },
            "risk_of_loss": {
                "var_95_pct": [stats['var_95'], eval_metric('var_95', stats['var_95'])],
                "var_99_pct": [stats['var_99'], eval_metric('var_99', stats['var_99'])],
                "cvar_95_pct": [stats['cvar_95'], eval_metric('cvar_95', stats['cvar_95'])],
                "cvar_99_pct": [stats['cvar_99'], eval_metric('cvar_99', stats['cvar_99'])]
            },
            "drawdowns": {
                "max_drawdown_pct": [stats['max_drawdown'], eval_metric('max_drawdown', stats['max_drawdown'])],
                "avg_drawdown_pct": [stats['avg_drawdown'], eval_metric('avg_drawdown', stats['avg_drawdown'])],
                "avg_drawdown_duration_days": [stats['avg_drawdown_duration'], eval_metric('avg_drawdown_duration', stats['avg_drawdown_duration'])]
            },
            "concentration": {
                "hhi": [concentration['hhi'], eval_metric('hhi', concentration['hhi'])],
                "weighted_avg_exposure": [concentration['weighted_avg_exposure'], eval_metric('weighted_avg_exposure', concentration['weighted_avg_exposure'])],
                "num_positions": concentration['num_positions']
            }
        }
        click.echo(json.dumps(result, indent=2))

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
