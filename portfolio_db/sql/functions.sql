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

-- Helper: was there any observed price activity for a pricing bucket on p_date?
-- Reuses get_asset_type_sql() so the checkpoint grouping stays aligned with the
-- rest of the pricing model.
DROP FUNCTION IF EXISTS market_has_price_activity_sql(TEXT, DATE) CASCADE;
CREATE OR REPLACE FUNCTION market_has_price_activity_sql(p_asset_type TEXT, p_date DATE)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM prices p
        WHERE get_asset_type_sql(p.ticker) = p_asset_type
          AND p.date = p_date
    );
$$;

-- Helper: most recent observed price date for a pricing bucket on or before p_end_date.
-- This is intentionally data-driven instead of relying on a hardcoded trading calendar.
DROP FUNCTION IF EXISTS market_last_price_date_sql(TEXT, DATE) CASCADE;
CREATE OR REPLACE FUNCTION market_last_price_date_sql(p_asset_type TEXT, p_end_date DATE)
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
    SELECT MAX(p.date)
    FROM prices p
    WHERE get_asset_type_sql(p.ticker) = p_asset_type
      AND p.date <= p_end_date;
$$;

-- Required price checkpoints per ticker: trade dates + end date
-- Used to validate that the price cache covers all valuation points.
DROP FUNCTION IF EXISTS get_required_price_checkpoints_sql(DATE);
CREATE OR REPLACE FUNCTION get_required_price_checkpoints_sql(p_end_date DATE)
RETURNS TABLE(ticker TEXT, checkpoint_date DATE)
LANGUAGE sql
STABLE
AS $$
    -- trade_dates: every (ticker, transaction date) that needs a price, across the
    -- three ticker derivations (asset itself, the FX currency for foreign stocks,
    -- the normalized FX cash currency). asset_type is carried so the market-open
    -- filter below can group by pricing bucket.
    WITH trade_dates AS (
        SELECT DISTINCT
            t.asset::TEXT AS ticker,
            get_asset_type_sql(t.asset) AS asset_type,
            t.date AS checkpoint_date
        FROM transactions t
        WHERE t.action IN ('BUY', 'SELL')
          AND get_asset_type_sql(t.asset) NOT IN ('cash_base', 'cash_fx', 'cash_stable')
          AND NOT is_stablecoin_sql(t.asset)
          AND t.asset NOT LIKE 'CASH %'

        UNION

        SELECT DISTINCT
            cash_currency_for_asset_type_sql(get_asset_type_sql(t.asset))::TEXT,
            get_asset_type_sql(cash_currency_for_asset_type_sql(get_asset_type_sql(t.asset))),
            t.date
        FROM transactions t
        WHERE t.action IN ('BUY', 'SELL')
          AND get_asset_type_sql(t.asset) IN (
              'stock_eur', 'stock_gbp', 'stock_jpy', 'stock_chf',
              'stock_cad', 'stock_aud', 'stock_hkd', 'stock_sgd'
          )

        UNION

        SELECT DISTINCT
            normalize_cash_asset_sql(t.asset, get_asset_type_sql(t.asset))::TEXT,
            get_asset_type_sql(normalize_cash_asset_sql(t.asset, get_asset_type_sql(t.asset))),
            t.date
        FROM transactions t
        WHERE (get_asset_type_sql(t.asset) = 'cash_fx'
           OR (t.asset LIKE 'CASH %' AND t.asset != 'CASH USD'))
          AND normalize_cash_asset_sql(t.asset, get_asset_type_sql(t.asset)) != 'USD'
          AND NOT is_stablecoin_sql(normalize_cash_asset_sql(t.asset, get_asset_type_sql(t.asset)))
    ),
    candidates AS (
        -- historical checkpoints: the trade dates themselves
        SELECT ticker, asset_type, checkpoint_date FROM trade_dates

        UNION

        -- current checkpoint: per ticker, the bucket's last observed price date
        -- (crypto trades 24/7 so p_end_date applies directly). The crypto branch
        -- is a no-op for FX-currency tickers (always cash_fx), so one expression
        -- covers all derivations.
        SELECT DISTINCT
            ticker,
            asset_type,
            CASE
                WHEN asset_type = 'crypto' THEN p_end_date
                ELSE market_last_price_date_sql(asset_type, p_end_date)
            END
        FROM trade_dates
    )
    SELECT DISTINCT c.ticker, c.checkpoint_date
    FROM candidates c
    WHERE c.checkpoint_date IS NOT NULL
      -- ponytail: this data-driven filter has two honest blind spots.
      -- First, a whole-bucket same-day fetch failure on a real trading day is not flagged by
      -- coverage here, because no same-bucket print exists to prove the market was open; that
      -- case is only caught later by stale_tickers_sql() once the missing day ages past
      -- p_max_age_days. Second, full-bucket historical outages are likewise dropped here, not
      -- just single-ticker-bucket gaps. The upgrade path is an external market-open signal
      -- (for example refresh-audit state), not a hardcoded holiday calendar.
      AND market_has_price_activity_sql(c.asset_type, c.checkpoint_date)
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
        SELECT id, date, asset, action, quantity
        FROM transactions
        WHERE date <= p_as_of_date
          AND NOT is_cash_like_sql(asset)
    ),
    net_holdings AS (
        SELECT
            f.asset,
            SUM(
                (CASE WHEN f.action IN ('BUY', 'EXCHANGE_TO')  THEN f.quantity
                      WHEN f.action IN ('SELL', 'EXCHANGE_FROM') THEN -f.quantity
                      ELSE 0 END)
                * COALESCE((
                    SELECT EXP(SUM(LN(s.quantity)))
                    FROM filtered_txns s
                    WHERE s.asset = f.asset
                      AND s.action = 'SPLIT'
                      AND (s.date > f.date OR (s.date = f.date AND s.id > f.id))
                ), 1)
            ) AS net_quantity
        FROM filtered_txns f
        WHERE f.action <> 'SPLIT'
        GROUP BY f.asset
        HAVING SUM(
            (CASE WHEN f.action IN ('BUY', 'EXCHANGE_TO')  THEN f.quantity
                  WHEN f.action IN ('SELL', 'EXCHANGE_FROM') THEN -f.quantity
                  ELSE 0 END)
            * COALESCE((
                SELECT EXP(SUM(LN(s.quantity)))
                FROM filtered_txns s
                WHERE s.asset = f.asset
                  AND s.action = 'SPLIT'
                  AND (s.date > f.date OR (s.date = f.date AND s.id > f.id))
            ), 1)
        ) <> 0
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
            SELECT id, date, asset, action, quantity
            FROM transactions
            WHERE date <= p_as_of_date
              AND NOT is_cash_like_sql(asset)
        )
        SELECT
            f.asset,
            SUM(
                (CASE WHEN f.action IN ('BUY', 'EXCHANGE_TO')  THEN f.quantity
                      WHEN f.action IN ('SELL', 'EXCHANGE_FROM') THEN -f.quantity
                      ELSE 0 END)
                * COALESCE((
                    SELECT EXP(SUM(LN(s.quantity)))
                    FROM filtered s
                    WHERE s.asset = f.asset
                      AND s.action = 'SPLIT'
                      AND (s.date > f.date OR (s.date = f.date AND s.id > f.id))
                ), 1)
            ) AS net_quantity
        FROM filtered f
        WHERE f.action <> 'SPLIT'
        GROUP BY f.asset
        HAVING SUM(
            (CASE WHEN f.action IN ('BUY', 'EXCHANGE_TO')  THEN f.quantity
                  WHEN f.action IN ('SELL', 'EXCHANGE_FROM') THEN -f.quantity
                  ELSE 0 END)
            * COALESCE((
                SELECT EXP(SUM(LN(s.quantity)))
                FROM filtered s
                WHERE s.asset = f.asset
                  AND s.action = 'SPLIT'
                  AND (s.date > f.date OR (s.date = f.date AND s.id > f.id))
            ), 1)
        ) <> 0
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

