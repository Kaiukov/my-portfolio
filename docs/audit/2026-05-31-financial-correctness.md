# Portfolio Financial Correctness Audit Findings

Scope: read-only audit of PostgreSQL-first portfolio CLI financial math and TypeScript adapter flows.

Workspace: `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit`

Result: no source files were modified. `git status --short` was clean after the audit. SQL probes used temporary tables inside explicit `BEGIN ... ROLLBACK`; each rollback was confirmed.

## Scenario 1: ADD Transaction + Fee - BUY and SELL Fees

### Finding 1.1 - BLOCKER - Crypto/non-fiat `fee_currency` is valued through different tickers in different paths

References:

- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:303` - `discover_required_tickers_sql()` maps non-fiat fee currencies to `fee_currency || '-USD'`, e.g. `BTC-USD`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:422` - FIFO chooses bare `fee_currency` for conversion, e.g. `BTC`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:430` - BUY FIFO lot cost adds `cash_amount_to_usd_sql(tx.fee_currency, fees, date)`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:438` - SELL FIFO proceeds subtract `cash_amount_to_usd_sql(tx.fee_currency, fees, date)`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:530` - status fees total uses `cash_amount_to_usd_sql(COALESCE(fee_currency, currency, 'USD'), fees, date)`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:637` - `portfolio_cash_sql()` maps non-fiat fee currency cash bucket to `fee_currency || '-USD'`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:654` - `portfolio_cash_sql()` subtracts the native fee quantity from that mapped fee cash bucket.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/procedures.sql:85` - daily returns holdings walk maps non-empty `fee_currency` to a fee cash key.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/procedures.sql:88` - non-fiat fee currencies become `tx.fee_currency || '-USD'`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/add.ts:100` - TypeScript adapter persists `fees`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/add.ts:101` - TypeScript adapter persists `feeCurrency`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/cli.ts:182` - CLI accepts `--fee-currency`.

Expected:

For `BUY 1 AAPL @ 100 USD`, fee `0.0001 BTC`, with `BTC-USD=50000`, all valuation paths should agree:

- USD cash movement: `-100`
- BTC fee cash movement: `-0.0001 BTC`
- BTC fee USD value: `0.0001 * 50000 = 5`
- FIFO cost basis: `100 + 5 = 105`
- status `fees`: `5`
- portfolio value on trade date with `AAPL=100`: `AAPL 100 - USD 100 - BTC fee 5 = -5` if no deposit exists

Actual:

The daily returns holdings walk and `portfolio_cash_sql()` use `BTC-USD` for the fee bucket and can value the fee correctly if `BTC-USD` exists in `prices`.

`portfolio_fifo_metrics_sql()` and `portfolio_status_sql()` pass bare `BTC` into `cash_amount_to_usd_sql()`. That function treats `BTC` as a normal stock-like ticker and looks for a `prices.ticker='BTC'` row, while price discovery and repair load `BTC-USD`. With only the expected `BTC-USD` price present, the conversion returns `NULL`.

In the rollback-contained probe, `portfolio_cash_sql()` returned the correct fee cash value of `-5`, while `portfolio_fifo_metrics_sql()` errored:

```text
cash_amount_to_usd_sql('BTC', 0.0001, '2026-01-02')     = NULL
cash_amount_to_usd_sql('BTC-USD', 0.0001, '2026-01-02') = 5
portfolio_fifo_metrics_sql('2026-01-02') error:
null value in column "unit_cost_usd" of relation "fifo_lots" violates not-null constraint
```

Minimal reproduction:

```sql
BEGIN;

CREATE TEMP TABLE prices (LIKE public.prices INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE transactions (LIKE public.transactions INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE daily_returns (LIKE public.daily_returns INCLUDING ALL) ON COMMIT DROP;

INSERT INTO prices(date,ticker,price) VALUES
  ('2026-01-02','AAPL',100),
  ('2026-01-02','BTC-USD',50000);

INSERT INTO transactions(
  id,date,asset,action,quantity,asset_type,price,currency,
  fees,fee_currency,exchange,data_source,account
) VALUES (
  1,'2026-01-02','AAPL','BUY',1,'stock_usd',100,'USD',
  0.0001,'BTC','X','',NULL
);

SELECT
  cash_amount_to_usd_sql('BTC',0.0001,'2026-01-02') AS actual_bare_btc,
  cash_amount_to_usd_sql('BTC-USD',0.0001,'2026-01-02') AS expected_crypto_pair;

SELECT * FROM portfolio_cash_sql('2026-01-02');

SELECT * FROM portfolio_fifo_metrics_sql('2026-01-02');

ROLLBACK;
```

Rollback confirmation from the audit probe:

```sql
SELECT to_regclass('pg_temp.transactions') IS NULL AS temp_transactions_gone;
```

returned `true`.

### Finding 1.2 - MATCH - Fiat foreign trade fees are handled consistently in the tested path

References:

- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:615` - `portfolio_cash_sql()` keeps BUY trade cash separate when `fee_currency` differs from trade currency.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:621` - `portfolio_cash_sql()` keeps SELL proceeds separate when `fee_currency` differs from trade currency.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:637` - fee cash bucket mapping.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:430` - FIFO BUY fee conversion.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:438` - FIFO SELL fee conversion.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:530` - status fee conversion.

Expected:

For `BUY 1 AAPL @ 100 USD`, fee `2 EUR`, with `EURUSD=X=1.1`:

- USD cash: `-100`
- EUR cash: `-2`
- fee USD value: `2 * 1.1 = 2.20`
- FIFO cost basis: `102.20`
- status fees: `2.20`
- portfolio value without deposit and with `AAPL=100`: `100 - 100 - 2.20 = -2.20`

Actual:

The tested fiat foreign-fee path matched expected values:

```text
portfolio_value = -2.200000000000003
fees            = 2.2
cost_basis      = 102.2
cash EUR        = -2, usd_value = -2.2
cash USD        = -100
```

Minimal reproduction:

```sql
BEGIN;

CREATE TEMP TABLE prices (LIKE public.prices INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE transactions (LIKE public.transactions INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE daily_returns (LIKE public.daily_returns INCLUDING ALL) ON COMMIT DROP;

INSERT INTO prices(date,ticker,price) VALUES
  ('2026-01-02','AAPL',100),
  ('2026-01-02','EURUSD=X',1.1);

INSERT INTO transactions(
  id,date,asset,action,quantity,asset_type,price,currency,
  fees,fee_currency,exchange,data_source,account
) VALUES (
  1,'2026-01-02','AAPL','BUY',1,'stock_usd',100,'USD',
  2,'EUR','X','',NULL
);

SELECT refresh_daily_returns_sql('2026-01-02') AS rows_rebuilt;
SELECT portfolio_value, fees, cost_basis, realized_gain, unrealized_gain, total_profit
FROM portfolio_status_sql();
SELECT * FROM portfolio_cash_sql('2026-01-02') ORDER BY cash_key;

ROLLBACK;
```

### Finding 1.3 - MATCH - USD BUY/SELL fees flow through cash, FIFO cost basis, realized gain, fees, and snapshot totals

References:

- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/procedures.sql:97` - BUY adds asset quantity.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/procedures.sql:102` - BUY subtracts trade cash.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/procedures.sql:116` - BUY subtracts same-currency fee cash.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/procedures.sql:122` - SELL subtracts asset quantity.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/procedures.sql:127` - SELL credits proceeds cash.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/procedures.sql:141` - SELL subtracts same-currency fee cash.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:430` - FIFO BUY includes fee in lot cost.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:438` - FIFO SELL subtracts fee from proceeds.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:527` - status fees include standalone fees plus transaction `fees` columns.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:614` - cash BUY uses `quantity * price + fees` when same currency.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:621` - cash SELL uses `quantity * price - fees` when same currency.

Expected:

Fixture:

- Deposit `$1000`
- Buy `2 AAPL @ 100`, fee `$5`
- Sell `1 AAPL @ 150`, fee `$2`
- AAPL price on final date `$160`

Hand calculation:

- After BUY: cash `1000 - 200 - 5 = 795`, holdings `2 AAPL`
- BUY unit cost: `(200 + 5) / 2 = 102.50`
- SELL net proceeds: `150 - 2 = 148`
- Realized gain: `148 - 102.50 = 45.50`
- Remaining cost basis: `1 * 102.50 = 102.50`
- Final cash: `795 + 148 = 943`
- Final AAPL value: `1 * 160 = 160`
- Portfolio value: `943 + 160 = 1103`
- Unrealized gain: `160 - 102.50 = 57.50`
- Total profit: `45.50 + 57.50 = 103`
- Status fees: `5 + 2 = 7`
- Total gain vs net contributions: `1103 - 1000 = 103`

Actual:

The rollback-contained probe matched expected:

```text
portfolio_value = 1103
deposits        = 1000
fees            = 7
total_invested  = 1000
total_gain      = 103
cost_basis      = 102.5
realized_gain   = 45.5
unrealized_gain = 57.5
total_profit    = 103
cash USD        = 943
allocation AAPL = 1 share, value_usd 160
summary total_cash_usd = 943
summary portfolio_value_usd = 1103
```

Minimal reproduction:

```sql
BEGIN;

