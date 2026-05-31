-- pg_cron job wrapper: recalculate daily returns.
-- Calls refresh_daily_returns_sql() – the single canonical recalculation function.
-- Logs execution to scheduled_job_log with status, rows_affected, and error_message.
-- Deployable independently of pg_cron; test with: SELECT job_recalculate();

DROP FUNCTION IF EXISTS job_recalculate() CASCADE;
CREATE OR REPLACE FUNCTION job_recalculate()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_job_id BIGINT;
    v_rows INTEGER := 0;
BEGIN
    INSERT INTO scheduled_job_log (job_name, status)
    VALUES ('job_recalculate', 'running')
    RETURNING id INTO v_job_id;

    BEGIN
        v_rows := refresh_daily_returns_sql(NULL);

        UPDATE scheduled_job_log
        SET status = 'completed',
            finished_at = now(),
            rows_affected = v_rows
        WHERE id = v_job_id;
    EXCEPTION WHEN OTHERS THEN
        UPDATE scheduled_job_log
        SET status = 'failed',
            finished_at = now(),
            rows_affected = 0,
            error_message = SQLERRM
        WHERE id = v_job_id;
    END;

    RETURN v_rows;
END;
$$;
