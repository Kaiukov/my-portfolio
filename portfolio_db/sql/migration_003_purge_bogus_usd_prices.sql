-- Migration: purge bogus USD price rows caused by Yahoo Finance ticker collision.
-- The "USD" ticker on Yahoo Finance resolves to ProShares Ultra Semiconductors ETF,
-- not the US Dollar. These bogus rows (fetched before the isYahooFetchable guard was
-- added in #241) polluted the correlation/diversification analytics. The correct
-- base-currency price series lives under ticker "CASH USD" (all 1.0).
-- Idempotent: safe to re-run — a second execution deletes 0 rows.

DELETE FROM prices WHERE ticker = 'USD' AND price <> 1.0;
