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
    v_asset_type TEXT;
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

    FOR v_date IN
        SELECT generate_series(v_min_date, v_max_date, interval '1 day')::date
    LOOP
        PERFORM verify_held_prices_sql(v_date);

        v_portfolio_value := COALESCE(portfolio_value_asof_sql(v_date), 0);

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

            IF v_prev_value > 0 THEN
                v_investment_return := ((v_portfolio_value - v_prev_value - v_cash_flow_impact) / v_prev_value) * 100;
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
