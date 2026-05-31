# Portfolio Scheduling

Two distinct cron approaches serve different purposes. Do not mix them.

---

## 1. pg_cron (SQL-only — internal DB operations)

**Scope**: recalculate, verify, health checks, backup — runs INSIDE PostgreSQL.

**Network**: NO. pg_cron has no network access and cannot fetch Yahoo prices.

**Commands**:
```bash
portfolio cron install    # register all pg_cron jobs
portfolio cron list       # list managed jobs
portfolio cron remove     # unregister
```

**Managed jobs** (all SQL-only):
| Job | Schedule | Purpose |
|---|---|---|
| `portfolio_verify_prices_daily` | Daily 07:00 | Detect stale/missing price data |
| `portfolio_health_daily` | Daily 07:05 | DB reachability + recalc freshness |
| `portfolio_backup_daily` | Daily 02:00 | Nightly DB snapshot |
| `portfolio_recalc_weekday` | Mon–Fri 18:30 | Recalculate daily returns after US close |
| `portfolio_recalc_saturday` | Sat 10:00 | Catch late Friday settlement |
| `portfolio_detect_missing_prices_sunday` | Sun 02:30 | Scan for missing price coverage |
| `portfolio_recalc_sunday` | Sun 03:00 | Weekly forced full recalc |
| `portfolio_performance_monthly` | 1st of month 06:00 | Monthly performance snapshot |

---

## 2. OS-crontab (`portfolio refresh` — network price fetch)

**Scope**: Fetches Yahoo Finance prices via HTTPS, recalculates, returns fresh summary — runs on HOST OS.

**Network**: YES. This is the ONLY way to fetch fresh prices from Yahoo Finance on a schedule.

**Commands**:
```bash
portfolio schedule --emit      # print the crontab line (default)
portfolio schedule --install   # append managed block to user crontab (idempotent)
portfolio schedule --remove    # remove managed block
```

**Managed crontab entry**:
```cron
# >>> portfolio-cli managed >>>
30 18 * * 1-5 cd /path/to/repo && portfolio refresh >/dev/null 2>&1
# <<< portfolio-cli managed <<<
```

**Schedule**: Weekdays (Mon–Fri) at 18:30 local time — 2.5 hours after US market close (16:00 ET), giving Yahoo Finance time to propagate closing prices.

**Idempotency**: Running `schedule --install` twice does NOT duplicate the block. The managed block is identified by comment delimiters `# >>> portfolio-cli managed >>>` / `# <<< portfolio-cli managed <<<`.

**Compatibility**: macOS and Linux (uses `crontab -l` / `crontab -`).

---

## Division of labor

| Concern | Who handles it |
|---|---|
| Fetch fresh Yahoo prices | OS-cron (`portfolio refresh`) |
| Recalculate from cached prices | pg_cron (`portfolio_recalc_*`) |
| Verify price data integrity | pg_cron (`portfolio_verify_prices_daily`) |
| DB health checks | pg_cron (`portfolio_health_daily`) |
| DB backups | pg_cron (`portfolio_backup_daily`) |
| Monthly performance snap | pg_cron (`portfolio_performance_monthly`) |

pg_cron CANNOT fetch Yahoo prices (no network). OS-cron CAN fetch prices but cannot run inside PostgreSQL. Use both together for a complete automated pipeline.
