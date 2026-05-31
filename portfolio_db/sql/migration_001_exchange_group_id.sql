-- Migration: add exchange_group_id column to link EXCHANGE_FROM and EXCHANGE_TO legs.
-- Each exchange is a two-leg atomic event. exchange_group_id links both legs with a shared UUID.
-- Idempotent: safe to run multiple times on an existing DB.

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS exchange_group_id TEXT;

-- Re-apply functions/procedures that reference transactions.* to stay consistent
-- (the schema change is additive; functions use explicit column lists and are unaffected)