-- ============================================================================
-- Diversification depth: correlation-aware portfolio diversification metrics.
--
-- Uses per-holding daily returns derived from the prices table to compute
-- pairwise Pearson correlations, producing a risk-weighted Herfindahl-
-- Hirschman Index (correlation_weighted_hhi) alongside standard concentration
-- metrics.
--
-- Method:
--   1. Holdings + weights: reuses portfolio_allocation_sql(p_as_of_date) for
--      per-asset allocation_pct. Weights w_i = allocation_pct / 100.0.
--      Only assets that have >=2 price rows in the lookback window participate
--      in correlation. Cash, FX, and other assets with no prices rows are
--      excluded from correlation computation but still contribute to HHI,
--      total_holdings, and the diagonal of CWHHI (their off-diagonal pairwise
--      contributions are treated as ρ=0).
--   2. Per-holding daily returns: computed from the prices table as
--      return_t = close_t / close_{t-1} - 1 over
--      [p_as_of_date - p_lookback_days, p_as_of_date].
--   3. Pairwise Pearson correlation ρ(i,j): computed via PostgreSQL's CORR()
--      aggregate over return series joined ON date (not array position).
--      Only dates where BOTH assets have a price are used.
--      p_min_correlation filters which pairs contribute to avg/max/min:
--      a pair is included only when |ρ| >= p_min_correlation.
--   4. HHI: Σ w_i² (weights as fractions, 0-1 scale). Output HHI is
--      multiplied by 10000 for compatibility with portfolio_concentration_sql()
--      which uses the standard 0-10000 scale.
--      effective_holdings = 1.0 / Σ w_i² (inverse Herfindahl).
--   5. Correlation-weighted HHI (CWHHI):
--        CWHHI = Σ_i Σ_j w_i w_j ρ(i,j)   with ρ(i,i) = 1
--      Expands to:
--        CWHHI = Σ_i w_i² + 2 * Σ_{i<j} w_i w_j ρ(i,j)
--      (pairs where either asset lacks price data contribute ρ=0).
--      Output is multiplied by 10000 (0-10000 scale, matching HHI).
--      Reduces to plain HHI when all off-diagonal ρ=0.
--
-- Degenerate cases:
--   - <2 holdings with price series → avg_pairwise_correlation, max/min = NULL
--   - Single holding → HHI = 10000, effective_holdings = 1, CWHHI = 10000
--   - Zero-variance return series → CORR returns NULL → pair excluded
--   - No pairs survive p_min_correlation filter → avg/max/min = NULL
-- ============================================================================
DROP FUNCTION IF EXISTS portfolio_diversification_depth_sql(DATE, INTEGER, DOUBLE PRECISION);
CREATE OR REPLACE FUNCTION portfolio_diversification_depth_sql(
    p_as_of_date      DATE DEFAULT CURRENT_DATE,
    p_lookback_days   INTEGER DEFAULT 252,
    p_min_correlation DOUBLE PRECISION DEFAULT 0.0
)
RETURNS TABLE (
    as_of_date                TEXT,
    hhi                       DOUBLE PRECISION,
    total_holdings            INTEGER,
    effective_holdings        DOUBLE PRECISION,
    avg_pairwise_correlation  DOUBLE PRECISION,
    max_pairwise_correlation  DOUBLE PRECISION,
    min_pairwise_correlation  DOUBLE PRECISION,
    correlation_weighted_hhi  DOUBLE PRECISION
)
LANGUAGE sql
STABLE
AS $$
    WITH alloc AS (
        SELECT asset, allocation_pct / 100.0 AS wgt
        FROM portfolio_allocation_sql(p_as_of_date)
        WHERE allocation_pct > 0
    ),
    priced_assets AS (
        SELECT a.asset, a.wgt
        FROM alloc a
        WHERE NOT is_cash_like_sql(a.asset)
          AND EXISTS (
            SELECT 1 FROM prices p
            WHERE p.ticker = a.asset
              AND p.date BETWEEN p_as_of_date - p_lookback_days AND p_as_of_date
            HAVING COUNT(*) >= 2
        )
    ),
    priced_cnt AS (
        SELECT COUNT(*) AS ct FROM priced_assets
    ),
    daily_ret AS (
        SELECT
            p.ticker AS asset_nm,
            p.date,
            p.price / NULLIF(
                LAG(p.price) OVER (PARTITION BY p.ticker ORDER BY p.date),
                0.0
            ) - 1.0 AS ret
        FROM prices p
        JOIN priced_assets pa ON p.ticker = pa.asset
        WHERE p.date BETWEEN p_as_of_date - p_lookback_days AND p_as_of_date
    ),
    pair_corr AS (
        SELECT
            a1.asset AS a_a,
            a1.wgt   AS w_a,
            a2.asset AS a_b,
            a2.wgt   AS w_b,
            CORR(d1.ret, d2.ret) AS rho_val
        FROM priced_assets a1
        CROSS JOIN priced_assets a2
        JOIN daily_ret d1 ON d1.asset_nm = a1.asset
        JOIN daily_ret d2
            ON d2.asset_nm = a2.asset
            AND d2.date = d1.date
        WHERE a1.asset < a2.asset
        GROUP BY a1.asset, a1.wgt, a2.asset, a2.wgt
        HAVING COUNT(*) >= 2
    ),
    filtered_corr AS (
        SELECT w_a, w_b, rho_val
        FROM pair_corr
        WHERE rho_val IS NOT NULL
          AND ABS(rho_val) >= p_min_correlation
    ),
    all_corr AS (
        -- CWHHI uses ALL non-null pairs regardless of p_min_correlation;
        -- the filter only narrows the reported avg/max/min stats (see header).
        SELECT w_a, w_b, rho_val
        FROM pair_corr
        WHERE rho_val IS NOT NULL
    ),
    base_hhi AS (
        SELECT COALESCE(SUM(wgt * wgt), 0.0) AS hhi_frac FROM alloc
    ),
    total_h AS (
        SELECT COUNT(*)::INTEGER AS th FROM alloc
    ),
    corr_adj AS (
        SELECT COALESCE(SUM(w_a * w_b * rho_val), 0.0) AS adj FROM all_corr
    )
    SELECT
        p_as_of_date::TEXT,
        bh.hhi_frac * 10000.0,
        th.th,
        CASE WHEN bh.hhi_frac > 0 THEN 1.0 / bh.hhi_frac ELSE 0.0 END,
        (SELECT CASE WHEN (SELECT ct FROM priced_cnt) < 2 THEN NULL::DOUBLE PRECISION
                     ELSE (SELECT AVG(rho_val) FROM filtered_corr)
                END),
        (SELECT CASE WHEN (SELECT ct FROM priced_cnt) < 2 THEN NULL::DOUBLE PRECISION
                     ELSE (SELECT MAX(rho_val) FROM filtered_corr)
                END),
        (SELECT CASE WHEN (SELECT ct FROM priced_cnt) < 2 THEN NULL::DOUBLE PRECISION
                     ELSE (SELECT MIN(rho_val) FROM filtered_corr)
                END),
        (bh.hhi_frac + 2.0 * COALESCE(ca.adj, 0.0)) * 10000.0
    FROM base_hhi bh
    CROSS JOIN total_h th
    CROSS JOIN corr_adj ca
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
DROP FUNCTION IF EXISTS portfolio_performance_sql(DATE, TEXT, DATE, DOUBLE PRECISION, DOUBLE PRECISION);
CREATE OR REPLACE FUNCTION portfolio_performance_sql(
    p_as_of_date DATE DEFAULT CURRENT_DATE,
    p_benchmark TEXT DEFAULT 'SPY',
    p_from_date DATE DEFAULT NULL,
    p_risk_free_rate DOUBLE PRECISION DEFAULT 0.02,
    p_inflation_rate DOUBLE PRECISION DEFAULT 0.025
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
    down_capture_ratio     DOUBLE PRECISION,
    calmar_ratio           DOUBLE PRECISION,
    real_cagr              DOUBLE PRECISION,
    real_total_return_pct  DOUBLE PRECISION
)
LANGUAGE sql
STABLE
AS $$
    WITH params AS (
        SELECT
            p_as_of_date AS as_of_date,
            p_benchmark AS benchmark_ticker,
            p_risk_free_rate AS risk_free_rate_annual,
            p_inflation_rate AS inflation_rate,
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
        ) x
        WHERE drawdown > 0
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
    ),
    performance AS (
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
                WHEN COALESCE(d.spy_twr, -1.0) > -1.0 THEN
                    d.spy_twr * 100.0
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
            END                                                                                     AS down_capture_ratio,
            p.inflation_rate                                                                        AS _inf
        FROM derived d
        CROSS JOIN params p
    )
    SELECT
        p.total_days,
        p.start_date,
        p.end_date,
        p.start_value,
        p.end_value,
        p.total_gain,
        p.avg_daily_return,
        p.avg_investment_return,
        p.std_dev,
        p.hist_volatility,
        p.var_95,
        p.var_99,
        p.cvar_95,
        p.cvar_99,
        p.max_drawdown,
        p.avg_drawdown,
        p.avg_drawdown_duration,
        p.time_weighted_return_pct,
        p.total_return_pct,
        p.median_monthly_return,
        p.cagr,
        p.beta,
        p.sharpe_ratio,
        p.sortino_ratio,
        p.treynor_ratio,
        p.information_ratio,
        p.jensens_alpha,
        p.relative_return,
        p.tracking_error,
        p.spy_twr_pct,
        p.spy_cagr_pct,
        p.up_capture_ratio,
        p.down_capture_ratio,
        CASE
            WHEN COALESCE(p.max_drawdown, 0.0) <> 0 THEN p.cagr / ABS(p.max_drawdown)
            ELSE 0.0
        END                                                                                         AS calmar_ratio,
        ((1 + COALESCE(p.cagr, 0.0) / 100.0) / (1 + COALESCE(p._inf, 0.0)) - 1) * 100.0              AS real_cagr,
        CASE
            WHEN p.start_date IS NOT NULL AND p.end_date IS NOT NULL
            THEN ((1 + COALESCE(p.total_return_pct, 0.0) / 100.0) / POWER(1 + COALESCE(p._inf, 0.0), (p.end_date::DATE - p.start_date::DATE)::double precision / 365.25) - 1) * 100.0
            ELSE 0.0
        END                                                                                         AS real_total_return_pct
    FROM performance p
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

