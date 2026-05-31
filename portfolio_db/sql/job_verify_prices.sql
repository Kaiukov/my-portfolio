-- pg_cron job wrapper: verify price data integrity.
-- Checks price cache coverage against required tickers and reports staleness.
-- Purely diagnostic (read-only) – does not modify any data.
-- Deployable independently of pg_cron; test with: SELECT job_verify_prices();

DROP FUNCTION IF EXISTS job_verify_prices(INTEGER) CASCADE;
CREATE OR REPLACE FUNCTION job_verify_prices(p_max_age_days INTEGER DEFAULT 5)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_job_id BIGINT;
    v_total_rows INTEGER;
    v_unique_tickers INTEGER;
    v_coverage_issues INTEGER;
    v_stale_count INTEGER;
    v_issue_list TEXT;
BEGIN
    INSERT INTO scheduled_job_log (job_name, status)
    VALUES ('job_verify_prices', 'running')
    RETURNING id INTO v_job_id;

    BEGIN
        SELECT COUNT(*), COUNT(DISTINCT ticker)
        INTO v_total_rows, v_unique_tickers
        FROM prices;

        SELECT COUNT(*), string_agg(c.ticker, ',')
        INTO v_coverage_issues, v_issue_list
        FROM (
            SELECT DISTINCT c.ticker
            FROM get_required_price_checkpoints_sql(last_trading_day_sql(CURRENT_DATE)) c
            WHERE NOT EXISTS (
                SELECT 1 FROM prices p
                WHERE p.ticker = c.ticker AND p.date = c.checkpoint_date::date
            )
        ) c;

        SELECT COUNT(*)
        INTO v_stale_count
        FROM stale_tickers_sql(p_max_age_days);

        UPDATE scheduled_job_log
        SET status = 'completed',
            finished_at = now(),
            rows_affected = v_coverage_issues + v_stale_count,
            error_message = CASE
                WHEN v_coverage_issues > 0 OR v_stale_count > 0
                THEN 'Issues: ' || COALESCE(v_coverage_issues::text, '0') || ' coverage, '
                     || v_stale_count::text || ' stale'
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

    RETURN v_coverage_issues + v_stale_count;
END;
$$;
