-- pg_cron schedule registrations for portfolio automated jobs.
-- SAFE TO DEPLOY on databases WITHOUT pg_cron: the DO block checks for the extension
-- and emits a NOTICE if pg_cron is not installed, skipping all registrations.
-- When pg_cron IS installed, this file registers all portfolio cron jobs.
-- Each job calls a standalone PL/pgSQL wrapper function (job_*.sql) that is
-- independently testable with SELECT job_name(...).
--
-- Lifecycle order: verify -> repair -> recalculate -> health -> backup
-- Monthly: performance snapshot
--
-- To apply: psql "$PORTFOLIO_DB_URL" -f portfolio_db/sql/cron_jobs.sql
-- To list:   SELECT * FROM cron.job WHERE jobname LIKE 'portfolio_%';
-- To clear:  SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname LIKE 'portfolio_%';

DO $do$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
    ) THEN
        RAISE NOTICE 'pg_cron extension is not installed – skipping all cron job registrations.';
        RAISE NOTICE 'Install pg_cron first: CREATE EXTENSION pg_cron; (requires superuser and shared_preload_libraries)';
        RAISE NOTICE 'See docs/pg-cron.md for setup instructions.';
        RETURN;
    END IF;

    --
    -- Daily 07:00 -- Verify price data integrity
    --
    PERFORM cron.schedule(
        'portfolio_verify_prices_daily',
        '0 7 * * *',
        $$SELECT job_verify_prices(5)$$
    );

    --
    -- Daily 07:05 -- Health check
    --
    PERFORM cron.schedule(
        'portfolio_health_daily',
        '5 7 * * *',
        $$SELECT job_health(5)$$
    );

    --
    -- Daily 02:00 -- Backup (snapshot key tables)
    --
    PERFORM cron.schedule(
        'portfolio_backup_daily',
        '0 2 * * *',
        $$SELECT job_backup()$$
    );

    --
    -- Mon-Fri 18:30 -- Recalculate after US market close
    --
    PERFORM cron.schedule(
        'portfolio_recalc_weekday',
        '30 18 * * 1-5',
        $$SELECT job_recalculate()$$
    );

    --
    -- Sat 10:00 -- Recalculate (catch late Friday data)
    --
    PERFORM cron.schedule(
        'portfolio_recalc_saturday',
        '0 10 * * 6',
        $$SELECT job_recalculate()$$
    );

    --
    -- Sun 02:30 -- Detect missing/stale prices
    --
    PERFORM cron.schedule(
        'portfolio_repair_prices_sunday',
        '30 2 * * 0',
        $$SELECT job_repair_missing_prices(5)$$
    );

    --
    -- Sun 03:00 -- Deep weekly recalculation
    --
    PERFORM cron.schedule(
        'portfolio_recalc_sunday',
        '0 3 * * 0',
        $$SELECT job_recalculate()$$
    );

    --
    -- Monthly 1st 06:00 -- Performance snapshot
    --
    PERFORM cron.schedule(
        'portfolio_performance_monthly',
        '0 6 1 * *',
        $$SELECT job_monthly_performance('SPY')$$
    );

    RAISE NOTICE 'Portfolio pg_cron jobs registered successfully.';
    RAISE NOTICE 'Use SELECT * FROM cron.job WHERE jobname LIKE ''portfolio_%%'' to list active jobs.';
END;
$do$;
