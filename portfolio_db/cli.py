"""CLI interface for portfolio_db."""

import click
import sys
from datetime import datetime, date
from portfolio_db.portfolio_service import PortfolioService
from portfolio_db.response import success, error, build_pagination


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
    service = PortfolioService(db)
    try:
        data, total = service.get_daily_returns_paginated(limit, offset, sd, ed)
        pagination = build_pagination(limit, offset, total)
        success("report", data, count=len(data), pagination=pagination)
    except Exception as e:
        error("report", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── transactions ─────────────────────────────────────────────────────────────

@cli.command()
@click.option("--limit", default=50, type=int, help="Max rows (default 50)")
@click.option("--offset", default=0, type=int, help="Rows to skip (default 0)")
@click.option("--start-date", default=None, help="Filter from date (YYYY-MM-DD)")
@click.option("--end-date", default=None, help="Filter to date (YYYY-MM-DD)")
@click.option("--db", default="portfolio.db", help="Path to database file")
def transactions(limit, offset, start_date, end_date, db):
    """List transactions."""
    sd = _parse_date(start_date, "--start-date") if start_date else None
    ed = _parse_date(end_date, "--end-date") if end_date else None
    service = PortfolioService(db)
    try:
        data, total = service.get_transactions_paginated(limit, offset, sd, ed)
        pagination = build_pagination(limit, offset, total)
        success("transactions", data, count=len(data), pagination=pagination)
    except Exception as e:
        error("transactions", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── status ───────────────────────────────────────────────────────────────────

@cli.command()
@click.option("--db", default="portfolio.db", help="Path to database file")
def status(db):
    """Show portfolio status."""
    service = PortfolioService(db)
    try:
        trans_count = service.db.get_transaction_count()
        stats = service.get_performance_stats()
        data = {
            "transactions": trans_count,
            "start_date": stats["start_date"],
            "end_date": stats["end_date"],
            "portfolio_value": stats["end_value"],
            "total_invested": stats["total_cash_flow"],
            "total_gain": stats["total_gain"],
            "total_gain_pct": stats["total_return_pct"],
            "as_of_date": str(date.today()),
        }
        success("status", data)
    except Exception as e:
        error("status", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── add ──────────────────────────────────────────────────────────────────────

@cli.command()
@click.option("--date", "date_str", required=True, help="Transaction date (DD-MM-YYYY)")
@click.option("--asset", required=True, help="Asset symbol")
@click.option("--action", required=True,
              type=click.Choice(["BUY", "SELL", "DEPOSIT", "FEE"], case_sensitive=False))
@click.option("--quantity", required=True, type=float)
@click.option("--price", type=float, default=None)
@click.option("--currency", default="USD")
@click.option("--fees", type=float, default=None)
@click.option("--exchange", default="")
@click.option("--db", default="portfolio.db")
def add(date_str, asset, action, quantity, price, currency, fees, exchange, db):
    """Add a transaction and auto-recalculate returns."""
    date_obj = _parse_legacy_date(date_str, "--date")
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
            exchange=exchange,
        )
        trans = service.db.con.execute(
            "SELECT id, date, asset, action, quantity, asset_type, price, currency, fees, exchange, data_source "
            "FROM transactions WHERE id = ?", [result["transaction_id"]]
        ).fetchone()
        col_names = ["id", "date", "asset", "action", "quantity", "asset_type", "price", "currency", "fees", "exchange", "data_source"]
        trans_dict = {
            name: (str(value) if name == "date" else value)
            for name, value in zip(col_names, trans)
        }
        success("add", {"transaction": trans_dict, "recalculated": True})
    except Exception as e:
        error("add", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── verify_prices ────────────────────────────────────────────────────────────

@cli.command()
@click.option("--db", default="portfolio.db")
def verify_prices(db):
    """Verify prices table structure and storage."""
    service = PortfolioService(db)
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
            "issues": info.get("optimization_notes", []),
        }
        success("verify_prices", data)
    except Exception as e:
        error("verify_prices", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── recalculate ──────────────────────────────────────────────────────────────

@cli.command()
@click.option("--force", is_flag=True)
@click.option("--from-date", default=None, help="Recalculate from date (DD-MM-YYYY)")
@click.option("--db", default="portfolio.db")
def recalculate(force, from_date, db):
    """Recalculate portfolio returns."""
    from_date_obj = _parse_legacy_date(from_date, "--from-date") if from_date else None
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
    except Exception as e:
        error("recalculate", "INTERNAL_ERROR", str(e))
    finally:
        service.close()


# ─── allocation ───────────────────────────────────────────────────────────────

@cli.command()
@click.option("--type", "allocation_type",
              type=click.Choice(["assets", "cash", "all"]), default="all")
@click.option("--db", default="portfolio.db")
def allocation(allocation_type, db):
    """Show portfolio allocation breakdown."""
    service = PortfolioService(db)
    try:
        data = service.get_allocation(allocation_type=allocation_type)
        success("allocation", data)
    except Exception as e:
        error("allocation", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── cash ─────────────────────────────────────────────────────────────────────

@cli.command()
@click.option("--db", default="portfolio.db")
def cash(db):
    """Show actual cash balances (converted to USD)."""
    service = PortfolioService(db)
    try:
        cash_balances = service.get_actual_cash_balances()

        fx_rates = {"EURUSD=X": 1.0, "GBPUSD=X": 1.0}
        fx_fetch_errors = []  # Track which FX rates failed to fetch
        try:
            import yfinance as yf
            from datetime import timedelta
            end = date.today()
            start = end - timedelta(days=7)
            for ticker in ["EURUSD=X", "GBPUSD=X"]:
                try:
                    hist = yf.Ticker(ticker).history(start=start, end=end)
                    if not hist.empty:
                        fx_rates[ticker] = float(hist["Close"].iloc[-1])
                except Exception as e:
                    # Record failure but continue with default rate
                    fx_fetch_errors.append(ticker)
        except Exception:
            # yfinance not available or import failed
            fx_fetch_errors.extend(["EURUSD=X", "GBPUSD=X"])

        result = []
        for currency_key, bal_data in cash_balances.items():
            balance = bal_data["balance"]
            deposits = bal_data["deposits"]
            spent = bal_data["spent"]
            received = bal_data["received"]

            if balance == 0 and deposits == 0 and spent == 0 and received == 0:
                continue

            if currency_key == "EURUSD=X":
                fx_rate = fx_rates["EURUSD=X"]
                currency = "EUR"
            elif currency_key == "GBPUSD=X":
                fx_rate = fx_rates["GBPUSD=X"]
                currency = "GBP"
            else:
                fx_rate = 1.0
                currency = currency_key

            result.append({
                "currency": currency,
                "balance": round(balance, 6),
                "usd_value": round(balance * fx_rate, 2),
                "fx_rate": fx_rate,
                "fx_rate_is_default": currency_key in fx_fetch_errors,
                "deposits": round(deposits * fx_rate, 2),
                "spent": round(spent * fx_rate, 2),
                "received": round(received * fx_rate, 2),
            })

        # Warn about FX rates that couldn't be fetched
        warnings = []
        if fx_fetch_errors:
            warnings.append(f"FX rates defaulted (using 1.0) for: {', '.join(fx_fetch_errors)}")

        success("cash", result, count=len(result), extra_meta={"warnings": warnings} if warnings else None)
    except Exception as e:
        error("cash", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── delete ───────────────────────────────────────────────────────────────────

@cli.command()
@click.option("--id", "trans_id", required=True, type=int)
@click.option("--confirm", is_flag=True, help="Skip confirmation prompt")
@click.option("--db", default="portfolio.db")
def delete(trans_id, confirm, db):
    """Delete a transaction by ID and auto-recalculate returns."""
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

@cli.command()
@click.option("--db", default="portfolio.db")
def performance(db):
    """Show performance metrics."""
    service = PortfolioService(db)
    try:
        stats = service.get_performance_stats()
        concentration = service.get_concentration_metrics()

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
                "cash_flow": stats["total_cash_flow"],
            },
            "returns": {
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
        }
        success("performance", result)
    except Exception as e:
        error("performance", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── summary ──────────────────────────────────────────────────────────────────

@cli.command()
@click.option("--filter", "position_filter",
              type=click.Choice(["open", "all"]), default="all")
@click.option("--db", default="portfolio.db")
def summary(position_filter, db):
    """Show portfolio position summary with gains/losses."""
    service = PortfolioService(db)
    try:
        include_closed = position_filter == "all"
        positions = service.get_position_summary(include_closed=include_closed)
        success("summary", positions, count=len(positions))
    except Exception as e:
        error("summary", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── exchange ─────────────────────────────────────────────────────────────────

@cli.command()
@click.option("--date", "date_str", required=True, help="Transaction date (DD-MM-YYYY)")
@click.option("--from", "from_asset", required=True)
@click.option("--to", "to_asset", required=True)
@click.option("--quantity", required=True, type=float)
@click.option("--rate", required=True, type=float)
@click.option("--db", default="portfolio.db")
def exchange(date_str, from_asset, to_asset, quantity, rate, db):
    """Exchange one currency for another."""
    date_obj = _parse_legacy_date(date_str, "--date")
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


if __name__ == "__main__":
    cli()
