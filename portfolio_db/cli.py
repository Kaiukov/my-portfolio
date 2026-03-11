"""CLI interface for portfolio_db."""

import click
import sys
import json
import shutil
from pathlib import Path
from datetime import datetime, date, timedelta
from portfolio_db.portfolio_service import PortfolioService
from portfolio_db.response import success, error, build_pagination


CONFIG_FILE = Path.home() / ".portfolio-config.json"
CONFIG_KEYS = {"db", "log_dir", "timezone"}


def _load_config() -> dict:
    if not CONFIG_FILE.exists():
        return {}
    try:
        return json.loads(CONFIG_FILE.read_text())
    except Exception:
        return {}


def _save_config(config: dict) -> None:
    CONFIG_FILE.write_text(json.dumps(config, indent=2))


def _resolved_db(db: str) -> str:
    if db != "portfolio.db":
        return db
    cfg = _load_config()
    return cfg.get("db", db)


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
    service = PortfolioService(_resolved_db(db))
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
    service = PortfolioService(_resolved_db(db))
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
    service = PortfolioService(_resolved_db(db))
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
    service = PortfolioService(_resolved_db(db))
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
    service = PortfolioService(_resolved_db(db))
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
    service = PortfolioService(_resolved_db(db))
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
    service = PortfolioService(_resolved_db(db))
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
    service = PortfolioService(_resolved_db(db))
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
    service = PortfolioService(_resolved_db(db))
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
    service = PortfolioService(_resolved_db(db))
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
    service = PortfolioService(_resolved_db(db))
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
    service = PortfolioService(_resolved_db(db))
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
    service = PortfolioService(_resolved_db(db))
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


# ─── init ─────────────────────────────────────────────────────────────────────

