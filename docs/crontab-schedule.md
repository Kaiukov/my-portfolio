# Portfolio Scheduled Jobs (pg_cron)

Automated jobs for keeping prices and portfolio calculations up to date.

Scheduling is managed via **pg_cron**, a PostgreSQL extension that runs SQL functions
on a cron schedule inside the database itself. This replaces the previous OS crontab
approach, ensuring scheduling travels with backups/migrations and is visible in `psql`.

---

## Prerequisites

- PostgreSQL with **pg_cron** extension installed
- `PORTFOLIO_DB_URL` environment variable set to your PostgreSQL connection string

### Enable pg_cron

**Supabase (Pro tier and above):**
Enable pg_cron via Dashboard > Extensions. No superuser access needed — Supabase manages the extension.

**Local PostgreSQL:**
```sql
-- Add to postgresql.conf: shared_preload_libraries = 'pg_cron'
-- Then connect as superuser and run:
CREATE EXTENSION pg_cron;
```

**Managed PostgreSQL (RDS, Cloud SQL, etc.):**
Check your provider's documentation for pg_cron support.

### Install / Uninstall

```bash
# Register all portfolio jobs with pg_cron
portfolio cron install

# List active jobs
portfolio cron status

# Remove all portfolio jobs
portfolio cron uninstall
```

---

## Schedule Overview

| Job | Schedule | When | pg_cron function |
|---|---|---|---|
| `recalculate` | Mon-Fri 18:30 | After US market close | `job_run_recalculate()` |
| `recalculate` | Sat 10:00 | Weekend morning | `job_run_recalculate()` |
| `recalculate --force` | Sun 03:00 | Weekly deep refresh | `job_run_recalculate(p_force := TRUE)` |
| `repair_prices` | Sun 02:30 | Before weekly recalc (diagnostic) | `job_run_repair_prices()` |
| `verify_prices` | Daily 07:00 | Before market open | `job_run_verify_prices()` |
| `health` | Daily 07:05 | After verify | `job_run_health()` |
| `backup` | Daily 02:00 | Nightly | `job_run_backup()` |
| `status` | Mon-Fri 09:00 | Morning briefing | `job_run_status_snapshot()` |
| `performance` | 1st of month 06:00 | Monthly | `job_run_monthly_performance()` |

### Lazy-recalc maintenance

| Job | Schedule | When | What |
|---|---|---|---|
| `daily_maintenance_check()` | Daily 06:00 (via pg_cron) | Early morning | Sets `prices_need_fetch` and `needs_recalc` flags in `service_state` |
| `portfolio sync` | Daily 06:15 (via crontab) | After maintenance check | Reads flags, fetches prices / recalculates if needed, clears flags |

`portfolio sync` is also safe to run as a standalone command — it reads `service_state` flags to determine what (if anything) needs attention.

**pg_cron registration:**
```sql
SELECT cron.schedule('portfolio_daily_check', '0 6 * * *', $$SELECT daily_maintenance_check();$$);
```

---

## Audit Trail

All job executions are logged to the `scheduled_job_log` table:

```sql
-- View recent job runs
SELECT job_name, status, started_at, finished_at, error_message
FROM scheduled_job_log
ORDER BY started_at DESC
LIMIT 20;

-- Check for failures
SELECT job_name, started_at, error_message
FROM scheduled_job_log
WHERE status = 'failed'
ORDER BY started_at DESC;
```

Backups are stored in `scheduled_job_backup` as JSONB snapshots.

---

## Manual Fallback (OS crontab)

If pg_cron is unavailable (e.g., Supabase Free tier, shared hosting without extension support),
fall back to OS crontab:

### Prerequisites for crontab mode

- Project installed via `uv` (see `pyproject.toml`)
- Logs written to `$PROJECT/logs/`

```bash
mkdir -p /path/to/my-portfolio/logs
export PORTFOLIO_DB_URL='postgresql://postgres:password@localhost:5432/postgres'
```

### Crontab Entries

```cron
SHELL=/bin/bash
PROJECT=/path/to/my-portfolio
LOG=$PROJECT/logs
UV=uv
PORTFOLIO_DB_URL=postgresql://postgres:password@localhost:5432/postgres

0 2  * * *    cd $PROJECT && $UV run portfolio backup >> $LOG/backup.log 2>&1

# ─── DAILY: lazy-recalc sync (reads service_state flags, repairs/recalc if needed) (06:15)
15 6 * * *    cd $PROJECT && $UV run portfolio sync >> $LOG/sync.log 2>&1
30 2 * * 0    cd $PROJECT && $UV run portfolio repair_prices >> $LOG/repair-prices.log 2>&1
0 3  * * 0    cd $PROJECT && $UV run portfolio recalculate --force >> $LOG/recalc-full.log 2>&1
30 18 * * 1-5  cd $PROJECT && $UV run portfolio recalculate >> $LOG/recalc.log 2>&1
0 10 * * 6    cd $PROJECT && $UV run portfolio recalculate >> $LOG/recalc.log 2>&1
0 7  * * *    cd $PROJECT && $UV run portfolio verify_prices >> $LOG/verify-prices.log 2>&1
5 7  * * *    cd $PROJECT && $UV run portfolio health >> $LOG/health.log 2>&1
0 9  * * 1-5  cd $PROJECT && $UV run portfolio status >> $LOG/status.log 2>&1
0 6  1 * *    cd $PROJECT && $UV run portfolio performance > $LOG/performance-$(date +\%Y-\%m).log 2>&1
```

### Install crontab

```bash
crontab -l > /tmp/current_crontab 2>/dev/null
cat >> /tmp/current_crontab << 'EOF'
# -- portfolio auto-refresh --
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
crontab /tmp/current_crontab && rm /tmp/current_crontab
```

### Remove crontab

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
| `logs/sync.log` | Daily lazy-recalc sync output |
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

- All times are **UTC** (pg_cron uses UTC by default).
- US market closes at **16:00 ET** (20:00–21:00 UTC depending on DST). 18:30 entries
  in the crontab fallback use local server time.
- `recalculate` without `--force` uses the smart cache — it skips if nothing changed.
- `recalculate --force` on Sunday rebuilds from scratch as a safety net for cache drift.
- `repair_prices` via pg_cron is **diagnostic only** — it identifies gaps. Actual price
  fetching from yfinance requires running `portfolio repair_prices` from the CLI.
- All CLI output is pure JSON envelopes — pipe into `jq` or ingest into monitoring tools.