-- FIFO realized gains detail: one row per SELL↔BUY lot match.
-- Reuses the same temp-table FIFO approach as portfolio_fifo_metrics_sql.
-- BUY creates lots; SELL consumes oldest lots first and emits a row per match.
-- SPLIT adjusts lots (no taxable event, no emitted rows).
-- Holding days = sell_date - matched buy date.
DROP FUNCTION IF EXISTS portfolio_realized_gains_sql(DATE, DATE, TEXT);
CREATE OR REPLACE FUNCTION portfolio_realized_gains_sql(
    p_from_date DATE DEFAULT NULL,
    p_to_date DATE DEFAULT CURRENT_DATE,
    p_asset TEXT DEFAULT NULL
)
RETURNS TABLE (
    sell_date        DATE,
    sell_id          BIGINT,
    asset            TEXT,
    sell_quantity    DOUBLE PRECISION,
    proceeds_usd     DOUBLE PRECISION,
    cost_basis_usd   DOUBLE PRECISION,
    realized_gain    DOUBLE PRECISION,
    holding_days     INTEGER,
    matched_buy_id   BIGINT,
    matched_buy_date DATE
)
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
    v_lot_cost       DOUBLE PRECISION;
    v_proceeds       DOUBLE PRECISION;
    v_sell_qty       DOUBLE PRECISION;
    v_consume        DOUBLE PRECISION;
    v_cost_consumed  DOUBLE PRECISION;
    v_proceeds_share DOUBLE PRECISION;
    v_realized       DOUBLE PRECISION;
    lot_rec          RECORD;
    tx               RECORD;
BEGIN
    DROP TABLE IF EXISTS fifo_lots_detail;
    CREATE TEMP TABLE fifo_lots_detail (
        id SERIAL PRIMARY KEY,
        asset TEXT NOT NULL,
        remaining_qty DOUBLE PRECISION NOT NULL,
        unit_cost_usd DOUBLE PRECISION NOT NULL,
        buy_id BIGINT NOT NULL,
        buy_date DATE NOT NULL
    ) ON COMMIT DROP;

    CREATE INDEX IF NOT EXISTS idx_fifo_lots_detail_asset ON fifo_lots_detail (asset, id);

    FOR tx IN
        SELECT t.id, t.date, t.asset, upper(t.action) AS action,
               t.quantity, t.price, t.fees,
               COALESCE(NULLIF(t.currency, ''), 'USD') AS currency,
               COALESCE(NULLIF(t.fee_currency, ''), NULLIF(t.currency, ''), 'USD') AS fee_currency
        FROM transactions t
        WHERE upper(t.action) IN ('BUY', 'SELL', 'SPLIT')
          AND NOT is_cash_like_sql(t.asset)
          AND t.date <= p_to_date
          AND (p_asset IS NULL OR upper(t.asset) = upper(p_asset))
        ORDER BY t.date ASC, t.id ASC
    LOOP
        IF tx.action = 'BUY' THEN
            v_lot_cost := cash_amount_to_usd_sql(tx.currency, tx.quantity * COALESCE(tx.price, 0), tx.date)
                        + cash_amount_to_usd_sql(fee_currency_ticker_sql(tx.fee_currency), COALESCE(tx.fees, 0), tx.date);

            INSERT INTO fifo_lots_detail (asset, remaining_qty, unit_cost_usd, buy_id, buy_date)
            VALUES (tx.asset, tx.quantity,
                    CASE WHEN tx.quantity > 0 THEN v_lot_cost / tx.quantity ELSE 0 END,
                    tx.id, tx.date);
        ELSIF tx.action = 'SELL' THEN
            v_sell_qty := tx.quantity;
            v_proceeds := cash_amount_to_usd_sql(tx.currency, tx.quantity * COALESCE(tx.price, 0), tx.date)
                        - cash_amount_to_usd_sql(fee_currency_ticker_sql(tx.fee_currency), COALESCE(tx.fees, 0), tx.date);

            FOR lot_rec IN
                SELECT f.id, f.remaining_qty, f.unit_cost_usd, f.buy_id, f.buy_date
                FROM fifo_lots_detail f
                WHERE f.asset = tx.asset AND f.remaining_qty > 0
                ORDER BY f.id ASC
            LOOP
                EXIT WHEN v_sell_qty <= 0;

                v_consume := LEAST(lot_rec.remaining_qty, v_sell_qty);
                v_cost_consumed := v_consume * lot_rec.unit_cost_usd;
                v_proceeds_share := v_proceeds * (v_consume / tx.quantity);
                v_realized := v_proceeds_share - v_cost_consumed;

                sell_date        := tx.date;
                sell_id          := tx.id;
                asset            := tx.asset;
                sell_quantity    := v_consume;
                proceeds_usd     := v_proceeds_share;
                cost_basis_usd   := v_cost_consumed;
                realized_gain    := v_realized;
                holding_days     := (tx.date - lot_rec.buy_date);
                matched_buy_id   := lot_rec.buy_id;
                matched_buy_date := lot_rec.buy_date;

                IF p_from_date IS NULL OR tx.date >= p_from_date THEN
                    RETURN NEXT;
                END IF;

                UPDATE fifo_lots_detail f
                SET remaining_qty = f.remaining_qty - v_consume
                WHERE f.id = lot_rec.id;

                v_sell_qty := v_sell_qty - v_consume;
            END LOOP;
        ELSIF tx.action = 'SPLIT' THEN
            UPDATE fifo_lots_detail f
            SET remaining_qty = f.remaining_qty * tx.quantity,
                unit_cost_usd = CASE WHEN tx.quantity <> 0
                                THEN f.unit_cost_usd / tx.quantity
                                ELSE f.unit_cost_usd END
            WHERE f.asset = tx.asset AND f.remaining_qty > 0;
        END IF;
    END LOOP;

    RETURN;
END;
$$;

