-- pg_cron job wrapper: snapshot key tables via COPY.
-- Creates timestamped backup tables (transactions_backup_YYYYMMDD etc.) in the same DB.
-- This is a SQL-only alternative to pg_dump; for full external backups use 'portfolio-ts backup'.
-- Deployable independently of pg_cron; test with: SELECT job_backup();

DROP FUNCTION IF EXISTS job_backup() CASCADE;
CREATE OR REPLACE FUNCTION job_backup()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_job_id BIGINT;
    v_suffix TEXT;
    v_count INTEGER := 0;
    v_row_count BIGINT;
BEGIN
    INSERT INTO scheduled_job_log (job_name, status)
    VALUES ('job_backup', 'running')
    RETURNING id INTO v_job_id;

    BEGIN
        v_suffix := to_char(now(), 'YYYYMMDD');

        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS transactions_backup_%s AS TABLE transactions',
            v_suffix
        );
        GET DIAGNOSTICS v_row_count = ROW_COUNT;
        v_count := v_count + v_row_count::integer;

        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS daily_returns_backup_%s AS TABLE daily_returns',
            v_suffix
        );
        GET DIAGNOSTICS v_row_count = ROW_COUNT;
        v_count := v_count + v_row_count::integer;

        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS prices_backup_%s AS TABLE prices',
            v_suffix
        );
        GET DIAGNOSTICS v_row_count = ROW_COUNT;
        v_count := v_count + v_row_count::integer;

        UPDATE scheduled_job_log
        SET status = 'completed',
            finished_at = now(),
            rows_affected = v_count
        WHERE id = v_job_id;
    EXCEPTION WHEN OTHERS THEN
        UPDATE scheduled_job_log
        SET status = 'failed',
            finished_at = now(),
            rows_affected = v_count,
            error_message = SQLERRM
        WHERE id = v_job_id;
    END;

    RETURN v_count;
END;
$$;
