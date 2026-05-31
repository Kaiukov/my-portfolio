# PostgreSQL pg_cron Scheduled Jobs

Scheduled jobs migrated from OS crontab to `pg_cron`, a PostgreSQL extension that runs SQL functions on a cron schedule inside the database.

## Requirements

`pg_cron` requires:
- Superuser privileges to install
- `shared_preload_libraries = 'pg_cron'` in `postgresql.conf`
- PostgreSQL restart after config change

## Extension Installation

```sql
-- Requires superuser (postgres role)
CREATE EXTENSION pg_cron;

-- Verify
SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_cron';
```

### Supabase

Supabase Pro and above include pg_cron. Free tier does not. For Free tier, fall back to OS crontab (see `docs/crontab-schedule.md`).

### Local PostgreSQL

```bash
# macOS Homebrew PostgreSQL 16
brew services stop postgresql@16
echo "shared_preload_libraries = 'pg_cron'" >> /opt/homebrew/var/postgresql@16/postgresql.conf
brew services start postgresql@16

# Then connect as superuser
psql postgres -c "CREATE EXTENSION pg_cron;"
```

## Architecture

All job wrappers are standalone PL/pgSQL functions in `portfolio_db/sql/job_*.sql`. Each wrapper:
1. Inserts a start row into `scheduled_job_log` with `status = 'running'`
2. Calls the existing SQL function (no financial math duplication)
3. Updates the log row with status, rows_affected, and error_message on finish
4. Uses BEGIN/EXCEPTION to catch and log failures

The wrappers are independently deployable and testable **without** pg_cron:
```sql
SELECT job_recalculate();
SELECT job_repair_missing_prices(5);
SELECT job_verify_prices(5);
SELECT job_backup();
SELECT job_monthly_performance('SPY');
SELECT job_health(5);
```

The `cron_jobs.sql` file contains all `cron.schedule()` registrations guarded by an extension existence check. Deploying it on a DB without pg_cron is safe — it emits a NOTICE and skips.

## LIMITATION: pg_cron is SQL-Only — Cannot Fetch External Prices

**pg_cron runs SQL functions inside the database. It has NO network access.** It cannot call external APIs (Yahoo Finance, etc.) to fetch price data. This is a fundamental PostgreSQL security boundary — PL/pgSQL cannot make HTTP requests.

**What pg_cron CAN do (and does):**
- `job_repair_missing_prices` — DETECTS stale/missing prices via `daily_maintenance_check()` + `stale_tickers_sql()`, sets `service_state.prices_need_fetch = true`, logs which tickers are stale to `scheduled_job_log` with status `needs_external_repair`
- `job_verify_prices` — DIAGNOSTIC coverage and staleness check
- `job_recalculate` — Rebuilds `daily_returns` from cached prices (only works when prices are already in `prices` table)
- `job_health` — DB liveness + service_state freshness check

**What requires the external CLI (OS crontab / CI / manual):**
- Actual price fetching: `portfolio-ts repair_prices` which calls Yahoo Finance via `yahoo-finance2`

**Recommended hybrid approach:**
1. Let pg_cron run `job_detect_missing_prices` (Sunday 02:30) to flag staleness before the weekly recalc
2. Schedule `portfolio-ts repair_prices` via OS crontab 20 minutes earlier (Sunday 02:10) so fresh prices are in the cache before detection runs
3. Or run `portfolio-ts repair_prices` manually when `scheduled_job_log` shows `needs_external_repair` entries

**Verifying staleness in the audit trail:**
```sql
SELECT started_at, rows_affected, error_message
FROM scheduled_job_log
WHERE job_name = 'job_repair_missing_prices'
  AND status = 'needs_external_repair'
ORDER BY started_at DESC;
```

## Lifecycle

Jobs are scheduled in this daily/weekly order (pg_cron SQL-only jobs, plus external CLI for price fetching):

```
external: repair_prices (OS crontab Sun 02:10) — fetches fresh prices from Yahoo
pg_cron:  detect_missing_prices (Sun 02:30) — verifies prices are now fresh
pg_cron:  recalculate --force (Sun 03:00)    — full weekly rebuild
pg_cron:  backup (daily 02:00)
pg_cron:  verify_prices (daily 07:00) → health (07:05)
pg_cron:  recalculate (Mon-Fri 18:30, Sat 10:00) — guarded (skips if no changes)
pg_cron:  monthly performance (1st 06:00)
```

## Job Schedule

| Job name | Schedule | Wrapper | Description |
|---|---|---|---|
| `portfolio_verify_prices_daily` | `0 7 * * *` | `job_verify_prices()` | Price coverage + staleness diagnostic |
| `portfolio_health_daily` | `5 7 * * *` | `job_health()` | DB reachability + service_state freshness |
| `portfolio_backup_daily` | `0 2 * * *` | `job_backup()` | COPY snapshot of transactions, daily_returns, prices |
| `portfolio_recalc_weekday` | `30 18 * * 1-5` | `job_recalculate()` | Guarded refresh (skips if no changes or stale prices) |
| `portfolio_recalc_saturday` | `0 10 * * 6` | `job_recalculate()` | Guarded refresh (catch late Friday data) |
| `portfolio_recalc_sunday` | `0 3 * * 0` | `job_recalculate(true)` | Forced full rebuild (bypasses all guards) |
| `portfolio_detect_missing_prices_sunday` | `30 2 * * 0` | `job_repair_missing_prices()` | Detect missing/stale prices (SQL-only, cannot fetch) |
| `portfolio_performance_monthly` | `0 6 1 * *` | `job_monthly_performance()` | Monthly performance snapshot |

## CLI Commands

```bash
# Register all jobs in pg_cron
portfolio-ts cron install

# List registered portfolio jobs
portfolio-ts cron list

# Remove all portfolio jobs from pg_cron
portfolio-ts cron remove
```

The CLI is a thin adapter — it checks for pg_cron availability and delegates all job registration to `cron.schedule()` / `cron.unschedule()`. No business logic in the CLI.

## Audit Trail: `scheduled_job_log`

Every job execution is logged to the `scheduled_job_log` table:

```sql
SELECT job_name, started_at, finished_at, status, rows_affected, error_message
FROM scheduled_job_log
ORDER BY started_at DESC
LIMIT 20;
```

Columns:
- `job_name` — wrapper function name
- `started_at` — when the job started
- `finished_at` — when the job finished (NULL if still running)
- `status` — `running`, `completed`, or `failed`
- `rows_affected` — rows affected by the operation
- `error_message` — error details on failure, or diagnostic info on success

## Fallback: OS Crontab

If pg_cron is unavailable (Supabase Free, no superuser access), use the OS crontab fallback documented in `docs/crontab-schedule.md`. The crontab approach calls the `portfolio-ts` CLI directly but lacks the audit trail and DB-native error handling.

## Migration from Crontab to pg_cron

1. Install pg_cron extension (requires superuser)
2. Deploy SQL wrappers: `psql "$PORTFOLIO_DB_URL" -f portfolio_db/sql/job_*.sql`
3. Deploy migration: `psql "$PORTFOLIO_DB_URL" -f portfolio_db/sql/migration_002_scheduled_job_log.sql`
4. Register jobs: `bun src/cli.ts cron install` (or `psql -f portfolio_db/sql/cron_jobs.sql`)
5. Verify: `bun src/cli.ts cron list`
6. Remove crontab entries: `crontab -l | grep -v "portfolio" | crontab -`
