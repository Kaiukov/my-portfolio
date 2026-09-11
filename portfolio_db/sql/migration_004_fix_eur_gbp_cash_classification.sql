-- Migration: fix EUR/GBP cash classification that produced a phantom +599.43 EUR
-- and +55.44 GBP in `portfolio_cash_sql()` (issue #368).
--
-- Root cause: since #362/#365 the cash bucket of a BUY/SELL row is derived from the
-- row's `currency` column (`cash_asset = COALESCE(NULLIF(currency,''), asset)`), not
-- from the instrument's market currency as before. Six legacy rows carry `currency = 'USD'`
-- while the instrument is listed in EUR/GBP, so their cash legs moved out of the
-- EUR/GBP buckets and into USD:
--
--   id 286 / 308  VGEU.DE  (VGEU.EU, IE00B945VV12, EUR fund)   -> -599.44 EUR
--   id 296 / 315 / 328  IGLN.L (SGLN.EU, IE00B4ND3602, GBP)    -> net of the buys
--   id 605        IGLN.L  SELL 18 @ 71.46 = 1 286.28 GBP       -> proceeds stayed in GBP
--
-- Two synthetic USD "reconciliation" inflows were written by earlier reconciliation
-- sessions to compensate exactly this drift; their sum equals the phantom and they
-- must be removed together with the reclassification, otherwise the phantom merely
-- changes bucket:
--
--   2351  2026-08-31  +618.39544  exchange `reconciliation-20260831-usd-fix`
--   2321  2026-07-22  + 35.50456  exchange `reconciliation-20260722-usd-fix`
--   -------------------------------------------------------------
--                     +653.90   = phantom (verified by simulation over the full ledger)
--
-- Row 2301 (+4.50482744) and row 2235 (+75.44) look similar but are legitimate: removing
-- them breaks the USD bucket (verified), so they are deliberately not touched.
--
-- Evidence: Freedom24 broker reports for both accounts (period 2025-12-31 -> 2026-09-11)
-- document EUR 18.84 / GBP 2.65 / USD 136.99; VGEU.EU is priced in EUR and the
-- SGLN.EU sale of 1 286.28 GBP is reported in GBP.
--
-- Idempotent: every statement is guarded by the offending row's full signature, so a
-- second execution updates 0 and deletes 0 rows.

-- 1) Non-USD-listed instrument legs settle in the instrument's market currency.
UPDATE transactions
   SET currency = 'EUR'
 WHERE id IN (286, 308)
   AND asset = 'VGEU.DE'
   AND upper(action) IN ('BUY', 'SELL')
   AND currency = 'USD';

UPDATE transactions
   SET currency = 'GBP'
 WHERE id IN (296, 315, 328, 605)
   AND asset = 'IGLN.L'
   AND upper(action) IN ('BUY', 'SELL')
   AND currency = 'USD';

-- 2) Drop the synthetic USD reconciliation inflows that only compensated the above.
DELETE FROM transactions
 WHERE id IN (2351, 2321)
   AND asset = 'USD'
   AND upper(action) = 'DEPOSIT'
   AND exchange IN ('reconciliation-20260831-usd-fix', 'reconciliation-20260722-usd-fix');

-- 3) Report the resulting cash buckets so the deploy log carries the verification.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT cash_key, currency, round(balance::numeric, 4) AS balance
          FROM portfolio_cash_sql(CURRENT_DATE)
         ORDER BY cash_key
    LOOP
        RAISE NOTICE 'cash % (%): %', r.cash_key, r.currency, r.balance;
    END LOOP;
    RAISE NOTICE 'expected after migration #368: EUR ~18.84 | GBP ~2.65 | USD ~183.11 (portfolio-specific)';
END
$$;
