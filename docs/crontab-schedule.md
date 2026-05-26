# Portfolio Crontab Schedule

Automated jobs for keeping prices and portfolio calculations up to date.

---

## Prerequisites

- Project installed via `uv` (see `pyproject.toml`)
- PostgreSQL connection URL set in `PORTFOLIO_DB_URL` env var (required)
- Logs written to `$PROJECT/logs/`

```bash
# One-time setup
mkdir -p /path/to/my-portfolio/logs

# Set PostgreSQL connection
export PORTFOLIO_DB_URL='postgresql://postgres:password@localhost:5432/postgres'
# OR use Supabase
export PORTFOLIO_DB_URL='postgresql://postgres:password@db.project.supabase.co:5432/postgres?sslmode=require'
```

---

## Schedule Overview

| Job | Schedule | When | Why |
|---|---|---|---|
| `recalculate` | Mon–Fri 18:30 | After US market close (16:00 ET) | Refresh daily returns with latest closing prices |
| `recalculate` | Sat 10:00 | Weekend morning | Catch any late Friday settlement data |
| `recalculate --force` | Sun 03:00 | Weekly deep refresh | Full recalc — clears cache, rebuilds all rows |
| `repair_prices` | Sun 02:30 | Before weekly recalc | Backfill any missing price coverage |
| `verify_prices` | Daily 07:00 | Before market open | Detect missing/stale price data early |
| `health` | Daily 07:05 | After verify | Confirm DB reachable and recalc fresh |
| `backup` | Daily 02:00 | Nightly | Timestamped DB snapshot before daily operations |
| `status` | Mon–Fri 09:00 | Morning briefing | Snapshot portfolio value to log |
| `performance` | 1st of month 06:00 | Monthly | Persist monthly performance report to file |

---

## Crontab Entries

```cron
# ─── ENVIRONMENT ────────────────────────────────────────────────────────────
SHELL=/bin/bash
PROJECT=/path/to/my-portfolio
LOG=$PROJECT/logs
UV=uv
# PostgreSQL connection (required)
PORTFOLIO_DB_URL=postgresql://postgres:password@localhost:5432/postgres

# ─── NIGHTLY: backup DB before daily operations (02:00) ──────────────────────
0 2  * * *    cd $PROJECT && $UV run portfolio backup >> $LOG/backup.log 2>&1

# ─── SUNDAY: repair missing prices before weekly recalc (02:30) ──────────────
30 2 * * 0    cd $PROJECT && $UV run portfolio repair_prices >> $LOG/repair-prices.log 2>&1

# ─── SUNDAY: full forced recalculation (weekly deep refresh) (03:00) ─────────
0 3  * * 0    cd $PROJECT && $UV run portfolio recalculate --force >> $LOG/recalc-full.log 2>&1

# ─── WEEKDAY: recalculate after US market close (Mon–Fri 18:30) ─────────────
30 18 * * 1-5  cd $PROJECT && $UV run portfolio recalculate >> $LOG/recalc.log 2>&1

# ─── SATURDAY: catch late Friday settlement data ─────────────────────────────
0 10 * * 6    cd $PROJECT && $UV run portfolio recalculate >> $LOG/recalc.log 2>&1

# ─── DAILY: verify price data integrity at 07:00 ─────────────────────────────
0 7  * * *    cd $PROJECT && $UV run portfolio verify_prices >> $LOG/verify-prices.log 2>&1

# ─── DAILY: health check after verify (07:05) ────────────────────────────────
5 7  * * *    cd $PROJECT && $UV run portfolio health >> $LOG/health.log 2>&1

# ─── WEEKDAY MORNING: portfolio status snapshot at 09:00 ─────────────────────
0 9  * * 1-5  cd $PROJECT && $UV run portfolio status >> $LOG/status.log 2>&1

# ─── MONTHLY: performance report on 1st of each month at 06:00 ───────────────
0 6  1 * *    cd $PROJECT && $UV run portfolio performance > $LOG/performance-$(date +\%Y-\%m).log 2>&1
```

---

## Install / Remove

### Install
```bash
# Append entries to current crontab
crontab -l > /tmp/current_crontab 2>/dev/null
cat >> /tmp/current_crontab << 'EOF'

# ── portfolio auto-refresh ────────────────────────────────────────────────────
SHELL=/bin/bash
PROJECT=/path/to/my-portfolio
LOG=$PROJECT/logs
UV=uv
PORTFOLIO_DB_URL=postgresql://postgres:password@localhost:5432/postgres

30 18 * * 1-5  cd $PROJECT && $UV run portfolio recalculate >> $LOG/recalc.log 2>&1
0  10 * * 6    cd $PROJECT && $UV run portfolio recalculate >> $LOG/recalc.log 2>&1
0  3  * * 0    cd $PROJECT && $UV run portfolio recalculate --force >> $LOG/recalc-full.log 2>&1
0  7  * * *    cd $PROJECT && $UV run portfolio verify_prices >> $LOG/verify-prices.log 2>&1
0  9  * * 1-5  cd $PROJECT && $UV run portfolio status >> $LOG/status.log 2>&1
0  6  1 * *    cd $PROJECT && $UV run portfolio performance > $LOG/performance-$(date +%Y-%m).log 2>&1
EOF
crontab /tmp/current_crontab && echo "Crontab installed." && rm /tmp/current_crontab
```

### Remove
```bash
crontab -l | grep -v "portfolio" | crontab -
echo "Portfolio crontab entries removed."
```

### Verify
```bash
crontab -l | grep portfolio
```

---

## Log Files

| File | Updated by |
|---|---|
| `logs/portfolio.log` | All mutations and key events (structured JSON lines) |
| `logs/backup.log` | Nightly backup |
| `logs/repair-prices.log` | Sunday price repair |
| `logs/recalc.log` | Weekday + Saturday recalculate |
| `logs/recalc-full.log` | Sunday forced recalculate |
| `logs/verify-prices.log` | Daily price integrity check |
| `logs/health.log` | Daily health check |
| `logs/status.log` | Weekday morning status snapshot |
| `logs/performance-YYYY-MM.log` | Monthly performance report (one file per month) |

### Tail logs
```bash
# Live tail of recalc
tail -f $PROJECT/logs/recalc.log

# Last price verification
tail -20 $PROJECT/logs/verify-prices.log

# This month's performance report
cat $PROJECT/logs/performance-$(date +%Y-%m).log
```

---

## Notes

- All times are **local server time**. Adjust if server is not in your timezone.
- US market closes at **16:00 ET**. 18:30 local gives a 2.5 h buffer for data propagation on yfinance.
- `recalculate` without `--force` uses the smart cache — it skips if nothing changed.
- `recalculate --force` on Sunday rebuilds from scratch; this is the safety net for any cache drift.
- After the response standardization plan is implemented, all log output will be pure JSON envelopes — easy to pipe into `jq` or ingest into monitoring tools.

```bash
# Example: monitor for errors after implementation
tail -f logs/recalc.log | jq 'select(.ok == false)'
```
