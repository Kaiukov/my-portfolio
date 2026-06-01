# Transactions

## Supported Actions

| Action | Group | Asset | Price | Quantity |
|---|---|---|---|---|
| BUY | TRADE | Non-cash | Required, > 0 | > 0 |
| SELL | TRADE | Non-cash | Required, > 0 | > 0 |
| DEPOSIT | EXTERNAL_INFLOW | Cash | Forbidden | > 0 |
| WITHDRAW | EXTERNAL_OUTFLOW | Cash | Forbidden | > 0 |
| TRANSFER | TRANSFER | Cash | Forbidden | > 0 |
| DIVIDEND | INCOME | Cash | Forbidden | > 0 |
| INTEREST | INCOME | Cash | Forbidden | > 0 |
| FEE | EXPENSE | Cash | Forbidden | > 0 |
| TAX | EXPENSE | Cash | Forbidden | > 0 |
| EXCHANGE_FROM | SYSTEM | Cash | Forbidden | < 0 |
| EXCHANGE_TO | SYSTEM | Cash | Forbidden | > 0 |

EXCHANGE_FROM/TO are created automatically by the `exchange` command.

## Validation

- BUY/SELL: non-cash asset, price > 0, quantity > 0, fees optional
- DEPOSIT/WITHDRAW: cash asset, no price, quantity > 0
- TRANSFER: cash asset, no price, quantity > 0, account required
- DIVIDEND/INTEREST: cash asset, no price, quantity > 0
- FEE/TAX: cash asset, no price, quantity > 0

## Date Format Trap

**Read/report commands** use `YYYY-MM-DD`. **Write/recalc commands** use legacy `DD-MM-YYYY`.

```bash
# Read: YYYY-MM-DD
uv run portfolio performance --as-of-date 2026-01-15

# Write: DD-MM-YYYY
uv run portfolio add --date 15-01-2026 --asset AAPL --action buy --quantity 10 --price 150 --exchange IB

# Exchange also uses DD-MM-YYYY
uv run portfolio exchange --from USD --to EURUSD=X --quantity 1000 --date 15-03-2026
```

## Fee Currency

`add` and `edit` accept `--fee-currency`. Defaults to `--currency`. Stored in `fee_currency` VARCHAR(10).

## Migration

The `migrate` command ingests semicolon-separated CSV with `DD-MM-YYYY` dates. Destructive: clears all existing transactions and daily_returns before import.
