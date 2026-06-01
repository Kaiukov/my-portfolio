# Exchange and Cash

## Currency Exchange

```bash
uv run portfolio exchange --from USD --to EURUSD=X --quantity 1000 --date 15-03-2026
```

Creates two system transactions:
- `EXCHANGE_FROM`: deducts source currency (negative quantity)
- `EXCHANGE_TO`: credits target currency (positive quantity)

## Validation

- FROM and TO must be cash-like
- FROM and TO must differ after normalization
- Quantity must be positive

## Cash Alias Normalization

| Raw Input | Normalized |
|---|---|
| USD | USD |
| CASH USD | USD |
| EURUSD=X | EURUSD=X |
| CASH EUR | EURUSD=X |
| GBPUSD=X | GBPUSD=X |
| CASH GBP | GBPUSD=X |
| UAHUSD=X | UAHUSD=X |

## Fee Currency

`add` and `edit` support `--fee-currency`. Defaults to `--currency`. Stored in `fee_currency` VARCHAR(10).

## Supported Cash Assets

USD (base), EURUSD=X, GBPUSD=X, UAHUSD=X. All values reported in USD.