-- Realized gains aggregated by tax year.
-- Groups by EXTRACT(YEAR FROM sell_date). Short-term = holding_days <= 365.
-- Builds on top of portfolio_realized_gains_sql detail.
DROP FUNCTION IF EXISTS portfolio_realized_gains_by_year_sql(INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION portfolio_realized_gains_by_year_sql(
    p_from_year INTEGER DEFAULT NULL,
    p_to_year INTEGER DEFAULT NULL
)
RETURNS TABLE (
    tax_year             INTEGER,
    total_realized_gain  DOUBLE PRECISION,
    short_term_gain      DOUBLE PRECISION,
    long_term_gain       DOUBLE PRECISION,
    transaction_count    BIGINT
)
LANGUAGE sql
STABLE
AS $$
    WITH detail AS (
        SELECT sell_date, asset, realized_gain, holding_days, sell_id
        FROM portfolio_realized_gains_sql(
            CASE WHEN p_from_year IS NOT NULL THEN make_date(p_from_year, 1, 1) ELSE NULL END,
            CASE WHEN p_to_year IS NOT NULL THEN make_date(p_to_year, 12, 31) ELSE CURRENT_DATE END,
            NULL
        )
    )
    SELECT
        EXTRACT(YEAR FROM sell_date)::INTEGER                     AS tax_year,
        COALESCE(SUM(realized_gain), 0)::DOUBLE PRECISION         AS total_realized_gain,
        COALESCE(SUM(CASE WHEN holding_days <= 365 THEN realized_gain ELSE 0 END), 0)::DOUBLE PRECISION AS short_term_gain,
        COALESCE(SUM(CASE WHEN holding_days > 365 THEN realized_gain ELSE 0 END), 0)::DOUBLE PRECISION  AS long_term_gain,
        COUNT(DISTINCT sell_id)::BIGINT                            AS transaction_count
    FROM detail
    GROUP BY EXTRACT(YEAR FROM sell_date)
    ORDER BY tax_year
$$;

---------- portfolio_period_returns_sql ----------
-- #223 Multi-window period returns: 1M, 3M, 6M, YTD, 1Y, SII
-- All returns are TWR (geometric-linked investment_return, cash-flow-neutral).
-- SII MUST equal portfolio_performance_sql.time_weighted_return_pct.

CREATE OR REPLACE FUNCTION portfolio_period_returns_sql(
    p_as_of_date DATE DEFAULT CURRENT_DATE
) RETURNS TABLE(period TEXT, from_date TEXT, return_pct DOUBLE PRECISION)
LANGUAGE sql
STABLE
AS $$
    WITH params AS (
        SELECT COALESCE(p_as_of_date, CURRENT_DATE) AS as_of_date
    ),
    min_dr AS (
        SELECT MIN(date) AS sii_from
        FROM daily_returns
        CROSS JOIN params
        WHERE portfolio_value > 0 AND date <= params.as_of_date
    ),
    windows(w, from_d) AS (
        SELECT '1M',  as_of_date - INTERVAL '1 month'               FROM params
        UNION ALL
        SELECT '3M',  as_of_date - INTERVAL '3 months'              FROM params
        UNION ALL
        SELECT '6M',  as_of_date - INTERVAL '6 months'              FROM params
        UNION ALL
        SELECT 'YTD', date_trunc('year', as_of_date)::DATE          FROM params
        UNION ALL
        SELECT '1Y',  as_of_date - INTERVAL '1 year'                FROM params
        UNION ALL
        SELECT 'SII', COALESCE(min_dr.sii_from, params.as_of_date)  FROM min_dr CROSS JOIN params
    )
    SELECT
        w.w AS period,
        w.from_d::TEXT AS from_date,
        COALESCE(
            (EXP(SUM(LN(GREATEST(1.0 + dr.investment_return / 100.0, 1e-12))))
             - 1) * 100.0,
            0.0
        )::DOUBLE PRECISION AS return_pct
    FROM windows w
    CROSS JOIN params p
    LEFT JOIN daily_returns dr
        ON dr.date >= w.from_d
        AND dr.date <= p.as_of_date
        AND dr.portfolio_value > 0
    GROUP BY w.w, w.from_d
    ORDER BY w.w;
$$;

---------- portfolio_rolling_returns_sql ----------
-- #223 Rolling trailing returns over p_window_months.
-- For each month-end ≤ as_of_date with ≥ p_window_months of prior
-- daily_returns history, compute the geometric-linked TWR (investment_return).

CREATE OR REPLACE FUNCTION portfolio_rolling_returns_sql(
    p_as_of_date DATE DEFAULT CURRENT_DATE,
    p_window_months INTEGER DEFAULT 12
) RETURNS TABLE(date TEXT, return_pct DOUBLE PRECISION)
LANGUAGE sql
STABLE
AS $$
    WITH params AS (
        SELECT
            COALESCE(p_as_of_date, CURRENT_DATE) AS as_of_date,
            COALESCE(p_window_months, 12) AS window_months
    ),
    month_ends AS (
        SELECT MAX(dr.date) AS me
        FROM daily_returns dr
        CROSS JOIN params p
        WHERE dr.date <= p.as_of_date
        GROUP BY date_trunc('month', dr.date)
    ),
    eligible AS (
        SELECT me.me
        FROM month_ends me
        CROSS JOIN params p
        WHERE (
            SELECT MIN(dr2.date)
            FROM daily_returns dr2
            WHERE dr2.date <= me.me
              AND dr2.portfolio_value > 0
        ) <= me.me - (p.window_months * INTERVAL '1 month')
    )
    SELECT
        e.me::TEXT AS date,
        COALESCE(
            (EXP(SUM(LN(GREATEST(1.0 + dr.investment_return / 100.0, 1e-12))))
             - 1) * 100.0,
            0.0
        )::DOUBLE PRECISION AS return_pct
    FROM eligible e
    CROSS JOIN params p
    LEFT JOIN daily_returns dr
        ON dr.date > e.me - (p.window_months * INTERVAL '1 month')
        AND dr.date <= e.me
        AND dr.portfolio_value > 0
    GROUP BY e.me
    ORDER BY e.me;
$$;

-- Asset metadata cache reader: returns cached sector/industry/region + staleness flag.
-- Reads cache only (no network). Uses p_max_age_days to compute is_stale the same
-- way the price cache does.
DROP FUNCTION IF EXISTS portfolio_asset_metadata_sql(TEXT, INTEGER);
CREATE OR REPLACE FUNCTION portfolio_asset_metadata_sql(
    p_asset TEXT DEFAULT NULL,
    p_max_age_days INTEGER DEFAULT 5
)
RETURNS TABLE(
    asset TEXT,
    asset_kind TEXT,
    sector TEXT,
    industry TEXT,
    region TEXT,
    sector_weights JSONB,
    source TEXT,
    fetched_at TEXT,
    is_stale BOOLEAN
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        am.ticker::TEXT,
        am.asset_kind,
        am.sector,
        am.industry,
        am.region,
        am.sector_weights,
        am.source,
        to_char(am.fetched_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')::TEXT,
        (am.fetched_at < (CURRENT_DATE - p_max_age_days) OR am.fetched_at IS NULL) AS is_stale
    FROM asset_metadata am
    WHERE (p_asset IS NULL OR upper(am.ticker) = upper(p_asset))
    ORDER BY am.ticker;
$$;

-- Cash drag: opportunity cost of holding idle cash vs being invested.
-- Quantifies the annualized-rate-basis forgone return, i.e. 1-year forgone $.
-- total_cash_usd: from portfolio_cash_sql (canonical cash classification + FX).
-- total_portfolio_value + portfolio_cagr + benchmark_cagr: from portfolio_performance_sql.
-- period_start_date = COALESCE(p_from_date, inception date from performance).
-- Drag ($) = total_cash_usd × (return_rate − p_cash_return_rate)  [1-year forgone].
-- Drag (%) = drag($) / total_portfolio_value × 100.
-- Guard: divide-by-zero on zero portfolio value.
DROP FUNCTION IF EXISTS portfolio_cash_drag_sql(DATE, DATE, DOUBLE PRECISION, DOUBLE PRECISION);
CREATE OR REPLACE FUNCTION portfolio_cash_drag_sql(
    p_as_of_date             DATE DEFAULT CURRENT_DATE,
    p_from_date              DATE DEFAULT NULL,
    p_benchmark_return_rate  DOUBLE PRECISION DEFAULT NULL,
    p_cash_return_rate       DOUBLE PRECISION DEFAULT 0.0
)
RETURNS TABLE (
    total_portfolio_value     DOUBLE PRECISION,
    total_cash_usd            DOUBLE PRECISION,
    cash_pct                  DOUBLE PRECISION,
    portfolio_cagr            DOUBLE PRECISION,
    benchmark_cagr            DOUBLE PRECISION,
    assumed_cash_return_rate  DOUBLE PRECISION,
    drag_vs_portfolio_cagr    DOUBLE PRECISION,
    drag_vs_benchmark         DOUBLE PRECISION,
    drag_vs_portfolio_pct     DOUBLE PRECISION,
    drag_vs_benchmark_pct     DOUBLE PRECISION,
    period_start_date         TEXT,
    period_end_date           TEXT
)
LANGUAGE sql
STABLE
AS $$
    WITH cash_total AS (
        SELECT COALESCE(SUM(c.usd_value), 0.0) AS total_cash_usd
        FROM portfolio_cash_sql(p_as_of_date) c
    ),
    pv AS (
        -- canonical total portfolio value (holdings + cash), aligned to the
        -- status/cash/summary reporting snapshot; NOT the invested-only
        -- start_value+total_gain trajectory from portfolio_performance_sql.
        SELECT COALESCE(ps.portfolio_value, 0.0) AS portfolio_value
        FROM portfolio_status_sql(p_as_of_date) ps
    ),
    perf AS (
        SELECT
            p.cagr                                              AS portfolio_cagr,
            p.spy_cagr_pct                                      AS benchmark_cagr,
            p.start_date                                        AS start_date,
            p.end_date                                          AS end_date
        FROM portfolio_performance_sql(p_as_of_date, 'SPY', p_from_date, 0.02, 0.025) p
    ),
    drag AS (
        SELECT
            ct.total_cash_usd,
            pv.portfolio_value,
            p.portfolio_cagr,
            p.benchmark_cagr,
            p_cash_return_rate                                      AS assumed_cash_return_rate,
            p.start_date,
            p.end_date,
            COALESCE(p.portfolio_cagr, 0.0) / 100.0 - p_cash_return_rate AS rate_gap_portfolio,
            COALESCE(p_benchmark_return_rate, COALESCE(p.benchmark_cagr, 0.0) / 100.0) - p_cash_return_rate AS rate_gap_benchmark
        FROM cash_total ct
        CROSS JOIN perf p
        CROSS JOIN pv
    )
    SELECT
        d.portfolio_value                                          AS total_portfolio_value,
        d.total_cash_usd                                           AS total_cash_usd,
        CASE WHEN d.portfolio_value > 0.0
             THEN (d.total_cash_usd / d.portfolio_value) * 100.0
             ELSE 0.0
        END                                                        AS cash_pct,
        COALESCE(d.portfolio_cagr, 0.0)                            AS portfolio_cagr,
        COALESCE(d.benchmark_cagr, 0.0)                            AS benchmark_cagr,
        d.assumed_cash_return_rate                                 AS assumed_cash_return_rate,
        d.total_cash_usd * d.rate_gap_portfolio                     AS drag_vs_portfolio_cagr,
        d.total_cash_usd * d.rate_gap_benchmark                     AS drag_vs_benchmark,
        CASE WHEN d.portfolio_value > 0.0
             THEN (d.total_cash_usd * d.rate_gap_portfolio) / d.portfolio_value * 100.0
             ELSE 0.0
        END                                                        AS drag_vs_portfolio_pct,
        CASE WHEN d.portfolio_value > 0.0
             THEN (d.total_cash_usd * d.rate_gap_benchmark) / d.portfolio_value * 100.0
             ELSE 0.0
        END                                                        AS drag_vs_benchmark_pct,
        COALESCE(d.start_date, p_as_of_date::TEXT)                 AS period_start_date,
        COALESCE(d.end_date, p_as_of_date::TEXT)                   AS period_end_date
    FROM drag d
$$;
-- Correlation matrix for portfolio diversification analysis.
-- Returns pairwise Pearson correlation of daily price returns
-- for non-cash holdings over the configured window.
DROP FUNCTION IF EXISTS portfolio_correlation_matrix_sql(DATE, INTEGER) CASCADE;

CREATE OR REPLACE FUNCTION portfolio_correlation_matrix_sql(
    p_as_of_date DATE DEFAULT NULL,
    p_window_months INTEGER DEFAULT 12
)
RETURNS TABLE (
    asset_a TEXT,
    asset_b TEXT,
    correlation DOUBLE PRECISION
) AS $$
DECLARE
    v_as_of DATE;
    v_window_months INTEGER;
BEGIN
    v_as_of := COALESCE(p_as_of_date, CURRENT_DATE);
    v_window_months := COALESCE(p_window_months, 12);

    RETURN QUERY
    WITH held_assets AS (
        SELECT DISTINCT n.asset
        FROM (
            SELECT asset,
                   SUM(CASE
                       WHEN action IN ('BUY','DEPOSIT','DIVIDEND','INTEREST','TRANSFER','EXCHANGE_TO') THEN quantity
                       WHEN action IN ('SELL','WITHDRAW','FEE','TAX','EXCHANGE_FROM') THEN -quantity
                       ELSE 0
                   END) AS net_quantity
            FROM transactions
            WHERE date <= v_as_of
            GROUP BY asset
        ) n
        WHERE n.net_quantity > 0
          AND n.asset NOT IN ('USD','EUR','GBP','CHF','CAD','AUD','HKD','SGD','JPY')
          AND NOT (n.asset LIKE 'CASH %')
          AND is_cash_like_sql(n.asset) = false
          AND get_asset_type_sql(n.asset) NOT IN ('cash_base','cash_fx','cash_stable')
    ),
    price_series AS (
        SELECT
            p.ticker,
            p.date,
            p.price,
            LAG(p.price) OVER (PARTITION BY p.ticker ORDER BY p.date) AS prev_price
        FROM prices p
        JOIN held_assets ha ON p.ticker = ha.asset
        WHERE p.date > (v_as_of - (v_window_months || ' months')::INTERVAL)
          AND p.date <= v_as_of
          AND p.price > 0
    ),
    daily_rets AS (
        SELECT
            ticker,
            date,
            (price - prev_price) / prev_price AS ret
        FROM price_series
        WHERE prev_price IS NOT NULL AND prev_price > 0
    ),
    corr_calc AS (
        SELECT
            dr_a.ticker AS asset_a,
            dr_b.ticker AS asset_b,
            COUNT(*) AS n,
            SUM(dr_a.ret) AS sum_x,
            SUM(dr_b.ret) AS sum_y,
            SUM(dr_a.ret * dr_b.ret) AS sum_xy,
            SUM(dr_a.ret * dr_a.ret) AS sum_x2,
            SUM(dr_b.ret * dr_b.ret) AS sum_y2
        FROM daily_rets dr_a
        JOIN daily_rets dr_b ON dr_a.date = dr_b.date
        GROUP BY dr_a.ticker, dr_b.ticker
    )
    SELECT
        cc.asset_a,
        cc.asset_b,
        CASE
            WHEN cc.n < 5 THEN NULL::DOUBLE PRECISION
            WHEN GREATEST((cc.n * cc.sum_x2 - cc.sum_x * cc.sum_x), 0.0) = 0.0 THEN NULL::DOUBLE PRECISION
            WHEN GREATEST((cc.n * cc.sum_y2 - cc.sum_y * cc.sum_y), 0.0) = 0.0 THEN NULL::DOUBLE PRECISION
            ELSE ((cc.n * cc.sum_xy - cc.sum_x * cc.sum_y) /
                  SQRT(GREATEST((cc.n * cc.sum_x2 - cc.sum_x * cc.sum_x) * (cc.n * cc.sum_y2 - cc.sum_y * cc.sum_y), 1e-12)))
                 ::DOUBLE PRECISION
        END AS correlation
    FROM corr_calc cc
    ORDER BY cc.asset_a, cc.asset_b;
END;
$$ LANGUAGE plpgsql STABLE;

-- Portfolio growth decomposition: split total growth into "from my savings"
-- (net contributions) vs "from the market" (returns).
--
-- Convention: the baseline is the FIRST daily_returns row (earliest tracked date).
-- All components are measured as DELTAS between two portfolio_status_sql snapshots:
--   - start snapshot: portfolio_status_sql at the first daily_returns date
--   - end snapshot:   portfolio_status_sql at p_as_of_date
-- This guarantees the identity:
--     total_growth_usd = from_contributions_usd + from_returns_usd
--
--   initial_value  = portfolio_value at the first daily_returns row (0 if none)
--   current_value  = status_end.portfolio_value
--   net_deposits   = (deposits_end - deposits_start) - (withdrawals_end - withdrawals_start)
--   total_gain     = (realized_end - realized_start) + (unrealized_end - unrealized_start)
--   total_income   = income_end - income_start
--   total_fees_and_taxes = (fees_end - fees_start) + (taxes_end - taxes_start)
--   total_growth_usd    = current_value - initial_value
--   from_contributions_usd = net_deposits
--   from_returns_usd       = market_return = delta of (realized_gain + unrealized_gain)
--                            (pure price/realized P/L). Deliberately NOT delta of
--                            portfolio_status_sql.total_gain, because that field =
--                            portfolio_value - (deposits - withdrawals) also absorbs
--                            dividend/interest income and standalone fees, which would
--                            mis-attribute income as market returns. With market_return
--                            defined this way the identity that holds is:
--                            total_growth_usd = from_contributions_usd + from_returns_usd
--                                             + total_income - total_fees_and_taxes
--
-- Guards:
--   total_growth_usd = 0 -> percentage split is NULL to avoid a misleading 0/0
--   signed split is preserved for negative growth as well
DROP FUNCTION IF EXISTS portfolio_decomposition_sql(DATE) CASCADE;

CREATE OR REPLACE FUNCTION portfolio_decomposition_sql(
    p_as_of_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    as_of_date             TEXT,
    total_growth_usd       DOUBLE PRECISION,
    total_growth_pct       DOUBLE PRECISION,
    from_contributions_usd DOUBLE PRECISION,
    from_contributions_pct DOUBLE PRECISION,
    from_returns_usd       DOUBLE PRECISION,
    from_returns_pct       DOUBLE PRECISION,
    initial_value          DOUBLE PRECISION,
    current_value          DOUBLE PRECISION,
    net_deposits           DOUBLE PRECISION,
    total_gain             DOUBLE PRECISION,
    total_income           DOUBLE PRECISION,
    total_fees_and_taxes   DOUBLE PRECISION
)
LANGUAGE sql
STABLE
AS $$
    WITH start_info AS (
        SELECT
            (SELECT MIN(date) FROM daily_returns)            AS start_date,
            COALESCE(
                (SELECT portfolio_value FROM daily_returns ORDER BY date ASC LIMIT 1),
                0.0
            )                                                 AS initial_value
    ),
    status_start AS (
        SELECT * FROM portfolio_status_sql(
            COALESCE((SELECT start_date FROM start_info), '1900-01-01'::DATE)
        )
    ),
    status_end AS (
        SELECT * FROM portfolio_status_sql(p_as_of_date)
    ),
    pieces AS (
        SELECT
            p_as_of_date::TEXT                                                   AS as_of_date,
            COALESCE(se.portfolio_value, 0.0)                                    AS current_value,
            si.initial_value,
            (COALESCE(se.deposits, 0.0) - COALESCE(ss.deposits, 0.0))
              - (COALESCE(se.withdrawals, 0.0) - COALESCE(ss.withdrawals, 0.0)) AS net_deposits,
            (COALESCE(se.realized_gain, 0.0) - COALESCE(ss.realized_gain, 0.0))
              + (COALESCE(se.unrealized_gain, 0.0)
                 - COALESCE(ss.unrealized_gain, 0.0))                            AS total_gain,
            COALESCE(se.income, 0.0) - COALESCE(ss.income, 0.0)                  AS total_income,
            (COALESCE(se.fees, 0.0) - COALESCE(ss.fees, 0.0))
              + (COALESCE(se.taxes, 0.0) - COALESCE(ss.taxes, 0.0))             AS total_fees_and_taxes,
            -- market_return = pure price/realized P/L over the window = delta of (realized + unrealized).
            -- Must NOT use portfolio_status_sql.total_gain here: that field is
            -- (portfolio_value - net_invested), which absorbs dividend/interest income and
            -- standalone fees, so it would mis-attribute income as market returns. Using the
            -- realized+unrealized delta keeps from_returns_usd distinct from total_income /
            -- total_fees_and_taxes and satisfies the identity
            -- total_growth = contributions + market_return + income - fees_and_taxes.
            COALESCE(se.realized_gain, 0.0) - COALESCE(ss.realized_gain, 0.0)
              + COALESCE(se.unrealized_gain, 0.0) - COALESCE(ss.unrealized_gain, 0.0) AS market_return
        FROM status_start ss
        CROSS JOIN status_end se
        CROSS JOIN start_info si
    )
    SELECT
        p.as_of_date,
        p.current_value - p.initial_value                                                                             AS total_growth_usd,
        CASE WHEN p.initial_value > 0.0
             THEN (p.current_value - p.initial_value) / p.initial_value * 100.0
             ELSE 0.0
        END                                                                                                            AS total_growth_pct,
        p.net_deposits                                                                                                 AS from_contributions_usd,
        CASE WHEN (p.current_value - p.initial_value) <> 0.0
             THEN p.net_deposits / (p.current_value - p.initial_value) * 100.0
             ELSE NULL::DOUBLE PRECISION
        END                                                                                                            AS from_contributions_pct,
        p.market_return                                                                                                AS from_returns_usd,
        CASE WHEN (p.current_value - p.initial_value) <> 0.0
             THEN p.market_return / (p.current_value - p.initial_value) * 100.0
             ELSE NULL::DOUBLE PRECISION
        END                                                                                                            AS from_returns_pct,
        p.initial_value,
        p.current_value,
        p.net_deposits,
        p.total_gain,
        p.total_income,
        p.total_fees_and_taxes
    FROM pieces p
$$;

-- ============================================================================
-- Projection: long-term future value (FV) + goal tracking / FIRE.
--
-- Annuity formula derivation (hand-verifiable):
--   Let r  = annual return rate (decimal, e.g. 0.07)
--       m  = r/12  (monthly rate)
--       C  = monthly contribution (end of month, ordinary annuity)
--       PV = current_value (portfolio_value as of p_as_of_date)
--       n  = number of months
--
--   Contributions deposited at END of each month (ordinary annuity).
--   FV after n months:
--     FV(n) = PV * (1+m)^n  +  C * ((1+m)^n - 1) / m    [if m != 0]
--     FV(n) = PV            +  C * n                      [if m = 0]
--
--   Projection mode (p_target_value IS NULL):
--     n = p_projection_years * 12
--     projected_value_nominal = FV(n)
--     projected_value_real    = FV(n) / (1+p_inflation_rate)^p_projection_years
--     total_contributions     = C * n
--     return_portion          = projected_value_nominal - PV - total_contributions
--     Goal fields NULL. required_return_rate NULL.
--
--   Goal mode (p_target_value provided):
--     Solve smallest integer n (months) where FV(n) >= target inflated to the
--     goal month via p_inflation_rate.
--     Uses iterative month-by-month approach (cap: 100 years = 1200 months).
--     Uses the same FV recurrence/formula for positive, zero, and negative rates.
--     years_to_goal = n / 12.0 (fractional months ceiling).
--     projected_goal_value = FV(n) (>= target).
--     Projection fields NULL.
--     required_return_rate: bisection on annual r ∈ [-0.20, 2.00]
--       such that FV(p_projection_years*12) = p_target_value inflated to the
--       projection horizon via p_inflation_rate.
--       Tolerance: 1e-8. Returns NULL if no solution.
--
--   Guard: negative or zero current_value → NULL row.
-- ============================================================================
DROP FUNCTION IF EXISTS portfolio_projection_sql(DATE, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, DOUBLE PRECISION) CASCADE;
CREATE OR REPLACE FUNCTION portfolio_projection_sql(
    p_as_of_date            DATE DEFAULT CURRENT_DATE,
    p_monthly_contribution  DOUBLE PRECISION DEFAULT 1000,
    p_annual_return_rate    DOUBLE PRECISION DEFAULT NULL,
    p_target_value          DOUBLE PRECISION DEFAULT NULL,
    p_projection_years      INTEGER DEFAULT 10,
    p_inflation_rate        DOUBLE PRECISION DEFAULT 0.0
)
RETURNS TABLE (
    current_value               DOUBLE PRECISION,
    annual_return_rate          DOUBLE PRECISION,
    monthly_contribution        DOUBLE PRECISION,
    inflation_rate              DOUBLE PRECISION,
    target_value                DOUBLE PRECISION,
    years_to_goal               DOUBLE PRECISION,
    projected_goal_value        DOUBLE PRECISION,
    projection_years            INTEGER,
    projected_value_nominal     DOUBLE PRECISION,
    projected_value_real        DOUBLE PRECISION,
    total_contributions         DOUBLE PRECISION,
    return_portion              DOUBLE PRECISION,
    required_return_rate        DOUBLE PRECISION
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_cv               DOUBLE PRECISION;
    v_r                DOUBLE PRECISION;
    v_m                DOUBLE PRECISION;
    v_n                INTEGER;
    v_c                DOUBLE PRECISION;
    v_fv               DOUBLE PRECISION;
    v_total_contr      DOUBLE PRECISION;
    v_months           INTEGER;
    v_i                INTEGER;
    v_found            BOOLEAN;
    v_m_max            INTEGER := 1200; -- 100 years cap
    v_projection_years INTEGER;

    -- bisection for required_return_rate
    v_lo               DOUBLE PRECISION;
    v_hi               DOUBLE PRECISION;
    v_mid              DOUBLE PRECISION;
    v_mid_m            DOUBLE PRECISION;
    v_fv_mid           DOUBLE PRECISION;
    v_iter             INTEGER;
    v_max_iter         INTEGER := 200;
    v_tol              DOUBLE PRECISION := 1e-8;
    v_targ_months      INTEGER;
    v_goal_target      DOUBLE PRECISION;
    v_fraction         DOUBLE PRECISION;
    v_term_report      DOUBLE PRECISION;
BEGIN
    -- 1. Get current_value from portfolio_status_sql
    SELECT ps.portfolio_value INTO v_cv
    FROM portfolio_status_sql(p_as_of_date) ps;
    IF v_cv IS NULL OR v_cv <= 0 THEN
        RETURN;
    END IF;

    -- 2. Determine annual_return_rate
    IF p_annual_return_rate IS NULL THEN
        SELECT pperf.cagr / 100.0 INTO v_r
        FROM portfolio_performance_sql(p_as_of_date, 'SPY', NULL, 0.02, 0.025) pperf;
        IF v_r IS NULL THEN
            v_r := 0.0;
        END IF;
    ELSE
        v_r := p_annual_return_rate; -- assumed passed as decimal, e.g. 0.07
    END IF;

    v_c := p_monthly_contribution;
    v_m := POWER(1.0 + v_r, 1.0 / 12.0) - 1.0;
    v_projection_years := GREATEST(p_projection_years, 0);

    -- 3. Projection mode (no target)
    IF p_target_value IS NULL THEN
        v_n := v_projection_years * 12;
        v_total_contr := v_c * v_n;

        IF v_m = 0.0 THEN
            v_fv := v_cv + v_c * v_n;
        ELSE
            v_fv := v_cv * (1.0 + v_m)^v_n + v_c * ((1.0 + v_m)^v_n - 1.0) / v_m;
        END IF;

        RETURN QUERY SELECT
            v_cv,
            v_r,
            v_c,
            p_inflation_rate,
            NULL::DOUBLE PRECISION,   -- target_value
            NULL::DOUBLE PRECISION,   -- years_to_goal
            NULL::DOUBLE PRECISION,   -- projected_goal_value
            v_projection_years,
            v_fv,
            v_fv / (1.0 + p_inflation_rate)^v_projection_years,
            v_total_contr,
            v_fv - v_cv - v_total_contr,
            NULL::DOUBLE PRECISION;   -- required_return_rate
        RETURN;
    END IF;

    -- 4. Goal mode (target provided)
    IF v_cv >= p_target_value THEN
        RETURN QUERY SELECT
            v_cv,
            v_r,
            v_c,
            p_inflation_rate,
            p_target_value,
            0::DOUBLE PRECISION,      -- years_to_goal
            v_cv,                     -- projected_goal_value
            NULL::INTEGER,            -- projection_years
            NULL::DOUBLE PRECISION,   -- projected_value_nominal
            NULL::DOUBLE PRECISION,   -- projected_value_real
            NULL::DOUBLE PRECISION,   -- total_contributions
            NULL::DOUBLE PRECISION,   -- return_portion
            NULL::DOUBLE PRECISION;   -- required_return_rate
        RETURN;
    END IF;

    v_found := FALSE;
    v_fv := v_cv;

    FOR v_i IN 1..v_m_max LOOP
        v_goal_target := p_target_value * POWER(1.0 + p_inflation_rate, v_i::DOUBLE PRECISION / 12.0);
        IF v_m = 0.0 THEN
            v_fv := v_cv + v_c * v_i;
        ELSE
            v_fv := v_cv * (1.0 + v_m)^v_i + v_c * ((1.0 + v_m)^v_i - 1.0) / v_m;
        END IF;
        IF v_fv >= v_goal_target THEN
            v_found := TRUE;
            v_months := v_i;  -- persist found month
            EXIT;
        END IF;
    END LOOP;

    IF NOT v_found THEN
        -- Unreachable: return with NULL years_to_goal
        RETURN QUERY SELECT
            v_cv,
            v_r,
            v_c,
            p_inflation_rate,
            p_target_value,
            NULL::DOUBLE PRECISION,   -- years_to_goal
            NULL::DOUBLE PRECISION,   -- projected_goal_value
            NULL::INTEGER,            -- projection_years
            NULL::DOUBLE PRECISION,   -- projected_value_nominal
            NULL::DOUBLE PRECISION,   -- projected_value_real
            NULL::DOUBLE PRECISION,   -- total_contributions
            NULL::DOUBLE PRECISION,   -- return_portion
            NULL::DOUBLE PRECISION;   -- required_return_rate
        RETURN;
    END IF;

    -- 5. Compute required_return_rate (bisection on r)
    v_targ_months := v_projection_years * 12;
    v_goal_target := p_target_value * POWER(1.0 + p_inflation_rate, v_projection_years::DOUBLE PRECISION);
    v_lo := -0.20;
    v_hi := 2.00;  -- 200% annual
    v_mid := v_r;
    v_iter := 0;

    -- Check if target is achievable at hi rate
    v_mid_m := POWER(1.0 + v_hi, 1.0 / 12.0) - 1.0;
    IF v_mid_m = 0.0 THEN
        v_fv_mid := v_cv + v_c * v_targ_months;
    ELSE
        v_fv_mid := v_cv * (1.0 + v_mid_m)^v_targ_months
                  + v_c * ((1.0 + v_mid_m)^v_targ_months - 1.0) / v_mid_m;
    END IF;
    IF v_fv_mid < v_goal_target THEN
        v_mid := NULL; -- not achievable within bracket
    ELSE
        WHILE v_iter < v_max_iter LOOP
            v_mid := (v_lo + v_hi) / 2.0;
            v_mid_m := POWER(1.0 + v_mid, 1.0 / 12.0) - 1.0;
            IF v_mid_m = 0.0 THEN
                v_fv_mid := v_cv + v_c * v_targ_months;
            ELSE
                v_fv_mid := v_cv * (1.0 + v_mid_m)^v_targ_months
                          + v_c * ((1.0 + v_mid_m)^v_targ_months - 1.0) / v_mid_m;
            END IF;

            IF ABS(v_fv_mid - v_goal_target) < v_tol OR (v_hi - v_lo) < v_tol THEN
                EXIT;
            END IF;

            IF v_fv_mid < v_goal_target THEN
                v_lo := v_mid;
            ELSE
                v_hi := v_mid;
            END IF;
            v_iter := v_iter + 1;
        END LOOP;
    END IF;

    RETURN QUERY SELECT
        v_cv,
        v_r,
        v_c,
        p_inflation_rate,
        p_target_value,
        v_months::DOUBLE PRECISION / 12.0,   -- years_to_goal (fractional)
        v_fv,                                 -- projected_goal_value (>= target)
        NULL::INTEGER,                        -- projection_years
        NULL::DOUBLE PRECISION,               -- projected_value_nominal
        NULL::DOUBLE PRECISION,               -- projected_value_real
        NULL::DOUBLE PRECISION,               -- total_contributions
        NULL::DOUBLE PRECISION,               -- return_portion
        v_mid;                                -- required_return_rate
END;
$$;

-- Safe withdrawal rate / decumulation analysis (#230)
-- Determines how long a portfolio lasts given an annual withdrawal amount/rate,
-- accounts for inflation-adjusted spending, expected returns, and computes
-- max safe withdrawal via bisection.
--
-- Recurrence (withdrawal at END of year, inflation-adjusted):
--   V_0 = portfolio_value
--   V_t = V_{t-1} * (1 + r) - W0 * (1 + infl)^(t-1)   for t = 1..horizon
-- where:
--   r    = expected_return (decimal, e.g. 0.06)
--   infl = p_inflation_rate / 100.0 (p_inflation_rate is a PERCENT, default 3.0)
--   W0   = annual withdrawal in year 1 (today's dollars)
--   horizon = p_time_horizon_years
--
-- Withdrawal resolution:
--   1. p_annual_withdrawal given → W0 = p_annual_withdrawal
--   2. p_withdrawal_rate given (percent) → W0 = portfolio_value * p_withdrawal_rate / 100
--   3. Neither → W0 = portfolio_value * 0.04 (4% rule)
--   withdrawal_rate_pct = W0 / portfolio_value * 100
--
-- Expected return resolution:
--   1. p_expected_return given (decimal, e.g. 0.06) → use it
--   2. Otherwise → portfolio_performance_sql(p_as_of_date).cagr / 100.0
--
-- success_likelihood / shortfall_risk: v1 deterministic single-path proxy
-- (NOT a probabilistic Monte-Carlo estimate — v1 placeholder).
--   success_likelihood = 100 if terminal_value >= 0
--                      else 100 * years_until_depletion / horizon (clamped 0–100)
--   shortfall_risk = 100 - success_likelihood
--
-- max_safe_withdrawal: largest W0 (today's $) such that terminal_value >= 0
--   solved by expanding an upper bracket until terminal_value < 0, then
--   bisection between the last safe lower bound and unsafe upper bound
--   (tolerance 1e-8). For horizon=0 it is undefined and returned as NULL.
-- max_safe_withdrawal_rate = max_safe_withdrawal / portfolio_value * 100
--
-- years_until_depletion: smallest t where V_t <= 0 (fractional via linear
--   interpolation within the year). Returns NULL if portfolio never depletes
--   within the horizon.
--
-- total_withdrawn = Σ_{t=1..min(horizon, depletion)} W0*(1+infl)^(t-1) (nominal)
-- return_generated = terminal_value_at_depletion - portfolio_value + total_withdrawn
DROP FUNCTION IF EXISTS portfolio_withdrawal_sql(DATE, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, DOUBLE PRECISION, DOUBLE PRECISION) CASCADE;
CREATE OR REPLACE FUNCTION portfolio_withdrawal_sql(
    p_as_of_date          DATE DEFAULT CURRENT_DATE,
    p_annual_withdrawal   DOUBLE PRECISION DEFAULT NULL,
    p_withdrawal_rate     DOUBLE PRECISION DEFAULT NULL,
    p_time_horizon_years  INTEGER DEFAULT 30,
    p_expected_return     DOUBLE PRECISION DEFAULT NULL,
    p_inflation_rate      DOUBLE PRECISION DEFAULT 3.0
)
RETURNS TABLE (
    portfolio_value          DOUBLE PRECISION,
    annual_withdrawal        DOUBLE PRECISION,
    withdrawal_rate_pct      DOUBLE PRECISION,
    time_horizon_years       INTEGER,
    expected_return          DOUBLE PRECISION,
    inflation_rate           DOUBLE PRECISION,
    years_until_depletion    DOUBLE PRECISION,
    terminal_value           DOUBLE PRECISION,
    success_likelihood       DOUBLE PRECISION,
    max_safe_withdrawal      DOUBLE PRECISION,
    max_safe_withdrawal_rate DOUBLE PRECISION,
    total_withdrawn          DOUBLE PRECISION,
    return_generated         DOUBLE PRECISION,
    shortfall_risk           DOUBLE PRECISION
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_pv      DOUBLE PRECISION;
    v_r       DOUBLE PRECISION;
    v_infl    DOUBLE PRECISION;
    v_W0      DOUBLE PRECISION;
    v_wd_pct  DOUBLE PRECISION;
    v_horizon INTEGER;

    -- simulation working vars
    v_V       DOUBLE PRECISION;
    v_V_prev  DOUBLE PRECISION;
    v_dep     DOUBLE PRECISION;  -- years_until_depletion, NULL if never
    v_term    DOUBLE PRECISION;
    v_term_report DOUBLE PRECISION;
    v_fraction DOUBLE PRECISION;
    v_tw      DOUBLE PRECISION;   -- total_withdrawn
    v_succ    DOUBLE PRECISION;   -- success_likelihood

    -- bisection on W0 for max safe withdrawal
    v_W_lo    DOUBLE PRECISION;
    v_W_hi    DOUBLE PRECISION;
    v_W_mid   DOUBLE PRECISION;
    v_term_mid DOUBLE PRECISION;
    v_iter    INTEGER;
    v_max_iter INTEGER := 200;
    v_tol     DOUBLE PRECISION := 1e-8;
    v_bracket_iter INTEGER;
    v_bracket_max_iter INTEGER := 60;

    -- simulation loop
    v_t       INTEGER;
    v_withdraw DOUBLE PRECISION;
    v_found   BOOLEAN;
BEGIN
    -- 1. portfolio_value from status
    SELECT ps.portfolio_value INTO v_pv
    FROM portfolio_status_sql(p_as_of_date) ps;
    IF v_pv IS NULL OR v_pv <= 0 THEN
        RETURN;
    END IF;

    -- 2. expected_return
    IF p_expected_return IS NOT NULL THEN
        v_r := p_expected_return;
    ELSE
        SELECT pperf.cagr / 100.0 INTO v_r
        FROM portfolio_performance_sql(p_as_of_date, 'SPY', NULL, 0.02, 0.025) pperf;
        IF v_r IS NULL THEN
            v_r := 0.0;
        END IF;
    END IF;

    -- 3. inflation_rate (passed as PERCENT → convert to decimal)
    v_infl := p_inflation_rate / 100.0;

    -- 4. horizon
    v_horizon := GREATEST(p_time_horizon_years, 0);

    -- 5. resolve withdrawal amount W0
    IF p_annual_withdrawal IS NOT NULL THEN
        v_W0 := p_annual_withdrawal;
    ELSIF p_withdrawal_rate IS NOT NULL THEN
        v_W0 := v_pv * p_withdrawal_rate / 100.0;
    ELSE
        v_W0 := v_pv * 0.04;
    END IF;
    v_wd_pct := CASE WHEN v_pv > 0 THEN v_W0 / v_pv * 100.0 ELSE 0.0 END;

    -- 6. Annual simulation
    v_V := v_pv;
    v_dep := NULL;
    v_found := FALSE;
    v_tw := 0.0;

    IF v_horizon = 0 THEN
        v_term := v_pv;
        v_dep := NULL;
        v_tw := 0.0;
    ELSE
        FOR v_t IN 1..v_horizon LOOP
            v_withdraw := v_W0 * POWER(1.0 + v_infl, v_t - 1);
            v_V_prev := v_V;
            v_V := v_V * (1.0 + v_r) - v_withdraw;

            IF NOT v_found THEN
                v_tw := v_tw + v_withdraw;
            END IF;

            IF (NOT v_found) AND v_V <= 0.0 THEN
                v_found := TRUE;
                IF v_V = 0.0 THEN
                    v_dep := v_t::DOUBLE PRECISION;
                ELSE
                    -- fractional interpolation: depletion between t-1 and t
                    -- V_{t-1} > 0, V_t < 0
                    IF v_V_prev > 0 THEN
                        v_dep := (v_t - 1)::DOUBLE PRECISION + v_V_prev / (v_V_prev - v_V);
                    ELSE
                        v_dep := v_t::DOUBLE PRECISION;
                    END IF;
                END IF;
                v_fraction := v_dep - (v_t - 1)::DOUBLE PRECISION;
                IF v_fraction < 0.0 THEN
                    v_fraction := 0.0;
                ELSIF v_fraction > 1.0 THEN
                    v_fraction := 1.0;
                END IF;
                v_tw := v_tw - v_withdraw + (v_withdraw * v_fraction);
            END IF;
        END LOOP;
        v_term := v_V;
    END IF;

    v_term_report := CASE
        WHEN v_dep IS NOT NULL AND v_dep < v_horizon::DOUBLE PRECISION THEN 0.0
        ELSE v_term
    END;

    -- 7. return_generated
    -- return_generated uses the depletion point when depletion occurs before the
    -- horizon; otherwise it uses the simulated terminal value.

    -- 8. success_likelihood (v1 deterministic proxy)
    IF v_term >= 0.0 THEN
        v_succ := 100.0;
    ELSIF v_horizon = 0 THEN
        v_succ := 100.0;
    ELSE
        -- linear: how far into horizon before depletion
        v_succ := CASE WHEN v_dep IS NOT NULL AND v_dep > 0
                       THEN GREATEST(0.0, LEAST(100.0, 100.0 * v_dep / v_horizon::DOUBLE PRECISION))
                       ELSE 0.0 END;
    END IF;

    -- 9. max_safe_withdrawal via bisection
    IF v_horizon = 0 THEN
        v_W_mid := NULL;
    ELSE
        v_W_lo := 0.0;
        v_W_hi := GREATEST(v_W0, v_pv, 1.0);
        v_W_mid := v_W_hi;
        v_iter := 0;
        v_bracket_iter := 0;

        LOOP
            v_V := v_pv;
            FOR v_t IN 1..v_horizon LOOP
                v_withdraw := v_W_hi * POWER(1.0 + v_infl, v_t - 1);
                v_V := v_V * (1.0 + v_r) - v_withdraw;
            END LOOP;

            EXIT WHEN v_V < 0.0 OR v_bracket_iter >= v_bracket_max_iter;

            v_W_lo := v_W_hi;
            v_W_hi := v_W_hi * 2.0;
            v_bracket_iter := v_bracket_iter + 1;
        END LOOP;

        IF v_V >= 0.0 THEN
            v_W_mid := v_W_hi;
        ELSE
            WHILE v_iter < v_max_iter LOOP
                v_W_mid := (v_W_lo + v_W_hi) / 2.0;

                -- simulate with W_mid
                v_V := v_pv;
                FOR v_t IN 1..v_horizon LOOP
                    v_withdraw := v_W_mid * POWER(1.0 + v_infl, v_t - 1);
                    v_V := v_V * (1.0 + v_r) - v_withdraw;
                END LOOP;

                IF ABS(v_V) < v_tol OR (v_W_hi - v_W_lo) < v_tol THEN
                    EXIT;
                END IF;

                IF v_V >= 0.0 THEN
                    v_W_lo := v_W_mid;
                ELSE
                    v_W_hi := v_W_mid;
                END IF;
                v_iter := v_iter + 1;
            END LOOP;

            v_W_mid := v_W_lo;
        END IF;
    END IF;

    RETURN QUERY SELECT
        v_pv,
        v_W0,
        v_wd_pct,
        v_horizon,
        v_r,
        p_inflation_rate,
        v_dep,
        v_term,
        v_succ,
        v_W_mid,
        CASE
            WHEN v_W_mid IS NULL THEN NULL::DOUBLE PRECISION
            WHEN v_pv > 0 THEN v_W_mid / v_pv * 100.0
            ELSE 0.0
        END,
        v_tw,
        v_term_report - v_pv + v_tw,
        100.0 - v_succ;
END;
$$;

SET check_function_bodies = on;
