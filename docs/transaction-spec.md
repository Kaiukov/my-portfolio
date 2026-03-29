# Transaction Specification

## Supported Actions

| Action | Group | Asset | Price | Quantity | Description |
|---|---|---|---|---|---|
| `BUY` | TRADE | Non-cash | Required, > 0 | > 0 | Purchase an asset; cash deducted automatically |
| `SELL` | TRADE | Non-cash | Required, > 0 | > 0 | Sell an asset; cash credited automatically |
| `DEPOSIT` | EXTERNAL_INFLOW | Cash | Forbidden | > 0 | External cash contribution (counts toward net_contributions) |
| `WITHDRAW` | EXTERNAL_OUTFLOW | Cash | Forbidden | > 0 | External cash withdrawal (counts toward net_contributions) |
| `TRANSFER` | TRANSFER | Cash | Forbidden | > 0 | Internal movement between accounts (does NOT count toward net_contributions) |
| `DIVIDEND` | INCOME | Cash | Forbidden | > 0 | Dividend income received |
| `INTEREST` | INCOME | Cash | Forbidden | > 0 | Interest income received |
| `FEE` | EXPENSE | Cash | Forbidden | > 0 | Brokerage or transaction fee paid |
| `TAX` | EXPENSE | Cash | Forbidden | > 0 | Tax payment on gains |
| `EXCHANGE_FROM` | SYSTEM | Cash | Forbidden | < 0 | Source leg of a currency exchange (system-created) |
| `EXCHANGE_TO` | SYSTEM | Cash | Forbidden | > 0 | Target leg of a currency exchange (system-created) |

`EXCHANGE_FROM` / `EXCHANGE_TO` are created automatically by the `exchange` CLI command and are not available as user-selectable actions.

---

## Validation Rules per Action

### TRADE (BUY, SELL)
- `asset` must be a non-cash asset (stock, crypto, ETF)
- `price` is required and must be > 0
- `quantity` must be > 0
- `fees` are optional

### EXTERNAL_INFLOW (DEPOSIT)
- `asset` must be a cash asset (`USD`, `EURUSD=X`, `GBPUSD=X`, etc.)
- `price` must be absent (null)
- `quantity` must be > 0

### EXTERNAL_OUTFLOW (WITHDRAW)
- Same rules as EXTERNAL_INFLOW

### TRANSFER
- TRANSFER represents an **internal movement between accounts** within the tracked portfolio universe
- `asset` must be a cash asset
- `price` must be absent (null)
- `quantity` must be > 0
- `account` is **required** — use it to identify the source or destination account (e.g. `broker_a`, `broker_b`)
- Does NOT count toward `net_contributions`; use `DEPOSIT` for external inflows

### INCOME (DIVIDEND, INTEREST)
- `asset` must be a cash asset
- `price` must be absent (null)
- `quantity` must be > 0

### EXPENSE (FEE, TAX)
- `asset` must be a cash asset
- `price` must be absent (null)
- `quantity` must be > 0

### SYSTEM (EXCHANGE_FROM)
- `asset` must be a cash asset
- `price` must be absent (null)
- `quantity` must be < 0 (deduction from source)

### SYSTEM (EXCHANGE_TO)
- `asset` must be a cash asset
- `price` must be absent (null)
- `quantity` must be > 0

---

## Effect on Portfolio Metrics

| Action | Holdings | Cash Balance | Deposits | Withdrawals | Net Contributions | Income | Fees/Taxes |
|---|---|---|---|---|---|---|---|
| BUY | +quantity asset, −cost cash | −cost | — | — | — | — | — |
| SELL | −quantity asset, +proceeds cash | +proceeds | — | — | — | — | — |
| DEPOSIT | +quantity cash | +quantity | +amount | — | +amount | — | — |
| WITHDRAW | −quantity cash | −quantity | — | +amount | −amount | — | — |
| TRANSFER | +quantity cash | +quantity | — | — | — | — | — |
| DIVIDEND | +quantity cash | +quantity | — | — | — | +amount | — |
| INTEREST | +quantity cash | +quantity | — | — | — | +amount | — |
| FEE | −quantity cash | −quantity | — | — | — | — | +amount |
| TAX | −quantity cash | −quantity | — | — | — | — | +amount |
| EXCHANGE_FROM | −|qty| source | −|qty| | — | — | — | — | — |
| EXCHANGE_TO | +qty target | +qty | — | — | — | — | — |

**net_contributions = deposits − withdrawals**

TRANSFER is intentionally excluded from net_contributions: it represents an internal movement of funds between accounts already within the tracked portfolio universe. Use DEPOSIT for external contributions.

---

## TRANSFER Semantics

TRANSFER is separate from DEPOSIT:

| | DEPOSIT | TRANSFER |
|---|---|---|
| Meaning | New money from outside | Movement between tracked accounts |
| Counted in TWR cash flows | Yes | No |
| Counted in net_contributions | Yes | No |
| Shown in cash balance | Yes | Yes |
| Shown in `cash` report | `deposits` field | `transfers_in` field |

When tracking a single account, use DEPOSIT for all external inflows. Use TRANSFER only when you have multiple accounts and want to record an internal movement without distorting return calculations.

---

## Account Dimension

Each transaction has an optional `account` field (VARCHAR). It is used to label which account a transaction belongs to. This is especially relevant for TRANSFER:

- `TRANSFER` with `account = "broker_b"` means: cash arrived from broker_b
- This field is informational for now; multi-account reporting is a future milestone

---

## Audit Fields

Each transaction row stores:

| Field | Type | Description |
|---|---|---|
| `created_at` | TIMESTAMP | Set automatically on insert |
| `updated_at` | TIMESTAMP | Set automatically on `edit` (null if never edited) |
| `account` | VARCHAR | Optional account label |

---

## Recalculation Behavior

After any write operation (add, edit, delete, exchange):

1. The earliest affected date is determined: `min(old_date, new_date)`
2. Daily returns from that date onward are deleted
3. Daily returns are recomputed from that date to today
4. `stale_data` state is set to `true` before recalc, `false` after success

For a new transaction appended at the latest date, only that date and forward needs recalculation (partial recalc). For a backdated transaction, all dates from the transaction date forward are recomputed (full recalc from that date).

---

## Supported Cash Assets

| Symbol | Currency | Notes |
|---|---|---|
| `USD` | US Dollar | Base currency |
| `EURUSD=X` | Euro | Yahoo Finance FX ticker |
| `GBPUSD=X` | British Pound | Yahoo Finance FX ticker |
| `UAHUSD=X` | Ukrainian Hryvnia | Yahoo Finance FX ticker |

All portfolio values are reported in USD. Non-USD cash positions are converted using the last available FX rate as of the reporting date.
