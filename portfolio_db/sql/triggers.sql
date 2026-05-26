-- Portfolio database triggers
-- Automatic update of metadata columns (updated_at)

-- Trigger function: update updated_at on modification
CREATE OR REPLACE FUNCTION update_timestamp_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

-- Trigger on transactions table: auto-update updated_at on INSERT/UPDATE
CREATE TRIGGER transactions_update_timestamp
BEFORE UPDATE ON transactions
FOR EACH ROW
EXECUTE FUNCTION update_timestamp_trigger();

-- Trigger on refresh_log table: auto-update timestamp on INSERT
CREATE TRIGGER refresh_log_update_timestamp
BEFORE INSERT ON refresh_log
FOR EACH ROW
EXECUTE FUNCTION update_timestamp_trigger();

-- Trigger on recalc_cache table: auto-update timestamp on INSERT/UPDATE
CREATE TRIGGER recalc_cache_update_timestamp
BEFORE UPDATE ON recalc_cache
FOR EACH ROW
EXECUTE FUNCTION update_timestamp_trigger();

-- Trigger on service_state table: auto-update updated_at on INSERT/UPDATE
CREATE TRIGGER service_state_update_timestamp
BEFORE INSERT ON service_state
FOR EACH ROW
WHEN (NEW.updated_at IS NULL)
EXECUTE FUNCTION update_timestamp_trigger();

CREATE TRIGGER service_state_update_timestamp_on_update
BEFORE UPDATE ON service_state
FOR EACH ROW
EXECUTE FUNCTION update_timestamp_trigger();

-- Trigger on repair_log table: auto-update timestamp on INSERT
CREATE TRIGGER repair_log_update_timestamp
BEFORE INSERT ON repair_log
FOR EACH ROW
EXECUTE FUNCTION update_timestamp_trigger();
