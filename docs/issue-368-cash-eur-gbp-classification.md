# Issue #368 — phantom EUR/GBP cash in `portfolio_cash_sql()`

## Symptom

`cash` reported **€618.27** in `CASH EUR` and **£58.09** in `CASH GBP` while the broker
held **€18.84** and **£2.65** (Freedom24 accounts CY 1575211 + CY 1575609, 2026-09-11).
Cash and `portfolio_value` were overstated by **≈ $772**
(`599.43 × 1.16535 + 55.44 × 1.34581`).

## Root cause

Not a regression of the `v0.10.1 → v0.10.0` rollback — `portfolio_db/sql/functions.sql`
is byte-identical in both tags. The trigger was the 2026-08-24 deploy of #362/#365
(`fix: route crypto trades to stablecoin cash bucket`), which changed how the cash bucket
of a `BUY`/`SELL` row is derived:

```sql
-- before: bucket from the instrument (get_cash_key_for_asset_sql maps stock_eur → EURUSD=X)
-- after:
CASE WHEN upper(t.action) IN ('BUY','SELL') AND NOT is_cash_like_sql(t.asset)
     THEN COALESCE(NULLIF(t.currency, ''), t.asset)      -- bucket from the currency column
     ELSE t.asset END AS cash_asset
```

Six legacy rows carry `currency = 'USD'` while the instrument is listed in EUR/GBP, so
their cash legs silently moved out of the EUR/GBP buckets into USD:

| id | date | asset | action | cash leg | expected bucket | bucket after #365 |
|---|---|---|---|---|---|---|
| 286 | 2025-05-15 | VGEU.DE | BUY | −167.94 | EUR | USD |
| 308 | 2025-09-30 | VGEU.DE | BUY | −431.50 | EUR | USD |
| 296 | 2025-07-02 | IGLN.L | BUY | −391.30 | GBP | USD |
| 315 | 2025-10-17 | IGLN.L | BUY | −474.90 | GBP | USD |
| 328 | 2025-10-24 | IGLN.L | BUY | −475.52 | GBP | USD |
| 605 | 2026-02-07 | IGLN.L | SELL | +1286.28 | GBP | USD |