CREATE TEMP TABLE prices (LIKE public.prices INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE transactions (LIKE public.transactions INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE daily_returns (LIKE public.daily_returns INCLUDING ALL) ON COMMIT DROP;

INSERT INTO prices(date,ticker,price) VALUES
  ('2026-01-01','AAPL',100),
  ('2026-01-02','AAPL',150),
  ('2026-01-03','AAPL',160);

INSERT INTO transactions(
  id,date,asset,action,quantity,asset_type,price,currency,
  fees,fee_currency,exchange,data_source,account
) VALUES
  (1,'2026-01-01','USD','DEPOSIT',1000,'cash_base',NULL,'USD',NULL,NULL,'X','',NULL),
  (2,'2026-01-01','AAPL','BUY',2,'stock_usd',100,'USD',5,NULL,'X','',NULL),
  (3,'2026-01-02','AAPL','SELL',1,'stock_usd',150,'USD',2,NULL,'X','',NULL);

SELECT refresh_daily_returns_sql('2026-01-01') AS rows_rebuilt;
SELECT date, round(portfolio_value::numeric,2) AS portfolio_value
FROM daily_returns
WHERE date IN ('2026-01-01','2026-01-02','2026-01-03')
ORDER BY date;
SELECT portfolio_value, deposits, withdrawals, income, fees, total_invested,
       total_gain, cost_basis, realized_gain, unrealized_gain, total_profit
FROM portfolio_status_sql();
SELECT * FROM portfolio_cash_sql('2026-01-03');
SELECT holding_count, total_cash_usd, portfolio_value_usd
FROM portfolio_summary_sql('2026-01-03');
SELECT asset, net_quantity, value_usd
FROM portfolio_allocation_sql('2026-01-03')
ORDER BY asset;

ROLLBACK;
```

## Scenario 2: DELETE Transaction

### Finding 2.1 - BLOCKER - Deleting one exchange leg leaves an orphaned cash leg and creates/destroys portfolio value

References:

- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/schema.sql:5` - `transactions` table has independent rows and no exchange group/link id.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/exchange.ts:70` - exchange inserts `EXCHANGE_FROM`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/exchange.ts:85` - exchange inserts `EXCHANGE_TO`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/delete.ts:62` - delete fetches only one transaction id.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/delete.ts:74` - delete starts a DB transaction.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/delete.ts:75` - delete removes only the requested row.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/delete.ts:76` - delete recalculates from the deleted row date.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/procedures.sql:147` - `EXCHANGE_TO` increases target cash.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/procedures.sql:155` - `EXCHANGE_FROM` applies source cash delta.

Expected:

An exchange is a two-leg atomic financial event. Deleting one leg should either:

- delete both linked legs, or
- reject deletion of a single system-created leg, or
- otherwise preserve value conservation.

Fixture:

- Deposit `$1000`
- Exchange from USD to EUR:
  - `EXCHANGE_FROM USD quantity -1000`
  - `EXCHANGE_TO EURUSD=X quantity 909.090909`
  - `EURUSD=X=1.1`

Expected portfolio value before delete: approximately `$1000`.

If deleting the exchange, expected portfolio value should become `$1000` USD cash, not `$2000`.

Actual:

Because there is no exchange group/link id and delete removes only one row, deleting the `EXCHANGE_FROM` leg leaves both:

- original USD cash from the deposit: `$1000`
- orphaned EUR leg worth approximately `$1000`

Probe result after deleting only the source leg:

```text
cash EURUSD=X balance = 909.0909090909, usd_value = 999.9999999999901
cash USD balance      = 1000,           usd_value = 1000
summary total_cash_usd       = 1999.99999999999
summary portfolio_value_usd  = 1999.99999999999
```

Minimal reproduction:

```sql
BEGIN;

CREATE TEMP TABLE prices (LIKE public.prices INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE transactions (LIKE public.transactions INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE daily_returns (LIKE public.daily_returns INCLUDING ALL) ON COMMIT DROP;

INSERT INTO prices(date,ticker,price)
VALUES ('2026-01-02','EURUSD=X',1.1);

INSERT INTO transactions(
  id,date,asset,action,quantity,asset_type,price,currency,
  fees,fee_currency,exchange,data_source,account
) VALUES
  (1,'2026-01-02','USD','DEPOSIT',1000,'cash_base',NULL,'USD',NULL,NULL,'X','',NULL),
  (2,'2026-01-02','USD','EXCHANGE_FROM',-1000,'cash_base',NULL,'',NULL,NULL,'to EUR','',NULL),
  (3,'2026-01-02','EURUSD=X','EXCHANGE_TO',909.0909090909,'cash_fx',NULL,'',NULL,NULL,'from USD','',NULL);

SELECT refresh_daily_returns_sql('2026-01-02') AS initial_rebuild;
SELECT * FROM portfolio_cash_sql('2026-01-02') ORDER BY cash_key;

DROP TABLE holdings;
DELETE FROM transactions WHERE id = 2;

SELECT refresh_daily_returns_sql('2026-01-02') AS after_delete_rebuild;
SELECT * FROM portfolio_cash_sql('2026-01-02') ORDER BY cash_key;
SELECT total_cash_usd, portfolio_value_usd
FROM portfolio_summary_sql('2026-01-02');

ROLLBACK;
```

The `DROP TABLE holdings` in the repro is only needed because the probe invokes `refresh_daily_returns_sql()` twice in one SQL transaction; the function creates a temp table named `holdings` with `ON COMMIT DROP`, so a second call in the same surrounding transaction conflicts unless the temp table is dropped manually.

### Finding 2.2 - MATCH - Delete rollback safety is correct for a single delete plus recalculation failure

References:

- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/tx.ts:5` - `runTx()` issues `BEGIN`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/tx.ts:8` - `runTx()` commits after successful callback.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/tx.ts:10` - `runTx()` catches errors.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/tx.ts:11` - `runTx()` rolls back on error.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/delete.ts:74` - delete wraps the delete and recalculation in `runTx()`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/delete.ts:75` - row deletion.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/delete.ts:76` - recalculation inside the same transaction.

Expected:

If `refresh_daily_returns_sql()` fails after the delete, the deleted transaction should be restored because the delete and recalc are in one DB transaction.

Actual:

The TypeScript adapter uses `runTx()` for delete, so a recalculation error throws and triggers `ROLLBACK`. I found no rollback-safety bug for the single-row delete operation itself.

Residual risk:

This does not address the orphaned exchange-leg bug in Finding 2.1. Rollback safety protects failed deletes, not successful deletion of the wrong unit of work.

## Scenario 3: EXCHANGE - Currency Exchange

### Finding 3.1 - MATCH - Normal cash-like exchange valuation conserves value when user rate and cached FX are consistent

References:

- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/exchange.ts:24` - date parsing.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/exchange.ts:25` - positive quantity validation.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/exchange.ts:26` - positive rate validation.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/exchange.ts:28` - raw same-asset validation.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/exchange.ts:37` - `from` cash-like validation via SQL.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/exchange.ts:41` - `to` cash-like validation via SQL.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/exchange.ts:57` - target amount equals `quantity * rate`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/exchange.ts:70` - source leg insert.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/exchange.ts:85` - target leg insert.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/exchange.ts:100` - recalculation after both legs.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/procedures.sql:147` - target leg increases target cash.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/procedures.sql:155` - source leg applies source cash delta.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:167` - cash USD conversion.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:181` - asset market value conversion.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:628` - cash snapshot includes `EXCHANGE_TO` as positive cash.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:630` - cash snapshot applies `EXCHANGE_FROM` quantity as stored.

Expected:

For `USD 1000 -> EUR 909.090909` with `EURUSD=X=1.1`, target value is:

```text
909.090909 * 1.1 = 999.9999999
```

Portfolio value should remain approximately `$1000`.

Actual:

The rollback-contained probe matched expected:

```text
daily_returns portfolio_value = 999.9999999999901
cash EURUSD=X balance = 909.0909090909
cash EURUSD=X usd_value = 999.9999999999901
summary total_cash_usd = 999.9999999999901
summary portfolio_value_usd = 999.9999999999901
```

Minimal reproduction:

```sql
BEGIN;

CREATE TEMP TABLE prices (LIKE public.prices INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE transactions (LIKE public.transactions INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE daily_returns (LIKE public.daily_returns INCLUDING ALL) ON COMMIT DROP;

INSERT INTO prices(date,ticker,price)
VALUES ('2026-01-02','EURUSD=X',1.1);

INSERT INTO transactions(
  id,date,asset,action,quantity,asset_type,price,currency,
  fees,fee_currency,exchange,data_source,account
) VALUES
  (1,'2026-01-02','USD','DEPOSIT',1000,'cash_base',NULL,'USD',NULL,NULL,'X','',NULL),
  (2,'2026-01-02','USD','EXCHANGE_FROM',-1000,'cash_base',NULL,'',NULL,NULL,'to EUR','',NULL),
  (3,'2026-01-02','EURUSD=X','EXCHANGE_TO',909.0909090909,'cash_fx',NULL,'',NULL,NULL,'from USD','',NULL);

SELECT refresh_daily_returns_sql('2026-01-02') AS rows_rebuilt;
SELECT date, portfolio_value
FROM daily_returns
WHERE date='2026-01-02';
SELECT * FROM portfolio_cash_sql('2026-01-02') ORDER BY cash_key;
SELECT total_cash_usd, portfolio_value_usd
FROM portfolio_summary_sql('2026-01-02');

ROLLBACK;
```

### Finding 3.2 - MATCH - Reverse-quoted FX inversion is handled during price fetch

References:

- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/providers/yahoo.ts:9` - comment states Yahoo quotes selected FX pairs as foreign-currency-per-USD and stored prices are USD-per-foreign-currency.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/providers/yahoo.ts:11` - `REVERSE_QUOTED_FX` set starts.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/providers/yahoo.ts:12` - `JPYUSD=X` is reverse-quoted.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/providers/yahoo.ts:13` - `CHFUSD=X` is reverse-quoted.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/providers/yahoo.ts:14` - `CADUSD=X` is reverse-quoted.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/providers/yahoo.ts:15` - `AUDUSD=X` is reverse-quoted.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/providers/yahoo.ts:16` - `HKDUSD=X` is reverse-quoted.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/providers/yahoo.ts:17` - `SGDUSD=X` is reverse-quoted.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/providers/yahoo.ts:20` - internal-to-Yahoo ticker map starts.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/providers/yahoo.ts:22` - `JPYUSD=X` maps to Yahoo `JPY=X`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/providers/yahoo.ts:23` - `CHFUSD=X` maps to Yahoo `CHF=X`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/providers/yahoo.ts:24` - `CADUSD=X` maps to Yahoo `CAD=X`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/providers/yahoo.ts:55` - fetch uses mapped Yahoo ticker.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/providers/yahoo.ts:56` - `shouldInvert`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/providers/yahoo.ts:73` - stored price is `1 / close` for reverse-quoted pairs.

Expected:

Internal prices for JPY/CHF/CAD/AUD/HKD/SGD should be stored as USD per one foreign unit, matching `cash_amount_to_usd_sql()` and `asset_market_value_usd_sql()` expectations.

Actual:

The provider maps and inverts those pairs before inserting `prices`. I found no exchange valuation bug for reverse-quoted FX in this code path.

### Finding 3.3 - NIT - Equivalent cash assets are not normalized before `from != to` validation

References:

- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/exchange.ts:28` - compares raw uppercased `fromAsset` and `toAsset`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:38` - `normalize_cash_asset_sql()` exists.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:43` - `CASH USD` normalizes to `USD`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:61` - cash key helper exists.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:91` - default cash key is `USD`.

Expected:

`--from USD --to CASH USD` should be rejected as a same-cash-bucket exchange.

Actual:

The adapter only checks `params.fromAsset.toUpperCase() === params.toAsset.toUpperCase()`, so equivalent cash representations can pass the initial same-asset check.

Minimal reproduction:

```bash
portfolio-ts exchange \
  --date 2026-01-02 \
  --from USD \
  --to "CASH USD" \
  --quantity 100 \
  --rate 1
```

Expected: validation error because both sides normalize to the USD cash bucket.

Actual: raw string check does not catch this equivalence. Subsequent behavior depends on SQL `is_cash_like_sql()` and cash-key handling, but the intended `from != to` invariant is not enforced on normalized cash identity.

## Scenario 4: ADD Standalone FEE Transaction

### Finding 4.1 - SHOULD-FIX - Non-cash `FEE` transactions are accepted and then reported inconsistently

References:

- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/docs/transaction-spec.md:52` - `FEE`/`TAX` are expense actions.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/docs/transaction-spec.md:53` - expense asset must be cash.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/docs/transaction-spec.md:54` - expense price must be absent.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/docs/transaction-spec.md:55` - expense quantity must be positive.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/docs/transaction-spec.md:80` - `FEE` reduces cash and appears in fees/taxes.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/add.ts:34` - adapter validates asset symbol only with generic action rules.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/validators.ts:89` - bare ISO currency rejection applies only to BUY/SELL and does not require cash assets for FEE.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/procedures.sql:151` - `FEE` and `TAX` decrease the derived cash key by quantity.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:528` - status fee total includes `FEE` actions.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:529` - status converts `FEE` action amount with `cash_amount_to_usd_sql(t.asset, t.quantity, t.date)`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:629` - `portfolio_cash_sql()` subtracts standalone `FEE` quantity from the derived cash bucket.

Expected:

`FEE` asset must be cash-like. A malformed `FEE AAPL quantity 10` should be rejected before insert.

If accepted, all valuation paths would need to agree. With `AAPL=100`, there are two possible interpretations:

- if `quantity=10` means `$10 fee`, cash and status should both show `$10`;
- if `quantity=10 AAPL` means asset-denominated fee, holdings/cash and status should both show value `$1000`.

The transaction spec chooses the first interpretation and requires a cash asset.

Actual:

The malformed non-cash `FEE` is accepted by the adapter-level validation and then paths disagree:

- `refresh_daily_returns_sql()` and `portfolio_cash_sql()` derive the cash key from `AAPL`, which defaults to `USD`, and subtract only `10`, producing portfolio cash/value `-10`.
- `portfolio_status_sql()` converts `10 AAPL` through `cash_amount_to_usd_sql('AAPL', 10, date)`, producing `10 * 100 = 1000` in `fees`.

Probe result:

```text
daily_returns portfolio_value = -10
status portfolio_value        = -10
status fees                   = 1000
cash USD balance              = -10
cash USD usd_value            = -10
```

Minimal reproduction:

```sql
BEGIN;

CREATE TEMP TABLE prices (LIKE public.prices INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE transactions (LIKE public.transactions INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE daily_returns (LIKE public.daily_returns INCLUDING ALL) ON COMMIT DROP;

INSERT INTO prices(date,ticker,price)
VALUES ('2026-01-02','AAPL',100);

INSERT INTO transactions(
  id,date,asset,action,quantity,asset_type,price,currency,
  fees,fee_currency,exchange,data_source,account
) VALUES (
  1,'2026-01-02','AAPL','FEE',10,'stock_usd',NULL,'USD',
  NULL,NULL,'X','',NULL
);

SELECT refresh_daily_returns_sql('2026-01-02') AS rows_rebuilt;
SELECT date, portfolio_value
FROM daily_returns
WHERE date='2026-01-02';
SELECT portfolio_value, income, fees, total_invested
FROM portfolio_status_sql();
SELECT * FROM portfolio_cash_sql('2026-01-02');

ROLLBACK;
```

### Finding 4.2 - MATCH - Proper cash standalone FEE path reduces cash and appears in fees without corrupting cost basis

References:

- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/procedures.sql:151` - `FEE` decreases cash.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:528` - status sums standalone `FEE`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:424` - FIFO only processes BUY/SELL.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:628` - cash snapshot positive actions.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:629` - cash snapshot subtracts `FEE`.

Expected:

For `FEE USD 10`:

- USD cash decreases by `10`
- status `fees` increases by `10`
- FIFO cost basis, realized gain, unrealized gain are unaffected because no BUY/SELL is involved
- fee is not double-counted with BUY/SELL `fees` column unless both transaction types exist separately

Actual:

The SQL logic follows that model for cash-like FEE actions. The inconsistency in Finding 4.1 is caused by missing action-specific validation that allows non-cash assets into the FEE path.

Minimal reproduction:

```sql
BEGIN;

CREATE TEMP TABLE prices (LIKE public.prices INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE transactions (LIKE public.transactions INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE daily_returns (LIKE public.daily_returns INCLUDING ALL) ON COMMIT DROP;

INSERT INTO transactions(
  id,date,asset,action,quantity,asset_type,price,currency,
  fees,fee_currency,exchange,data_source,account
) VALUES (
  1,'2026-01-02','USD','FEE',10,'cash_base',NULL,'USD',
  NULL,NULL,'X','',NULL
);

SELECT refresh_daily_returns_sql('2026-01-02') AS rows_rebuilt;
SELECT portfolio_value, income, fees, total_invested,
       cost_basis, realized_gain, unrealized_gain, total_profit
FROM portfolio_status_sql();
SELECT * FROM portfolio_cash_sql('2026-01-02');

ROLLBACK;
```

Expected and actual for this valid cash case:

```text
cash USD = -10
fees = 10
cost_basis unaffected
realized_gain unaffected
unrealized_gain unaffected
```

## Scenario 5: ADD DIVIDEND and INTEREST

### Finding 5.1 - SHOULD-FIX - Non-cash DIVIDEND/INTEREST transactions are accepted and inflate income totals

References:

- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/docs/transaction-spec.md:47` - DIVIDEND/INTEREST are income actions.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/docs/transaction-spec.md:48` - income asset must be cash.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/docs/transaction-spec.md:49` - income price must be absent.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/docs/transaction-spec.md:50` - income quantity must be positive.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/docs/transaction-spec.md:78` - DIVIDEND increases cash and income.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/docs/transaction-spec.md:79` - INTEREST increases cash and income.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/add.ts:34` - adapter validates asset symbol only with generic action rules.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/validators.ts:89` - bare ISO currency rejection applies only to BUY/SELL and does not require cash assets for DIVIDEND/INTEREST.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/procedures.sql:147` - DIVIDEND/INTEREST increase the derived cash key by quantity.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:525` - status income sums DIVIDEND/INTEREST using `cash_amount_to_usd_sql(t.asset, t.quantity, t.date)`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:628` - `portfolio_cash_sql()` treats DIVIDEND/INTEREST as positive cash quantity.

Expected:

`DIVIDEND` and `INTEREST` assets must be cash-like. A malformed `DIVIDEND AAPL quantity 10` should be rejected before insert.

If a user records a `$10` dividend, expected values are:

- cash increases by `$10`
- income increases by `$10`
- deposits remain unchanged
- total invested remains unchanged
- cost basis remains unchanged

Actual:

The malformed non-cash `DIVIDEND` is accepted and paths disagree:

- `refresh_daily_returns_sql()` and `portfolio_cash_sql()` derive the cash key from `AAPL`, which defaults to USD, and add only `10`, producing cash/portfolio value `$10`.
- `portfolio_status_sql()` converts `10 AAPL` through `cash_amount_to_usd_sql('AAPL', 10, date)`, producing income `$1000` when `AAPL=100`.

Probe result:

```text
daily_returns portfolio_value = 10
status portfolio_value        = 10
status deposits               = 0
status withdrawals            = 0
status income                 = 1000
status fees                   = 0
status total_invested         = 0
cash USD balance              = 10
cash USD usd_value            = 10
summary total_cash_usd        = 10
summary portfolio_value_usd   = 10
```

This is not misclassified as a deposit/contribution; `deposits=0` and `total_invested=0`. The bug is that invalid non-cash income is accepted and income is inflated.

Minimal reproduction:

```sql
BEGIN;

CREATE TEMP TABLE prices (LIKE public.prices INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE transactions (LIKE public.transactions INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE daily_returns (LIKE public.daily_returns INCLUDING ALL) ON COMMIT DROP;

INSERT INTO prices(date,ticker,price)
VALUES ('2026-01-02','AAPL',100);

INSERT INTO transactions(
  id,date,asset,action,quantity,asset_type,price,currency,
  fees,fee_currency,exchange,data_source,account
) VALUES (
  1,'2026-01-02','AAPL','DIVIDEND',10,'stock_usd',NULL,'USD',
  NULL,NULL,'X','',NULL
);

SELECT refresh_daily_returns_sql('2026-01-02') AS rows_rebuilt;
SELECT date, portfolio_value
FROM daily_returns
WHERE date='2026-01-02';
SELECT portfolio_value, deposits, withdrawals, income, fees, total_invested
FROM portfolio_status_sql();
SELECT * FROM portfolio_cash_sql('2026-01-02');
SELECT holding_count, total_cash_usd, portfolio_value_usd
FROM portfolio_summary_sql('2026-01-02');

ROLLBACK;
```

The same issue applies to `INTEREST` because it shares the same SQL branches and action-spec rules as `DIVIDEND`.

### Finding 5.2 - MATCH - Proper cash DIVIDEND/INTEREST path increases cash and income, not deposits or cost basis

References:

- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:521` - status deposits only sum `DEPOSIT`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:523` - status withdrawals only sum `WITHDRAW`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:525` - status income sums `DIVIDEND` and `INTEREST`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:424` - FIFO only processes BUY/SELL.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/procedures.sql:147` - DIVIDEND/INTEREST increase cash.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/procedures.sql:184` - cash-flow impact calculation checks cash-like transactions.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/procedures.sql:186` - only `DEPOSIT` adds cash-flow impact.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/procedures.sql:188` - only `WITHDRAW` subtracts cash-flow impact.

Expected:

For valid `DIVIDEND USD 10` or `INTEREST USD 10`:

- cash increases by `10`
- status `income` increases by `10`
- `deposits` remains `0`
- `total_invested` remains unchanged
- FIFO cost basis is unaffected
- `cash_flow_impact` for TWR is not treated as a deposit or withdrawal

Actual:

The SQL logic follows that model for cash-like income. The inconsistency in Finding 5.1 is caused by missing action-specific validation that allows non-cash assets into income actions.

Minimal reproduction:

```sql
BEGIN;

CREATE TEMP TABLE transactions (LIKE public.transactions INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE daily_returns (LIKE public.daily_returns INCLUDING ALL) ON COMMIT DROP;

INSERT INTO transactions(
  id,date,asset,action,quantity,asset_type,price,currency,
  fees,fee_currency,exchange,data_source,account
) VALUES (
  1,'2026-01-02','USD','DIVIDEND',10,'cash_base',NULL,'USD',
  NULL,NULL,'X','',NULL
);

SELECT refresh_daily_returns_sql('2026-01-02') AS rows_rebuilt;
SELECT portfolio_value, deposits, withdrawals, income, fees, total_invested,
       cost_basis, realized_gain, unrealized_gain, total_profit
FROM portfolio_status_sql();
SELECT * FROM portfolio_cash_sql('2026-01-02');

ROLLBACK;
```

Expected and actual for this valid cash case:

```text
cash USD = 10
income = 10
deposits = 0
total_invested = 0
cost_basis unaffected
```

## Scenario 6: Snapshot Command Consistency - status, summary, allocation, cash

### Finding 6.1 - SHOULD-FIX - `status` cannot be pinned to the same `--as-of-date` as `cash`, `allocation`, and `summary`

References:

- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/cli.ts:126` - `status` command dispatch.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/cli.ts:127` - `status` calls `getStatus()` without parsing `--as-of-date`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/status.ts:35` - `getStatus()` has no as-of-date parameter.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/status.ts:39` - `getStatus()` calls `portfolio_status_sql()` with no argument.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:540` - `portfolio_status_sql()` chooses latest `daily_returns`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:542` - latest `daily_returns` source.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:543` - latest date ordering.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:548` - FIFO metrics are computed as of latest daily return date.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/cli.ts:390` - `cash` command dispatch.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/cli.ts:391` - `cash` parses `--as-of-date`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/cli.ts:397` - `allocation` command dispatch.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/cli.ts:398` - `allocation` parses `--as-of-date`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/cli.ts:404` - `summary` command dispatch.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/cli.ts:405` - `summary` parses `--as-of-date`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/cash.ts:27` - `getCash(asOfDate?)`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/cash.ts:31` - cash calls `portfolio_cash_sql($1)`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/allocation.ts:27` - `getAllocation(asOfDate?)`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/allocation.ts:31` - allocation calls `portfolio_allocation_sql($1)`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/summary.ts:22` - `getSummary(asOfDate?)`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio-ts/src/commands/summary.ts:26` - summary calls `portfolio_summary_sql($1)`.

Expected:

The project invariant says `status`, `cash`, `summary`, `allocation`, `performance`, and `mwr` must stay aligned to one reporting snapshot. For historical audits, the user should be able to compare:

```bash
portfolio-ts status --as-of-date 2026-01-02
portfolio-ts cash --as-of-date 2026-01-02
portfolio-ts allocation --as-of-date 2026-01-02
portfolio-ts summary --as-of-date 2026-01-02
```

and get one consistent reporting date.

Actual:

`cash`, `allocation`, and `summary` accept `--as-of-date` and call date-parameterized SQL functions.

`status` ignores any as-of-date flag because the CLI does not parse one for status, `getStatus()` has no parameter, and `portfolio_status_sql()` itself has no date parameter. It always chooses the latest row from `daily_returns`.

Minimal reproduction:

```bash
portfolio-ts cash --as-of-date 2026-01-02
portfolio-ts allocation --as-of-date 2026-01-02
portfolio-ts summary --as-of-date 2026-01-02
portfolio-ts status --as-of-date 2026-01-02
```

Expected:

All four commands report `as_of_date = 2026-01-02` and reconcile on the same portfolio/cash/holdings snapshot.

Actual:

`status` does not consume `--as-of-date`; it reports the latest `daily_returns` date. That can differ from the date used by `cash`, `allocation`, and `summary`.

### Finding 6.2 - MATCH - Current-date snapshot commands reconcile for the tested BUY/SELL fixture after recalculation

References:

- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:587` - `portfolio_cash_sql(DATE)`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:695` - `portfolio_allocation_sql(DATE)`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:777` - `portfolio_summary_sql(DATE)`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/functions.sql:493` - `portfolio_status_sql()`.
- `/Users/oleksandrkaiukov/Code/my-portfolio-cli-audit/portfolio_db/sql/procedures.sql:215` - daily returns insert/update.

Expected:

For the tested BUY/SELL fee fixture from Scenario 1:

- status `portfolio_value` should equal summary `portfolio_value_usd`
- summary `total_cash_usd` should equal cash total
- allocation rows should sum to the portfolio value

Actual:

The tested current/latest snapshot reconciled:

```text
status portfolio_value       = 1103
cash USD                     = 943
summary total_cash_usd       = 943
summary portfolio_value_usd  = 1103
allocation AAPL value_usd    = 160
allocation USD value_usd     = 943
allocation sum               = 1103
```

Minimal reproduction:

Use the Scenario 1.3 fixture and run:

```sql
SELECT portfolio_value, fees, total_gain, cost_basis, realized_gain, unrealized_gain, total_profit
FROM portfolio_status_sql();

SELECT * FROM portfolio_cash_sql('2026-01-03');

SELECT holding_count, total_cash_usd, portfolio_value_usd
FROM portfolio_summary_sql('2026-01-03');

SELECT asset, net_quantity, value_usd
FROM portfolio_allocation_sql('2026-01-03')
ORDER BY asset;
```

## Summary Table

| Scenario | Finding | Severity | Result |
|---|---|---:|---|
| 1. ADD BUY/SELL fee | Crypto/non-fiat `fee_currency` ticker mismatch between cash/daily returns and FIFO/status | BLOCKER | Confirmed bug |
| 1. ADD BUY/SELL fee | Fiat foreign `fee_currency` fixture | MATCH | No bug found |
| 1. ADD BUY/SELL fee | USD BUY/SELL fee fixture | MATCH | No bug found |
| 2. DELETE | Deleting one exchange leg orphans the other leg and creates/destroys value | BLOCKER | Confirmed bug |
| 2. DELETE | Rollback safety for delete plus recalc failure | MATCH | No bug found |
| 3. EXCHANGE | Normal cash-like exchange valuation with consistent FX | MATCH | No bug found |
| 3. EXCHANGE | Reverse-quoted JPY/CHF/CAD/AUD/HKD/SGD provider inversion | MATCH | No bug found |
| 3. EXCHANGE | Equivalent cash assets not normalized before `from != to` check | NIT | Confirmed validation gap |
| 4. Standalone FEE | Non-cash FEE accepted and fees total inflated | SHOULD-FIX | Confirmed bug |
| 4. Standalone FEE | Valid cash FEE reduces cash and appears in fees | MATCH | No bug found |
| 5. DIVIDEND/INTEREST | Non-cash income accepted and income total inflated | SHOULD-FIX | Confirmed bug |
| 5. DIVIDEND/INTEREST | Valid cash income increases cash/income, not deposits/cost basis | MATCH | No bug found |
| 6. Snapshot consistency | `status` has no `--as-of-date` and cannot align to historical snapshots | SHOULD-FIX | Confirmed reporting gap |
| 6. Snapshot consistency | Current-date tested snapshot reconciles after recalc | MATCH | No bug found |

