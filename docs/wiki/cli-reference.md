# CLI Reference

All commands emit JSON with this envelope:

```json
{"ok": true, "command": "...", "data": ..., "meta": {"generated_at": "...", "count": N}}
```

Errors: `{"ok": false, "command": "...", "error": {"code": "X", "message": "..."}, "meta": {...}}`

### Freshness Meta Fields

Snapshot commands (`status`, `summary`, `cash`, `allocation`, `performance`, `mwr`) include freshness metadata in the `meta` envelope:

| Field | Type | Always present | Description |
|---|---|---|---|
| `meta.needs_recalc` | boolean | Yes | `true` when prices were refreshed but daily returns are not yet recalculated |
| `meta.recalc_warning` | string | Only when `needs_recalc` is true | `"Prices were refreshed but daily returns are not recalculated — snapshot commands (status/summary/allocation/cash) and performance may report different values for this date. Run 'recalculate' to sync."` |
| `meta.prices_as_of` | string \| null | Yes | Most recent price date in the cache |
| `meta.price_age_days` | number \| null | Yes | Days since `prices_as_of` |
| `meta.stale` | boolean | Yes | `true` when missing price checkpoints or stale tickers exist |

When `needs_recalc` is true, snapshot commands and `performance` may disagree for that date until `recalculate` is run. See [Recalculation](recalculation.md) for details.

Dates: ISO `YYYY-MM-DD` is the primary format on all commands. Legacy `DD-MM-YYYY` is still accepted on write commands (`--date`, `--from-date`) with a deprecation warning.

## Read-Only Commands

Never trigger network calls: `report`, `transactions`, `status`, `allocation`, `cash`, `summary`, `performance`, `mwr`, `verify_prices`, `health`.

## Mutating Commands

Auto-recalculate after write: `add`, `edit`, `delete`, `exchange`. Maintenance commands `repair_prices` and `recalculate` also mutate state but belong to the maintenance group.

## File-Level Commands

`init`, `backup`.

## Common Options

### performance

```
--as-of-date TEXT    Snapshot date in YYYY-MM-DD
--benchmark TEXT     Benchmark ticker (default: SPY)
--from-date TEXT     Filter returns from this date (YYYY-MM-DD)
--period [1y|6m|3m|ytd]  Period filter
```

### add

```
--date TEXT         Transaction date in YYYY-MM-DD (required; legacy DD-MM-YYYY accepted, deprecated)
--asset TEXT        Asset or cash ticker (required)
--action TEXT       buy/sell/deposit/withdraw/dividend/interest/fee/tax/transfer (required)
--quantity FLOAT    Positive quantity (required)
--price FLOAT       Positive price (required for BUY/SELL)
--currency TEXT     Currency code (default: USD)
--fees FLOAT        Non-negative fee amount
--fee-currency TEXT Fee currency (defaults to --currency)
--exchange TEXT     Broker or exchange label (required)
--account TEXT      Account label (required for TRANSFER)
```

### edit

```
--id INTEGER        Transaction ID (required)
--dry-run           Show changes without applying
```

### delete

```
--id INTEGER        Transaction ID (required)
--confirm           Confirm deletion (required unless --dry-run)
--dry-run           Show what would be deleted
```

### exchange

```
--from TEXT         Source cash asset (required)
--to TEXT           Target cash asset (required)
--quantity FLOAT    Amount to exchange (required)
--date TEXT         Date in YYYY-MM-DD (required; legacy DD-MM-YYYY accepted, deprecated)
```

### repair_prices / recalculate

```
--dry-run           Show what would be done
--force             Bypass safety checks (recalculate only)
```

## Adapter Access

The same write operations are available via the HTTP API and MCP adapter, using identical JSON envelopes. See `docs/platform-adapters.md` for route/tool tables, shared write layer, and error-mapping parity.
