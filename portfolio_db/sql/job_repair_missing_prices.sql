-- pg_cron job wrapper: DETECT missing/stale prices (diagnostic only).
-- Runs daily_maintenance_check() and stale_tickers_sql() to detect price gaps.
-- Sets service_state.prices_need_fetch flag for external CLI to act on.
-- STATUS: 'needs_external_repair' when stale tickers found, 'completed_ok' when all fresh.
--
-- IMPORTANT LIMITATION: PostgreSQL/pg_cron cannot make network calls.
-- This wrapper CANNOT fetch prices from Yahoo Finance or any external API.
-- Actual price fetching MUST run via the external CLI:
--   portfolio-ts repair_prices
-- (trigger manually, via OS crontab, or via CI pipeline).
-- pg_cron ONLY detects staleness — it does not and cannot repair it.
--
-- Deployable independently of pg_cron; test with: SELECT job_repair_missing_prices();

DROP FUNCTION IF EXISTS job_repair_missing_prices(INTEGER) CASCADE;
CREATE OR REPLACE FUNCTION job_repair_missing_prices(p_max_age_days INTEGER DEFAULT 5)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_job_id BIGINT;
    v_stale_count INTEGER;
    v_stale_list TEXT;
BEGIN
    INSERT INTO scheduled_job_log (job_name, status)
    VALUES ('job_repair_missing_prices', 'running')
    RETURNING id INTO v_job_id;

    BEGIN
        PERFORM daily_maintenance_check(p_max_age_days);

        SELECT COUNT(*), string_agg(s.ticker, ',')
        INTO v_stale_count, v_stale_list
        FROM stale_tickers_sql(p_max_age_days) s;

        UPDATE scheduled_job_log
        SET status = CASE
                WHEN v_stale_count > 0 THEN 'needs_external_repair'
                ELSE 'completed_ok'
            END,
            finished_at = now(),
            rows_affected = v_stale_count,
            error_message = CASE
                WHEN v_stale_count > 0 THEN 'Stale tickers detected: ' || v_stale_list
                ELSE NULL
            END
        WHERE id = v_job_id;
    EXCEPTION WHEN OTHERS THEN
        UPDATE scheduled_job_log
        SET status = 'failed',
            finished_at = now(),
            rows_affected = 0,
            error_message = SQLERRM
        WHERE id = v_job_id;
    END;

    RETURN v_stale_count;
END;
$$;
