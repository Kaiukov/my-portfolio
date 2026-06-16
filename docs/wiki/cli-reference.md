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

### asset_analysis

```
--ticker TEXT        Yahoo Finance ticker to analyze
--asset TEXT         Alias for --ticker
--period TEXT        One of 1mo, 3mo, 6mo, ytd, 1y, 2y, 3y, 5y
--lookback-days INT  Explicit analysis window in calendar days (overrides --period)
--benchmark TEXT     Benchmark ticker for beta/capture/tracking metrics (default: ^GSPC)
--as-of-date TEXT    Analysis end date in YYYY-MM-DD
--risk-free-rate FLOAT  Annual decimal risk-free rate used by Sharpe/Sortino (default: 0.0425)
```

`asset_analysis` is a Yahoo-backed read path and does not require the ticker to exist in portfolio transactions or holdings. Success payloads include structured `data.warnings[]` and `data.errors[]` for partial-data conditions; adapter `meta` does not duplicate those warnings.
The echoed `data.request` also includes resolved `annualization_periods` so annualized metrics make their market-calendar assumption explicit.

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

Те же операции доступны через HTTP API и MCP adapter с идентичными JSON-конвертами.

- **MCP (канонический):** Streamable HTTP `http://<host>:8787/mcp` — [Connection Spec](mcp-connect-spec.md)
- **HTTP API:** RESTful endpoints на том же порту — [Platform Adapters](../platform-adapters.md)
- **Инструменты:** 23 read + 5 write — [MCP Reference](mcp-reference.md)
