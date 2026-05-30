-- Portfolio database helper functions
-- These mirror Python domain helpers as SQL functions for database-side calculations

-- Asset type detection based on ticker symbol
CREATE OR REPLACE FUNCTION get_asset_type_sql(ticker TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN ticker = 'USD' THEN 'cash_base'
        WHEN ticker IN ('EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'HKD', 'SGD', 'JPY') THEN 'cash_fx'
        WHEN RIGHT(ticker, 5) = 'USD=X' THEN 'cash_fx'
        WHEN RIGHT(ticker, 4) = '-USD' THEN 'crypto'
        WHEN RIGHT(ticker, 2) = '.L' THEN 'stock_gbp'
        WHEN RIGHT(ticker, 3) = '.DE' THEN 'stock_eur'
        WHEN RIGHT(ticker, 2) = '.T' THEN 'stock_jpy'
        WHEN RIGHT(ticker, 3) = '.SW' THEN 'stock_chf'
        WHEN RIGHT(ticker, 3) = '.TO' THEN 'stock_cad'
        WHEN RIGHT(ticker, 3) = '.AX' THEN 'stock_aud'
        WHEN RIGHT(ticker, 3) = '.HK' THEN 'stock_hkd'
        WHEN RIGHT(ticker, 3) = '.SG' THEN 'stock_sgd'
        ELSE 'stock_usd'
    END
$$;

-- Check if asset is cash-like (USD, FX symbols, or CASH buckets)
CREATE OR REPLACE FUNCTION is_cash_like_sql(asset TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT get_asset_type_sql(asset) IN ('cash_base', 'cash_fx')
        OR asset LIKE 'CASH %'
$$;

-- Normalize cash asset to standard representation
CREATE OR REPLACE FUNCTION normalize_cash_asset_sql(asset TEXT, asset_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN asset_type = 'cash_base' OR asset = 'CASH USD' THEN 'USD'
        WHEN asset = 'EUR' THEN 'EURUSD=X'
        WHEN asset = 'GBP' THEN 'GBPUSD=X'
        WHEN asset = 'CHF' THEN 'CHFUSD=X'
        WHEN asset = 'CAD' THEN 'CADUSD=X'
        WHEN asset = 'AUD' THEN 'AUDUSD=X'
        WHEN asset = 'HKD' THEN 'HKDUSD=X'
        WHEN asset = 'SGD' THEN 'SGDUSD=X'
        WHEN asset = 'JPY' THEN 'JPYUSD=X'
        WHEN asset_type = 'cash_fx' THEN asset
        WHEN asset = 'CASH EUR' THEN 'EURUSD=X'
        WHEN asset = 'CASH GBP' THEN 'GBPUSD=X'
        WHEN asset = 'CASH UAH' THEN 'UAHUSD=X'
        ELSE asset
    END
$$;

-- Get the cash FX key for an asset (used to track cash positions)
CREATE OR REPLACE FUNCTION get_cash_key_for_asset_sql(asset TEXT, asset_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN asset_type = 'cash_fx' THEN asset
        WHEN asset_type = 'stock_eur' THEN 'EURUSD=X'
        WHEN asset_type = 'stock_gbp' THEN 'GBPUSD=X'
        WHEN asset_type = 'stock_jpy' THEN 'JPYUSD=X'
        WHEN asset_type = 'stock_chf' THEN 'CHFUSD=X'
        WHEN asset_type = 'stock_cad' THEN 'CADUSD=X'
        WHEN asset_type = 'stock_aud' THEN 'AUDUSD=X'
        WHEN asset_type = 'stock_hkd' THEN 'HKDUSD=X'
        WHEN asset_type = 'stock_sgd' THEN 'SGDUSD=X'
        WHEN asset = 'CASH EUR' THEN 'EURUSD=X'
        WHEN asset = 'CASH GBP' THEN 'GBPUSD=X'
        WHEN asset = 'CASH UAH' THEN 'UAHUSD=X'
        ELSE 'USD'
    END
$$;

-- Get display currency for cash symbol
CREATE OR REPLACE FUNCTION cash_display_currency_sql(symbol TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN symbol = 'USD' THEN 'USD'
        WHEN symbol = 'EURUSD=X' THEN 'EUR'
        WHEN symbol = 'GBPUSD=X' THEN 'GBP'
        WHEN symbol = 'UAHUSD=X' THEN 'UAH'
        WHEN symbol = 'JPYUSD=X' THEN 'JPY'
        WHEN symbol = 'CHFUSD=X' THEN 'CHF'
        WHEN symbol = 'CADUSD=X' THEN 'CAD'
        WHEN symbol = 'AUDUSD=X' THEN 'AUD'
        WHEN symbol = 'HKDUSD=X' THEN 'HKD'
        WHEN symbol = 'SGDUSD=X' THEN 'SGD'
        ELSE symbol
    END
$$;

-- Get cash currency for asset type
CREATE OR REPLACE FUNCTION cash_currency_for_asset_type_sql(asset_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN asset_type = 'stock_eur' THEN 'EURUSD=X'
        WHEN asset_type = 'stock_gbp' THEN 'GBPUSD=X'
        WHEN asset_type = 'stock_jpy' THEN 'JPYUSD=X'
        WHEN asset_type = 'stock_chf' THEN 'CHFUSD=X'
        WHEN asset_type = 'stock_cad' THEN 'CADUSD=X'
        WHEN asset_type = 'stock_aud' THEN 'AUDUSD=X'
        WHEN asset_type = 'stock_hkd' THEN 'HKDUSD=X'
        WHEN asset_type = 'stock_sgd' THEN 'SGDUSD=X'
        ELSE 'USD'
    END
$$;

-- Get price as of a given date (lookup most recent price on or before date)
CREATE OR REPLACE FUNCTION price_asof_sql(p_ticker TEXT, p_as_of_date DATE)
RETURNS DOUBLE PRECISION
LANGUAGE sql
STABLE
AS $$
    SELECT p.price
    FROM prices p
    WHERE p.ticker = p_ticker
      AND p.date <= p_as_of_date
    ORDER BY p.date DESC
    LIMIT 1
$$;

-- Convert cash amount to USD using FX rates
CREATE OR REPLACE FUNCTION cash_amount_to_usd_sql(p_asset TEXT, p_quantity DOUBLE PRECISION, p_as_of_date DATE)
RETURNS DOUBLE PRECISION
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN normalize_cash_asset_sql(p_asset, get_asset_type_sql(p_asset)) = 'USD' THEN p_quantity
        ELSE p_quantity * price_asof_sql(
            normalize_cash_asset_sql(p_asset, get_asset_type_sql(p_asset)),
            p_as_of_date
        )
    END
$$;

-- Get market value in USD for an asset quantity
CREATE OR REPLACE FUNCTION asset_market_value_usd_sql(p_asset TEXT, p_quantity DOUBLE PRECISION, p_as_of_date DATE)
RETURNS DOUBLE PRECISION
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN get_asset_type_sql(p_asset) = 'cash_base' THEN p_quantity
        WHEN get_asset_type_sql(p_asset) = 'cash_fx' THEN p_quantity * price_asof_sql(p_asset, p_as_of_date)
        WHEN get_asset_type_sql(p_asset) IN (
            'stock_eur', 'stock_gbp', 'stock_jpy', 'stock_chf',
            'stock_cad', 'stock_aud', 'stock_hkd', 'stock_sgd'
        ) THEN p_quantity * price_asof_sql(p_asset, p_as_of_date) * price_asof_sql(
            cash_currency_for_asset_type_sql(get_asset_type_sql(p_asset)),
            p_as_of_date
        )
        ELSE p_quantity * price_asof_sql(p_asset, p_as_of_date)
    END
$$;

-- Lazy-recalc staleness check: TRUE when price refresh is newer than last recalculation
CREATE OR REPLACE FUNCTION needs_recalc()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN (SELECT state_value FROM service_state
              WHERE state_key = 'last_successful_recalc') IS NULL
            THEN TRUE
        WHEN (SELECT state_value FROM service_state
              WHERE state_key = 'last_successful_price_refresh') IS NULL
            THEN FALSE
        ELSE
            (SELECT state_value::timestamptz FROM service_state
             WHERE state_key = 'last_successful_price_refresh')
            >
            (SELECT state_value::timestamptz FROM service_state
             WHERE state_key = 'last_successful_recalc')
    END
$$;

-- Discover all required tickers (assets + FX) from transaction data
-- Returns ticker_category = 'asset' for tradeable assets, 'fx' for FX pairs
CREATE OR REPLACE FUNCTION discover_required_tickers_sql()
RETURNS TABLE(ticker TEXT, ticker_category TEXT)
LANGUAGE sql
STABLE
AS $$
    SELECT ticker, ticker_category
    FROM (
        -- All unique assets from transactions
        SELECT t.asset AS ticker, 'asset'::TEXT AS ticker_category
        FROM transactions t

        UNION

        -- FX pairs derived from non-USD currencies in transactions
        SELECT CASE
            WHEN t.currency = 'EUR' THEN 'EURUSD=X'
            WHEN t.currency = 'GBP' THEN 'GBPUSD=X'
            WHEN t.currency = 'UAH' THEN 'UAHUSD=X'
            WHEN t.currency = 'JPY' THEN 'JPYUSD=X'
            WHEN t.currency = 'CHF' THEN 'CHFUSD=X'
            WHEN t.currency = 'CAD' THEN 'CADUSD=X'
            WHEN t.currency = 'AUD' THEN 'AUDUSD=X'
            WHEN t.currency = 'HKD' THEN 'HKDUSD=X'
            WHEN t.currency = 'SGD' THEN 'SGDUSD=X'
        END, 'fx'::TEXT
        FROM transactions t
        WHERE t.currency IS NOT NULL AND t.currency != 'USD'

        UNION

        -- FX pairs needed by regional stock types
        SELECT cash_currency_for_asset_type_sql(get_asset_type_sql(t.asset)), 'fx'::TEXT
        FROM transactions t
        WHERE get_asset_type_sql(t.asset) IN (
            'stock_eur', 'stock_gbp', 'stock_jpy', 'stock_chf',
            'stock_cad', 'stock_aud', 'stock_hkd', 'stock_sgd'
        )

        UNION

        -- Cash FX assets directly (e.g. EURUSD=X as a traded asset)
        SELECT t.asset, 'fx'::TEXT
        FROM transactions t
        WHERE get_asset_type_sql(t.asset) = 'cash_fx'

        UNION

        -- Legacy CASH buckets (CASH EUR -> EURUSD=X, etc.)
        SELECT CASE
            WHEN t.asset = 'CASH EUR' THEN 'EURUSD=X'
            WHEN t.asset = 'CASH GBP' THEN 'GBPUSD=X'
            WHEN t.asset = 'CASH UAH' THEN 'UAHUSD=X'
        END, 'fx'::TEXT
        FROM transactions t
        WHERE t.asset IN ('CASH EUR', 'CASH GBP', 'CASH UAH')
    ) sub
    WHERE ticker IS NOT NULL
$$;

-- Required price checkpoints per ticker: trade dates + end date
-- Used to validate that the price cache covers all valuation points.
CREATE OR REPLACE FUNCTION get_required_price_checkpoints_sql(p_end_date DATE)
RETURNS TABLE(ticker TEXT, checkpoint_date DATE)
LANGUAGE sql
STABLE
AS $$
    SELECT DISTINCT t.asset::TEXT, t.date
    FROM transactions t
    WHERE t.action IN ('BUY', 'SELL')
      AND get_asset_type_sql(t.asset) NOT IN ('cash_base', 'cash_fx')
      AND t.asset NOT LIKE 'CASH %'

    UNION

    SELECT DISTINCT t.asset::TEXT, p_end_date
    FROM transactions t
    WHERE t.action IN ('BUY', 'SELL')
      AND get_asset_type_sql(t.asset) NOT IN ('cash_base', 'cash_fx')
      AND t.asset NOT LIKE 'CASH %'

    UNION

    SELECT DISTINCT cash_currency_for_asset_type_sql(get_asset_type_sql(t.asset))::TEXT, t.date
    FROM transactions t
    WHERE t.action IN ('BUY', 'SELL')
      AND get_asset_type_sql(t.asset) IN (
          'stock_eur', 'stock_gbp', 'stock_jpy', 'stock_chf',
          'stock_cad', 'stock_aud', 'stock_hkd', 'stock_sgd'
      )

    UNION

    SELECT DISTINCT cash_currency_for_asset_type_sql(get_asset_type_sql(t.asset))::TEXT, p_end_date
    FROM transactions t
    WHERE t.action IN ('BUY', 'SELL')
      AND get_asset_type_sql(t.asset) IN (
          'stock_eur', 'stock_gbp', 'stock_jpy', 'stock_chf',
          'stock_cad', 'stock_aud', 'stock_hkd', 'stock_sgd'
      )

    UNION

    SELECT DISTINCT normalize_cash_asset_sql(t.asset, get_asset_type_sql(t.asset))::TEXT, t.date
    FROM transactions t
    WHERE (get_asset_type_sql(t.asset) = 'cash_fx'
       OR (t.asset LIKE 'CASH %' AND t.asset != 'CASH USD'))
      AND normalize_cash_asset_sql(t.asset, get_asset_type_sql(t.asset)) != 'USD'

    UNION

    SELECT DISTINCT normalize_cash_asset_sql(t.asset, get_asset_type_sql(t.asset))::TEXT, p_end_date
    FROM transactions t
    WHERE (get_asset_type_sql(t.asset) = 'cash_fx'
       OR (t.asset LIKE 'CASH %' AND t.asset != 'CASH USD'))
      AND normalize_cash_asset_sql(t.asset, get_asset_type_sql(t.asset)) != 'USD'
$$;

-- Portfolio status snapshot: all fields owned by PostgreSQL.
-- Called by `portfolio-ts status` so TypeScript never computes financial metrics.
--
-- Known parity gap vs Python: deposits/withdrawals/income/fees/taxes use raw transaction
-- quantities in the asset's native currency, not FX-converted USD amounts. For portfolios
-- with non-USD cash flows the totals may differ from Python's FX-aware cash-flow analysis.
-- portfolio_value and as_of_date are taken from daily_returns (recalculated by PG).
CREATE OR REPLACE FUNCTION portfolio_status_sql()
RETURNS TABLE (
    transactions_count    INTEGER,
    start_date            TEXT,
    end_date              TEXT,
    portfolio_value       DOUBLE PRECISION,
    total_invested        DOUBLE PRECISION,
    deposits              DOUBLE PRECISION,
    withdrawals           DOUBLE PRECISION,
    income                DOUBLE PRECISION,
    fees                  DOUBLE PRECISION,
    taxes                 DOUBLE PRECISION,
    total_gain            DOUBLE PRECISION,
    total_gain_pct        DOUBLE PRECISION,
    as_of_date            TEXT
)
LANGUAGE sql
STABLE
AS $$
    WITH agg AS (
        SELECT
            COUNT(*)::INTEGER                                            AS transactions_count,
            MIN(date)::TEXT                                             AS start_date,
            MAX(date)::TEXT                                             AS end_date,
            COALESCE(SUM(CASE WHEN action = 'DEPOSIT'  THEN quantity ELSE 0 END), 0) AS deposits,
            COALESCE(SUM(CASE WHEN action = 'WITHDRAW' THEN quantity ELSE 0 END), 0) AS withdrawals,
            COALESCE(SUM(CASE WHEN action IN ('DIVIDEND','INTEREST') THEN quantity ELSE 0 END), 0) AS income,
            COALESCE(SUM(CASE WHEN action = 'FEE' THEN quantity ELSE 0 END), 0) AS fees,
            COALESCE(SUM(CASE WHEN action = 'TAX' THEN quantity ELSE 0 END), 0) AS taxes
        FROM transactions
    ),
    latest_dr AS (
        SELECT portfolio_value, date::TEXT AS as_of_date
        FROM daily_returns
        ORDER BY date DESC
        LIMIT 1
    )
    SELECT
        a.transactions_count,
        a.start_date,
        a.end_date,
        dr.portfolio_value,
        a.deposits - a.withdrawals                                      AS total_invested,
        a.deposits,
        a.withdrawals,
        a.income,
        a.fees,
        a.taxes,
        CASE WHEN dr.portfolio_value IS NOT NULL
                  AND (a.deposits - a.withdrawals) > 0
             THEN dr.portfolio_value - (a.deposits - a.withdrawals)
             ELSE NULL END                                              AS total_gain,
        CASE WHEN dr.portfolio_value IS NOT NULL
                  AND (a.deposits - a.withdrawals) > 0
             THEN (dr.portfolio_value - (a.deposits - a.withdrawals))
                   / (a.deposits - a.withdrawals) * 100.0
             ELSE NULL END                                              AS total_gain_pct,
        dr.as_of_date
    FROM agg a
    LEFT JOIN latest_dr dr ON TRUE
$$;

-- Daily maintenance check: sets staleness flags in service_state for `portfolio sync` to act on
CREATE OR REPLACE FUNCTION daily_maintenance_check()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    IF COALESCE((SELECT MAX(date) FROM prices), DATE '1900-01-01') < CURRENT_DATE - 1 THEN
        INSERT INTO service_state (state_key, state_value, updated_at)
        VALUES ('prices_need_fetch', 'true', CURRENT_TIMESTAMP)
        ON CONFLICT (state_key)
        DO UPDATE SET state_value = 'true', updated_at = CURRENT_TIMESTAMP;
    END IF;

    IF needs_recalc() THEN
        INSERT INTO service_state (state_key, state_value, updated_at)
        VALUES ('needs_recalc', 'true', CURRENT_TIMESTAMP)
        ON CONFLICT (state_key)
        DO UPDATE SET state_value = 'true', updated_at = CURRENT_TIMESTAMP;
    END IF;
END;
$$;
