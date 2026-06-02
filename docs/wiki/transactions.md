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
- BUY/SELL: a 3-letter symbol is rejected only when it matches `ALLOWED_CURRENCIES` (`USD`, `EUR`, `GBP`, `UAH`, `JPY`, `CHF`, `CAD`, `AUD`, `HKD`, `SGD`) — use FX pair format (`EURUSD=X`) instead. Any other 3-letter ticker (IWM, SPY, QQQ, etc.) is accepted as a normal asset symbol.

## Date Format Trap

**All commands** accept ISO `YYYY-MM-DD` (primary). Legacy `DD-MM-YYYY` is still accepted on write commands with a deprecation warning.

```bash
# Read: YYYY-MM-DD
portfolio performance --as-of-date 2026-01-15

# Write: YYYY-MM-DD (DD-MM-YYYY also accepted, deprecated)
portfolio add --date 2026-01-15 --asset AAPL --action buy --quantity 10 --price 150 --exchange IB

# Exchange also uses YYYY-MM-DD
portfolio exchange --from USD --to EURUSD=X --quantity 1000 --date 2026-03-15
```

## Fee Currency

`add` and `edit` accept `--fee-currency`. Defaults to `--currency`. Stored in `fee_currency` VARCHAR(10).
