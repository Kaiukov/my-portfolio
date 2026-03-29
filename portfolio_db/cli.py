"""CLI interface for portfolio_db."""

import click
import shutil
import sys
from datetime import datetime, date
from pathlib import Path
from portfolio_db.portfolio_service import PortfolioService, PriceDataUnavailableError
from portfolio_db.response import success, error, build_pagination
import portfolio_db.logger as log

USER_ACTION_CHOICES = [
    "BUY",
    "SELL",
    "DEPOSIT",
    "WITHDRAW",
    "DIVIDEND",
    "INTEREST",
    "FEE",
    "TAX",
    "TRANSFER",
]


def _parse_date(value: str, flag: str) -> date:
    """Parse YYYY-MM-DD string; call error() and exit on failure."""
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        error("_", "VALIDATION_ERROR", f"{flag} must be YYYY-MM-DD, got: {value!r}")


def _parse_legacy_date(value: str, flag: str) -> date:
    """Parse DD-MM-YYYY string (used by add / exchange / recalculate)."""
    try:
        return datetime.strptime(value, "%d-%m-%Y").date()
    except ValueError:
        error("_", "VALIDATION_ERROR", f"{flag} must be DD-MM-YYYY, got: {value!r}")


@click.group()
def cli():
    """Portfolio tracking with DuckDB."""
    pass


# ─── migrate ──────────────────────────────────────────────────────────────────

