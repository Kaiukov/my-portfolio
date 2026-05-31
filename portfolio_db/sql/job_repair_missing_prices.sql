-- pg_cron job wrapper: detect missing/stale prices.
-- Runs daily_maintenance_check() and stale_tickers_sql() to detect price gaps.
-- Logs detection results to scheduled_job_log.
-- NOTE: actual Yahoo price fetching requires network I/O and is performed by
-- the 'portfolio-ts repair_prices' CLI command. This wrapper is a SQL-only
-- diagnostic that flags staleness in service_state for the CLI to act on.
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
        SET status = 'completed',
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
