# Portfolio Crontab Schedule

Automated jobs for keeping prices and portfolio calculations up to date.

---

## Prerequisites

- Project installed via `uv` (see `pyproject.toml`)
- Database at `$PROJECT_ROOT/portfolio.db` (default path)
- Logs written to `$PROJECT_ROOT/logs/`

```bash
# One-time setup
mkdir -p /home/user/my-portfolio/logs
```

---

## Schedule Overview

| Job | Schedule | When | Why |
|---|---|---|---|
| `recalculate` | Mon–Fri 18:30 | After US market close (16:00 ET) | Refresh daily returns with latest closing prices |
| `recalculate` | Sat 10:00 | Weekend morning | Catch any late Friday settlement data |
| `recalculate --force` | Sun 03:00 | Weekly deep refresh | Full recalc — clears cache, rebuilds all rows |
| `verify_prices` | Daily 07:00 | Before market open | Detect missing/stale price data early |
| `status` | Mon–Fri 09:00 | Morning briefing | Snapshot portfolio value to log |
| `performance` | 1st of month 06:00 | Monthly | Persist monthly performance report to file |

---

## Crontab Entries

```cron
# ─── ENVIRONMENT ────────────────────────────────────────────────────────────
SHELL=/bin/bash
PROJECT=/home/user/my-portfolio
LOG=$PROJECT/logs
DB=$PROJECT/portfolio.db
UV=uv

# ─── WEEKDAY: recalculate after US market close (Mon–Fri 18:30) ─────────────
30 18 * * 1-5  cd $PROJECT && $UV run portfolio recalculate --db $DB >> $LOG/recalc.log 2>&1

# ─── SATURDAY: catch late Friday settlement data ─────────────────────────────
0 10 * * 6    cd $PROJECT && $UV run portfolio recalculate --db $DB >> $LOG/recalc.log 2>&1

# ─── SUNDAY: full forced recalculation (weekly deep refresh) ─────────────────
0 3  * * 0    cd $PROJECT && $UV run portfolio recalculate --force --db $DB >> $LOG/recalc-full.log 2>&1

# ─── DAILY: verify price data integrity at 07:00 ─────────────────────────────
0 7  * * *    cd $PROJECT && $UV run portfolio verify_prices --db $DB >> $LOG/verify-prices.log 2>&1

# ─── WEEKDAY MORNING: portfolio status snapshot at 09:00 ─────────────────────
0 9  * * 1-5  cd $PROJECT && $UV run portfolio status --db $DB >> $LOG/status.log 2>&1

# ─── MONTHLY: performance report on 1st of each month at 06:00 ───────────────
0 6  1 * *    cd $PROJECT && $UV run portfolio performance --db $DB > $LOG/performance-$(date +\%Y-\%m).log 2>&1
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
PROJECT=/home/user/my-portfolio
LOG=/home/user/my-portfolio/logs
DB=/home/user/my-portfolio/portfolio.db
UV=uv

30 18 * * 1-5  cd $PROJECT && $UV run portfolio recalculate --db $DB >> $LOG/recalc.log 2>&1
0  10 * * 6    cd $PROJECT && $UV run portfolio recalculate --db $DB >> $LOG/recalc.log 2>&1
0  3  * * 0    cd $PROJECT && $UV run portfolio recalculate --force --db $DB >> $LOG/recalc-full.log 2>&1
0  7  * * *    cd $PROJECT && $UV run portfolio verify_prices --db $DB >> $LOG/verify-prices.log 2>&1
0  9  * * 1-5  cd $PROJECT && $UV run portfolio status --db $DB >> $LOG/status.log 2>&1
0  6  1 * *    cd $PROJECT && $UV run portfolio performance --db $DB > $LOG/performance-$(date +%Y-%m).log 2>&1
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
| `logs/recalc.log` | Weekday + Saturday recalculate |
| `logs/recalc-full.log` | Sunday forced recalculate |
| `logs/verify-prices.log` | Daily price integrity check |
| `logs/status.log` | Weekday morning status snapshot |
| `logs/performance-YYYY-MM.log` | Monthly performance report (one file per month) |

### Tail logs
```bash
# Live tail of recalc
tail -f /home/user/my-portfolio/logs/recalc.log

# Last price verification
tail -20 /home/user/my-portfolio/logs/verify-prices.log

# This month's performance report
cat /home/user/my-portfolio/logs/performance-$(date +%Y-%m).log
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
