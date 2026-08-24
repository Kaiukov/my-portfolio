-- Portfolio database views
-- Database-side reporting and allocation calculations
-- All views are idempotent (CREATE OR REPLACE VIEW)

-- Holdings view: current net quantity by asset
CREATE OR REPLACE VIEW current_holdings AS
SELECT
    asset,
    SUM(CASE
        WHEN action IN ('BUY', 'DEPOSIT', 'DIVIDEND', 'INTEREST', 'TRANSFER', 'EXCHANGE_TO', 'STAKING_REWARD', 'WRAP', 'UNWRAP') THEN quantity
        WHEN action IN ('SELL', 'WITHDRAW', 'FEE', 'TAX') THEN -quantity
        WHEN action = 'EXCHANGE_FROM' THEN quantity
        ELSE 0
    END) AS net_quantity
FROM transactions
GROUP BY asset
HAVING SUM(CASE
    WHEN action IN ('BUY', 'DEPOSIT', 'DIVIDEND', 'INTEREST', 'TRANSFER', 'EXCHANGE_TO', 'STAKING_REWARD', 'WRAP', 'UNWRAP') THEN quantity
    WHEN action IN ('SELL', 'WITHDRAW', 'FEE', 'TAX', 'EXCHANGE_FROM') THEN -quantity
    ELSE 0
END) <> 0;

-- Cash view: cash balances by currency/bucket as of today
CREATE OR REPLACE VIEW cash_balances AS
SELECT cash_key, currency, display_bucket, balance
FROM portfolio_cash_sql(CURRENT_DATE);

-- Market value snapshot view: holdings with USD market value as of a given date
-- This view requires a date parameter passed at query time
-- Example: SELECT * FROM holdings_with_value WHERE as_of_date = '2024-01-15'
CREATE OR REPLACE VIEW holdings_with_value AS
SELECT
    h.asset,
    h.net_quantity,
    COALESCE(h.net_quantity * price_asof_sql(h.asset, CURRENT_DATE), h.net_quantity) AS market_value_usd,
    detect_asset_kind(h.asset) AS asset_kind
FROM current_holdings h;

-- Allocation view: portfolio allocation percentages
CREATE OR REPLACE VIEW portfolio_allocation AS
WITH valued_holdings AS (
    SELECT
        asset,
        net_quantity,
        asset_market_value_usd_sql(asset, net_quantity, CURRENT_DATE) AS value_usd
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
    (SELECT SUM(usd_value) FROM portfolio_cash_sql(CURRENT_DATE)) AS total_cash_usd,
    (SELECT SUM(value_usd) FROM portfolio_allocation) AS portfolio_value_usd,
    (SELECT MAX(date) FROM transactions) AS last_transaction_date,
    (SELECT COUNT(*) FROM transactions) AS transaction_count,
    CURRENT_TIMESTAMP AS generated_at;
