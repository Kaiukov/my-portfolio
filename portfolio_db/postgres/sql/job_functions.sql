-- Portfolio scheduled job wrapper functions
-- Called by pg_cron on a schedule. Each wrapper logs execution to scheduled_job_log.

-- Wrapper: daily recalculate (incremental rebuild of daily_returns)
CREATE OR REPLACE FUNCTION job_run_recalculate(p_force BOOLEAN DEFAULT FALSE)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_job_name TEXT;
    v_rows INTEGER;
    v_start TIMESTAMP := clock_timestamp();
BEGIN
    v_job_name := CASE WHEN p_force THEN 'recalculate_full' ELSE 'recalculate' END;

    INSERT INTO scheduled_job_log (job_name, status, started_at)
    VALUES (v_job_name, 'running', v_start);

    IF p_force THEN
        PERFORM refresh_daily_returns_sql(NULL);
    ELSE
        PERFORM refresh_daily_returns_sql(
            (SELECT MAX(date) FROM daily_returns)
        );
    END IF;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    UPDATE scheduled_job_log
    SET status = 'completed',
        finished_at = clock_timestamp(),
        rows_affected = v_rows,
        result_summary = jsonb_build_object('forced', p_force, 'rows_recalculated', v_rows)
    WHERE job_name = v_job_name AND started_at = v_start;

    RETURN v_rows;
EXCEPTION WHEN OTHERS THEN
    UPDATE scheduled_job_log
    SET status = 'failed',
        finished_at = clock_timestamp(),
        error_message = SQLERRM
    WHERE job_name = v_job_name AND started_at = v_start;
    RAISE;
END;
$$;