@cli.command()
@click.option("--db", default="portfolio.db", help="Path to database file")
@click.option("--csv", default=None, help="Optional CSV file to migrate after DB init")
def init(db, csv):
    """Initialize database schema, optionally importing CSV data."""
    db_path = _resolved_db(db)
    service = PortfolioService(db_path)
    try:
        data = {"db": db_path, "initialized": True, "imported": False}
        if csv:
            service.setup_from_csv(csv)
            data["imported"] = True
            data["rows_imported"] = service.db.get_transaction_count()
            data["source"] = csv
        success("init", data)
    except Exception as e:
        error("init", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── health ───────────────────────────────────────────────────────────────────

@cli.command(name="health")
@click.option("--db", default="portfolio.db", help="Path to database file")
def health_check(db):
    """Run operational health checks."""
    db_path = _resolved_db(db)
    service = PortfolioService(db_path)
    try:
        tx_count = service.db.get_transaction_count()
        prices_info = service.db.get_prices_table_info()
        max_price_date = prices_info.get("max_date")
        stale_days = None
        if max_price_date:
            stale_days = (date.today() - max_price_date).days

        yfinance_ok = True
        yfinance_error = None
        try:
            import yfinance as yf
            end = date.today()
            start = end - timedelta(days=7)
            hist = yf.Ticker("SPY").history(start=start, end=end)
            yfinance_ok = not hist.empty
            if hist.empty:
                yfinance_error = "No data returned for SPY."
        except Exception as e:
            yfinance_ok = False
            yfinance_error = str(e)

        result = {
            "db": {
                "path": db_path,
                "ok": True,
                "transactions": tx_count,
            },
            "prices": {
                "ok": prices_info.get("total_records", 0) > 0,
                "total_records": prices_info.get("total_records", 0),
                "min_date": str(prices_info.get("min_date") or ""),
                "max_date": str(max_price_date or ""),
                "stale_days": stale_days,
            },
            "market_data": {
                "provider": "yfinance",
                "ok": yfinance_ok,
                "error": yfinance_error,
            },
        }
        success("health", result)
    except Exception as e:
        error("health", "INTERNAL_ERROR", str(e))
    finally:
        service.close()


# ─── fetch-prices ─────────────────────────────────────────────────────────────

@cli.command(name="fetch-prices")
@click.option("--db", default="portfolio.db", help="Path to database file")
@click.option("--start-date", default=None, help="Start date (YYYY-MM-DD)")
@click.option("--end-date", default=None, help="End date (YYYY-MM-DD)")
def fetch_prices(db, start_date, end_date):
    """Fetch and persist market prices for discovered symbols."""
    db_path = _resolved_db(db)
    service = PortfolioService(db_path)
    try:
        discovered = service.discover_assets_and_currencies()
        symbols = list(discovered.get("assets", [])) + list(discovered.get("fx_currencies", []))
        if not symbols:
            success("fetch-prices", {"symbols": [], "rows_written": 0, "message": "No symbols to fetch"})
            return

        min_tx, max_tx = service.db.get_date_range()
        sd = _parse_date(start_date, "--start-date") if start_date else (min_tx or date.today())
        ed = _parse_date(end_date, "--end-date") if end_date else (max_tx or date.today())
        if sd > ed:
            error("fetch-prices", "VALIDATION_ERROR", "--start-date cannot be after --end-date")

        prices = service.price_service.fetch_all_prices(symbols, sd, ed)
        service._persist_prices_to_db(prices)

        rows = sum(len(v) for v in prices.values())
        success("fetch-prices", {
            "symbols": symbols,
            "rows_written": rows,
            "start_date": str(sd),
            "end_date": str(ed),
        })
    except Exception as e:
        error("fetch-prices", "PRICE_FETCH_ERROR", str(e))
    finally:
        service.close()


# ─── backup/restore ───────────────────────────────────────────────────────────

@cli.command()
@click.option("--db", default="portfolio.db", help="Path to database file")
@click.option("--output", default=None, help="Backup destination file")
def backup(db, output):
    """Create a backup copy of DuckDB file."""
    src = Path(_resolved_db(db))
    if not src.exists():
        error("backup", "NOT_FOUND", f"Database not found: {src}")
    out = Path(output) if output else Path("backups") / f"portfolio-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db"
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copy2(src, out)
        success("backup", {"source": str(src), "backup": str(out), "bytes": out.stat().st_size})
    except Exception as e:
        error("backup", "INTERNAL_ERROR", str(e))


@cli.command()
@click.option("--db", default="portfolio.db", help="Destination database file")
@click.option("--input", "input_file", required=True, help="Backup file to restore from")
@click.option("--confirm", is_flag=True, help="Required to overwrite destination")
def restore(db, input_file, confirm):
    """Restore DuckDB file from backup."""
    dest = Path(_resolved_db(db))
    src = Path(input_file)
    if not src.exists():
        error("restore", "NOT_FOUND", f"Backup not found: {src}")
    if dest.exists() and not confirm:
        error("restore", "VALIDATION_ERROR", "Pass --confirm to overwrite existing DB")
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        success("restore", {"input": str(src), "db": str(dest), "bytes": dest.stat().st_size})
    except Exception as e:
        error("restore", "INTERNAL_ERROR", str(e))


# ─── export/import ────────────────────────────────────────────────────────────

@cli.command()
@click.option("--kind", type=click.Choice(["transactions", "returns"], case_sensitive=False), required=True)
@click.option("--output", required=True, help="Output JSON file")
@click.option("--db", default="portfolio.db", help="Path to database file")
def export(kind, output, db):
    """Export transactions or returns to JSON."""
    service = PortfolioService(_resolved_db(db))
    try:
        kind = kind.lower()
        if kind == "transactions":
            service.export_transactions_json(output)
        else:
            service.export_returns_json(output)
        success("export", {"kind": kind, "output": output})
    except Exception as e:
        error("export", "INTERNAL_ERROR", str(e))
    finally:
        service.close()


@cli.command(name="import")
@click.option("--csv", "csv_path", required=True, help="CSV source file")
@click.option("--db", default="portfolio.db", help="Path to database file")
def import_cmd(csv_path, db):
    """Import CSV transactions and recalculate portfolio."""
    service = PortfolioService(_resolved_db(db))
    try:
        service.setup_from_csv(csv_path)
        success("import", {"source": csv_path, "rows_imported": service.db.get_transaction_count()})
    except Exception as e:
        error("import", "DB_ERROR", str(e))
    finally:
        service.close()


# ─── cron ─────────────────────────────────────────────────────────────────────

@cli.group()
def cron():
    """Manage production crontab entries."""
    pass


@cron.command(name="install")
def cron_install():
    """Install portfolio cron schedule."""
    try:
        import shutil as _sh
        if _sh.which("crontab") is None:
            success("cron-install", {"installed": False, "message": "crontab binary not found"})
            return
        from pathlib import Path as _Path
        project = _Path.cwd()
        logs = project / "logs"
        logs.mkdir(parents=True, exist_ok=True)
        block = f"""# ── portfolio auto-refresh ──
SHELL=/bin/bash
PROJECT={project}
LOG={logs}
DB={project / 'portfolio.db'}
UV=uv
30 18 * * 1-5  cd $PROJECT && $UV run portfolio recalculate --db $DB >> $LOG/recalc.log 2>&1
0 10 * * 6     cd $PROJECT && $UV run portfolio recalculate --db $DB >> $LOG/recalc.log 2>&1
0 3 * * 0      cd $PROJECT && $UV run portfolio recalculate --force --db $DB >> $LOG/recalc-full.log 2>&1
0 7 * * *      cd $PROJECT && $UV run portfolio verify-prices --db $DB >> $LOG/verify-prices.log 2>&1
0 9 * * 1-5    cd $PROJECT && $UV run portfolio status --db $DB >> $LOG/status.log 2>&1
0 6 1 * *      cd $PROJECT && $UV run portfolio performance --db $DB > $LOG/performance-$(date +\\%Y-\\%m).log 2>&1
# ── end portfolio auto-refresh ──
"""
        import subprocess
        current = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
        content = current.stdout if current.returncode == 0 else ""
        if "# ── portfolio auto-refresh ──" in content:
            success("cron-install", {"installed": False, "message": "Already installed"})
            return
        new_content = (content.strip() + "\n\n" + block).strip() + "\n"
        proc = subprocess.run(["crontab", "-"], input=new_content, text=True, capture_output=True)
        if proc.returncode != 0:
            error("cron-install", "INTERNAL_ERROR", proc.stderr.strip() or "Failed to install crontab")
        success("cron-install", {"installed": True, "project": str(project)})
    except Exception as e:
        error("cron-install", "INTERNAL_ERROR", str(e))


@cron.command(name="remove")
def cron_remove():
    """Remove portfolio cron schedule."""
    try:
        import shutil as _sh
        if _sh.which("crontab") is None:
            success("cron-remove", {"removed": False, "message": "crontab binary not found"})
            return
        import subprocess
        current = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
        if current.returncode != 0:
            success("cron-remove", {"removed": False, "message": "No crontab configured"})
            return
        lines = current.stdout.splitlines()
        out = []
        skipping = False
        for line in lines:
            if line.strip() == "# ── portfolio auto-refresh ──":
                skipping = True
                continue
            if line.strip() == "# ── end portfolio auto-refresh ──":
                skipping = False
                continue
            if not skipping:
                out.append(line)
        new_content = "\n".join(out).strip() + "\n"
        proc = subprocess.run(["crontab", "-"], input=new_content, text=True, capture_output=True)
        if proc.returncode != 0:
            error("cron-remove", "INTERNAL_ERROR", proc.stderr.strip() or "Failed to update crontab")
        success("cron-remove", {"removed": True})
    except Exception as e:
        error("cron-remove", "INTERNAL_ERROR", str(e))


@cron.command(name="status")
def cron_status():
    """Show installed portfolio cron entries."""
    try:
        import shutil as _sh
        if _sh.which("crontab") is None:
            success("cron-status", {"installed": False, "entries": [], "message": "crontab binary not found"})
            return
        import subprocess
        current = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
        if current.returncode != 0:
            success("cron-status", {"installed": False, "entries": []})
            return
        lines = current.stdout.splitlines()
        entries = []
        capture = False
        for line in lines:
            if line.strip() == "# ── portfolio auto-refresh ──":
                capture = True
                continue
            if line.strip() == "# ── end portfolio auto-refresh ──":
                capture = False
                continue
            if capture and line.strip():
                entries.append(line)
        success("cron-status", {"installed": len(entries) > 0, "entries": entries}, count=len(entries))
    except Exception as e:
        error("cron-status", "INTERNAL_ERROR", str(e))


# ─── version ──────────────────────────────────────────────────────────────────

@cli.command()
def version():
    """Show CLI and package version."""
    try:
        from importlib.metadata import version as _v
        pkg_version = _v("portfolyahoo")
    except Exception:
        pkg_version = "0.1.0"
    success("version", {"package": "portfolyahoo", "version": pkg_version})


# ─── config ───────────────────────────────────────────────────────────────────

@cli.group()
def config():
    """Manage CLI runtime configuration."""
    pass


@config.command(name="show")
def config_show():
    """Show current config values."""
    cfg = _load_config()
    success("config-show", {"path": str(CONFIG_FILE), "config": cfg})


@config.command(name="set")
@click.option("--key", required=True, type=click.Choice(sorted(CONFIG_KEYS), case_sensitive=False))
@click.option("--value", required=True)
def config_set(key, value):
    """Set a config value."""
    cfg = _load_config()
    key = key.lower()
    cfg[key] = value
    _save_config(cfg)
    success("config-set", {"path": str(CONFIG_FILE), "key": key, "value": value})




if __name__ == "__main__":
    cli()
