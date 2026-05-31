-- pg_cron job wrapper: health check (DB reachability + service_state freshness).
-- Runs SELECT 1 for liveness and checks service_state staleness.
-- Deployable independently of pg_cron; test with: SELECT job_health();

DROP FUNCTION IF EXISTS job_health(INTEGER) CASCADE;
CREATE OR REPLACE FUNCTION job_health(p_max_age_days INTEGER DEFAULT 5)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_job_id BIGINT;
    v_one INTEGER;
    v_needs_recalc BOOLEAN;
    v_issues TEXT := '';
BEGIN
    INSERT INTO scheduled_job_log (job_name, status)
    VALUES ('job_health', 'running')
    RETURNING id INTO v_job_id;

    BEGIN
        SELECT 1 INTO v_one;

        v_needs_recalc := needs_recalc();

        IF v_needs_recalc THEN
            v_issues := 'needs_recalc=true; ';
        END IF;

        IF EXISTS (
            SELECT 1 FROM stale_tickers_sql(p_max_age_days)
        ) THEN
            v_issues := v_issues || 'stale_tickers_detected; ';
        END IF;

        UPDATE scheduled_job_log
        SET status = CASE WHEN v_issues = '' THEN 'completed' ELSE 'completed' END,
            finished_at = now(),
            rows_affected = CASE WHEN v_issues = '' THEN 0 ELSE 1 END,
            error_message = CASE WHEN v_issues = '' THEN 'healthy' ELSE v_issues END
        WHERE id = v_job_id;
    EXCEPTION WHEN OTHERS THEN
        UPDATE scheduled_job_log
        SET status = 'failed',
            finished_at = now(),
            rows_affected = 0,
            error_message = SQLERRM
        WHERE id = v_job_id;
    END;

    RETURN (v_issues = '');
END;
$$;