-- Wrapper: verify price cache coverage and integrity
CREATE OR REPLACE FUNCTION job_run_verify_prices()
RETURNS TABLE(
    total_prices BIGINT,
    unique_tickers INTEGER,
    min_date DATE,
    max_date DATE,
    stale_tickers TEXT[],
    issues_found INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_job_name TEXT := 'verify_prices';
    v_start TIMESTAMP := clock_timestamp();
    v_total BIGINT;
    v_tickers INTEGER;
    v_min DATE;
    v_max DATE;
    v_ticker_list TEXT[];
BEGIN
    INSERT INTO scheduled_job_log (job_name, status, started_at)
    VALUES (v_job_name, 'running', v_start);

    SELECT COUNT(*) INTO v_total FROM prices;
    SELECT COUNT(DISTINCT ticker) INTO v_tickers FROM prices;
    SELECT MIN(date), MAX(date) INTO v_min, v_max FROM prices;

    WITH required_tickers AS (
        SELECT DISTINCT asset AS ticker FROM transactions
        UNION ALL
        SELECT DISTINCT currency AS ticker FROM transactions WHERE currency IS NOT NULL AND currency != 'USD'
        UNION ALL
        SELECT DISTINCT fee_currency AS ticker FROM transactions WHERE fee_currency IS NOT NULL AND fee_currency != 'USD'
    ),
    ticker_gaps AS (
        SELECT rt.ticker,
               MIN(t.date) AS first_txn,
               MAX(t.date) AS last_txn,
               (SELECT MAX(p.date) FROM prices p WHERE p.ticker = rt.ticker) AS last_price_date
        FROM required_tickers rt
        JOIN transactions t ON t.asset = rt.ticker OR t.currency = rt.ticker OR t.fee_currency = rt.ticker
        GROUP BY rt.ticker
    )
    SELECT array_agg(ticker ORDER BY ticker)
    INTO v_ticker_list
    FROM ticker_gaps
    WHERE last_price_date IS NULL OR last_price_date < last_txn;

    UPDATE scheduled_job_log
    SET status = 'completed',
        finished_at = clock_timestamp(),
        rows_affected = v_total,
        result_summary = jsonb_build_object(
            'total_prices', v_total,
            'unique_tickers', v_tickers,
            'date_range', jsonb_build_object('start', v_min, 'end', v_max),
            'stale_ticker_count', array_length(v_ticker_list, 1)
        )
    WHERE job_name = v_job_name AND started_at = v_start;

    RETURN QUERY SELECT
        v_total,
        v_tickers,
        v_min,
        v_max,
        COALESCE(v_ticker_list, ARRAY[]::TEXT[]),
        COALESCE(array_length(v_ticker_list, 1), 0);
EXCEPTION WHEN OTHERS THEN
    UPDATE scheduled_job_log
    SET status = 'failed',
        finished_at = clock_timestamp(),
        error_message = SQLERRM
    WHERE job_name = v_job_name AND started_at = v_start;
    RAISE;
END;
$$;

-- Wrapper: health check (DB reachability, service_state freshness, data gaps)
CREATE OR REPLACE FUNCTION job_run_health()
RETURNS TABLE(
    db_reachable BOOLEAN,
    stale_data BOOLEAN,
    last_recalc TIMESTAMP,
    last_price_refresh TIMESTAMP,
    price_coverage_issues INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_job_name TEXT := 'health';
    v_start TIMESTAMP := clock_timestamp();
    v_stale BOOLEAN := FALSE;
    v_last_recalc TIMESTAMP;
    v_last_refresh TIMESTAMP;
    v_issues INTEGER := 0;
    v_total_prices BIGINT;
    v_recalc_count BIGINT;
    v_txn_max_date DATE;
BEGIN
    INSERT INTO scheduled_job_log (job_name, status, started_at)
    VALUES (v_job_name, 'running', v_start);

    SELECT state_value::timestamp INTO v_last_recalc
    FROM service_state
    WHERE state_key = 'last_successful_recalc';

    SELECT state_value::timestamp INTO v_last_refresh
    FROM service_state
    WHERE state_key = 'last_successful_price_refresh';

    SELECT COUNT(*) INTO v_total_prices FROM prices;
    SELECT COUNT(*) INTO v_recalc_count FROM daily_returns;
    SELECT MAX(date) INTO v_txn_max_date FROM transactions;

    IF v_total_prices = 0 OR v_recalc_count = 0 THEN
        v_stale := TRUE;
    ELSIF v_last_recalc IS NULL OR v_last_recalc < (CURRENT_TIMESTAMP - INTERVAL '2 days') THEN
        v_stale := TRUE;
    END IF;

    IF v_txn_max_date IS NOT NULL AND v_txn_max_date > (SELECT MAX(date) FROM daily_returns) THEN
        v_stale := TRUE;
    END IF;

    UPDATE scheduled_job_log
    SET status = 'completed',
        finished_at = clock_timestamp(),
        result_summary = jsonb_build_object(
            'db_reachable', TRUE,
            'stale_data', v_stale,
            'last_recalc', v_last_recalc,
            'last_price_refresh', v_last_refresh,
            'price_records', v_total_prices,
            'daily_return_records', v_recalc_count
        )
    WHERE job_name = v_job_name AND started_at = v_start;

    RETURN QUERY SELECT TRUE, v_stale, v_last_recalc, v_last_refresh, v_issues;
EXCEPTION WHEN OTHERS THEN
    UPDATE scheduled_job_log
    SET status = 'failed',
        finished_at = clock_timestamp(),
        error_message = SQLERRM
    WHERE job_name = v_job_name AND started_at = v_start;
    RETURN QUERY SELECT FALSE, TRUE, NULL::TIMESTAMP, NULL::TIMESTAMP, -1;
END;
$$;

-- Wrapper: status snapshot (insert portfolio summary into scheduled_job_log)
CREATE OR REPLACE FUNCTION job_run_status_snapshot()
RETURNS TABLE(
    portfolio_value DOUBLE PRECISION,
    transaction_count BIGINT,
    as_of_date DATE
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_job_name TEXT := 'status';
    v_start TIMESTAMP := clock_timestamp();
    v_value DOUBLE PRECISION;
    v_count BIGINT;
    v_last_date DATE;
BEGIN
    INSERT INTO scheduled_job_log (job_name, status, started_at)
    VALUES (v_job_name, 'running', v_start);

    SELECT SUM(asset_market_value_usd_sql(h.asset, h.net_quantity, CURRENT_DATE))
    INTO v_value
    FROM current_holdings h
    WHERE h.net_quantity <> 0;

    SELECT COUNT(*) INTO v_count FROM transactions;
    SELECT MAX(date) INTO v_last_date FROM transactions;

    UPDATE scheduled_job_log
    SET status = 'completed',
        finished_at = clock_timestamp(),
        result_summary = jsonb_build_object(
            'portfolio_value_usd', COALESCE(v_value, 0),
            'transaction_count', v_count,
            'as_of_date', CURRENT_DATE,
            'last_transaction_date', v_last_date
        )
    WHERE job_name = v_job_name AND started_at = v_start;

    RETURN QUERY SELECT
        COALESCE(v_value, 0),
        v_count,
        CURRENT_DATE;
EXCEPTION WHEN OTHERS THEN
    UPDATE scheduled_job_log
    SET status = 'failed',
        finished_at = clock_timestamp(),
        error_message = SQLERRM
    WHERE job_name = v_job_name AND started_at = v_start;
    RAISE;
END;
$$;

-- Wrapper: monthly performance aggregation (insert monthly report into scheduled_job_log)
CREATE OR REPLACE FUNCTION job_run_monthly_performance()
RETURNS TABLE(
    month_start DATE,
    month_end DATE,
    portfolio_value DOUBLE PRECISION,
    monthly_return_pct DOUBLE PRECISION,
    benchmark_return_pct DOUBLE PRECISION
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_job_name TEXT := 'performance';
    v_start TIMESTAMP := clock_timestamp();
    v_summary JSONB;
    v_month_start DATE;
    v_month_end DATE;
BEGIN
    INSERT INTO scheduled_job_log (job_name, status, started_at)
    VALUES (v_job_name, 'running', v_start);

    v_month_start := date_trunc('month', CURRENT_DATE - INTERVAL '1 month')::date;
    v_month_end := (date_trunc('month', CURRENT_DATE) - INTERVAL '1 day')::date;

    WITH month_dr AS (
        SELECT
            date,
            portfolio_value,
            investment_return
        FROM daily_returns
        WHERE date BETWEEN v_month_start AND v_month_end
    ),
    month_bounds AS (
        SELECT
            (ARRAY_AGG(portfolio_value ORDER BY date))[1] AS start_value,
            (ARRAY_AGG(portfolio_value ORDER BY date DESC))[1] AS end_value,
            EXP(SUM(LN(GREATEST(1.0 + investment_return / 100.0, 1e-12)))) - 1 AS twr
        FROM month_dr
    ),
    spy_return AS (
        SELECT ((price - prev_price) / prev_price) * 100.0 AS spy_ret
        FROM (
            SELECT
                (ARRAY_AGG(price ORDER BY date))[1] AS prev_price,
                (ARRAY_AGG(price ORDER BY date DESC))[1] AS price
            FROM prices
            WHERE ticker = 'SPY'
              AND date BETWEEN v_month_start AND v_month_end
        ) x
    )
    SELECT jsonb_build_object(
        'month_start', v_month_start,
        'month_end', v_month_end,
        'portfolio_value_end', COALESCE(mb.end_value, 0),
        'portfolio_return_pct', ROUND(COALESCE(mb.twr * 100.0, 0), 4),
        'benchmark_return_pct', ROUND(COALESCE(sr.spy_ret, 0), 4)
    ) INTO v_summary
    FROM month_bounds mb, spy_return sr;

    UPDATE scheduled_job_log
    SET status = 'completed',
        finished_at = clock_timestamp(),
        result_summary = v_summary
    WHERE job_name = v_job_name AND started_at = v_start;

    RETURN QUERY SELECT
        v_month_start,
        v_month_end,
        (v_summary->>'portfolio_value_end')::DOUBLE PRECISION,
        (v_summary->>'portfolio_return_pct')::DOUBLE PRECISION,
        (v_summary->>'benchmark_return_pct')::DOUBLE PRECISION;
EXCEPTION WHEN OTHERS THEN
    UPDATE scheduled_job_log
    SET status = 'failed',
        finished_at = clock_timestamp(),
        error_message = SQLERRM
    WHERE job_name = v_job_name AND started_at = v_start;
    RAISE;
END;
$$;

-- Wrapper: repair missing prices (diagnostic — identifies gaps, logs them)
-- Note: actual price fetching from yfinance requires Python; this identifies what needs repair
CREATE OR REPLACE FUNCTION job_run_repair_prices()
RETURNS TABLE(
    ticker TEXT,
    missing_days BIGINT,
    first_txn_date DATE,
    last_txn_date DATE,
    last_cached_date DATE
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_job_name TEXT := 'repair_prices';
    v_start TIMESTAMP := clock_timestamp();
    v_gap_count INTEGER;
BEGIN
    INSERT INTO scheduled_job_log (job_name, status, started_at)
    VALUES (v_job_name, 'running', v_start);

    CREATE TEMP TABLE _price_gaps ON COMMIT DROP AS
    WITH required_tickers AS (
        SELECT DISTINCT asset AS ticker
        FROM transactions
        UNION
        SELECT DISTINCT currency AS ticker
        FROM transactions
        WHERE currency IS NOT NULL AND currency != 'USD'
        UNION
        SELECT DISTINCT fee_currency AS ticker
        FROM transactions
        WHERE fee_currency IS NOT NULL AND fee_currency != 'USD'
    ),
    txn_ranges AS (
        SELECT
            rt.ticker,
            MIN(t.date) AS first_txn,
            MAX(t.date) AS last_txn
        FROM required_tickers rt
        JOIN transactions t ON t.asset = rt.ticker
            OR t.currency = rt.ticker
            OR t.fee_currency = rt.ticker
        GROUP BY rt.ticker
    ),
    price_ranges AS (
        SELECT
            ticker,
            MAX(date) AS last_cached_date,
            COUNT(*) AS cached_days
        FROM prices
        GROUP BY ticker
    )
    SELECT
        tr.ticker,
        tr.first_txn,
        tr.last_txn,
        COALESCE(pr.last_cached_date, tr.first_txn - INTERVAL '1 day') AS last_cached_date,
        (tr.last_txn - COALESCE(pr.last_cached_date, tr.first_txn - INTERVAL '1 day'))::BIGINT AS missing_days
    FROM txn_ranges tr
    LEFT JOIN price_ranges pr USING (ticker)
    WHERE COALESCE(pr.last_cached_date, tr.first_txn - INTERVAL '1 day') < tr.last_txn;

    SELECT COUNT(*) INTO v_gap_count FROM _price_gaps;

    UPDATE scheduled_job_log
    SET status = 'completed',
        finished_at = clock_timestamp(),
        rows_affected = v_gap_count,
        result_summary = jsonb_build_object(
            'tickers_with_gaps', v_gap_count,
            'action_needed', 'Run `portfolio repair_prices` from CLI to fetch missing price data from yfinance'
        )
    WHERE job_name = v_job_name AND started_at = v_start;

    RETURN QUERY SELECT
        pg.ticker,
        pg.missing_days,
        pg.first_txn,
        pg.last_txn,
        pg.last_cached_date
    FROM _price_gaps pg
    ORDER BY pg.missing_days DESC;

    DROP TABLE IF EXISTS _price_gaps;
EXCEPTION WHEN OTHERS THEN
    UPDATE scheduled_job_log
    SET status = 'failed',
        finished_at = clock_timestamp(),
        error_message = SQLERRM
    WHERE job_name = v_job_name AND started_at = v_start;
    RAISE;
END;
$$;

-- Wrapper: database backup via COPY TO into backup tables
CREATE OR REPLACE FUNCTION job_run_backup()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_job_name TEXT := 'backup';
    v_start TIMESTAMP := clock_timestamp();
    v_total_rows INTEGER := 0;
    v_count INTEGER;
BEGIN
    INSERT INTO scheduled_job_log (job_name, status, started_at)
    VALUES (v_job_name, 'running', v_start);

    -- Write new backup rows first, then delete old ones (atomic swap avoids data loss
    -- window if the job fails mid-run — previous backup remains intact until new one completes)
    INSERT INTO scheduled_job_backup (backup_date, table_name, row_count, data)
    SELECT CURRENT_DATE, 'transactions', COUNT(*),
           jsonb_agg(to_jsonb(t) ORDER BY t.id)
    FROM transactions t;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_total_rows := v_total_rows + v_count;

    INSERT INTO scheduled_job_backup (backup_date, table_name, row_count, data)
    SELECT CURRENT_DATE, 'daily_returns', COUNT(*),
           jsonb_agg(to_jsonb(d) ORDER BY d.date)
    FROM daily_returns d;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_total_rows := v_total_rows + v_count;

    -- Skip prices in JSONB backup — 18k+ rows produces multi-MB objects with no restore path.
    -- Price data is reconstructed via `portfolio repair_prices` from yfinance.

    -- Remove previous backup only after new rows are written successfully
    DELETE FROM scheduled_job_backup WHERE backup_date < CURRENT_DATE;

    UPDATE scheduled_job_log
    SET status = 'completed',
        finished_at = clock_timestamp(),
        rows_affected = v_total_rows,
        result_summary = jsonb_build_object(
            'mode', 'sql_copy',
            'backup_date', CURRENT_DATE,
            'tables_backed_up', ARRAY['transactions', 'daily_returns']
        )
    WHERE job_name = v_job_name AND started_at = v_start;

    RETURN v_total_rows;
EXCEPTION WHEN OTHERS THEN
    UPDATE scheduled_job_log
    SET status = 'failed',
        finished_at = clock_timestamp(),
        error_message = SQLERRM
    WHERE job_name = v_job_name AND started_at = v_start;
    RAISE;
END;
$$;
