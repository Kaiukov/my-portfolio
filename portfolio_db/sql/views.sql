-- Portfolio database views
-- Database-side reporting and allocation calculations
-- All views are idempotent (CREATE OR REPLACE VIEW)

-- Holdings view: current net quantity by asset
CREATE OR REPLACE VIEW current_holdings AS
SELECT
    asset,
    SUM(CASE
        WHEN action IN ('BUY', 'DEPOSIT', 'DIVIDEND', 'INTEREST', 'TRANSFER', 'EXCHANGE_TO') THEN quantity
        WHEN action IN ('SELL', 'WITHDRAW', 'FEE', 'TAX') THEN -quantity
        WHEN action = 'EXCHANGE_FROM' THEN quantity
        ELSE 0
    END) AS net_quantity
FROM transactions
GROUP BY asset
HAVING SUM(CASE
    WHEN action IN ('BUY', 'DEPOSIT', 'DIVIDEND', 'INTEREST', 'TRANSFER', 'EXCHANGE_TO') THEN quantity
    WHEN action IN ('SELL', 'WITHDRAW', 'FEE', 'TAX', 'EXCHANGE_FROM') THEN -quantity
    ELSE 0
END) <> 0;

-- Cash view: cash balances by currency/bucket as of today
CREATE OR REPLACE VIEW cash_balances AS
WITH cash_txns AS (
    SELECT
        get_cash_key_for_asset_sql(asset, COALESCE(asset_type, get_asset_type_sql(asset))) AS cash_key,
        cash_display_currency_sql(get_cash_key_for_asset_sql(asset, COALESCE(asset_type, get_asset_type_sql(asset)))) AS currency,
        CASE
            WHEN asset LIKE 'CASH %' THEN asset
            WHEN get_asset_type_sql(asset) = 'cash_base' THEN 'CASH USD'
            WHEN get_asset_type_sql(asset) = 'cash_fx' THEN 'CASH ' || currency
            ELSE NULL
        END AS display_bucket,
        CASE
            WHEN action IN ('BUY', 'DEPOSIT', 'DIVIDEND', 'INTEREST', 'TRANSFER', 'EXCHANGE_TO') THEN quantity
            WHEN action IN ('SELL', 'WITHDRAW', 'FEE', 'TAX') THEN -quantity
            WHEN action = 'EXCHANGE_FROM' THEN quantity
            ELSE 0
        END AS cash_delta
    FROM transactions
)
SELECT
    cash_key,
    currency,
    COALESCE(display_bucket, 'CASH ' || currency) AS display_bucket,
    SUM(cash_delta) AS balance
FROM cash_txns
GROUP BY cash_key, currency, display_bucket
HAVING SUM(cash_delta) <> 0;

-- Market value snapshot view: holdings with USD market value as of a given date
-- This view requires a date parameter passed at query time
-- Example: SELECT * FROM holdings_with_value WHERE as_of_date = '2024-01-15'
CREATE OR REPLACE VIEW holdings_with_value AS
SELECT
    h.asset,
    h.net_quantity,
    COALESCE(h.net_quantity * price_asof_sql(h.asset, CURRENT_DATE), h.net_quantity) AS market_value_usd
FROM current_holdings h;

-- Allocation view: portfolio allocation percentages
CREATE OR REPLACE VIEW portfolio_allocation AS
WITH valued_holdings AS (
    SELECT
        asset,
        net_quantity,
        CASE
            WHEN get_asset_type_sql(asset) = 'cash_base' THEN net_quantity
            WHEN get_asset_type_sql(asset) = 'cash_fx' THEN net_quantity * price_asof_sql(asset, CURRENT_DATE)
            WHEN get_asset_type_sql(asset) IN (
                'stock_eur', 'stock_gbp', 'stock_jpy', 'stock_chf',
                'stock_cad', 'stock_aud', 'stock_hkd', 'stock_sgd'
            ) THEN net_quantity * price_asof_sql(asset, CURRENT_DATE) *
                price_asof_sql(cash_currency_for_asset_type_sql(get_asset_type_sql(asset)), CURRENT_DATE)
            ELSE net_quantity * price_asof_sql(asset, CURRENT_DATE)
        END AS value_usd
    FROM current_holdings
),
total_value AS (
    SELECT SUM(value_usd) AS portfolio_total
    FROM valued_holdings
)
SELECT
    v.asset,
    v.net_quantity,
    v.value_usd,
    CASE
        WHEN t.portfolio_total > 0 THEN (v.value_usd / t.portfolio_total) * 100
        ELSE 0
    END AS allocation_pct
FROM valued_holdings v
CROSS JOIN total_value t
WHERE v.value_usd <> 0
ORDER BY v.value_usd DESC;

-- Summary view: overall portfolio metrics
CREATE OR REPLACE VIEW portfolio_summary AS
SELECT
    (SELECT COUNT(DISTINCT asset) FROM current_holdings) AS holding_count,
    (SELECT SUM(net_quantity) FROM cash_balances) AS total_cash_usd,
    (SELECT SUM(value_usd) FROM portfolio_allocation) AS portfolio_value_usd,
    (SELECT MAX(date) FROM transactions) AS last_transaction_date,
    (SELECT COUNT(*) FROM transactions) AS transaction_count,
    CURRENT_TIMESTAMP AS generated_at;
TIMESTAMP AS generated_at;
