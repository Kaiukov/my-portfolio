-- Portfolio database procedures
-- Complex business logic implemented as PostgreSQL stored procedures

-- Refresh daily returns by recalculating from transaction history
-- This procedure rebuilds the daily_returns table with accurate portfolio valuations
-- and return metrics for each day
DROP FUNCTION IF EXISTS refresh_daily_returns_sql(DATE);
CREATE OR REPLACE FUNCTION refresh_daily_returns_sql(p_from_date DATE DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_min_date DATE;
    v_max_date DATE;
    v_date DATE;
    v_prev_value DOUBLE PRECISION := 0;
    v_portfolio_value DOUBLE PRECISION := 0;
    v_cash_flow_impact DOUBLE PRECISION := 0;
    v_portfolio_daily_return DOUBLE PRECISION := 0;
    v_investment_return DOUBLE PRECISION := 0;
    v_adjusted_base DOUBLE PRECISION := 0;
    v_rows INTEGER := 0;
    tx RECORD;
    h RECORD;
    v_asset_type TEXT;
    v_cash_key TEXT;
    v_fee_cash_key TEXT;
    v_fee_asset_type TEXT;
    v_asset_value DOUBLE PRECISION;
BEGIN
    IF p_from_date IS NULL THEN
        DELETE FROM daily_returns;
    ELSE
        DELETE FROM daily_returns WHERE date >= p_from_date;
    END IF;

    SELECT MIN(date), MAX(date)
      INTO v_min_date, v_max_date
    FROM transactions;

    IF v_min_date IS NULL THEN
        RETURN 0;
    END IF;

    IF v_max_date < CURRENT_DATE THEN
        v_max_date := CURRENT_DATE;
    END IF;

    CREATE TEMP TABLE holdings (
        asset TEXT PRIMARY KEY,
        qty DOUBLE PRECISION NOT NULL DEFAULT 0
    ) ON COMMIT DROP;

    INSERT INTO holdings (asset, qty)
    SELECT DISTINCT asset, 0
    FROM transactions
    ON CONFLICT (asset) DO NOTHING;

    INSERT INTO holdings (asset, qty)
    SELECT DISTINCT get_cash_key_for_asset_sql(asset, get_asset_type_sql(asset)), 0
    FROM transactions
    ON CONFLICT (asset) DO NOTHING;

    FOR v_date IN
        SELECT generate_series(v_min_date, v_max_date, interval '1 day')::date
    LOOP
        FOR tx IN
            SELECT id, asset, action, quantity, price, fees, asset_type,
                   COALESCE(NULLIF(currency, ''), 'USD') AS currency,
                   fee_currency
            FROM transactions
            WHERE date = v_date
            ORDER BY id
        LOOP
            v_asset_type := get_asset_type_sql(tx.asset);
            v_cash_key := get_cash_key_for_asset_sql(tx.asset, v_asset_type);

            INSERT INTO holdings (asset, qty)
            VALUES (tx.asset, 0)
            ON CONFLICT (asset) DO NOTHING;
            INSERT INTO holdings (asset, qty)
            VALUES (v_cash_key, 0)
            ON CONFLICT (asset) DO NOTHING;

            v_fee_cash_key := NULL;
            IF tx.fee_currency IS NOT NULL AND tx.fee_currency <> '' THEN
                v_fee_asset_type := get_asset_type_sql(tx.fee_currency);
                v_fee_cash_key := CASE
                    WHEN v_fee_asset_type = 'cash_base' THEN 'USD'
                    WHEN v_fee_asset_type = 'cash_fx'
                        THEN get_cash_key_for_asset_sql(tx.fee_currency, v_fee_asset_type)
                    ELSE tx.fee_currency || '-USD'
                END;
            END IF;

            CASE upper(tx.action)
                WHEN 'BUY' THEN
                    UPDATE holdings
                    SET qty = qty + tx.quantity
                    WHERE asset = tx.asset;

                    IF NOT is_cash_like_sql(tx.asset) AND tx.price IS NOT NULL THEN
                        UPDATE holdings
                        SET qty = qty - (tx.quantity * tx.price)
                        WHERE asset = v_cash_key;

                        IF v_fee_cash_key IS NOT NULL
                           AND v_fee_cash_key <> v_cash_key
                           AND COALESCE(tx.fees, 0) > 0 THEN
                            INSERT INTO holdings (asset, qty)
                            VALUES (v_fee_cash_key, 0)
                            ON CONFLICT (asset) DO NOTHING;
                            UPDATE holdings
                            SET qty = qty - tx.fees
                            WHERE asset = v_fee_cash_key;
                        ELSIF COALESCE(tx.fees, 0) > 0 THEN
                            UPDATE holdings
                            SET qty = qty - tx.fees
                            WHERE asset = v_cash_key;
                        END IF;
                    END IF;
                WHEN 'SELL' THEN
                    UPDATE holdings
                    SET qty = qty - tx.quantity
                    WHERE asset = tx.asset;

                    IF NOT is_cash_like_sql(tx.asset) AND tx.price IS NOT NULL THEN
                        UPDATE holdings
                        SET qty = qty + (tx.quantity * tx.price)
                        WHERE asset = v_cash_key;

                        IF v_fee_cash_key IS NOT NULL
                           AND v_fee_cash_key <> v_cash_key
                           AND COALESCE(tx.fees, 0) > 0 THEN
                            INSERT INTO holdings (asset, qty)
                            VALUES (v_fee_cash_key, 0)
                            ON CONFLICT (asset) DO NOTHING;
                            UPDATE holdings
                            SET qty = qty - tx.fees
                            WHERE asset = v_fee_cash_key;
                        ELSIF COALESCE(tx.fees, 0) > 0 THEN
                            UPDATE holdings
                            SET qty = qty - tx.fees
                            WHERE asset = v_cash_key;
                        END IF;
                    END IF;
                WHEN 'DEPOSIT', 'TRANSFER', 'DIVIDEND', 'INTEREST', 'EXCHANGE_TO' THEN
                    UPDATE holdings
                    SET qty = qty + tx.quantity
                    WHERE asset = v_cash_key;
                WHEN 'WITHDRAW', 'FEE', 'TAX' THEN
                    UPDATE holdings
                    SET qty = qty - tx.quantity
                    WHERE asset = v_cash_key;
                WHEN 'EXCHANGE_FROM' THEN
                    UPDATE holdings
                    SET qty = qty + tx.quantity
                    WHERE asset = v_cash_key;
                ELSE
                    NULL;
            END CASE;
        END LOOP;

        v_portfolio_value := 0;
        FOR h IN
            SELECT asset, qty
            FROM holdings
            WHERE qty <> 0
            ORDER BY asset
        LOOP
            v_asset_value := asset_market_value_usd_sql(h.asset, h.qty, v_date);
            IF h.qty <> 0 AND v_asset_value IS NULL THEN
                RAISE EXCEPTION USING MESSAGE = 'Price unavailable for ' || h.asset || ' as of ' || v_date;
            END IF;
            v_portfolio_value := v_portfolio_value + COALESCE(v_asset_value, 0);
        END LOOP;

        v_cash_flow_impact := 0;
        FOR tx IN
            SELECT asset, action, quantity, asset_type
            FROM transactions
            WHERE date = v_date
        LOOP
            v_asset_type := get_asset_type_sql(tx.asset);
            IF is_cash_like_sql(tx.asset) THEN
                IF upper(tx.action) = 'DEPOSIT' THEN
                    v_cash_flow_impact := v_cash_flow_impact + cash_amount_to_usd_sql(tx.asset, tx.quantity, v_date);
                ELSIF upper(tx.action) = 'WITHDRAW' THEN
                    v_cash_flow_impact := v_cash_flow_impact - cash_amount_to_usd_sql(tx.asset, tx.quantity, v_date);
                END IF;
            END IF;
        END LOOP;

        IF v_rows = 0 THEN
            v_portfolio_daily_return := 0;
            v_investment_return := 0;
            v_adjusted_base := v_portfolio_value;
            v_cash_flow_impact := 0;
        ELSE
            IF v_prev_value > 0 THEN
                v_portfolio_daily_return := ((v_portfolio_value - v_prev_value) / v_prev_value) * 100;
            ELSE
                v_portfolio_daily_return := 0;
            END IF;

            IF v_adjusted_base > 0 THEN
                v_investment_return := ((v_portfolio_value - v_prev_value - v_cash_flow_impact) / v_adjusted_base) * 100;
            ELSE
                v_investment_return := 0;
            END IF;

            v_adjusted_base := v_adjusted_base + v_cash_flow_impact;
        END IF;

        INSERT INTO daily_returns (
            date,
            portfolio_value,
            portfolio_daily_return,
            investment_return,
            cash_flow_impact,
            adjusted_base
        )
        VALUES (
            v_date,
            v_portfolio_value,
            v_portfolio_daily_return,
            v_investment_return,
            v_cash_flow_impact,
            v_adjusted_base
        )
        ON CONFLICT (date) DO UPDATE SET
            portfolio_value = EXCLUDED.portfolio_value,
            portfolio_daily_return = EXCLUDED.portfolio_daily_return,
            investment_return = EXCLUDED.investment_return,
            cash_flow_impact = EXCLUDED.cash_flow_impact,
            adjusted_base = EXCLUDED.adjusted_base;

        v_prev_value := v_portfolio_value;
        v_rows := v_rows + 1;
    END LOOP;

    RETURN v_rows;
END;
$$;
