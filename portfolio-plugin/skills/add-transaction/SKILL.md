---
name: portfolio-add-transaction
description: When the user needs to add, edit, delete, or exchange portfolio transactions using the CLI.
---

# Portfolio CLI — Transactions

## Transaction Types

Supported actions: `BUY`, `SELL`, `DEPOSIT`, `WITHDRAW`, `TRANSFER`, `DIVIDEND`, `INTEREST`, `FEE`, `TAX`.

Currency exchange uses the dedicated `portfolio exchange` command.

## Ticker Conventions

| Type | Example | Notes |
|------|---------|-------|
| US equities | `AAPL`, `VTI`, `SPY` | Standard ticker |
| Crypto | `BTC-USD` | Yahoo Finance pair format |
| Forex | `EURUSD=X` | Yahoo Finance FX format |
| Mutual funds | `VFIAX` | Standard ticker |

## Add a Transaction

`--exchange` is required:

```bash
portfolio add --date 2026-01-01 --asset AAPL --action BUY \
  --quantity 10 --price 150 --exchange Interactive
```

## Edit a Transaction

Use `--id` to target:

```bash
portfolio edit --id 42 --price 155.50
portfolio edit --id 42 --dry-run   # Preview changes
```

## Delete a Transaction

`--confirm` is required (unless `--dry-run`):

```bash
portfolio delete --id 42 --confirm
portfolio delete --id 42 --dry-run   # Preview what would be deleted
```

## Currency Exchange

Two linked transactions — `--rate` is the from→to FX rate:

```bash
portfolio exchange --date 2026-01-01 \
  --from USD --to EURUSD=X \
  --quantity 1000 --rate 0.92
```

## Stock Split

```bash
portfolio split --date 2026-01-01 --asset AAPL --ratio 4 --confirm
```

## Date Format

Primary: `YYYY-MM-DD`. Legacy `DD-MM-YYYY` is accepted on write commands with a stderr deprecation warning.
