-- pg_cron job wrapper: compute and log monthly performance snapshot.
-- Calls portfolio_performance_sql() and logs key metrics to scheduled_job_log.
-- Does NOT duplicate any financial math – delegates entirely to portfolio_performance_sql().
-- Deployable independently of pg_cron; test with: SELECT job_monthly_performance();

DROP FUNCTION IF EXISTS job_monthly_performance(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION job_monthly_performance(p_benchmark TEXT DEFAULT 'SPY')
RETURNS DOUBLE PRECISION
LANGUAGE plpgsql
AS $$
DECLARE
    v_job_id BIGINT;
    v_twr DOUBLE PRECISION;
    v_cagr DOUBLE PRECISION;
    v_sharpe DOUBLE PRECISION;
    v_max_dd DOUBLE PRECISION;
    v_metrics TEXT;
BEGIN
    INSERT INTO scheduled_job_log (job_name, status)
    VALUES ('job_monthly_performance', 'running')
    RETURNING id INTO v_job_id;

    BEGIN
        SELECT
            time_weighted_return_pct,
            cagr,
            sharpe_ratio,
            max_drawdown
        INTO
            v_twr, v_cagr, v_sharpe, v_max_dd
        FROM portfolio_performance_sql(CURRENT_DATE, p_benchmark);

        v_metrics := 'TWR=' || ROUND(v_twr::numeric, 2)::text || '%, CAGR=' || ROUND(v_cagr::numeric, 2)::text
                  || '%, Sharpe=' || ROUND(v_sharpe::numeric, 2)::text || ', MaxDD=' || ROUND(v_max_dd::numeric, 2)::text || '%';

        UPDATE scheduled_job_log
        SET status = 'completed',
            finished_at = now(),
            rows_affected = 1,
            error_message = v_metrics
        WHERE id = v_job_id;
    EXCEPTION WHEN OTHERS THEN
        UPDATE scheduled_job_log
        SET status = 'failed',
            finished_at = now(),
            rows_affected = 0,
            error_message = SQLERRM
        WHERE id = v_job_id;
    END;

    RETURN v_twr;
END;
$$;
