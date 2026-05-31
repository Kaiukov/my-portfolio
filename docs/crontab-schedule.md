# Portfolio Cron Scheduling

This project supports two distinct cron mechanisms with clear separation of responsibilities.

---

## 1. pg_cron (#41) — SQL-only, no network

`pg_cron` is a PostgreSQL extension that runs **inside the database**. It handles **SQL-only operations** that don't require external network access.

**Jobs managed by pg_cron:**

| Job | Schedule | What it does |
|-----|----------|-------------|
| `recalculate` | Mon–Fri 18:30 | Refresh daily returns from cached prices (SQL-only) |
| `recalculate` | Sat 10:00 | Catch Friday settlement data (SQL-only) |
| `verify_prices` | Daily 07:00 | Detect missing price checkpoints (SQL-only diagnostic) |
| `backup` | Daily 02:00 | pg_dump snapshot |

**Management via CLI:**
```bash
portfolio-ts cron install    # Create pg_cron jobs
portfolio-ts cron list       # List active pg_cron jobs
portfolio-ts cron remove     # Remove all portfolio pg_cron jobs
```

**Key characteristics:**
- No network calls (no Yahoo Finance, no HTTPS)
- Runs inside PostgreSQL — requires `pg_cron` extension and superuser
- Managed via `portfolio-ts cron` subcommands

---

## 2. OS-cron — HTTPS price fetch

OS-level crontab handles the **`portfolio refresh`** command which fetches prices from Yahoo Finance via HTTPS, repairs missing data, recalculates daily returns, and emits a summary.

**The `refresh` command (one-step OS-cron entry point):**
```bash
portfolio-ts refresh         # Fetch prices + recalculate + summary
portfolio-ts refresh --dry-run  # Preview what would be fetched
```

**Manage OS-crontab via CLI:**
```bash
portfolio-ts schedule emit      # Print the crontab block (for manual review)
portfolio-ts schedule install   # Install managed crontab block (idempotent)
portfolio-ts schedule remove    # Remove the managed crontab block
```

**The installed crontab contains:**
```
### portfolio-refresh-start (managed — do not edit)
# Mon–Fri after US market close
30 18 * * 1-5  cd $PROJECT && bun run portfolio-ts/src/cli.ts refresh >> $LOG/refresh.log 2>&1
# Saturday catch-up
0 10 * * 6    cd $PROJECT && bun run portfolio-ts/src/cli.ts refresh >> $LOG/refresh.log 2>&1
# Sunday full refresh
0 3  * * 0    cd $PROJECT && bun run portfolio-ts/src/cli.ts refresh >> $LOG/refresh.log 2>&1
### portfolio-refresh-end
```

**Key characteristics:**
- Makes HTTPS calls (Yahoo Finance `yahoo-finance2` npm package)
- Requires `PORTFOLIO_DB_URL` environment variable
- Managed via `portfolio-ts schedule` subcommands with idempotent install
- Managed block delimited by `### portfolio-refresh-start` / `### portfolio-refresh-end` markers
- Double-install is safe — block is not duplicated

---

## Quick reference

| Concern | Mechanism | CLI | Network? |
|---------|-----------|-----|----------|
| Daily returns | pg_cron | `portfolio-ts cron install` | No |
| Price verification | pg_cron | `portfolio-ts cron install` | No |
| Backup | pg_cron | `portfolio-ts cron install` | No |
| Price fetch + recalc | OS-crontab | `portfolio-ts schedule install` | Yes (Yahoo) |
| Health check | OS-crontab | `portfolio-ts schedule install` | No |

---

## Environment

```bash
export PORTFOLIO_DB_URL="postgresql://user:password@host:5432/dbname"
```

---

## Log files (OS-cron)

| Log file | Written by |
|----------|-----------|
| `logs/refresh.log` | `portfolio refresh` output |
| `logs/health.log` | `health` command output |
| `logs/performance-YYYY-MM.log` | Monthly performance snapshot |

All log output is pure JSON envelopes — pipe into `jq` for monitoring:

```bash
# Monitor for refresh errors
tail -f logs/refresh.log | jq 'select(.ok == false)'

# Latest successful refresh
tail -20 logs/refresh.log | jq 'select(.ok == true) | .meta.generated_at'
```
