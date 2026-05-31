-- pg_cron job wrapper: DETECT missing/stale prices (diagnostic only).
-- Checks both (a) stale tickers via stale_tickers_sql() and (b) required-ticker
-- checkpoint coverage via get_required_price_checkpoints_sql(). Tickers with ZERO
-- cached prices are invisible to stale_tickers_sql() but caught by the coverage check.
-- Sets service_state.prices_need_fetch flag for external CLI to act on.
-- STATUS: 'needs_external_repair' when EITHER stale or missing-coverage tickers found,
--         'completed_ok' only when BOTH checks are clean.
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
    v_coverage_count INTEGER;
    v_coverage_list TEXT;
    v_total_issues INTEGER;
    v_combined_list TEXT;
BEGIN
    INSERT INTO scheduled_job_log (job_name, status)
    VALUES ('job_repair_missing_prices', 'running')
    RETURNING id INTO v_job_id;

    BEGIN
        PERFORM daily_maintenance_check(p_max_age_days);

        SELECT COUNT(*), string_agg(s.ticker, ',')
        INTO v_stale_count, v_stale_list
        FROM stale_tickers_sql(p_max_age_days) s;

        SELECT COUNT(*), string_agg(c.ticker, ',')
        INTO v_coverage_count, v_coverage_list
        FROM (
            SELECT DISTINCT c.ticker
            FROM get_required_price_checkpoints_sql(CURRENT_DATE) c
            WHERE NOT EXISTS (
                SELECT 1 FROM prices p
                WHERE p.ticker = c.ticker AND p.date = c.checkpoint_date::date
            )
        ) c;

        v_total_issues := v_stale_count + v_coverage_count;

        IF v_total_issues > 0 THEN
            v_combined_list := CASE
                WHEN v_stale_count > 0 AND v_coverage_count > 0
                    THEN 'Stale: ' || v_stale_list || '; Missing: ' || v_coverage_list
                WHEN v_stale_count > 0
                    THEN 'Stale: ' || v_stale_list
                ELSE 'Missing: ' || v_coverage_list
            END;

            UPDATE scheduled_job_log
            SET status = 'needs_external_repair',
                finished_at = now(),
                rows_affected = v_total_issues,
                error_message = v_combined_list
            WHERE id = v_job_id;
        ELSE
            UPDATE scheduled_job_log
            SET status = 'completed_ok',
                finished_at = now(),
                rows_affected = 0,
                error_message = NULL
            WHERE id = v_job_id;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        UPDATE scheduled_job_log
        SET status = 'failed',
            finished_at = now(),
            rows_affected = 0,
            error_message = SQLERRM
        WHERE id = v_job_id;
    END;

    RETURN v_total_issues;
END;
$$;