@cli.command()
@click.option("--csv", default="yfiance-transactions/transactions.csv", help="Path to CSV file")
@click.option("--db", default="portfolio.db", help="Path to database file")
def migrate(csv, db):
    """Migrate transactions from CSV to DuckDB."""
    service = PortfolioService(db)
    try:
        service.setup_from_csv(csv)
        count = service.db.get_transaction_count()
        success("migrate", {"rows_imported": count, "source": csv, "db": db})
    except Exception as e:
        error("migrate", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── report ───────────────────────────────────────────────────────────────────

@cli.command()
@click.option("--limit", default=50, type=int, help="Max rows (default 50)")
@click.option("--offset", default=0, type=int, help="Rows to skip (default 0)")
@click.option("--start-date", default=None, help="Filter from date (YYYY-MM-DD)")
@click.option("--end-date", default=None, help="Filter to date (YYYY-MM-DD)")
@click.option("--db", default="portfolio.db", help="Path to database file")
def report(limit, offset, start_date, end_date, db):
    """Show daily returns report."""
    sd = _parse_date(start_date, "--start-date") if start_date else None
    ed = _parse_date(end_date, "--end-date") if end_date else None
    service = PortfolioService(db, read_only=True)
    try:
        data, total = service.get_daily_returns_paginated(limit, offset, sd, ed)
        pagination = build_pagination(limit, offset, total)
        success("report", data, count=len(data), pagination=pagination)
    except Exception as e:
        error("report", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── transactions ─────────────────────────────────────────────────────────────

@cli.command(epilog="""
Examples:

  portfolio transactions

  portfolio transactions --limit 20 --offset 40

  portfolio transactions --start-date 2026-01-01 --end-date 2026-03-31
""")
@click.option("--limit", default=50, type=int, help="Max rows (default 50)")
@click.option("--offset", default=0, type=int, help="Rows to skip (default 0)")
@click.option("--start-date", default=None, help="Filter from date (YYYY-MM-DD)")
@click.option("--end-date", default=None, help="Filter to date (YYYY-MM-DD)")
@click.option("--db", default="portfolio.db", help="Path to database file")
def transactions(limit, offset, start_date, end_date, db):
    """List transactions."""
    sd = _parse_date(start_date, "--start-date") if start_date else None
    ed = _parse_date(end_date, "--end-date") if end_date else None
    service = PortfolioService(db, read_only=True)
    try:
        data, total = service.get_transactions_paginated(limit, offset, sd, ed)
        pagination = build_pagination(limit, offset, total)
        success("transactions", data, count=len(data), pagination=pagination)
    except Exception as e:
        error("transactions", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── status ───────────────────────────────────────────────────────────────────

@cli.command(epilog="""
Examples:

  portfolio status

  portfolio status --as-of-date 2026-01-01
""")
@click.option("--as-of-date", default=None, help="Report as of date (YYYY-MM-DD)")
@click.option("--db", default="portfolio.db", help="Path to database file")
def status(as_of_date, db):
    """Show portfolio status."""
    as_of = _parse_date(as_of_date, "--as-of-date") if as_of_date else None
    service = PortfolioService(db, read_only=True)
    try:
        trans_count = service.db.get_transaction_count()
        stats = service.get_performance_stats(as_of_date=as_of)
        data = {
            "transactions": trans_count,
            "start_date": stats["start_date"],
            "end_date": stats["end_date"],
            "portfolio_value": stats["end_value"],
            "total_invested": stats["net_contributions"],
            "deposits": stats["deposits"],
            "withdrawals": stats["withdrawals"],
            "income": stats["income"],
            "fees": stats["fees"],
            "taxes": stats["taxes"],
            "total_gain": stats["net_gain"],
            "total_gain_pct": stats["total_return_pct"],
            "as_of_date": stats["end_date"],
        }
        success("status", data)
    except PriceDataUnavailableError as e:
        error("status", "PRICE_DATA_ERROR", str(e))
    except Exception as e:
        error("status", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── add ──────────────────────────────────────────────────────────────────────

@cli.command(epilog="""
Examples:

  portfolio add --date 01-01-2026 --asset AAPL --action buy --quantity 10 --price 150

  portfolio add --date 01-01-2026 --asset USD --action deposit --quantity 10000

  portfolio add --date 01-01-2026 --asset AAPL --action sell --quantity 5 --price 180 --fees 1.5
""")
@click.option("--date", "date_str", required=True, help="Transaction date (DD-MM-YYYY)")
@click.option("--asset", required=True, help="Asset symbol")
@click.option("--action", required=True,
              type=click.Choice(USER_ACTION_CHOICES, case_sensitive=False))
@click.option("--quantity", required=True, type=float)
@click.option("--price", type=float, default=None)
@click.option("--currency", default="USD")
@click.option("--fees", type=float, default=None)
@click.option("--exchange", default="")
@click.option("--account", default=None, help="Account label — required for TRANSFER (e.g. 'broker_a', 'broker_b')")
@click.option("--db", default="portfolio.db")
def add(date_str, asset, action, quantity, price, currency, fees, exchange, account, db):
    """Add a transaction and auto-recalculate returns."""
    date_obj = _parse_legacy_date(date_str, "--date")
    if not exchange or not exchange.strip():
        error("add", "VALIDATION", "--exchange is required (e.g. --exchange FreedomFinance)")
    service = PortfolioService(db)
    try:
        # CONFLICT check: SELL must not exceed current net holdings
        if action.upper() == "SELL":
            net = service.db.con.execute(
                """
                SELECT COALESCE(SUM(CASE WHEN action='BUY' THEN quantity
                                         WHEN action='SELL' THEN -quantity
                                         ELSE 0 END), 0)
                FROM transactions WHERE asset = ?
                """,
                [asset],
            ).fetchone()[0]
            if quantity > net:
                error(
                    "add",
                    "CONFLICT",
                    f"Cannot SELL {quantity} of {asset}: only {net} shares held",
                )

        result = service.add_transaction(
            date_obj=date_obj,
            asset=asset,
            action=action.upper(),
            quantity=quantity,
            price=price,
            currency=currency,
            fees=fees,
            exchange=exchange,
            account=account,
        )
        trans = service.db.get_transaction_by_id(result["transaction_id"])
        success("add", {"transaction": service._serialize_transaction_row(trans), "recalculated": True})
    except PriceDataUnavailableError as e:
        error("add", "PRICE_DATA_ERROR", str(e))
    except ValueError as e:
        error("add", "VALIDATION_ERROR", str(e))
    except Exception as e:
        error("add", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── edit ─────────────────────────────────────────────────────────────────────

@cli.command(epilog="""
Examples:

  portfolio edit --id 42 --price 155.50

  portfolio edit --id 42 --quantity 8 --dry-run

  portfolio edit --id 42 --date 15-01-2026 --fees 2.0
""")
@click.option("--id", "trans_id", required=True, type=int)
@click.option("--date", "date_str", default=None, help="Transaction date (DD-MM-YYYY)")
@click.option("--asset", default=None, help="Asset symbol")
@click.option("--action", default=None, type=click.Choice(USER_ACTION_CHOICES, case_sensitive=False))
@click.option("--quantity", default=None, type=float)
@click.option("--price", default=None, type=float)
@click.option("--currency", default=None)
@click.option("--fees", default=None, type=float)
@click.option("--exchange", default=None)
@click.option("--data-source", default=None)
@click.option("--account", default=None, help="Account label — required for TRANSFER (e.g. 'broker_a', 'broker_b')")
@click.option("--dry-run", is_flag=True, help="Show what would change without applying")
@click.option("--db", default="portfolio.db")
def edit(trans_id, date_str, asset, action, quantity, price, currency, fees, exchange, data_source, account, dry_run, db):
    """Edit an existing transaction and recalculate returns."""
    changes = {
        "date": _parse_legacy_date(date_str, "--date") if date_str else None,
        "asset": asset,
        "action": action.upper() if action else None,
        "quantity": quantity,
        "price": price,
        "currency": currency,
        "fees": fees,
        "exchange": exchange,
        "data_source": data_source,
        "account": account,
    }
    if not any(value is not None for value in changes.values()):
        error("edit", "VALIDATION_ERROR", "Provide at least one field to update")

    if dry_run:
        service = PortfolioService(db, read_only=True)
        try:
            preview = service.preview_edit_transaction(trans_id, **changes)
            proposed = {k: (str(v) if v is not None else None) for k, v in changes.items() if v is not None}
            success("edit", {"dry_run": True, "transaction_id": trans_id, "current": preview["current"], "proposed_changes": proposed})
        except ValueError as e:
            message = str(e)
            code = "NOT_FOUND" if "not found" in message.lower() else "VALIDATION_ERROR"
            error("edit", code, message)
        except SystemExit:
            raise
        except Exception as e:
            error("edit", "DB_ERROR", str(e))
        finally:
            service.close()
        return

    service = PortfolioService(db)
    try:
        # CONFLICT check: transaction may have been deleted after a dry-run
        if not service.db.get_transaction_by_id(trans_id):
            error(
                "edit",
                "CONFLICT",
                f"Transaction ID {trans_id} no longer exists; it may have been deleted since the dry-run",
            )
        result = service.edit_transaction(trans_id, **changes)
        success("edit", {
            "before": result["before"],
            "transaction": result["transaction"],
            "recalculated": True,
            "from_date": result["from_date"],
        })
    except PriceDataUnavailableError as e:
        error("edit", "PRICE_DATA_ERROR", str(e))
    except ValueError as e:
        message = str(e)
        code = "NOT_FOUND" if "not found" in message.lower() else "VALIDATION_ERROR"
        error("edit", code, message)
    except Exception as e:
        error("edit", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── verify_prices ────────────────────────────────────────────────────────────

@cli.command(name="verify_prices", epilog="""
Examples:

  portfolio verify_prices

  portfolio verify_prices --db custom.db
""")
@click.option("--db", default="portfolio.db")
def verify_prices(db):
    """Verify prices table structure and storage."""
    service = PortfolioService(db, read_only=True)
    try:
        info = service.verify_prices_storage()
        stats = info.get("statistics", {})
        tickers = info.get("ticker_breakdown", [])
        data = {
            "total_rows": stats.get("total_records", 0),
            "unique_tickers": len(tickers),
            "date_range": {
                "start": str(stats.get("min_date", "")),
                "end": str(stats.get("max_date", "")),
            },
            "required_range": info.get("coverage", {}).get("required_range", {}),
            "coverage_issues": info.get("coverage", {}).get("issues", []),
            "coverage": info.get("coverage", {}).get("coverage", []),
            "refresh_state": info.get("refresh_state", {}),
            "repair_log": info.get("repair_log", []),
            "issues": info.get("optimization_notes", []),
        }
        success("verify_prices", data)
    except Exception as e:
        error("verify_prices", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── repair_prices ────────────────────────────────────────────────────────────

@cli.command(name="repair_prices", epilog="""
Examples:

  portfolio repair_prices

  portfolio repair_prices --ticker AAPL --ticker MSFT

  portfolio repair_prices --start-date 2026-01-01 --dry-run
""")
@click.option("--ticker", "tickers", multiple=True, help="Specific ticker(s) to refresh")
@click.option("--start-date", default=None, help="Refresh from date (YYYY-MM-DD)")
@click.option("--end-date", default=None, help="Refresh to date (YYYY-MM-DD)")
@click.option("--dry-run", is_flag=True, help="Show what would be repaired without fetching")
@click.option("--db", default="portfolio.db")
def repair_prices(tickers, start_date, end_date, dry_run, db):
    """Fetch and cache missing/incomplete price series."""
    sd = _parse_date(start_date, "--start-date") if start_date else None
    ed = _parse_date(end_date, "--end-date") if end_date else None
    if dry_run:
        service = PortfolioService(db, read_only=True)
        try:
            coverage = service.analyze_price_coverage(start_date=sd, end_date=ed)
            issues = coverage.get("issues", [])
            target = [i["ticker"] for i in issues] if not tickers else list(tickers)
            success("repair_prices", {
                "dry_run": True,
                "would_repair": target,
                "issues_found": len(issues),
                "coverage": coverage,
            })
        except Exception as e:
            error("repair_prices", "PRICE_DATA_ERROR", str(e))
        finally:
            service.close()
        return
    service = PortfolioService(db)
    try:
        result = service.repair_prices(tickers=list(tickers) or None, start_date=sd, end_date=ed)
        success("repair_prices", result)
    except PriceDataUnavailableError as e:
        error("repair_prices", "PRICE_DATA_ERROR", str(e))
    except Exception as e:
        error("repair_prices", "PRICE_FETCH_ERROR", str(e))
    finally:
        service.close()


# ─── recalculate ──────────────────────────────────────────────────────────────

@cli.command(epilog="""
Examples:

  portfolio recalculate

  portfolio recalculate --from-date 01-01-2026

  portfolio recalculate --force --dry-run
""")
@click.option("--force", is_flag=True)
@click.option("--from-date", default=None, help="Recalculate from date (DD-MM-YYYY)")
@click.option("--dry-run", is_flag=True, help="Show what would be recalculated without executing")
@click.option("--db", default="portfolio.db")
def recalculate(force, from_date, dry_run, db):
    """Recalculate portfolio returns."""
    from_date_obj = _parse_legacy_date(from_date, "--from-date") if from_date else None
    if dry_run:
        service = PortfolioService(db, read_only=True)
        try:
            state = service.get_refresh_state()
            coverage = service.analyze_price_coverage()
            success("recalculate", {
                "dry_run": True,
                "from_date": str(from_date_obj) if from_date_obj else "beginning",
                "forced": force,
                "last_recalc": state.get("last_successful_recalc"),
                "stale_data": state.get("stale_data"),
                "price_issues": len(coverage.get("issues", [])),
            })
        except Exception as e:
            error("recalculate", "INTERNAL_ERROR", str(e))
        finally:
            service.close()
        return
    service = PortfolioService(db)
    try:
        result = service.recalculate(from_date=from_date_obj, force=force)
        if result.get("status") == "success":
            data = {
                "rows_affected": result.get("rows_affected", 0),
                "from_date": str(result.get("from_date", "")),
                "forced": force,
                "recalc_type": result.get("recalc_type", ""),
            }
            success("recalculate", data)
        else:
            error("recalculate", "INTERNAL_ERROR", result.get("message", "Unknown error"))
    except PriceDataUnavailableError as e:
        error("recalculate", "PRICE_DATA_ERROR", str(e))
    except Exception as e:
        error("recalculate", "INTERNAL_ERROR", str(e))
    finally:
        service.close()


# ─── allocation ───────────────────────────────────────────────────────────────

@cli.command(epilog="""
Examples:

  portfolio allocation

  portfolio allocation --type assets

  portfolio allocation --type cash --as-of-date 2026-01-01
""")
@click.option("--type", "allocation_type",
              type=click.Choice(["assets", "cash", "all"]), default="all")
@click.option("--as-of-date", default=None, help="Report as of date (YYYY-MM-DD)")
@click.option("--db", default="portfolio.db")
def allocation(allocation_type, as_of_date, db):
    """Show portfolio allocation breakdown."""
    as_of = _parse_date(as_of_date, "--as-of-date") if as_of_date else None
    service = PortfolioService(db, read_only=True)
    try:
        data = service.get_allocation(allocation_type=allocation_type, as_of_date=as_of)
        success("allocation", data)
    except PriceDataUnavailableError as e:
        error("allocation", "PRICE_DATA_ERROR", str(e))
    except Exception as e:
        error("allocation", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── cash ─────────────────────────────────────────────────────────────────────

@cli.command(epilog="""
Examples:

  portfolio cash

  portfolio cash --as-of-date 2026-01-01
""")
@click.option("--as-of-date", default=None, help="Report as of date (YYYY-MM-DD)")
@click.option("--db", default="portfolio.db")
def cash(as_of_date, db):
    """Show actual cash balances (converted to USD)."""
    as_of = _parse_date(as_of_date, "--as-of-date") if as_of_date else None
    service = PortfolioService(db, read_only=True)
    try:
        snapshot = service.build_reporting_snapshot(as_of_date=as_of, include_closed=True)
        cash_balances = snapshot["cash_balances"]
        result = []
        for bal_data in cash_balances:
            balance = bal_data["balance"]
            deposits = bal_data["deposits"]
            spent = bal_data["spent"]
            received = bal_data["received"]
            withdrawals = bal_data["withdrawals"]
            dividends = bal_data["dividends"]
            interest = bal_data["interest"]
            fees = bal_data["fees"]
            taxes = bal_data["taxes"]

            if balance == 0 and deposits == 0 and withdrawals == 0 and spent == 0 and received == 0 and dividends == 0 and interest == 0 and fees == 0 and taxes == 0:
                continue

            result.append({
                "currency": bal_data["currency"],
                "balance": round(balance, 6),
                "usd_value": round(bal_data["usd_value"], 2),
                "fx_rate": bal_data["fx_rate"],
                "deposits": round(deposits * bal_data["fx_rate"], 2),
                "withdrawals": round(withdrawals * bal_data["fx_rate"], 2),
                "dividends": round(dividends * bal_data["fx_rate"], 2),
                "interest": round(interest * bal_data["fx_rate"], 2),
                "fees": round(fees * bal_data["fx_rate"], 2),
                "taxes": round(taxes * bal_data["fx_rate"], 2),
                "spent": round(spent * bal_data["fx_rate"], 2),
                "received": round(received * bal_data["fx_rate"], 2),
            })

        meta = {"as_of_date": snapshot["as_of_date"]}
        success("cash", result, count=len(result), extra_meta=meta)
    except PriceDataUnavailableError as e:
        error("cash", "PRICE_DATA_ERROR", str(e))
    except Exception as e:
        error("cash", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── delete ───────────────────────────────────────────────────────────────────

@cli.command(epilog="""
Examples:

  portfolio delete --id 42 --dry-run

  portfolio delete --id 42 --confirm

  portfolio delete --id 42 --confirm --backup
""")
@click.option("--id", "trans_id", required=True, type=int)
@click.option("--confirm", is_flag=True, help="Skip confirmation prompt")
@click.option("--dry-run", is_flag=True, help="Show what would be deleted without executing")
@click.option("--backup", is_flag=True, help="Create a DB backup before deleting")
@click.option("--db", default="portfolio.db")
def delete(trans_id, confirm, dry_run, backup, db):
    """Delete a transaction by ID and auto-recalculate returns."""
    if dry_run:
        service = PortfolioService(db, read_only=True)
        try:
            trans = service.db.get_transaction_by_id(trans_id)
            if not trans:
                error("delete", "NOT_FOUND", f"Transaction ID {trans_id} not found")
            success("delete", {
                "dry_run": True,
                "transaction_id": trans_id,
                "would_delete": {
                    "date": str(trans[1]),
                    "asset": trans[2],
                    "action": trans[3],
                    "quantity": trans[4],
                },
            })
        except SystemExit:
            raise
        except Exception as e:
            error("delete", "DB_ERROR", str(e))
        finally:
            service.close()
        return

    if backup:
        src = Path(db)
        if src.exists():
            from datetime import datetime as _dt
            ts = _dt.now().strftime("%Y%m%d-%H%M%S")
            dst = src.parent / f"{src.stem}.backup-{ts}.db"
            shutil.copy2(src, dst)
            log.backup_created(str(src), str(dst), dst.stat().st_size)

    service = PortfolioService(db)
    try:
        trans = service.db.con.execute(
            "SELECT id, date, asset, action, quantity, price FROM transactions WHERE id = ?",
            [trans_id],
        ).fetchone()

        if not trans:
            error("delete", "NOT_FOUND", f"Transaction ID {trans_id} not found")

        if not confirm:
            # Non-interactive: require --confirm flag; output error envelope
            error("delete", "VALIDATION_ERROR",
                  "Pass --confirm to delete without interactive prompt")
            # error() calls sys.exit(1), but linters don't know that
            return  # Never reached, kept for clarity

        result = service.delete_transaction(trans_id)
        success("delete", {"deleted_id": result["transaction_id"], "recalculated": True})
    except SystemExit:
        raise
    except Exception as e:
        error("delete", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── performance ──────────────────────────────────────────────────────────────

@cli.command(epilog="""
Examples:

  portfolio performance

  portfolio performance --as-of-date 2026-01-01

  portfolio performance --benchmark QQQ
""")
@click.option("--as-of-date", default=None, help="Report as of date (YYYY-MM-DD)")
@click.option("--benchmark", default=None, help="Benchmark ticker (default: SPY)")
@click.option("--db", default="portfolio.db")
def performance(as_of_date, benchmark, db):
    """Show performance metrics."""
    as_of = _parse_date(as_of_date, "--as-of-date") if as_of_date else None
    service = PortfolioService(db, read_only=True)
    try:
        stats = service.get_performance_stats(as_of_date=as_of, benchmark_ticker=benchmark)
        concentration = service.get_concentration_metrics(as_of_date=as_of)

        def m(name, value):
            return service.evaluate_metric(name, value)

        result = {
            "period": {
                "start_date": stats["start_date"],
                "end_date": stats["end_date"],
                "total_days": stats["total_days"],
            },
            "values": {
                "start_value": stats["start_value"],
                "end_value": stats["end_value"],
                "total_gain": stats["total_gain"],
                "net_gain": stats["net_gain"],
                "deposits": stats["deposits"],
                "withdrawals": stats["withdrawals"],
                "net_contributions": stats["net_contributions"],
                "income": stats["income"],
                "dividends": stats["dividends"],
                "interest": stats["interest"],
                "fees": stats["fees"],
                "taxes": stats["taxes"],
                "realized_gain": stats["realized_gain"],
                "unrealized_gain": stats["unrealized_gain"],
            },
            "returns": {
                "time_weighted_return_pct": m("total_return_pct", stats["time_weighted_return_pct"]),
                "total_return_pct": m("total_return_pct", stats["total_return_pct"]),
                "cagr_pct": m("cagr", stats["cagr"]),
                "avg_daily_return_pct": m("avg_daily_return", stats["avg_daily_return"]),
                "avg_monthly_return_pct": m("avg_monthly_return", stats["avg_monthly_return"]),
            },
            "risk_metrics": {
                "std_dev_pct": m("std_dev", stats["std_dev"]),
                "hist_volatility_pct": m("hist_volatility", stats["hist_volatility"]),
                "beta": m("beta", stats["beta"]),
                "sharpe_ratio": m("sharpe_ratio", stats["sharpe_ratio"]),
                "sortino_ratio": m("sortino_ratio", stats["sortino_ratio"]),
                "treynor_ratio": m("treynor_ratio", stats["treynor_ratio"]),
                "information_ratio": m("information_ratio", stats["information_ratio"]),
                "jensens_alpha": m("jensens_alpha", stats["jensens_alpha"]),
                "relative_return": m("relative_return", stats["relative_return"]),
                "tracking_error": m("tracking_error", stats["tracking_error"]),
            },
            "risk_of_loss": {
                "var_95_pct": m("var_95", stats["var_95"]),
                "var_99_pct": m("var_99", stats["var_99"]),
                "cvar_95_pct": m("cvar_95", stats["cvar_95"]),
                "cvar_99_pct": m("cvar_99", stats["cvar_99"]),
            },
            "drawdowns": {
                "max_drawdown_pct": m("max_drawdown", stats["max_drawdown"]),
                "avg_drawdown_pct": m("avg_drawdown", stats["avg_drawdown"]),
                "avg_drawdown_duration_days": m("avg_drawdown_duration", stats["avg_drawdown_duration"]),
            },
            "concentration": {
                "hhi": m("hhi", concentration["hhi"]),
                "weighted_avg_exposure": m("weighted_avg_exposure", concentration["weighted_avg_exposure"]),
                "num_positions": concentration["num_positions"],
            },
            "benchmark": {
                "ticker": benchmark or service.BENCHMARK_TICKERS[0],
                "benchmark_twr_pct": stats["spy_twr_pct"],
                "benchmark_cagr_pct": stats["spy_cagr_pct"],
                "relative_return_pct": m("relative_return", stats["relative_return"]),
                "tracking_error_pct": m("tracking_error", stats["tracking_error"]),
                "information_ratio": m("information_ratio", stats["information_ratio"]),
                "jensens_alpha": m("jensens_alpha", stats["jensens_alpha"]),
                "up_capture_ratio": stats["up_capture_ratio"],
                "down_capture_ratio": stats["down_capture_ratio"],
            },
        }
        mwr = service.get_mwr_irr(as_of_date=as_of)
        result["mwr_irr"] = {
            "mwr_pct": round(mwr * 100, 4),
            "note": "Money-Weighted Return (XIRR) — accounts for deposit/withdrawal timing",
        }
        contributions = service.get_contribution_by_position(as_of_date=as_of)
        result["contribution_by_position"] = contributions
        success("performance", result)
    except PriceDataUnavailableError as e:
        error("performance", "PRICE_DATA_ERROR", str(e))
    except Exception as e:
        error("performance", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── mwr ──────────────────────────────────────────────────────────────────────

@cli.command(epilog="""
Examples:

  portfolio mwr

  portfolio mwr --as-of-date 2026-01-01

  portfolio mwr --db /data/portfolio.db --as-of-date 2025-12-31
""")
@click.option("--as-of-date", default=None, help="Calculate MWR as of date (YYYY-MM-DD)")
@click.option("--db", default="portfolio.db")
def mwr(as_of_date, db):
    """Show Money-Weighted Return (XIRR / IRR)."""
    as_of = _parse_date(as_of_date, "--as-of-date") if as_of_date else None
    service = PortfolioService(db, read_only=True)
    try:
        mwr_val = service.get_mwr_irr(as_of_date=as_of)
        snap = service.build_reporting_snapshot(as_of_date=as_of)
        success("mwr", {
            "mwr_pct": round(mwr_val * 100, 4),
            "as_of_date": str(snap["as_of_date"]) if snap.get("as_of_date") else None,
            "portfolio_value": snap.get("portfolio_value", 0.0),
            "net_contributions": snap.get("net_contributions", 0.0),
            "note": "Money-Weighted Return (XIRR) — accounts for deposit/withdrawal timing",
        })
    except Exception as e:
        error("mwr", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── summary ──────────────────────────────────────────────────────────────────

@cli.command(epilog="""
Examples:

  portfolio summary

  portfolio summary --filter open

  portfolio summary --as-of-date 2026-01-01
""")
@click.option("--filter", "position_filter",
              type=click.Choice(["open", "all"]), default="all")
@click.option("--as-of-date", default=None, help="Report as of date (YYYY-MM-DD)")
@click.option("--db", default="portfolio.db")
def summary(position_filter, as_of_date, db):
    """Show portfolio position summary with gains/losses."""
    as_of = _parse_date(as_of_date, "--as-of-date") if as_of_date else None
    service = PortfolioService(db, read_only=True)
    try:
        include_closed = position_filter == "all"
        snapshot = service.build_reporting_snapshot(as_of_date=as_of, include_closed=include_closed)
        positions = snapshot["positions"]
        success("summary", positions, count=len(positions), extra_meta={"as_of_date": snapshot["as_of_date"]})
    except PriceDataUnavailableError as e:
        error("summary", "PRICE_DATA_ERROR", str(e))
    except Exception as e:
        error("summary", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── exchange ─────────────────────────────────────────────────────────────────

@cli.command(epilog="""
Examples:

  portfolio exchange --date 01-01-2026 --from USD --to EUR --quantity 1000 --rate 0.92

  portfolio exchange --date 01-01-2026 --from EURUSD=X --to USD --quantity 500 --rate 1.09
""")
@click.option("--date", "date_str", required=True, help="Transaction date (DD-MM-YYYY)")
@click.option("--from", "from_asset", required=True)
@click.option("--to", "to_asset", required=True)
@click.option("--quantity", required=True, type=float)
@click.option("--rate", required=True, type=float)
@click.option("--db", default="portfolio.db")
def exchange(date_str, from_asset, to_asset, quantity, rate, db):
    """Exchange one currency for another."""
    date_obj = _parse_legacy_date(date_str, "--date")

    # CONFLICT check: exchanging a currency with itself makes no sense
    if from_asset.upper() == to_asset.upper():
        error(
            "exchange",
            "CONFLICT",
            f"--from and --to must be different assets; both are '{from_asset}'",
        )

    service = PortfolioService(db)
    try:
        result = service.exchange_currency(
            date_obj=date_obj,
            from_asset=from_asset,
            to_asset=to_asset,
            quantity=quantity,
            rate=rate,
        )
        data = {
            "from": {"asset": from_asset, "quantity": quantity},
            "to": {"asset": to_asset, "quantity": round(quantity * rate, 6)},
            "rate": rate,
            "date": str(date_obj),
            "transaction_ids": [result["from_trans_id"], result["to_trans_id"]],
        }
        success("exchange", data)
    except Exception as e:
        error("exchange", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── backup ───────────────────────────────────────────────────────────────────

@cli.command(epilog="""
Examples:

  portfolio backup

  portfolio backup --out /backups/portfolio-2026-01-01.db
""")
@click.option("--db", default="portfolio.db")
@click.option("--out", default=None, help="Backup file path (default: <db>.backup-<YYYYMMDD-HHMMSS>.db)")
def backup(db, out):
    """Create a timestamped copy of the portfolio database."""
    src = Path(db)
    if out is None:
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        dst = src.parent / f"{src.stem}.backup-{timestamp}.db"
    else:
        dst = Path(out)
    try:
        shutil.copy2(src, dst)
        log.backup_created(str(src), str(dst), dst.stat().st_size)
        success("backup", {"source": str(src), "backup": str(dst), "size_bytes": dst.stat().st_size})
    except Exception as e:
        error("backup", "IO_ERROR", str(e))


# ─── init ─────────────────────────────────────────────────────────────────────

@cli.command()
@click.option("--db", default="portfolio.db", help="Path to database file to initialize")
def init(db):
    """Initialize a new portfolio database (idempotent)."""
    from pathlib import Path
    try:
        service = PortfolioService(db)
        service.close()
        success("init", {"db_path": str(Path(db).resolve()), "status": "ready"})
    except Exception as e:
        error("init", "DB_ERROR", str(e))


# ─── health ───────────────────────────────────────────────────────────────────

@cli.command(epilog="""
Examples:

  portfolio health

  portfolio health --db custom.db
""")
@click.option("--db", default="portfolio.db")
def health(db):
    """Show DB and data health: recalc freshness, price coverage, stale state."""
    try:
        service = PortfolioService(db, read_only=True)
    except Exception as e:
        error("health", "DB_ERROR", f"Cannot open database: {e}")
        return
    try:
        state = service.get_refresh_state()
        coverage = service.analyze_price_coverage()
        issues = coverage.get("issues", [])
        stale_tickers = [i["ticker"] for i in issues]
        ok = not state.get("stale_data") and not issues
        success("health", {
            "status": "ok" if ok else "degraded",
            "db_reachable": True,
            "stale_data": state.get("stale_data", False),
            "last_successful_price_refresh": state.get("last_successful_price_refresh"),
            "last_successful_recalc": state.get("last_successful_recalc"),
            "price_coverage_issues": len(issues),
            "stale_tickers": stale_tickers,
        })
    except Exception as e:
        error("health", "DB_ERROR", str(e))
    finally:
        service.close()


if __name__ == "__main__":
    cli()
