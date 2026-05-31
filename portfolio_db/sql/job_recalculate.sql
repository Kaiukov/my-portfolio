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

        IF v_rows > 0 THEN
            INSERT INTO refresh_log (refresh_date, refresh_type, rows_affected)
            VALUES (CURRENT_DATE, 'daily_returns', v_rows);

            INSERT INTO service_state (state_key, state_value, updated_at)
            VALUES ('last_successful_recalc', now()::text, now())
            ON CONFLICT (state_key)
            DO UPDATE SET state_value = EXCLUDED.state_value, updated_at = EXCLUDED.updated_at;

            UPDATE service_state
            SET state_value = 'false', updated_at = now()
            WHERE state_key = 'needs_recalc';
        END IF;

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
