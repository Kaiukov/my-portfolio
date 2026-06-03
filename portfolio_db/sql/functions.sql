-- Portfolio database helper functions
-- These mirror Python domain helpers as SQL functions for database-side calculations

SET check_function_bodies = off;

-- Stablecoin allowlist: single source of truth for USD-pegged stablecoins.
-- Classification is GLOBAL/unconditional by design (stablecoins are cash 1:1 USD
-- regardless of entry date). The feature assumes no pre-existing BUY/SELL
-- stablecoin-symbol rows; verified 0 such rows on prod+dev at rollout 2026-06-03.
-- See regression guard test: stablecoin.integration.test.ts ("regression: no harm
-- to non-stablecoin portfolios").
DROP FUNCTION IF EXISTS is_stablecoin_sql(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION is_stablecoin_sql(asset TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
    SELECT upper(asset) IN ('USDT','USDC','DAI','TUSD','USDP','FDUSD','PYUSD','USDE','GUSD')
$$;

-- Detect asset kind: metadata-driven asset class detection
-- First checks asset_metadata.yahoo_quote_type, falls back to suffix-based detection
-- This is ORTHOGONAL to get_asset_type_sql (PRICING bucket) — asset_kind is for display/allocation
DROP FUNCTION IF EXISTS detect_asset_kind(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION detect_asset_kind(p_ticker TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        (SELECT CASE
            WHEN am.yahoo_quote_type = 'EQUITY' THEN 'stock'
            WHEN am.yahoo_quote_type = 'ETF' THEN 'etf'
            WHEN am.yahoo_quote_type = 'CRYPTOCURRENCY' THEN 'crypto'
            WHEN am.yahoo_quote_type = 'MUTUALFUND' THEN 'fund'
            WHEN am.yahoo_quote_type = 'CURRENCY' THEN 'fx'
            WHEN am.yahoo_quote_type IS NOT NULL THEN 'unknown'
            ELSE NULL
        END
        FROM asset_metadata am
        WHERE am.ticker = p_ticker
          AND am.yahoo_quote_type IS NOT NULL),
        CASE
            WHEN p_ticker = 'USD' THEN 'cash'
            WHEN p_ticker IN ('EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'HKD', 'SGD', 'JPY') THEN 'fx'
            WHEN RIGHT(p_ticker, 5) = 'USD=X' THEN 'fx'
            WHEN RIGHT(p_ticker, 4) = '-USD' THEN 'crypto'
            WHEN RIGHT(p_ticker, 2) = '.L' THEN 'stock'
            WHEN RIGHT(p_ticker, 3) = '.DE' THEN 'stock'
            WHEN RIGHT(p_ticker, 2) = '.T' THEN 'stock'
            WHEN RIGHT(p_ticker, 3) = '.SW' THEN 'stock'
            WHEN RIGHT(p_ticker, 3) = '.TO' THEN 'stock'
            WHEN RIGHT(p_ticker, 3) = '.AX' THEN 'stock'
            WHEN RIGHT(p_ticker, 3) = '.HK' THEN 'stock'
            WHEN RIGHT(p_ticker, 3) = '.SG' THEN 'stock'
            WHEN p_ticker LIKE 'CASH %' THEN 'cash'
            WHEN is_stablecoin_sql(p_ticker) THEN 'cash'
            ELSE 'stock'
        END
    )
$$;

-- Upsert asset metadata from Yahoo Finance quoteType response
DROP FUNCTION IF EXISTS upsert_asset_metadata(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION upsert_asset_metadata(
    p_ticker TEXT,
    p_yahoo_quote_type TEXT,
    p_yahoo_type_disp TEXT,
    p_yahoo_short_name TEXT,
    p_yahoo_long_name TEXT,
    p_currency TEXT,
    p_exchange TEXT,
    p_fetched_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE sql
AS $$
    INSERT INTO asset_metadata (ticker, yahoo_quote_type, yahoo_type_disp, yahoo_short_name, yahoo_long_name, currency, exchange, fetched_at)
    VALUES (p_ticker, p_yahoo_quote_type, p_yahoo_type_disp, p_yahoo_short_name, p_yahoo_long_name, p_currency, p_exchange, p_fetched_at)
    ON CONFLICT (ticker) DO UPDATE SET
        yahoo_quote_type = EXCLUDED.yahoo_quote_type,
        yahoo_type_disp = EXCLUDED.yahoo_type_disp,
        yahoo_short_name = EXCLUDED.yahoo_short_name,
        yahoo_long_name = EXCLUDED.yahoo_long_name,
        currency = EXCLUDED.currency,
        exchange = EXCLUDED.exchange,
        fetched_at = EXCLUDED.fetched_at
$$;

-- Asset type detection based on ticker symbol
DROP FUNCTION IF EXISTS get_asset_type_sql(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION get_asset_type_sql(ticker TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN ticker = 'USD' THEN 'cash_base'
        WHEN ticker IN ('EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'HKD', 'SGD', 'JPY') THEN 'cash_fx'
        -- cash_stable: unconditional global classification — stablecoins are always 1:1 USD.
        -- See is_stablecoin_sql comment for going-forward guarantee.
        WHEN is_stablecoin_sql(ticker) THEN 'cash_stable'
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
DROP FUNCTION IF EXISTS is_cash_like_sql(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION is_cash_like_sql(asset TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT get_asset_type_sql(asset) IN ('cash_base', 'cash_fx', 'cash_stable')
        OR asset LIKE 'CASH %'
$$;

-- Normalize cash asset to standard representation
DROP FUNCTION IF EXISTS normalize_cash_asset_sql(TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION normalize_cash_asset_sql(asset TEXT, asset_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN asset_type = 'cash_stable' THEN upper(asset)
        WHEN asset LIKE 'CASH %' AND is_stablecoin_sql(btrim(substring(asset FROM 6))) THEN upper(btrim(substring(asset FROM 6)))
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
        WHEN RIGHT(asset, 4) = '-USD' OR RIGHT(asset, 5) = 'USD=X' THEN asset
        ELSE asset || '-USD'
    END
$$;

-- Get the cash FX key for an asset (used to track cash positions)
DROP FUNCTION IF EXISTS get_cash_key_for_asset_sql(TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION get_cash_key_for_asset_sql(asset TEXT, asset_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN asset_type = 'cash_stable' THEN upper(asset)
        WHEN asset LIKE 'CASH %' AND is_stablecoin_sql(btrim(substring(asset FROM 6))) THEN upper(btrim(substring(asset FROM 6)))
        WHEN asset_type = 'cash_fx' THEN
            CASE
                WHEN asset = 'EUR' THEN 'EURUSD=X'
                WHEN asset = 'GBP' THEN 'GBPUSD=X'
                WHEN asset = 'CHF' THEN 'CHFUSD=X'
                WHEN asset = 'CAD' THEN 'CADUSD=X'
                WHEN asset = 'AUD' THEN 'AUDUSD=X'
                WHEN asset = 'HKD' THEN 'HKDUSD=X'
                WHEN asset = 'SGD' THEN 'SGDUSD=X'
                WHEN asset = 'JPY' THEN 'JPYUSD=X'
                ELSE asset
            END
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
DROP FUNCTION IF EXISTS cash_display_currency_sql(TEXT) CASCADE;
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
        WHEN is_stablecoin_sql(symbol) THEN symbol
        ELSE symbol
    END
$$;

-- Get cash currency for asset type
DROP FUNCTION IF EXISTS cash_currency_for_asset_type_sql(TEXT) CASCADE;
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

-- Get price as of a given date (lookup most recent price on or before date).
-- p_max_age_days (default NULL = disabled): when set, a price whose date is older
-- than (p_as_of_date - p_max_age_days) is treated as stale and returns NULL.
DROP FUNCTION IF EXISTS price_asof_sql(TEXT, DATE) CASCADE;
CREATE OR REPLACE FUNCTION price_asof_sql(p_ticker TEXT, p_as_of_date DATE, p_max_age_days INTEGER DEFAULT NULL)
RETURNS DOUBLE PRECISION
LANGUAGE sql
STABLE
AS $$
    SELECT p.price
    FROM prices p
    WHERE p.ticker = p_ticker
      AND p.date <= p_as_of_date
      AND (p_max_age_days IS NULL OR p.date >= p_as_of_date - p_max_age_days)
    ORDER BY p.date DESC
    LIMIT 1
$$;

-- Get price as of date with max-age enforcement.
-- Returns NULL if the most recent price on or before p_as_of_date is older than p_max_age_days.
-- Used by daily_maintenance_check for per-ticker staleness detection.
DROP FUNCTION IF EXISTS price_asof_stale_sql(TEXT, DATE, INTEGER) CASCADE;
CREATE OR REPLACE FUNCTION price_asof_stale_sql(p_ticker TEXT, p_as_of_date DATE, p_max_age_days INTEGER)
RETURNS DOUBLE PRECISION
LANGUAGE sql
STABLE
AS $$
    SELECT p.price
    FROM prices p
    WHERE p.ticker = p_ticker
      AND p.date <= p_as_of_date
      AND p.date >= p_as_of_date - p_max_age_days
    ORDER BY p.date DESC
    LIMIT 1
$$;

-- Convert cash amount to USD using FX rates
DROP FUNCTION IF EXISTS cash_amount_to_usd_sql(TEXT, DOUBLE PRECISION, DATE) CASCADE;
CREATE OR REPLACE FUNCTION cash_amount_to_usd_sql(p_asset TEXT, p_quantity DOUBLE PRECISION, p_as_of_date DATE)
RETURNS DOUBLE PRECISION
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN get_asset_type_sql(p_asset) = 'cash_stable' THEN p_quantity
        WHEN is_stablecoin_sql(normalize_cash_asset_sql(p_asset, get_asset_type_sql(p_asset))) THEN p_quantity
        WHEN normalize_cash_asset_sql(p_asset, get_asset_type_sql(p_asset)) = 'USD' THEN p_quantity
        ELSE p_quantity * price_asof_sql(
            normalize_cash_asset_sql(p_asset, get_asset_type_sql(p_asset)),
            p_as_of_date
        )
    END
$$;

-- Map a fee_currency to the ticker used for USD price lookup.
-- Fiat currencies (EUR, GBP, JPY, etc.) are converted to their FX pair (EURUSD=X).
-- Non-fiat currencies (BTC, ETH, etc.) are converted to their -USD pair (BTC-USD).
-- NULL, empty, or USD fee_currency returns 'USD'.
-- This single rule replaces duplicated BTC->BTC-USD logic in FIFO, status, and cash engines.
DROP FUNCTION IF EXISTS fee_currency_ticker_sql(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION fee_currency_ticker_sql(p_fee_currency TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_fee_currency IS NULL OR p_fee_currency = '' THEN 'USD'
        WHEN get_asset_type_sql(p_fee_currency) = 'cash_base' THEN 'USD'
        WHEN get_asset_type_sql(p_fee_currency) = 'cash_stable' THEN upper(p_fee_currency)
        WHEN get_asset_type_sql(p_fee_currency) = 'cash_fx'
            THEN get_cash_key_for_asset_sql(p_fee_currency, get_asset_type_sql(p_fee_currency))
        ELSE p_fee_currency || '-USD'
    END
$$;

-- Get market value in USD for an asset quantity
DROP FUNCTION IF EXISTS asset_market_value_usd_sql(TEXT, DOUBLE PRECISION, DATE) CASCADE;
CREATE OR REPLACE FUNCTION asset_market_value_usd_sql(p_asset TEXT, p_quantity DOUBLE PRECISION, p_as_of_date DATE)
RETURNS DOUBLE PRECISION
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN get_asset_type_sql(p_asset) = 'cash_base' THEN p_quantity
        WHEN get_asset_type_sql(p_asset) = 'cash_stable' THEN p_quantity
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
DROP FUNCTION IF EXISTS needs_recalc() CASCADE;
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
DROP FUNCTION IF EXISTS discover_required_tickers_sql();
CREATE OR REPLACE FUNCTION discover_required_tickers_sql()
RETURNS TABLE(ticker TEXT, ticker_category TEXT)
LANGUAGE sql
STABLE
AS $$
    SELECT ticker, ticker_category
    FROM (
        -- All unique assets from transactions (exclude stablecoins — they need no price)
        SELECT t.asset AS ticker, 'asset'::TEXT AS ticker_category
        FROM transactions t
        WHERE NOT is_stablecoin_sql(t.asset)
          AND NOT (t.asset LIKE 'CASH %' AND is_stablecoin_sql(btrim(substring(t.asset FROM 6))))

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

        UNION

        -- FX pairs needed for fee_currency values
        SELECT CASE
            WHEN t.fee_currency = 'EUR' THEN 'EURUSD=X'
            WHEN t.fee_currency = 'GBP' THEN 'GBPUSD=X'
            WHEN t.fee_currency = 'UAH' THEN 'UAHUSD=X'
            WHEN t.fee_currency = 'JPY' THEN 'JPYUSD=X'
            WHEN t.fee_currency = 'CHF' THEN 'CHFUSD=X'
            WHEN t.fee_currency = 'CAD' THEN 'CADUSD=X'
            WHEN t.fee_currency = 'AUD' THEN 'AUDUSD=X'
            WHEN t.fee_currency = 'HKD' THEN 'HKDUSD=X'
            WHEN t.fee_currency = 'SGD' THEN 'SGDUSD=X'
        END, 'fx'::TEXT
        FROM transactions t
        WHERE t.fee_currency IS NOT NULL
          AND t.fee_currency NOT IN ('', 'USD', 'BTC', 'ETH')
          AND get_asset_type_sql(t.fee_currency) = 'cash_fx'

        UNION

        -- Asset tickers needed for non-fiat fee currencies (e.g. BTC -> BTC-USD)
        -- Exclude stablecoins — they need no price
        SELECT DISTINCT fee_currency_ticker_sql(t.fee_currency), 'asset'::TEXT
        FROM transactions t
        WHERE t.fee_currency IS NOT NULL
          AND t.fee_currency <> ''
          AND get_asset_type_sql(t.fee_currency) NOT IN ('cash_base', 'cash_fx', 'cash_stable')
          AND NOT is_stablecoin_sql(t.fee_currency)
          AND fee_currency_ticker_sql(t.fee_currency) <> 'USD'
    ) sub
    WHERE ticker IS NOT NULL
$$;

-- Helper: returns the most recent weekday (Mon-Fri) on or before p_date.
-- Weekends only; holidays are out of scope.
-- DOW: 0=Sun -> p_date-2, 6=Sat -> p_date-1, else p_date.
CREATE OR REPLACE FUNCTION last_trading_day_sql(p_date DATE)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE EXTRACT(DOW FROM p_date)
        WHEN 0 THEN p_date - 2
        WHEN 6 THEN p_date - 1
        ELSE p_date
    END;
$$;

-- Required price checkpoints per ticker: trade dates + end date
-- Used to validate that the price cache covers all valuation points.
DROP FUNCTION IF EXISTS get_required_price_checkpoints_sql(DATE);
CREATE OR REPLACE FUNCTION get_required_price_checkpoints_sql(p_end_date DATE)
RETURNS TABLE(ticker TEXT, checkpoint_date DATE)
LANGUAGE sql
STABLE
AS $$
    SELECT DISTINCT t.asset::TEXT, t.date
    FROM transactions t
    WHERE t.action IN ('BUY', 'SELL')
      AND get_asset_type_sql(t.asset) NOT IN ('cash_base', 'cash_fx', 'cash_stable')
      AND NOT is_stablecoin_sql(t.asset)
      AND t.asset NOT LIKE 'CASH %'

    UNION

    SELECT DISTINCT t.asset::TEXT,
        CASE WHEN get_asset_type_sql(t.asset) = 'crypto'
             THEN p_end_date
             ELSE last_trading_day_sql(p_end_date)
        END
    FROM transactions t
    WHERE t.action IN ('BUY', 'SELL')
      AND get_asset_type_sql(t.asset) NOT IN ('cash_base', 'cash_fx', 'cash_stable')
      AND NOT is_stablecoin_sql(t.asset)
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

    SELECT DISTINCT cash_currency_for_asset_type_sql(get_asset_type_sql(t.asset))::TEXT,
        last_trading_day_sql(p_end_date)
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
      AND NOT is_stablecoin_sql(normalize_cash_asset_sql(t.asset, get_asset_type_sql(t.asset)))

    UNION

    SELECT DISTINCT normalize_cash_asset_sql(t.asset, get_asset_type_sql(t.asset))::TEXT,
        CASE
            WHEN get_asset_type_sql(normalize_cash_asset_sql(t.asset, get_asset_type_sql(t.asset))) = 'crypto'
            THEN p_end_date
            ELSE last_trading_day_sql(p_end_date)
        END
    FROM transactions t
    WHERE (get_asset_type_sql(t.asset) = 'cash_fx'
       OR (t.asset LIKE 'CASH %' AND t.asset != 'CASH USD'))
      AND normalize_cash_asset_sql(t.asset, get_asset_type_sql(t.asset)) != 'USD'
      AND NOT is_stablecoin_sql(normalize_cash_asset_sql(t.asset, get_asset_type_sql(t.asset)))
$$;

-- FIFO cost basis: computes realized/unrealized gain and cost basis for non-cash assets.
-- Processes BUY/SELL transactions in chronological order (date, then id).
-- BUY creates a lot with cost = qty*price + fees, converted to USD.
-- SELL consumes oldest lots first (FIFO); realized gain = proceeds - cost of consumed units.
-- All values in USD; trades in non-USD currencies are FX-converted via cash_amount_to_usd_sql.
DROP FUNCTION IF EXISTS portfolio_fifo_metrics_sql(DATE);
CREATE OR REPLACE FUNCTION portfolio_fifo_metrics_sql(p_as_of_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
    cost_basis       DOUBLE PRECISION,
    realized_gain    DOUBLE PRECISION,
    unrealized_gain  DOUBLE PRECISION,
    total_profit     DOUBLE PRECISION
)
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
    v_cost_basis       DOUBLE PRECISION := 0;
    v_realized_gain    DOUBLE PRECISION := 0;
    v_market_value     DOUBLE PRECISION := 0;
    v_lot_cost         DOUBLE PRECISION;
    v_proceeds         DOUBLE PRECISION;
    v_sell_qty         DOUBLE PRECISION;
    v_consume          DOUBLE PRECISION;
    v_cost_consumed    DOUBLE PRECISION;
    v_proceeds_share   DOUBLE PRECISION;
    lot_rec            RECORD;
    tx                 RECORD;
BEGIN
    v_cost_basis := 0;
    v_realized_gain := 0;

    DROP TABLE IF EXISTS fifo_lots;
    CREATE TEMP TABLE fifo_lots (
        id SERIAL PRIMARY KEY,
        asset TEXT NOT NULL,
        remaining_qty DOUBLE PRECISION NOT NULL,
        unit_cost_usd DOUBLE PRECISION NOT NULL
    ) ON COMMIT DROP;

    CREATE INDEX IF NOT EXISTS idx_fifo_lots_asset ON fifo_lots (asset, id);

    FOR tx IN
        SELECT t.id, t.date, t.asset, upper(t.action) AS action,
               t.quantity, t.price, t.fees,
               COALESCE(NULLIF(t.currency, ''), 'USD') AS currency,
               COALESCE(NULLIF(t.fee_currency, ''), NULLIF(t.currency, ''), 'USD') AS fee_currency
        FROM transactions t
        WHERE upper(t.action) IN ('BUY', 'SELL', 'SPLIT')
          AND NOT is_cash_like_sql(t.asset)
          AND t.date <= p_as_of_date
        ORDER BY t.date ASC, t.id ASC
    LOOP
        IF tx.action = 'BUY' THEN
            v_lot_cost := cash_amount_to_usd_sql(tx.currency, tx.quantity * COALESCE(tx.price, 0), tx.date)
                        + cash_amount_to_usd_sql(fee_currency_ticker_sql(tx.fee_currency), COALESCE(tx.fees, 0), tx.date);

            INSERT INTO fifo_lots (asset, remaining_qty, unit_cost_usd)
            VALUES (tx.asset, tx.quantity,
                    CASE WHEN tx.quantity > 0 THEN v_lot_cost / tx.quantity ELSE 0 END);
        ELSIF tx.action = 'SELL' THEN
            v_sell_qty := tx.quantity;
            v_proceeds := cash_amount_to_usd_sql(tx.currency, tx.quantity * COALESCE(tx.price, 0), tx.date)
                        - cash_amount_to_usd_sql(fee_currency_ticker_sql(tx.fee_currency), COALESCE(tx.fees, 0), tx.date);

            FOR lot_rec IN
                SELECT id, remaining_qty, unit_cost_usd
                FROM fifo_lots
                WHERE asset = tx.asset AND remaining_qty > 0
                ORDER BY id ASC
            LOOP
                EXIT WHEN v_sell_qty <= 0;

                v_consume := LEAST(lot_rec.remaining_qty, v_sell_qty);
                v_cost_consumed := v_consume * lot_rec.unit_cost_usd;
                v_proceeds_share := v_proceeds * (v_consume / tx.quantity);

                v_realized_gain := v_realized_gain + v_proceeds_share - v_cost_consumed;

                UPDATE fifo_lots
                SET remaining_qty = remaining_qty - v_consume
                WHERE id = lot_rec.id;

                v_sell_qty := v_sell_qty - v_consume;
            END LOOP;
        ELSIF tx.action = 'SPLIT' THEN
            UPDATE fifo_lots
            SET remaining_qty = remaining_qty * tx.quantity,
                unit_cost_usd = CASE WHEN tx.quantity <> 0
                                THEN unit_cost_usd / tx.quantity
                                ELSE unit_cost_usd END
            WHERE asset = tx.asset AND remaining_qty > 0;
        END IF;
    END LOOP;

    -- cost_basis = sum of remaining lot costs
    SELECT COALESCE(SUM(remaining_qty * unit_cost_usd), 0) INTO v_cost_basis
    FROM fifo_lots
    WHERE remaining_qty > 0;

    -- market value of remaining holdings
    SELECT COALESCE(SUM(asset_market_value_usd_sql(asset, remaining_qty, p_as_of_date)), 0)
    INTO v_market_value
    FROM fifo_lots
    WHERE remaining_qty > 0;

    v_cost_basis := ROUND(v_cost_basis::numeric, 2);
    v_realized_gain := ROUND(v_realized_gain::numeric, 2);
    v_market_value := ROUND(v_market_value::numeric, 2);
    RETURN QUERY
    SELECT
        v_cost_basis,
        v_realized_gain,
        v_market_value - v_cost_basis,
        v_realized_gain + (v_market_value - v_cost_basis);
END;
$$;

-- Portfolio status snapshot: all fields owned by PostgreSQL.
-- Called by `portfolio-ts status` so TypeScript never computes financial metrics.
-- Deposits/withdrawals/income/fees/taxes are FX-converted to USD via cash_amount_to_usd_sql().
-- fees includes: standalone FEE action quantity + fees column from BUY/SELL/all transactions.
-- portfolio_value comes from portfolio_value_asof_sql() — the single canonical valuation source.
-- FIFO metrics (cost_basis/reward/unrealized) are computed as-of the same date.
DROP FUNCTION IF EXISTS portfolio_status_sql();
CREATE OR REPLACE FUNCTION portfolio_status_sql(p_as_of_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
    transactions_count    INTEGER,
    start_date            TEXT,
    end_date              TEXT,
    portfolio_value       DOUBLE PRECISION,
    total_invested        DOUBLE PRECISION,       -- net contributed capital (deposits - withdrawals), NOT gross invested
    deposits              DOUBLE PRECISION,
    withdrawals           DOUBLE PRECISION,
    income                DOUBLE PRECISION,
    fees                  DOUBLE PRECISION,
    taxes                 DOUBLE PRECISION,
    total_gain            DOUBLE PRECISION,
    total_gain_pct        DOUBLE PRECISION,
    cost_basis            DOUBLE PRECISION,
    realized_gain         DOUBLE PRECISION,
    unrealized_gain       DOUBLE PRECISION,
    total_profit          DOUBLE PRECISION,
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
            COALESCE(SUM(CASE WHEN t.action = 'DEPOSIT'
                THEN cash_amount_to_usd_sql(t.asset, t.quantity, t.date) ELSE 0 END), 0) AS deposits,
            COALESCE(SUM(CASE WHEN t.action = 'WITHDRAW'
                THEN cash_amount_to_usd_sql(t.asset, t.quantity, t.date) ELSE 0 END), 0) AS withdrawals,
            COALESCE(SUM(CASE WHEN t.action IN ('DIVIDEND','INTEREST')
                THEN cash_amount_to_usd_sql(t.asset, t.quantity, t.date) ELSE 0 END), 0) AS income,
            -- fees = standalone FEE action amounts + fees column from all transactions
            COALESCE(SUM(CASE WHEN t.action = 'FEE'
                THEN cash_amount_to_usd_sql(t.asset, t.quantity, t.date) ELSE 0 END), 0)
            + COALESCE(SUM(CASE WHEN t.fees IS NOT NULL AND t.fees > 0
                THEN cash_amount_to_usd_sql(
                    fee_currency_ticker_sql(COALESCE(NULLIF(t.fee_currency, ''), NULLIF(t.currency, ''), 'USD')),
                    t.fees,
                    t.date
                ) ELSE 0 END), 0) AS fees,
            COALESCE(SUM(CASE WHEN t.action = 'TAX'
                THEN cash_amount_to_usd_sql(t.asset, t.quantity, t.date) ELSE 0 END), 0) AS taxes
        FROM transactions t
        WHERE t.date <= p_as_of_date
    ),
    valuation AS (
        SELECT COALESCE(portfolio_value_asof_sql(p_as_of_date), 0) AS portfolio_value
    ),
    fifo AS (
        SELECT cost_basis, realized_gain, unrealized_gain, total_profit
        FROM portfolio_fifo_metrics_sql(p_as_of_date)
    )
    SELECT
        a.transactions_count,
        a.start_date,
        a.end_date,
        v.portfolio_value,
        -- total_invested = net contributed capital (deposits - withdrawals), NOT gross invested.
        -- total_gain = portfolio_value - total_invested; total_gain and total_gain_pct are NULL when deposits <= withdrawals.
        a.deposits - a.withdrawals                                      AS total_invested,
        a.deposits,
        a.withdrawals,
        a.income,
        a.fees,
        a.taxes,
        CASE WHEN v.portfolio_value IS NOT NULL
                   AND (a.deposits - a.withdrawals) > 0
              THEN v.portfolio_value - (a.deposits - a.withdrawals)
              ELSE NULL END                                              AS total_gain,
        CASE WHEN v.portfolio_value IS NOT NULL
                   AND (a.deposits - a.withdrawals) > 0
              THEN (v.portfolio_value - (a.deposits - a.withdrawals))
                    / (a.deposits - a.withdrawals) * 100.0
              ELSE NULL END                                              AS total_gain_pct,
        f.cost_basis,
        f.realized_gain,
        f.unrealized_gain,
        f.total_profit,
        p_as_of_date::TEXT
    FROM agg a
    CROSS JOIN valuation v
    CROSS JOIN fifo f
$$;

-- Cash balances snapshot: FX-converted cash balances as of a given date.
-- Returns cash per bucket with native currency balance and USD value.
-- All financial calculations are owned by PostgreSQL.
DROP FUNCTION IF EXISTS portfolio_cash_sql(DATE);
CREATE OR REPLACE FUNCTION portfolio_cash_sql(p_as_of_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
    cash_key       TEXT,
    currency       TEXT,
    display_bucket TEXT,
    balance        DOUBLE PRECISION,
    usd_value      DOUBLE PRECISION
)
LANGUAGE sql
STABLE
AS $$
    WITH base_txns AS (
        SELECT * FROM transactions WHERE date <= p_as_of_date
    ),
    trade_cash AS (
        SELECT
            get_cash_key_for_asset_sql(t.asset, get_asset_type_sql(t.asset)) AS cash_key,
            cash_display_currency_sql(get_cash_key_for_asset_sql(t.asset, get_asset_type_sql(t.asset))) AS currency,
            CASE
                WHEN t.asset LIKE 'CASH %' THEN t.asset
                WHEN get_asset_type_sql(t.asset) = 'cash_base' THEN 'CASH USD'
                WHEN get_asset_type_sql(t.asset) = 'cash_stable' THEN 'CASH ' || upper(t.asset)
                WHEN get_asset_type_sql(t.asset) = 'cash_fx'
                    THEN 'CASH ' || cash_display_currency_sql(get_cash_key_for_asset_sql(t.asset, get_asset_type_sql(t.asset)))
                ELSE NULL
            END AS display_bucket,
            CASE
                WHEN upper(t.action) = 'BUY' AND NOT is_cash_like_sql(t.asset) AND t.price IS NOT NULL
                    THEN CASE WHEN t.fee_currency IS NOT NULL AND t.fee_currency <> ''
                               AND t.fee_currency <> COALESCE(t.currency, 'USD')
                               AND COALESCE(t.fees, 0) > 0
                              THEN -(t.quantity * t.price)
                              ELSE -(t.quantity * t.price + COALESCE(t.fees, 0))
                         END
                WHEN upper(t.action) = 'SELL' AND NOT is_cash_like_sql(t.asset) AND t.price IS NOT NULL
                    THEN CASE WHEN t.fee_currency IS NOT NULL AND t.fee_currency <> ''
                               AND t.fee_currency <> COALESCE(t.currency, 'USD')
                               AND COALESCE(t.fees, 0) > 0
                              THEN (t.quantity * t.price)
                              ELSE (t.quantity * t.price - COALESCE(t.fees, 0))
                         END
                WHEN upper(t.action) IN ('BUY', 'DEPOSIT', 'DIVIDEND', 'INTEREST', 'TRANSFER', 'EXCHANGE_TO') THEN t.quantity
                WHEN upper(t.action) IN ('SELL', 'WITHDRAW', 'FEE', 'TAX') THEN -t.quantity
                WHEN upper(t.action) = 'EXCHANGE_FROM' THEN t.quantity
                ELSE 0
            END AS cash_delta
        FROM base_txns t
    ),
    fee_cash AS (
        SELECT
            fee_currency_ticker_sql(t.fee_currency) AS cash_key,
            CASE
                WHEN get_asset_type_sql(t.fee_currency) = 'cash_base' THEN 'USD'
                ELSE t.fee_currency
            END AS currency,
            CASE
                WHEN get_asset_type_sql(t.fee_currency) = 'cash_base' THEN 'CASH USD'
                WHEN get_asset_type_sql(t.fee_currency) = 'cash_fx'
                    THEN 'CASH ' || cash_display_currency_sql(
                        get_cash_key_for_asset_sql(t.fee_currency, get_asset_type_sql(t.fee_currency)))
                ELSE 'CASH ' || t.fee_currency
            END AS display_bucket,
            -COALESCE(t.fees, 0) AS cash_delta
        FROM base_txns t
        WHERE upper(t.action) IN ('BUY', 'SELL')
          AND NOT is_cash_like_sql(t.asset)
          AND t.price IS NOT NULL
          AND t.fee_currency IS NOT NULL
          AND t.fee_currency <> ''
          AND t.fee_currency <> COALESCE(t.currency, 'USD')
          AND COALESCE(t.fees, 0) > 0
    ),
    all_cash AS (
        SELECT cash_key, currency, display_bucket, cash_delta FROM trade_cash
        UNION ALL
        SELECT cash_key, currency, display_bucket, cash_delta FROM fee_cash
    ),
    aggregated AS (
        SELECT
            cash_key,
            MAX(currency) AS currency,
            MAX(display_bucket) AS display_bucket,
            SUM(cash_delta) AS balance
        FROM all_cash
        GROUP BY cash_key
        HAVING SUM(cash_delta) <> 0
    )
    SELECT
        a.cash_key,
        a.currency,
        COALESCE(a.display_bucket, 'CASH ' || a.currency) AS display_bucket,
        a.balance,
        CASE
            WHEN a.cash_key = 'USD' THEN a.balance
            WHEN is_stablecoin_sql(a.cash_key) THEN a.balance
            ELSE a.balance * COALESCE(price_asof_sql(a.cash_key, p_as_of_date), 0)
        END AS usd_value
    FROM aggregated a
    ORDER BY a.cash_key
$$;

-- Allocation snapshot: FX-converted per-asset USD values and allocation percentages.
-- Returns all holdings with net_quantity, value_usd, and allocation_pct as of the given date.
DROP FUNCTION IF EXISTS portfolio_allocation_sql(DATE);
CREATE OR REPLACE FUNCTION portfolio_allocation_sql(p_as_of_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
    asset           TEXT,
    asset_type      TEXT,
    asset_kind      TEXT,
    net_quantity    DOUBLE PRECISION,
    value_usd       DOUBLE PRECISION,
    allocation_pct  DOUBLE PRECISION
)
LANGUAGE sql
STABLE
AS $$
    WITH filtered_txns AS (
        SELECT asset, action, quantity
        FROM transactions
        WHERE date <= p_as_of_date
          AND NOT is_cash_like_sql(asset)
    ),
    split_factors AS (
        SELECT
            asset,
            COALESCE(EXP(SUM(LN(quantity))), 1) AS factor
        FROM filtered_txns
        WHERE action = 'SPLIT'
        GROUP BY asset
    ),
    net_holdings AS (
        SELECT
            f.asset,
            SUM(CASE
                WHEN f.action IN ('BUY', 'EXCHANGE_TO') THEN f.quantity
                WHEN f.action IN ('SELL', 'EXCHANGE_FROM') THEN -f.quantity
                ELSE 0
            END) * COALESCE(sf.factor, 1) AS net_quantity
        FROM filtered_txns f
        LEFT JOIN split_factors sf ON f.asset = sf.asset
        GROUP BY f.asset, sf.factor
        HAVING SUM(CASE
            WHEN f.action IN ('BUY', 'EXCHANGE_TO') THEN f.quantity
            WHEN f.action IN ('SELL', 'EXCHANGE_FROM') THEN -f.quantity
            ELSE 0
        END) * COALESCE(sf.factor, 1) <> 0
    ),
    non_cash_valued AS (
        SELECT
            n.asset,
            get_asset_type_sql(n.asset) AS asset_type,
            n.net_quantity,
            CASE
                WHEN get_asset_type_sql(n.asset) IN (
                    'stock_eur', 'stock_gbp', 'stock_jpy', 'stock_chf',
                    'stock_cad', 'stock_aud', 'stock_hkd', 'stock_sgd'
                ) THEN n.net_quantity * COALESCE(price_asof_sql(n.asset, p_as_of_date), 0) *
                    COALESCE(price_asof_sql(cash_currency_for_asset_type_sql(get_asset_type_sql(n.asset)), p_as_of_date), 0)
                ELSE n.net_quantity * COALESCE(price_asof_sql(n.asset, p_as_of_date), 0)
            END AS value_usd
        FROM net_holdings n
    ),
    cash_valued AS (
        SELECT
            c.cash_key AS asset,
            CASE
                WHEN c.cash_key = 'USD' THEN 'cash_base'::TEXT
                WHEN is_stablecoin_sql(c.cash_key) THEN 'cash_stable'::TEXT
                ELSE 'cash_fx'::TEXT
            END AS asset_type,
            c.balance AS net_quantity,
            c.usd_value AS value_usd
        FROM portfolio_cash_sql(p_as_of_date) c
    ),
    all_valued AS (
        SELECT asset, asset_type, net_quantity, value_usd FROM non_cash_valued
        UNION ALL
        SELECT asset, asset_type, net_quantity, value_usd FROM cash_valued
    ),
    total AS (
        SELECT SUM(value_usd) AS portfolio_total FROM all_valued
    )
    SELECT
        v.asset,
        v.asset_type,
        detect_asset_kind(v.asset) AS asset_kind,
        v.net_quantity,
        v.value_usd,
        CASE
            WHEN t.portfolio_total > 0 THEN (v.value_usd / t.portfolio_total) * 100.0
            ELSE 0
        END AS allocation_pct
    FROM all_valued v
    CROSS JOIN total t
    WHERE v.value_usd <> 0
    ORDER BY v.value_usd DESC
$$;

-- Price existence guard for daily-returns recalculation.
-- Iterates held (non-cash, non-zero quantity) assets as-of p_as_of_date and
-- verifies that price_asof_sql returns a non-NULL price for every one.
-- For foreign-currency stocks also verifies the FX pair price is available.
-- Raises an exception if any required price is missing, preventing the
-- recalculation path from silently writing understated daily_returns values.
-- This guard is called by refresh_daily_returns_sql ONLY; the live read-path
-- (status/allocation/summary) does NOT use it and behaves as before.
DROP FUNCTION IF EXISTS verify_held_prices_sql(DATE);
CREATE OR REPLACE FUNCTION verify_held_prices_sql(p_as_of_date DATE)
RETURNS VOID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    h RECORD;
    v_price DOUBLE PRECISION;
    v_fx_price DOUBLE PRECISION;
BEGIN
    FOR h IN
        WITH filtered AS (
            SELECT asset, action, quantity
            FROM transactions
            WHERE date <= p_as_of_date
              AND NOT is_cash_like_sql(asset)
        ),
        split_factors AS (
            SELECT
                asset,
                COALESCE(EXP(SUM(LN(quantity))), 1) AS factor
            FROM filtered
            WHERE action = 'SPLIT'
            GROUP BY asset
        )
        SELECT
            f.asset,
            SUM(CASE WHEN f.action IN ('BUY', 'EXCHANGE_TO') THEN f.quantity
                     WHEN f.action IN ('SELL', 'EXCHANGE_FROM') THEN -f.quantity
                     ELSE 0 END) * COALESCE(sf.factor, 1) AS net_quantity
        FROM filtered f
        LEFT JOIN split_factors sf ON f.asset = sf.asset
        GROUP BY f.asset, sf.factor
        HAVING SUM(CASE WHEN f.action IN ('BUY', 'EXCHANGE_TO') THEN f.quantity
                         WHEN f.action IN ('SELL', 'EXCHANGE_FROM') THEN -f.quantity
                         ELSE 0 END) * COALESCE(sf.factor, 1) <> 0
    LOOP
        v_price := price_asof_sql(h.asset, p_as_of_date);
        IF v_price IS NULL THEN
            RAISE EXCEPTION USING MESSAGE =
                'Price unavailable for ' || h.asset || ' as of ' || p_as_of_date;
        END IF;

        IF get_asset_type_sql(h.asset) IN (
            'stock_eur', 'stock_gbp', 'stock_jpy', 'stock_chf',
            'stock_cad', 'stock_aud', 'stock_hkd', 'stock_sgd'
        ) THEN
            v_fx_price := price_asof_sql(
                cash_currency_for_asset_type_sql(get_asset_type_sql(h.asset)),
                p_as_of_date
            );
            IF v_fx_price IS NULL THEN
                RAISE EXCEPTION USING MESSAGE =
                    'FX price unavailable for '
                    || cash_currency_for_asset_type_sql(get_asset_type_sql(h.asset))
                    || ' as of ' || p_as_of_date;
            END IF;
        END IF;
    END LOOP;
END;
$$;

-- Canonical as-of-date portfolio value.
-- Delegates to portfolio_allocation_sql() which is the single source of truth
-- for all market valuation. Non-cash holdings valued via price_asof_sql with
-- FX conversion, and all cash legs via portfolio_cash_sql.
-- Used by portfolio_status_sql, portfolio_summary_sql, and other consumers.
DROP FUNCTION IF EXISTS portfolio_value_asof_sql(DATE) CASCADE;
CREATE OR REPLACE FUNCTION portfolio_value_asof_sql(p_as_of_date DATE DEFAULT CURRENT_DATE)
RETURNS DOUBLE PRECISION
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(SUM(value_usd), 0)
    FROM portfolio_allocation_sql(p_as_of_date)
$$;

-- Portfolio summary: high-level portfolio metrics as of a given date.
-- Uses the consolidated portfolio_value_asof_sql() for portfolio value.
DROP FUNCTION IF EXISTS portfolio_summary_sql(DATE);
CREATE OR REPLACE FUNCTION portfolio_summary_sql(p_as_of_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
    holding_count        BIGINT,
    total_cash_usd       DOUBLE PRECISION,
    portfolio_value_usd  DOUBLE PRECISION,
    last_transaction_date TEXT,
    transaction_count    BIGINT,
    as_of_date           TEXT
)
LANGUAGE sql
STABLE
AS $$
    WITH filtered AS (
        SELECT * FROM transactions WHERE date <= p_as_of_date
    ),
    holdings AS (
        SELECT COUNT(DISTINCT asset) AS cnt
        FROM (
            SELECT asset FROM filtered
            GROUP BY asset
            HAVING SUM(CASE
                WHEN action IN ('BUY', 'DEPOSIT', 'DIVIDEND', 'INTEREST', 'TRANSFER', 'EXCHANGE_TO') THEN quantity
                WHEN action IN ('SELL', 'WITHDRAW', 'FEE', 'TAX', 'EXCHANGE_FROM') THEN -quantity
                ELSE 0
            END) <> 0
        ) h
    ),
    cash_tot AS (
        SELECT COALESCE(SUM(usd_value), 0) AS cash_total
        FROM portfolio_cash_sql(p_as_of_date)
    ),
    alloc_tot AS (
        SELECT COALESCE(portfolio_value_asof_sql(p_as_of_date), 0) AS alloc_total
    )
    SELECT
        (SELECT cnt FROM holdings),
        (SELECT cash_total FROM cash_tot),
        (SELECT alloc_total FROM alloc_tot),
        (SELECT MAX(date)::TEXT FROM filtered),
        (SELECT COUNT(*) FROM filtered),
        p_as_of_date::TEXT
$$;

-- Concentration metrics: Herfindahl-Hirschman Index (HHI) and holding count.
-- HHI ranges from 0 (infinitely diversified) to 10,000 (single asset).
DROP FUNCTION IF EXISTS portfolio_concentration_sql(DATE);
CREATE OR REPLACE FUNCTION portfolio_concentration_sql(p_as_of_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
    hhi               DOUBLE PRECISION,
    total_holdings    BIGINT,
    as_of_date        TEXT
)
LANGUAGE sql
STABLE
AS $$
    WITH alloc AS (
        SELECT allocation_pct FROM portfolio_allocation_sql(p_as_of_date)
    )
    SELECT
        COALESCE(SUM(POWER(allocation_pct / 100.0, 2)) * 10000.0, 0),
        COUNT(*),
        p_as_of_date::TEXT
    FROM alloc
$$;

-- Performance statistics: TWR, Sharpe, Sortino, Treynor, max drawdown, benchmark-relative metrics.
-- ALL financial math is owned by PostgreSQL. TypeScript must not duplicate any calculation.
-- avg_daily_return uses portfolio_daily_return (INCLUDES cash flows).
-- avg_investment_return and all other risk metrics use investment_return (EXCLUDES cash flows).
-- time_weighted_return_pct = geometric-linked investment_return, EXCLUDES cash flows (cash-flow-neutral).
-- total_return_pct = (end_value - start_value) / start_value, INCLUDES cash-flow / contribution effects (balance growth).
--   For the flow-adjusted return use MWR/XIRR (portfolio mwr).
-- investment_return daily basis = prior market value PV_{t-1} (not contributed capital).
-- total_gain = start_value * TWR decimal — pure market gain in USD, excludes cash flows.
--   Reconcile: total_gain / start_value * 100 ≈ time_weighted_return_pct.
-- Benchmark-relative metrics are joined on date, not aligned by array position.
DROP FUNCTION IF EXISTS portfolio_performance_sql(DATE, TEXT, DATE, DOUBLE PRECISION);
CREATE OR REPLACE FUNCTION portfolio_performance_sql(
    p_as_of_date DATE DEFAULT CURRENT_DATE,
    p_benchmark TEXT DEFAULT 'SPY',
    p_from_date DATE DEFAULT NULL,
    p_risk_free_rate DOUBLE PRECISION DEFAULT 0.02
)
RETURNS TABLE (
    total_days             INTEGER,
    start_date             TEXT,
    end_date               TEXT,
    start_value            DOUBLE PRECISION,
    end_value              DOUBLE PRECISION,
    total_gain             DOUBLE PRECISION,
    avg_daily_return       DOUBLE PRECISION,
    avg_investment_return  DOUBLE PRECISION,
    std_dev                DOUBLE PRECISION,
    hist_volatility        DOUBLE PRECISION,
    var_95                 DOUBLE PRECISION,
    var_99                 DOUBLE PRECISION,
    cvar_95                DOUBLE PRECISION,
    cvar_99                DOUBLE PRECISION,
    max_drawdown           DOUBLE PRECISION,
    avg_drawdown           DOUBLE PRECISION,
    avg_drawdown_duration  DOUBLE PRECISION,
    time_weighted_return_pct DOUBLE PRECISION,
    total_return_pct       DOUBLE PRECISION,
    median_monthly_return  DOUBLE PRECISION,
    cagr                   DOUBLE PRECISION,
    beta                   DOUBLE PRECISION,
    sharpe_ratio           DOUBLE PRECISION,
    sortino_ratio          DOUBLE PRECISION,
    treynor_ratio          DOUBLE PRECISION,
    information_ratio      DOUBLE PRECISION,
    jensens_alpha          DOUBLE PRECISION,
    relative_return        DOUBLE PRECISION,
    tracking_error         DOUBLE PRECISION,
    spy_twr_pct            DOUBLE PRECISION,
    spy_cagr_pct           DOUBLE PRECISION,
    up_capture_ratio       DOUBLE PRECISION,
    down_capture_ratio     DOUBLE PRECISION
)
LANGUAGE sql
STABLE
AS $$
    WITH params AS (
        SELECT
            p_as_of_date AS as_of_date,
            p_benchmark AS benchmark_ticker,
            p_risk_free_rate AS risk_free_rate_annual,
            p_from_date AS from_date
    ),
    dr AS (
        SELECT d.date, d.portfolio_value, d.investment_return, d.portfolio_daily_return
        FROM daily_returns d
        CROSS JOIN params p
        WHERE d.portfolio_value > 0
          AND (p.as_of_date IS NULL OR d.date <= p.as_of_date)
          AND (p.from_date IS NULL OR d.date >= p.from_date)
        ORDER BY d.date
    ),
    dr_bounds AS (
        SELECT
            COUNT(*)::integer                                             AS total_days,
            MIN(date)::TEXT                                              AS start_date,
            MAX(date)::TEXT                                              AS end_date,
            (ARRAY_AGG(portfolio_value ORDER BY date))[1]                AS start_value,
            (ARRAY_AGG(portfolio_value ORDER BY date DESC))[1]           AS end_value,
            AVG(portfolio_daily_return)                                    AS avg_daily_return,
            AVG(investment_return)                                       AS avg_investment_return_val,
            STDDEV_POP(investment_return)                                AS std_dev,
            PERCENTILE_CONT(0.05) WITHIN GROUP (ORDER BY investment_return) AS var_95,
            PERCENTILE_CONT(0.01) WITHIN GROUP (ORDER BY investment_return) AS var_99,
            EXP(SUM(LN(GREATEST(1.0 + investment_return / 100.0, 1e-12)))) - 1 AS twr_decimal
        FROM dr
    ),
    cvar_stats AS (
        SELECT
            COALESCE(AVG(dr.investment_return) FILTER (
                WHERE dr.investment_return <= (SELECT var_95 FROM dr_bounds)
            ), 0.0) AS cvar_95,
            COALESCE(AVG(dr.investment_return) FILTER (
                WHERE dr.investment_return <= (SELECT var_99 FROM dr_bounds)
            ), 0.0) AS cvar_99
        FROM dr
        CROSS JOIN params p
    ),
    target AS (
        SELECT (risk_free_rate_annual / 252.0) * 100.0 AS target_daily_pct
        FROM params
    ),
    downside AS (
        SELECT COALESCE(
            SQRT(AVG(POWER(dr.investment_return - t.target_daily_pct, 2))
                 FILTER (WHERE dr.investment_return < t.target_daily_pct)),
            0.0
        ) AS downside_deviation_daily
        FROM dr
        CROSS JOIN target t
    ),
    drawdowns AS (
        SELECT
            date,
            portfolio_value,
            MAX(portfolio_value) OVER (
                ORDER BY date
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS running_max
        FROM dr
    ),
    drawdown_values AS (
        SELECT
            date,
            CASE
                WHEN running_max > 0 THEN ((running_max - portfolio_value) / running_max) * 100.0
                ELSE 0.0
            END AS drawdown
        FROM drawdowns
    ),
    drawdown_periods AS (
        SELECT grp, COUNT(*)::double precision AS duration
        FROM (
            SELECT
                date,
                drawdown,
                SUM(CASE WHEN drawdown = 0 THEN 1 ELSE 0 END) OVER (
                    ORDER BY date
                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                ) AS grp
            FROM drawdown_values
            WHERE drawdown > 0
        ) x
        GROUP BY grp
    ),
    drawdown_stats AS (
        SELECT
            MAX(drawdown)                                                      AS max_drawdown,
            COALESCE(AVG(drawdown) FILTER (WHERE drawdown > 0), 0.0)           AS avg_drawdown,
            COALESCE((SELECT AVG(duration) FROM drawdown_periods), 0.0)        AS avg_drawdown_duration
        FROM drawdown_values
    ),
    monthly_returns AS (
        SELECT
            date_trunc('month', date)::date AS month_start,
            EXP(SUM(LN(GREATEST(1.0 + investment_return / 100.0, 1e-12)))) - 1 AS month_return
        FROM dr
        GROUP BY 1
    ),
    monthly_median AS (
        SELECT
            COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY month_return) * 100.0, 0.0)
            AS median_monthly_return
        FROM monthly_returns
    ),
    bench_prices AS (
        SELECT
            p.date,
            p.price,
            LAG(p.price) OVER (ORDER BY p.date) AS prev_price
        FROM prices p
        CROSS JOIN params prm
        WHERE p.ticker = prm.benchmark_ticker
          AND (prm.as_of_date IS NULL OR p.date <= prm.as_of_date)
          AND (prm.from_date IS NULL OR p.date >= prm.from_date)
        ORDER BY p.date
    ),
    bench_returns AS (
        SELECT
            date,
            CASE WHEN prev_price > 0
                THEN ((price - prev_price) / prev_price) * 100.0
                ELSE 0.0
            END AS return_pct
        FROM bench_prices
        WHERE prev_price IS NOT NULL AND prev_price > 0
    ),
    bench_bounds AS (
        SELECT
            (ARRAY_AGG(price ORDER BY date))[1]      AS spy_start,
            (ARRAY_AGG(price ORDER BY date DESC))[1] AS spy_end,
            EXP(SUM(LN(GREATEST(1.0 + CASE WHEN prev_price > 0
                THEN ((price - prev_price) / prev_price)
                ELSE 0.0 END, 1e-12)))) - 1         AS spy_twr_decimal
        FROM bench_prices
        WHERE prev_price IS NOT NULL AND prev_price > 0
    ),
    aligned AS (
        SELECT
            d.date,
            d.investment_return AS port_ret,
            b.return_pct AS bench_ret
        FROM dr d
        INNER JOIN bench_returns b USING (date)
    ),
    aligned_avg AS (
        SELECT
            AVG(port_ret)  AS avg_port,
            AVG(bench_ret) AS avg_spy
        FROM aligned
    ),
    aligned_metrics AS (
        SELECT
            COUNT(*)::integer                                          AS aligned_days,
            AVG((a.port_ret - avg.avg_port) * (a.bench_ret - avg.avg_spy)) AS covariance,
            AVG(POWER(a.bench_ret - avg.avg_spy, 2))                  AS variance_market,
            AVG(a.port_ret - a.bench_ret)                              AS avg_excess_daily,
            SQRT(AVG(POWER(a.port_ret - a.bench_ret, 2)))              AS tracking_error_daily,
            SUM(CASE WHEN a.bench_ret > 0 THEN a.port_ret ELSE 0 END)  AS up_port_sum,
            SUM(CASE WHEN a.bench_ret > 0 THEN a.bench_ret ELSE 0 END) AS up_bench_sum,
            SUM(CASE WHEN a.bench_ret < 0 THEN a.port_ret ELSE 0 END)  AS down_port_sum,
            SUM(CASE WHEN a.bench_ret < 0 THEN a.bench_ret ELSE 0 END) AS down_bench_sum
        FROM aligned a
        CROSS JOIN aligned_avg avg
    ),
    derived AS (
        SELECT
            b.*,
            cv.cvar_95                                                    AS cvar_95_val,
            cv.cvar_99                                                    AS cvar_99_val,
            ds.avg_daily_return                                           AS avg_daily_return_val,
            ds.std_dev                                                    AS std_dev_val,
            ds.var_95                                                     AS var_95_val,
            ds.var_99                                                     AS var_99_val,
            ds.twr_decimal                                                AS twr_decimal_val,
            ds.start_date                                                 AS start_date_val,
            ds.end_date                                                   AS end_date_val,
            dd.max_drawdown                                               AS max_dd,
            dd.avg_drawdown                                               AS avg_dd,
            dd.avg_drawdown_duration                                      AS avg_dd_dur,
            mm.median_monthly_return                                      AS med_monthly,
            am.aligned_days                                               AS al_days,
            am.covariance                                                 AS cov_val,
            am.variance_market                                            AS var_mkt,
            am.avg_excess_daily                                           AS avg_exc,
            am.tracking_error_daily                                       AS te_daily,
            am.up_port_sum                                                AS up_p,
            am.up_bench_sum                                               AS up_b,
            am.down_port_sum                                              AS dn_p,
            am.down_bench_sum                                             AS dn_b,
            bb.spy_start                                                  AS spy_s,
            bb.spy_end                                                    AS spy_e,
            bb.spy_twr_decimal                                            AS spy_twr,
            t.target_daily_pct                                            AS target_daily,
            dn.downside_deviation_daily                                   AS downside_dev_daily,
            p.risk_free_rate_annual                                       AS rf
        FROM dr_bounds b
        CROSS JOIN cvar_stats cv
        CROSS JOIN dr_bounds ds
        CROSS JOIN drawdown_stats dd
        CROSS JOIN monthly_median mm
        CROSS JOIN aligned_metrics am
        CROSS JOIN bench_bounds bb
        CROSS JOIN target t
        CROSS JOIN downside dn
        CROSS JOIN params p
    )
    SELECT
        d.total_days,
        d.start_date_val                                                                        AS start_date,
        d.end_date_val                                                                          AS end_date,
        d.start_value                                                                           AS start_value,
        d.end_value                                                                             AS end_value,
        COALESCE(d.start_value * d.twr_decimal_val, 0.0)                                        AS total_gain,
        COALESCE(d.avg_daily_return_val, 0.0)                                                   AS avg_daily_return,
        COALESCE(d.avg_investment_return_val, 0.0)                                              AS avg_investment_return,
        COALESCE(d.std_dev_val, 0.0)                                                            AS std_dev,
        COALESCE(d.std_dev_val, 0.0) * SQRT(252.0)                                              AS hist_volatility,
        COALESCE(d.var_95_val, 0.0)                                                             AS var_95,
        COALESCE(d.var_99_val, 0.0)                                                             AS var_99,
        COALESCE(d.cvar_95_val, 0.0)                                                            AS cvar_95,
        COALESCE(d.cvar_99_val, 0.0)                                                            AS cvar_99,
        COALESCE(d.max_dd, 0.0)                                                                 AS max_drawdown,
        COALESCE(d.avg_dd, 0.0)                                                                 AS avg_drawdown,
        COALESCE(d.avg_dd_dur, 0.0)                                                             AS avg_drawdown_duration,
        COALESCE(d.twr_decimal_val * 100.0, 0.0)                                                AS time_weighted_return_pct,
        CASE WHEN COALESCE(d.start_value, 0.0) > 0
             THEN ((d.end_value - d.start_value) / d.start_value) * 100.0
             ELSE 0.0
        END                                                                                     AS total_return_pct,
        COALESCE(d.med_monthly, 0.0)                                                            AS median_monthly_return,
        CASE
            WHEN d.start_date_val IS NOT NULL
             AND d.end_date_val IS NOT NULL
             AND (d.end_date::DATE - d.start_date::DATE) > 0
            THEN ((d.twr_decimal_val + 1.0) ^ (1.0 / ((d.end_date::DATE - d.start_date::DATE)::double precision / 365.25)) - 1.0) * 100.0
            ELSE 0.0
        END                                                                                     AS cagr,
        CASE
            WHEN COALESCE(d.var_mkt, 0.0) > 0 THEN COALESCE(d.cov_val, 0.0) / d.var_mkt
            ELSE 0.0
        END                                                                                     AS beta,
        CASE
            WHEN COALESCE(d.std_dev_val, 0.0) * SQRT(252.0) > 0 THEN
                ((((d.twr_decimal_val + 1.0) ^ (1.0 / GREATEST((d.end_date::DATE - d.start_date::DATE)::double precision / 365.25, 1.0/365.25)) - 1.0) - d.rf)
                 / (COALESCE(d.std_dev_val, 0.0) * SQRT(252.0) / 100.0))
            ELSE 0.0
        END                                                                                     AS sharpe_ratio,
        CASE
            WHEN COALESCE(d.downside_dev_daily, 0.0) > 0 THEN
                ((COALESCE(d.avg_investment_return_val, 0.0) - COALESCE(d.target_daily, 0.0))
                  / d.downside_dev_daily) * SQRT(252.0)
            ELSE 0.0
        END                                                                                     AS sortino_ratio,
        CASE
            WHEN COALESCE(d.var_mkt, 0.0) > 0 AND COALESCE(d.cov_val, 0.0) <> 0 THEN
                (((d.twr_decimal_val + 1.0) ^ (1.0 / GREATEST((d.end_date::DATE - d.start_date::DATE)::double precision / 365.25, 1.0/365.25)) - 1.0) - d.rf)
                 / (COALESCE(d.cov_val, 0.0) / d.var_mkt)
            ELSE 0.0
        END                                                                                     AS treynor_ratio,
        CASE
            WHEN COALESCE(d.te_daily, 0.0) > 0 THEN
                (COALESCE(d.avg_exc, 0.0) * 252.0 / 100.0)
                 / (COALESCE(d.te_daily, 0.0) * SQRT(252.0) / 100.0)
            ELSE 0.0
        END                                                                                     AS information_ratio,
        CASE
            WHEN d.start_date_val IS NOT NULL AND d.end_date_val IS NOT NULL
             AND (d.end_date::DATE - d.start_date::DATE) > 0
            THEN
                (((d.twr_decimal_val + 1.0) ^ (1.0 / ((d.end_date::DATE - d.start_date::DATE)::double precision / 365.25)) - 1.0)
                  - (d.rf + COALESCE(d.cov_val / NULLIF(d.var_mkt, 0), 0.0) * (
                      CASE WHEN COALESCE(d.spy_s, 0.0) > 0 AND COALESCE(d.spy_e, 0.0) > 0
                           AND COALESCE(d.spy_twr, -1.0) > -1.0 AND (d.end_date::DATE - d.start_date::DATE) > 0
                           THEN ((d.spy_twr + 1.0) ^ (1.0 / ((d.end_date::DATE - d.start_date::DATE)::double precision / 365.25)) - 1.0)
                           ELSE 0.0
                      END - d.rf))) * 100.0
            ELSE 0.0
        END                                                                                     AS jensens_alpha,
        CASE
            WHEN d.start_date_val IS NOT NULL AND d.end_date_val IS NOT NULL
             AND (d.end_date::DATE - d.start_date::DATE) > 0
            THEN
                (((d.twr_decimal_val + 1.0) ^ (1.0 / ((d.end_date::DATE - d.start_date::DATE)::double precision / 365.25)) - 1.0)
                  - CASE WHEN COALESCE(d.spy_s, 0.0) > 0 AND COALESCE(d.spy_e, 0.0) > 0
                           AND COALESCE(d.spy_twr, -1.0) > -1.0 AND (d.end_date::DATE - d.start_date::DATE) > 0
                           THEN ((d.spy_twr + 1.0) ^ (1.0 / ((d.end_date::DATE - d.start_date::DATE)::double precision / 365.25)) - 1.0)
                           ELSE 0.0
                      END) * 100.0
            ELSE 0.0
        END                                                                                     AS relative_return,
        COALESCE(d.te_daily * SQRT(252.0), 0.0)                                                AS tracking_error,
        CASE
            WHEN COALESCE(d.spy_s, 0.0) > 0 THEN
                ((COALESCE(d.spy_e, 0.0) - d.spy_s) / d.spy_s) * 100.0
            ELSE 0.0
        END                                                                                     AS spy_twr_pct,
        CASE
            WHEN COALESCE(d.spy_s, 0.0) > 0 AND COALESCE(d.spy_e, 0.0) > 0
                 AND COALESCE(d.spy_twr, -1.0) > -1.0
                 AND d.start_date_val IS NOT NULL AND d.end_date_val IS NOT NULL
                 AND (d.end_date::DATE - d.start_date::DATE) > 0
            THEN (((d.spy_twr + 1.0) ^ (1.0 / ((d.end_date::DATE - d.start_date::DATE)::double precision / 365.25)) - 1.0)) * 100.0
            ELSE 0.0
        END                                                                                     AS spy_cagr_pct,
        CASE
            WHEN COALESCE(d.up_b, 0.0) <> 0 THEN COALESCE(d.up_p, 0.0) / d.up_b
            ELSE 0.0
        END                                                                                     AS up_capture_ratio,
        CASE
            WHEN COALESCE(d.dn_b, 0.0) <> 0 THEN COALESCE(d.dn_p, 0.0) / d.dn_b
            ELSE 0.0
        END                                                                                     AS down_capture_ratio
    FROM derived d
$$;

-- XIRR (Extended Internal Rate of Return) solver using Newton-Raphson with bisection fallback.
-- amounts: cash flow amounts (negative = outflow, positive = inflow, investor perspective)
-- dates: corresponding dates for each amount
-- Returns annualized rate as decimal (e.g. 0.10 = 10%). Returns 0.0 on failure.
DROP FUNCTION IF EXISTS xirr_sql(DOUBLE PRECISION[], DATE[]);
CREATE OR REPLACE FUNCTION xirr_sql(
    amounts DOUBLE PRECISION[],
    dates DATE[]
)
RETURNS DOUBLE PRECISION
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    n INTEGER;
    ref_date DATE;
    t DOUBLE PRECISION[];
    i INTEGER;
    rate DOUBLE PRECISION := 0.1;
    prev_rate DOUBLE PRECISION;
    f_val DOUBLE PRECISION;
    f_deriv DOUBLE PRECISION;
    term DOUBLE PRECISION;
    delta DOUBLE PRECISION;
    iter_count INTEGER := 0;
    max_iter INTEGER := 200;
    tol DOUBLE PRECISION := 1e-7;
    low DOUBLE PRECISION;
    high DOUBLE PRECISION;
    mid DOUBLE PRECISION;
    f_low DOUBLE PRECISION;
    f_mid DOUBLE PRECISION;
    all_pos BOOLEAN := TRUE;
    all_neg BOOLEAN := TRUE;
    j INTEGER;
BEGIN
    n := array_length(amounts, 1);
    IF n IS NULL OR n < 2 OR array_length(dates, 1) != n THEN
        RETURN 0.0;
    END IF;

    FOR j IN 1..n LOOP
        IF amounts[j] > 0 THEN
            all_neg := FALSE;
        ELSIF amounts[j] < 0 THEN
            all_pos := FALSE;
        END IF;
    END LOOP;

    IF all_pos OR all_neg THEN
        RETURN 0.0;
    END IF;

    ref_date := dates[1];
    t := ARRAY[]::DOUBLE PRECISION[];
    FOR i IN 1..n LOOP
        t[i] := (dates[i] - ref_date)::DOUBLE PRECISION / 365.0;
    END LOOP;

    <<newton>>
    WHILE iter_count < max_iter LOOP
        f_val := 0.0;
        f_deriv := 0.0;
        FOR i IN 1..n LOOP
            term := (1.0 + rate) ^ t[i];
            IF term <= 0.0 THEN
                rate := -0.9999;
                EXIT newton;
            END IF;
            f_val := f_val + amounts[i] / term;
            f_deriv := f_deriv - t[i] * amounts[i] / (term * (1.0 + rate));
        END LOOP;

        IF abs(f_val) < tol THEN
            RETURN rate;
        END IF;

        IF abs(f_deriv) < 1e-12 THEN
            EXIT newton;
        END IF;

        prev_rate := rate;
        rate := rate - f_val / f_deriv;

        IF rate <= -1.0 THEN
            rate := -0.9999;
        END IF;

        IF abs(rate - prev_rate) < tol THEN
            RETURN rate;
        END IF;

        iter_count := iter_count + 1;
    END LOOP;

    IF abs(f_val) < tol THEN
        RETURN rate;
    END IF;

    low := -0.9999;
    high := 10.0;

    f_low := 0.0;
    FOR i IN 1..n LOOP
        term := (1.0 + low) ^ t[i];
        IF term > 0.0 THEN
            f_low := f_low + amounts[i] / term;
        END IF;
    END LOOP;

    WHILE high <= 1000.0 LOOP
        f_mid := 0.0;
        FOR i IN 1..n LOOP
            term := (1.0 + high) ^ t[i];
            IF term > 0.0 THEN
                f_mid := f_mid + amounts[i] / term;
            END IF;
        END LOOP;

        IF f_low * f_mid <= 0.0 THEN
            EXIT;
        END IF;

        high := high * 2.0;
    END LOOP;

    IF f_low * f_mid > 0.0 THEN
        RETURN 0.0;
    END IF;

    iter_count := 0;
    WHILE iter_count < max_iter LOOP
        mid := (low + high) / 2.0;
        f_mid := 0.0;
        FOR i IN 1..n LOOP
            term := (1.0 + mid) ^ t[i];
            IF term > 0.0 THEN
                f_mid := f_mid + amounts[i] / term;
            END IF;
        END LOOP;

        IF abs(f_mid) < tol OR (high - low) < tol THEN
            RETURN mid;
        END IF;

        IF f_low * f_mid <= 0.0 THEN
            high := mid;
        ELSE
            low := mid;
            f_low := f_mid;
        END IF;

        iter_count := iter_count + 1;
    END LOOP;

    RETURN (low + high) / 2.0;
END;
$$;

-- Portfolio Money-Weighted Return (MWR / XIRR).
-- Builds external cash-flow series from DEPOSIT/WITHDRAW transactions
-- plus terminal portfolio market value, then solves for the annualized
-- internal rate of return using xirr_sql().
-- External flows (investor perspective):
--   DEPOSIT   → negative (money leaves investor)
--   WITHDRAW  → positive (money returns to investor)
-- Terminal portfolio value → positive (could be liquidated)
-- Returns annualized MWR as decimal. Returns NULL if insufficient data.
DROP FUNCTION IF EXISTS portfolio_mwr_sql(DATE);
CREATE OR REPLACE FUNCTION portfolio_mwr_sql(p_as_of_date DATE DEFAULT CURRENT_DATE)
RETURNS DOUBLE PRECISION
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    flow_amounts DOUBLE PRECISION[];
    flow_dates DATE[];
    flow_count INTEGER;
    term_value DOUBLE PRECISION;
    rec RECORD;
    i INTEGER := 0;
BEGIN
    flow_amounts := ARRAY[]::DOUBLE PRECISION[];
    flow_dates := ARRAY[]::DATE[];

    FOR rec IN
        SELECT
            t.date AS flow_date,
            CASE
                WHEN upper(t.action) = 'DEPOSIT'
                    THEN -cash_amount_to_usd_sql(t.asset, t.quantity, t.date)
                ELSE cash_amount_to_usd_sql(t.asset, t.quantity, t.date)
            END AS flow_amount
        FROM transactions t
        WHERE t.date <= p_as_of_date
          AND upper(t.action) IN ('DEPOSIT', 'WITHDRAW')
        ORDER BY t.date
    LOOP
        i := i + 1;
        flow_amounts[i] := rec.flow_amount;
        flow_dates[i] := rec.flow_date;
    END LOOP;

    SELECT COALESCE(portfolio_value_asof_sql(p_as_of_date), 0) INTO term_value;

    IF term_value IS NULL OR term_value <= 0 OR i = 0 THEN
        RETURN NULL;
    END IF;

    i := i + 1;
    flow_amounts[i] := term_value;
    flow_dates[i] := p_as_of_date;

    RETURN xirr_sql(flow_amounts, flow_dates);
END;
$$;

-- Stale tickers diagnostic: returns tickers whose latest price in the prices table
-- is older than p_max_age_days days relative to CURRENT_DATE.
-- Called by health and verify_prices commands for per-ticker staleness reporting.
-- p_max_age_days (default 2): a ticker is stale if its latest price date < CURRENT_DATE - p_max_age_days.
DROP FUNCTION IF EXISTS stale_tickers_sql(INTEGER);
CREATE OR REPLACE FUNCTION stale_tickers_sql(p_max_age_days INTEGER DEFAULT 2)
RETURNS TABLE(ticker TEXT, last_price_date DATE, age_days INTEGER)
LANGUAGE sql
STABLE
AS $$
    SELECT
        dt.ticker,
        p.last_date::DATE,
        (CURRENT_DATE - p.last_date)::INTEGER
    FROM discover_required_tickers_sql() dt
    CROSS JOIN LATERAL (
        SELECT MAX(px.date) AS last_date
        FROM prices px
        WHERE px.ticker = dt.ticker
    ) p
    WHERE p.last_date IS NOT NULL
      AND p.last_date < CURRENT_DATE - p_max_age_days
    ORDER BY dt.ticker
$$;

-- Daily maintenance check: sets staleness flags in service_state for `portfolio sync` to act on.
-- Evaluates staleness per ticker (not via a single global MAX(date), which would mask
-- per-ticker staleness if any one ticker has a recent price).
-- p_max_age_days (default 2): ticker is stale if its latest price < CURRENT_DATE - p_max_age_days.
DROP FUNCTION IF EXISTS daily_maintenance_check(INTEGER) CASCADE;
CREATE OR REPLACE FUNCTION daily_maintenance_check(p_max_age_days INTEGER DEFAULT 2)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    stale_count INTEGER;
    stale_ticker_list TEXT;
BEGIN
    -- Per-ticker staleness: check each required ticker's latest price age.
    -- This replaces the old global MAX(date) check which masked per-ticker staleness.
    SELECT COUNT(*), string_agg(s.ticker, ',')
    INTO stale_count, stale_ticker_list
    FROM stale_tickers_sql(p_max_age_days) s;

    IF stale_count > 0 THEN
        INSERT INTO service_state (state_key, state_value, updated_at)
        VALUES ('prices_need_fetch', 'true', CURRENT_TIMESTAMP)
        ON CONFLICT (state_key)
        DO UPDATE SET state_value = 'true', updated_at = CURRENT_TIMESTAMP;

        INSERT INTO service_state (state_key, state_value, updated_at)
        VALUES ('stale_tickers', COALESCE(stale_ticker_list, ''), CURRENT_TIMESTAMP)
        ON CONFLICT (state_key)
        DO UPDATE SET state_value = COALESCE(stale_ticker_list, ''), updated_at = CURRENT_TIMESTAMP;
    END IF;

    IF needs_recalc() THEN
        INSERT INTO service_state (state_key, state_value, updated_at)
        VALUES ('needs_recalc', 'true', CURRENT_TIMESTAMP)
        ON CONFLICT (state_key)
        DO UPDATE SET state_value = 'true', updated_at = CURRENT_TIMESTAMP;
    END IF;
END;
$$;

-- Income report: aggregated DIVIDEND and INTEREST transactions with FX conversion
DROP FUNCTION IF EXISTS portfolio_income_sql(DATE, DATE, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION portfolio_income_sql(
    p_as_of_date DATE DEFAULT CURRENT_DATE,
    p_from_date DATE DEFAULT NULL,
    p_asset TEXT DEFAULT NULL
)
RETURNS TABLE (
    asset          TEXT,
    action         TEXT,
    total_quantity DOUBLE PRECISION,
    usd_value      DOUBLE PRECISION,
    currency       TEXT,
    transaction_count BIGINT,
    first_date     TEXT,
    last_date      TEXT
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        t.asset::TEXT,
        t.action::TEXT,
        SUM(t.quantity)::DOUBLE PRECISION AS total_quantity,
        SUM(cash_amount_to_usd_sql(t.asset, t.quantity, t.date))::DOUBLE PRECISION AS usd_value,
        COALESCE(t.currency, 'USD')::TEXT AS currency,
        COUNT(*)::BIGINT AS transaction_count,
        MIN(t.date)::TEXT AS first_date,
        MAX(t.date)::TEXT AS last_date
    FROM transactions t
    WHERE t.action IN ('DIVIDEND', 'INTEREST')
      AND t.date <= p_as_of_date
      AND (p_from_date IS NULL OR t.date >= p_from_date)
      AND (p_asset IS NULL OR upper(t.asset) = upper(p_asset))
    GROUP BY t.asset, t.action, t.currency
    ORDER BY t.asset, t.action
$$;

-- Currency exposure: aggregates portfolio exposure by currency across both
-- holdings and cash. Non-cash holdings mapped via get_asset_type_sql (e.g.
-- stock_eur → EUR, stock_gbp → GBP, stock_usd → USD). Cash rows mapped
-- via the currency column from portfolio_cash_sql. Returns per-currency
-- breakdown with holdings_usd (non-cash market value) and cash_usd sub-columns.
-- pct sums to ~100 across rows; Σ usd_value == portfolio_value_asof_sql.
DROP FUNCTION IF EXISTS portfolio_currency_exposure_sql(DATE) CASCADE;
CREATE OR REPLACE FUNCTION portfolio_currency_exposure_sql(p_as_of_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
    as_of_date       TEXT,
    portfolio_value  DOUBLE PRECISION,
    currency         TEXT,
    usd_value        DOUBLE PRECISION,
    pct              DOUBLE PRECISION,
    holdings_usd     DOUBLE PRECISION,
    cash_usd         DOUBLE PRECISION
)
LANGUAGE sql
STABLE
AS $$
    WITH holdings AS (
        SELECT
            cash_display_currency_sql(
                cash_currency_for_asset_type_sql(a.asset_type)
            ) AS currency,
            SUM(a.value_usd) AS holdings_usd
        FROM portfolio_allocation_sql(p_as_of_date) a
        WHERE a.asset_type NOT IN ('cash_base', 'cash_fx', 'cash_stable')
          AND a.value_usd <> 0
        GROUP BY 1
    ),
    cash AS (
        SELECT
            c.currency,
            SUM(c.usd_value) AS cash_usd
        FROM portfolio_cash_sql(p_as_of_date) c
        WHERE c.usd_value <> 0
        GROUP BY c.currency
    ),
    combined AS (
        SELECT
            COALESCE(h.currency, c.currency) AS currency,
            COALESCE(h.holdings_usd, 0::double precision) AS holdings_usd,
            COALESCE(c.cash_usd, 0::double precision) AS cash_usd
        FROM holdings h
        FULL OUTER JOIN cash c ON h.currency = c.currency
    ),
    total AS (
        SELECT COALESCE(SUM(co.holdings_usd + co.cash_usd), 0::double precision) AS portfolio_total
        FROM combined co
    )
    SELECT
        p_as_of_date::TEXT,
        t.portfolio_total,
        co.currency,
        (co.holdings_usd + co.cash_usd),
        CASE
            WHEN t.portfolio_total > 0::double precision
            THEN ((co.holdings_usd + co.cash_usd) / t.portfolio_total) * 100.0::double precision
            ELSE 0::double precision
        END,
        co.holdings_usd,
        co.cash_usd
    FROM combined co
    CROSS JOIN total t
    WHERE (co.holdings_usd + co.cash_usd) <> 0::double precision
    ORDER BY (co.holdings_usd + co.cash_usd) DESC
$$;

SET check_function_bodies = on;