Net: `EURUSD=X` **+599.44**, `GBPUSD=X` **+55.44**, `USD` −455.55, `USDT` +199.33
(the USDT part is the intended #361 fix).

Two synthetic USD reconciliation inflows had been written by earlier sessions to
compensate exactly this drift, so the phantom was parked in EUR/GBP instead of USD:

```
2351  2026-08-31  +618.39544   exchange reconciliation-20260831-usd-fix
2321  2026-07-22  + 35.50456   exchange reconciliation-20260722-usd-fix
--------------------------------------------------------------
                  +653.90      = the phantom
```

## Evidence

1. **Official broker reports** (both accounts, period 2025-12-31 → 2026-09-11) document
   `EUR 10.95 / GBP 2.65 / USD 73.49` and `EUR 7.89 / USD 63.50`, i.e. €18.84 / £2.65 total.
   `VGEU.EU` (IE00B945VV12) is priced in EUR; the `SGLN.EU` sale (IE00B4ND3602, portfolio
   `IGLN.L`) is reported as `18 @ 71.460000 = 1 286.28 GBP` with GBP cash flow `−8.46`.
2. **Deterministic simulation** over the full ledger (287 transactions, restored production
   `pg_dump`, PostgreSQL 17.7): the pre-#365 formula reproduces the 2026-08-21 snapshot
   (EUR 18.83 / GBP 2.65 — the values that matched the broker screenshots), the #365 formula
   reproduces the live MCP output exactly (618.27 / 58.09 / 182.13 / 2 292.79).
   Applying the change set below lands `EUR 18.83 / GBP 2.65 / USD 183.11`,
   `portfolio_value` 20 386.36 → 19 614.16, with all positions unchanged.

## Fix

1. **Data** — `portfolio_db/sql/migration_004_fix_eur_gbp_cash_classification.sql`
   (idempotent): reclassify ids 286/308 → `EUR`, 296/315/328/605 → `GBP`, delete the two
   synthetic reconciliation rows 2351/2321. Rows 2301 and 2235 look similar but are
   legitimate (removing them breaks `USD`), so they are untouched.
2. **Guard** — `warnOnQuoteCurrencyMismatch()` in `portfolio-ts/src/validators.ts`, wired
   into `add` and `edit`. Warns when a `BUY`/`SELL` records a currency that contradicts the
   instrument's market suffix (`.DE` → EUR, `.L` → GBP, `.T` → JPY, `.SW` → CHF,
   `.TO` → CAD, `.AX` → AUD, `.HK` → HKD, `.SG` → SGD). It warns rather than throws: a
   foreign listing can legitimately settle in another currency (e.g. crypto settled in
   USDT, the #361 case), so a hard error would break valid writes.

The SQL precedence itself is intentionally **not** changed — preferring the market currency
over `currency` unconditionally would break legitimate cases, e.g. a USD-listed instrument
traded in EUR.

## Verification

- Migration applied to a fresh restore of the production dump: before
  `618.27 / 58.09 / 182.13` → after `18.83 / 2.65 / 183.11`, `portfolio_value` 19 614.16,
  285 transactions; a second run reports `UPDATE 0 / UPDATE 0 / DELETE 0` (idempotent).
- Regression battery over 20 read models (pre-fix vs post-fix databases): only the expected
  fields move — `deposits` −653.90, `cost_basis` +94.93, `unrealized` −94.93,
  `realized` −11.81, `fees` +2.12, `cash_pct` 17.48 % → 14.23 %. Positions, `income` and
  `transactions` (other than the two deletions) are unchanged.
- `warnOnQuoteCurrencyMismatch` covered by `portfolio-ts/tests/instrument_currency.test.ts`.

## Residuals / follow-ups

- USDT is +0.87 against the Binance screenshot (0.04 %) — likely a stale screenshot or an
  unrecorded Earn accrual.
- Realized P&L on the gold sale: broker reports **+269.64 GBP** (≈ $362.9) while the
  portfolio computes **−$67.25**. Broker-implied cost basis is 1 016.64 GBP / 18 units
  = 56.48 GBP/unit, versus the recorded purchases 64.80 / 79.15 / 78.84 → the 2025
  purchase prices for `SGLN.EU` / `IGLN.L` need a broker statement review.
- `portfolio_status_sql` returns `portfolio_value` 20 386.36 while MCP `status` returned
  20 320.61 → $65.75 gap (price vintage vs adapter-side calculation).
- Pre-existing and unrelated: `portfolio_correlation_matrix_sql()` raises
  `structure of query does not match function result type` — tracked separately (#369).

## Post-fix reconciliation (local practice copy, 2026-09-11)

After `migration_004` the local copy was reconciled item by item against the three
external sources:

| Asset | Portfolio | External | Diff | Status |
|---|---|---|---|---|
| USD | 183.11000000 | 183.16000000 | −0.05 | ROUNDING (0.03 %) |
| EUR | 18.83000000 | 18.84000000 | −0.01 | ROUNDING (0.05 %) |
| GBP | 2.65000000 | 2.65000000 | 0 | OK |
| USDC | 289.28500635 | 289.28500635 | 0 | OK |
| USDT | 2291.91551688 | 2291.91551688 | 0 | OK |
| SCHD / SPYM / SPCX / SGOV / XLU / VGIT / VGEU.DE / VWRP.L / IGLN.L | exact | exact | 0 | OK |
| ETH | 0.19404725 | 0.19404725 | 0 | OK |
| BTC | 0.02302429 | 0.02302620 | −0.00000191 | DUST (≈ $0.19) |
| WBETH | 0.05750268 | 0.05750285 | −0.00000017 | DUST |
| BNB / PAXG | not tracked | 0.00053641 / 0.00007691 | — | DUST (≈ $0.53) |

`portfolio_value` after the fix and the USDT correction: **19 613.29 USD**, total cash
**2 789.82 USD** (external 2 789.87).

### USDT balance correction

The ledger's USDT bucket was **+0.87067516** above the exchange (spot 2291.15977282 +
funding 0.75574406 = 2291.91551688). The drift cannot be attributed to a specific ledger
row — it needs a Binance transaction-history export. It is therefore recorded as an
explicitly labelled correction, never as a silent balancing entry:

```
date 2026-09-11 | asset USDT | action WITHDRAW | quantity 0.87067516 | currency USD
exchange reconciliation-20260911-usdt-fix
```

### Residuals that are deliberately not "corrected"

- **EUR −0.01 / USD −0.05**: every external line item is rounded to two decimals, and the
  broker's own per-account arithmetic closes on those rounded numbers; the ledger carries
  the underlying fills. Forcing parity would require inventing cent-level rows.
- **BNB / PAXG / BTC / WBETH dust**: leftovers from rounded sells. Adding them to the
  ledger without also moving the corresponding cash would break the USD bucket, which is
  already 5 cents below the documents — the two residuals are coupled. Value ≈ $0.7
  (0.004 % of the portfolio) and below the configured dust threshold (#336).

### Income-line tie-out (why the last cents cannot be closed from these documents)

Bucket-level cash ties to within 6 cents, but the ledger's income lines are short of the
broker's aggregates, so the two together cannot be localised from a **grouped** report:

| Line | Ledger (2026, USD) | Broker reports | Diff |
|---|---|---|---|
| Gross dividends | 112.86 | 115.33 (78.41 + 36.92) | −2.47 |
| Withheld tax | 12.00 | 13.69 (8.15 + 5.54) | −1.69 |
| Net dividends | 100.86 | 101.64 | **−0.78** |
| EUR dividends | 13.48 (2.54 + 10.94) | 15.83 | **−2.35** |

≈ $3.5 (€ + $) of income is missing from the ledger, absorbed elsewhere so the buckets still
tie to 6 cents. Both broker reports list every income/trade line as `Grouped` with no
per-transaction detail and the Binance balances come from screenshots, so the exact rows
cannot be identified from the available documents. Closing this needs:

1. a **non-grouped Freedom24 statement** (per-dividend / per-trade lines) for both accounts;
2. a **Binance transaction-history export** (CSV), which would also replace the labelled USDT
   correction with the real row;
3. a **Revolut statement** for the USD balance (currently taken from a screenshot).

### Income lines — what the Freedom24 e-mails proved

The broker's *reports* only print grouped lines, but its notification e-mails (Gmail) carry the
individual credits. Cross-check against the ledger:

- **7 dividends for CY 1575211 in Jun–Sep 2026 tie to the cent**: VGIT 3.68 (record 2026-06-01),
  SPYM 5.25 (06-12), SCHD 1.52 (06-24), VGIT 3.70 + SGOV 7.67 (08-03), VGIT 3.92 + SGOV 7.68
  (09-01) — all present with identical amounts.
- **Account attribution confirmed**: the two large SCHD rows 17.73 (2026-03-31) + 19.19
  (2026-06-24) = **36.92** = exactly the broker's CY 1575609 dividend total for the period,
  so the remaining USD dividend rows (75.94) belong to CY 1575211 against a documented **78.41**.
- **Applied, cash-neutral — €2.35 dividend restored.** VGEU.EU 2.35 EUR (record date 2025-12-19,
  paid 2026-01-07, 0.167559 EUR × 14 shares) was missing from the ledger. It is now recorded and
  the same 2.35 EUR is re-attributed out of the unexplained `reconciliation-20260704` deposit
  (id 2298), so **no cash bucket moves**: EUR dividend income 2026 is now **15.83 = the broker's
  figure exactly** (was 13.48).
- **Open — USD.** The e-mails document two VGIT credits absent from the ledger: **2.87 USD**
  (record date 2026-02-02) and **3.32 USD** (2026-03-02). But the CY 1575211 dividend rows are only
  **2.47 USD** short of the broker's aggregate (75.94 vs 78.41), so adding both would overshoot by
  3.72 — one of them (or another row) must already be represented under a different label.
  Splitting this requires the non-grouped statement, so **no USD income row was added**; forcing it
  from the current evidence would break the aggregate tie.

## Rollout

DEV/practice copy first (`pg_dump` → migrate → verify the five cash buckets), then PROD on
explicit approval, then `recalculate` and read-back of `cash` / `status` / `allocation`.
