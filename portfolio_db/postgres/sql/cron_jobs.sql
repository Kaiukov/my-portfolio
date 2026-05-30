-- Portfolio pg_cron schedule registrations
-- RUN: SELECT cron.schedule(...) for each job below.
-- UNINSTALL: SELECT cron.unschedule('job_name') for each.
--
-- Requires: CREATE EXTENSION pg_cron; (superuser, shared_preload_libraries)
-- The pg_cron extension must be installed before running this file.
-- On Supabase: pg_cron is available on Pro tier and above; enable via Dashboard > Extensions.

-- ═══════════════════════════════════════════════════════════════════════════════
-- INSTALL — register all scheduled jobs
-- ═══════════════════════════════════════════════════════════════════════════════

-- Daily 02:00 — backup key tables to scheduled_job_backup
SELECT cron.schedule(
    'portfolio_backup',
    '0 2 * * *',
    $$SELECT job_run_backup();$$
);

-- Sun 02:30 — repair_prices diagnostic (identifies gaps; run `portfolio repair_prices` CLI if gaps found)
SELECT cron.schedule(
    'portfolio_repair_prices',
    '30 2 * * 0',
    $$SELECT job_run_repair_prices();$$
);

-- Sun 03:00 — full forced recalculate
SELECT cron.schedule(
    'portfolio_recalculate_full',
    '0 3 * * 0',
    $$SELECT job_run_recalculate(p_force := TRUE);$$
);

-- Mon-Fri 18:30 — recalculate after US market close
SELECT cron.schedule(
    'portfolio_recalculate_weekday',
    '30 18 * * 1-5',
    $$SELECT job_run_recalculate();$$
);

-- Sat 10:00 — catch late Friday settlement data
SELECT cron.schedule(
    'portfolio_recalculate_saturday',
    '0 10 * * 6',
    $$SELECT job_run_recalculate();$$
);

-- Daily 07:00 — verify price cache coverage
SELECT cron.schedule(
    'portfolio_verify_prices',
    '0 7 * * *',
    $$SELECT job_run_verify_prices();$$
);

-- Daily 07:05 — health check
SELECT cron.schedule(
    'portfolio_health',
    '5 7 * * *',
    $$SELECT job_run_health();$$
);

-- Mon-Fri 09:00 — status snapshot
SELECT cron.schedule(
    'portfolio_status',
    '0 9 * * 1-5',
    $$SELECT job_run_status_snapshot();$$
);

-- Monthly 1st 06:00 — performance report
SELECT cron.schedule(
    'portfolio_performance',
    '0 6 1 * *',
    $$SELECT job_run_monthly_performance();$$
);


-- ═══════════════════════════════════════════════════════════════════════════════
-- UNINSTALL — remove all portfolio scheduled jobs
-- ═══════════════════════════════════════════════════════════════════════════════

-- SELECT cron.unschedule('portfolio_backup');
-- SELECT cron.unschedule('portfolio_repair_prices');
-- SELECT cron.unschedule('portfolio_recalculate_full');
-- SELECT cron.unschedule('portfolio_recalculate_weekday');
-- SELECT cron.unschedule('portfolio_recalculate_saturday');
-- SELECT cron.unschedule('portfolio_verify_prices');
-- SELECT cron.unschedule('portfolio_health');
-- SELECT cron.unschedule('portfolio_status');
-- SELECT cron.unschedule('portfolio_performance');
