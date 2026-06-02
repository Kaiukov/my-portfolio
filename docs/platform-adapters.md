# Platform Adapters, Utilities, and CLI Discovery

> Adapter surface documentation for the portfolio project.
> Defines the adapters and utilities, their responsibilities, and the contracts they share.

### Changelog

| Date | Change |
|---|---|
| 2026-05-31 | Initial draft |
| 2026-06-02 | API + MCP write adapters implemented (#181); shared write layer + envelope parity |

---

## Core Principles

Every adapter and utility in this document respects these invariants:

1. **PostgreSQL is the financial source of truth.** PostgreSQL and `portfolio_db/sql/*` own financial data and calculations. TypeScript/Bun adapters only route, validate inputs, orchestrate commands, and emit JSON envelopes. No adapter duplicates or recomputes financial calculations. All metrics (TWR, CAGR, Sharpe, allocation %, cash balances, etc.) are computed by PostgreSQL functions and surfaced through the shared service layer.
2. **Adapters never duplicate calculations.** The shared service/use-case layer (defined in `CLAUDE.md` → "Architecture layers") owns all business logic. Adapters format and route only.
3. **Read paths use cached prices only.** No adapter triggers a Yahoo Finance call during a read command. Price fetching belongs exclusively to `repair_prices` and `sync` (explicit maintenance commands). The stale-price max-age (`STALE_MAX_AGE_DAYS = 5`) is enforced before every `recalculate` (see `docs/crontab-schedule.md` and issue #84).
4. **All adapters share one JSON envelope.** Every response follows `{"ok": true/false, "command": "...", "data": ..., "meta": {"generated_at": "...", "count": N}}` as defined in `docs/api-response-standardization-plan.md`. The TypeScript implementation lives in `portfolio-ts/src/response.ts`.
5. **No hidden network on read paths.** `verify_prices` is diagnostic (reads DB only). `health` is diagnostic (reads DB only). Read commands (`status`, `cash`, `allocation`, `summary`, `performance`, `mwr`, `transactions`, `report`, `widget`) never call external price providers.
6. **Mutation safety.** Every write command (`add`, `edit`, `delete`, `exchange`) restores state if recalculation fails. `--dry-run` available on `edit`, `delete`, `repair_prices`, `recalculate`.
7. **Secrets never live in backups, widgets, or Scriptable source code.** Env-vars only.

---

## 1. CLI Adapter

The TypeScript/Bun runtime (`portfolio` binary) is the only active CLI implementation. `PARITY.md` documents the parity history with the removed Python implementation.

### Command Groups

All commands are pure JSON. No plain text, no tables, no markdown output.

#### Read-only (never trigger network calls)

| Command | Description | Paginated |
|---|---|---|
| `status` | Portfolio value, total gain, net contributions | No |
| `cash` | Cash balances by currency with USD values | No |
| `allocation` | Asset allocation with percentages | No |
| `summary` | Per-position summary (shares, cost basis, gain) | No |
| `performance` | TWR, CAGR, Sharpe, MDD, benchmark comparison | No |
| `mwr` | Money-weighted return (XIRR) | No |
| `transactions` | Transaction list with date/asset/action/quantity/price | Yes (`--limit`, `--offset`, `--start-date`, `--end-date`) |
| `report` | Daily portfolio returns | Yes (`--limit`, `--offset`, `--start-date`, `--end-date`) |
| `health` | DB reachability, stale data, price coverage diagnostics | No |
| `verify_prices` | Price coverage diagnostics (read-only) | No |
| `widget` | Compact portfolio JSON (see `docs/widget-contract.md`) | No |

#### Mutations (auto-recalculate after write)

| Command | `--dry-run` | Requires `--confirm` |
|---|---|---|
| `add` | No | No |
| `edit` | Yes | No |
| `delete` | Yes (preview) | Yes |
| `exchange` | No | No |
| `migrate` | No | No (destructive) |

#### Maintenance / File-level

| Command | Network | Safe for cron | Notes |
|---|---|---|---|
| `repair_prices` | Yes (Yahoo Finance) | Yes | Fetches missing prices. `--dry-run` available. |
| `recalculate` | No | Yes | Cached prices only. Refuses if `prices_need_fetch` unless `--force`. `--dry-run` available. |
| `sync` | Yes | Yes | `daily_maintenance_check` → `repair_prices` → `recalculate`. Convenience wrapper. |
| `backup` | No | Yes | `pg_dump` subprocess. Local file output. |
| `init` | No | Yes | Verify DB schema ready. |

### JSON Envelope

See `docs/api-response-standardization-plan.md` §3 and `portfolio-ts/src/response.ts` for the canonical implementation.

```json
{
  "ok": true,
  "command": "<command-name>",
  "data": <payload>,
  "meta": {
    "generated_at": "2026-05-31T10:00:00Z",
    "count": <int|null>,
    "pagination": { ... }  // only on transactions, report
  }
}
```

Errors:
```json
{
  "ok": false,
  "command": "<command-name>",
  "error": { "code": "VALIDATION_ERROR", "message": "..." },
  "meta": { "generated_at": "...", "count": null }
}
```

### Anchoring

- Architecture layers: See `CLAUDE.md` → "Architecture layers" — CLI is the adapter layer, calls shared service layer, never owns business logic.
- JSON contract: See `docs/api-response-standardization-plan.md` for per-command payload shapes.
- Date format: `YYYY-MM-DD` (ISO 8601) primary, legacy `DD-MM-YYYY` accepted with deprecation warning.

---

## 2. API Adapter

HTTP access layer for dashboards, widgets, and trusted integrations. Implemented as a Bun-native adapter in `portfolio-ts/src/api/server.ts`.

### Scope

**Read and write.** All read-only CLI commands are available as GET endpoints. Write operations (`add`, `edit`, `delete`, `exchange`) are available via POST/PATCH/PUT/DELETE, reusing the same shared command functions as the CLI — no duplicated business logic.

### Read-Only Endpoints

Each returns the same JSON envelope as the CLI, reusing the same PostgreSQL-owned calculations. The data payload is identical to the CLI command's `data` field.

| Method | Endpoint | CLI equivalent | Description |
|---|---|---|---|
| GET | `/health` | `health` | DB reachability, stale data, price coverage |
| GET | `/status` | `status` | Portfolio value, total gain, net contributions |
| GET | `/summary` | `summary` | Per-position summary (shares, cost basis, gain) |
| GET | `/allocation` | `allocation` | Asset allocation with percentages |
| GET | `/cash` | `cash` | Cash balances by currency with USD values |
| GET | `/performance` | `performance` | TWR, CAGR, Sharpe, MDD, benchmark comparison |
| GET | `/mwr` | `mwr` | Money-weighted return (XIRR) |
| GET | `/verify_prices` | `verify_prices` | Price coverage diagnostics (read-only) |

Note: the read-only `transactions` command currently has no GET endpoint in server.ts — use the CLI for transaction listing. The `/ready` endpoint (GET) is a health-check probe, not a CLI command mapping.

### Query Parameters

Common parameters mapped from CLI flags:

| CLI flag | API query param | Applies to |
|---|---|---|
| `--as-of-date` | `?as_of_date=` | `status`, `summary`, `allocation`, `cash`, `performance`, `mwr` |
| `--benchmark` | `?benchmark=` | `performance` |
| `--from-date` | `?from_date=` | `performance` |
| `--period` | `?period=` | `performance` |
| `--max-age-days` | `?max_age_days=` | `health`, `verify_prices` |

### Write Endpoints

Write operations reuse the same shared command functions (`src/adapters/shared.ts`) and are dispatched through `WriteHandlers` (addTransaction, editTransaction, editDryRun, deleteTransaction, deletePreview, exchangeCurrency). Dry-run is supported on edit and delete via `?dry_run=true` / `{"dry_run": true}`. Delete requires `?confirm=true` / `{"confirm": true}`.

| Method | Endpoint | CLI equivalent | Required body fields |
|---|---|---|---|
| POST | `/transactions` | `add` | date, asset, action, quantity, exchange |
| PATCH | `/transactions/:id` | `edit` | id (in path) + at least one field to change |
| PUT | `/transactions/:id` | `edit` | Same as PATCH (both route through editTransaction) |
| DELETE | `/transactions/:id` | `delete` | id (in path); confirm required unless dry-run |
| POST | `/exchange` | `exchange` | date, fromAsset/by from_asset/by from, toAsset/by to_asset/by to, quantity, rate |

Optional fields for POST/PATCH/PUT bodies: price, currency, fees, feeCurrency (or fee_currency), account, dataSource (or data_source). See `portfolio-ts/src/api/server.ts` for the canonical field resolution logic.

### Rules

- Return the same JSON envelope shape as the CLI (`response.ts` / `docs/api-response-standardization-plan.md`).
- Reuse the shared service layer + `src/adapters/shared.ts` `WriteHandlers`. No calculation in the API adapter.
- Write routes delegate to the same `WriteHandlers` as the MCP adapter and the underlying `commands/*` modules.
- Authentication (API keys, JWT) is a deployment concern — the adapter must accept configurable middleware.
- Rate limiting and CORS are deployment concerns, not baked into the adapter.

### Implementation Notes

- The API adapter is a thin HTTP wrapper around the same service functions that `portfolio-ts` calls — no SQL imports.
- Uses Bun's built-in `Bun.serve` with no external framework dependency.
- The adapter maps HTTP params → service params without duplicating CLI argument parsing.
- Error handling is unified via `toWriteErrorEnvelope` from `src/adapters/shared.ts` (see §3.2).

---

## 3. MCP Adapter

MCP (Model Context Protocol) write adapter for AI-agent integration. Implemented in `portfolio-ts/src/mcp/adapter.ts`.

### Scope

**Write operations only** (read operations use the CLI or HTTP API). Exposes add/edit/delete/exchange as MCP-style tool calls, reusing the same shared `WriteHandlers` from `src/adapters/shared.ts` as the HTTP API.

### Write Tools

All tools return the same JSON envelope as the CLI and HTTP API (`response.ts`). The `mcpWrite(toolName, args, ctx)` function dispatches by tool name.

| Tool name | CLI equivalent | Required args | Optional args |
|---|---|---|---|
| `add_transaction` | `add` | date, asset, action, quantity, exchange | price, currency, fees, feeCurrency/fee_currency, account |
| `edit_transaction` | `edit` | id/transactionId/transaction_id/transId | date, asset, action, quantity, price, currency, fees, feeCurrency/fee_currency, exchange, dataSource/data_source, account, dry_run/dryRun/dry-run |
| `delete_transaction` | `delete` | id/transactionId/transaction_id/transId | dry_run/dryRun/dry-run, confirm |
| `exchange_currency` | `exchange` | date, fromAsset/from_asset/from, toAsset/to_asset/to, quantity, rate | — |

### Arg Aliases

MCP tools accept multiple key aliases per arg for client flexibility:

- `add_transaction`: `feeCurrency` or `fee_currency`
- `edit_transaction`: `id`, `transactionId`, `transaction_id`, or `transId`; `feeCurrency` or `fee_currency`; `dataSource` or `data_source`; `dry_run`, `dryRun`, or `dry-run`
- `delete_transaction`: same id aliases as edit; `dry_run`, `dryRun`, or `dry-run`
- `exchange_currency`: `fromAsset`, `from_asset`, or `from`; `toAsset`, `to_asset`, or `to`

### Rules

- Same `WriteHandlers` interface as the HTTP API — identical behavior for add, edit, delete, exchange.
- Dry-run supported on `edit_transaction` and `delete_transaction`.
- Delete requires `confirm: true` unless dry-run.
- Unknown tool name returns `{"ok": false, "error": {"code": "NOT_FOUND", "message": "..."}}`.

### 3.1 Success Envelope

Identical to CLI and HTTP API (see §1 JSON Envelope for shape). `command` field maps to the CLI command name (`"add"`, `"edit"`, `"delete"`, `"exchange"`), not the MCP tool name.

### 3.2 Error Mapping (all adapters)

Error handling is unified across CLI, HTTP API, and MCP via `src/adapters/shared.ts` `toWriteErrorEnvelope`:

| Error type | `error.code` | HTTP status (API) | CLI exit code |
|---|---|---|---|
| `ValidationError` | `"VALIDATION_ERROR"` | 400 | 1 |
| `NotFoundError` | `"NOT_FOUND"` | 404 | 1 |
| Any other error | `"INTERNAL_ERROR"` | 500 | 1 |

**Parity guarantee:** The same `toWriteErrorEnvelope` function is used by both the HTTP API (`server.ts:316`) and the MCP adapter (`adapter.ts:172`). CLI errors follow the same code/message conventions internally. All three adapters produce structurally identical `ErrorEnvelope` JSON.

---

## 4. Dashboard Adapter

Future read-only UI for mobile, desktop, and web.

### Screens

Each screen maps to one or more read-only endpoints/CLI commands.

| Screen | Data source | Notes |
|---|---|---|
| Overview | `status`, `summary` | Portfolio value, total gain, quick stats |
| Allocation | `allocation` | Donut/treemap chart + table |
| Cash | `cash` | Per-currency balances with USD values |
| Performance | `performance`, `mwr` | Return charts, risk metrics, benchmark overlay |
| Transactions | `transactions` | Paginated transaction list with filters |
| Health | `health`, `verify_prices` | Operational status, price coverage |

### Rules

- **No financial calculations in frontend.** Every metric is pre-computed by PostgreSQL and served through the API/CLI JSON contract.
- **No direct price-provider calls from frontend.** All price data comes from the PostgreSQL cache.
- **Consume API/CLI-equivalent JSON only.** The dashboard is a pure consumer of the shared JSON envelope.
- **Stale data must be clearly indicated.** The dashboard must surface the `as_of_date` and `last_refresh` timestamps. If data is older than `STALE_MAX_AGE_DAYS` (5), show a warning banner.

### Technology

Not specified — the dashboard is frontend-agnostic. It could be a static site (Next.js, SvelteKit, Astro), a React Native app, or a simple HTML page that fetches from the API adapter.

---

## 5. Cron Jobs

Scheduled maintenance for prices and portfolio recalculation. The full existing schedule is documented in `docs/crontab-schedule.md`.

### Lifecycle

```
verify_prices ──→ repair_prices (when needed) ──→ recalculate ──→ health ──→ backup
```

### Job Descriptions

#### verify_prices (daily 07:00)

- **Type**: Diagnostic
- **Network**: No
- **Purpose**: Detect missing or stale price data before market open.
- **Output**: Coverage report with tickers, date ranges, and gap rows.
- **On failure**: Warnings only — does not block the day's operations.

#### repair_prices (Sunday 02:30, or on demand)

- **Type**: Remediation
- **Network**: Yes (Yahoo Finance)
- **Purpose**: Backfill missing or incomplete price data. Also fetches benchmark tickers (SPY) even if not in portfolio.
- **Stale-price guard**: `daily_maintenance_check()` runs first and enforces `STALE_MAX_AGE_DAYS = 5`.
- **On partial failure**: Failed tickers logged per-ticker in `repair_log`; other tickers continue.
- **Output**: Per-ticker fetch results, `refresh_log` entry, updated `service_state`.

#### recalculate (Mon–Fri 18:30, Sat 10:00, plus Sunday 03:00 with `--force`)

- **Type**: Calculation
- **Network**: No
- **Cached prices only**: Refuses if `prices_need_fetch` is true unless `--force`.
- **Purpose**: Rebuild `daily_returns` table from cached prices.
- **Output**: Rows affected, updated `refresh_log` + `service_state`.

#### health (daily 07:05, after verify)

- **Type**: Operational check
- **Network**: No
- **Purpose**: Confirm DB reachable, recalc fresh, price coverage OK.
- **Output**: Health envelope with signal booleans.
- **On failure**: Should trigger alerting (external — not part of this project).

#### backup (daily 02:00)

- **Type**: Snapshot
- **Network**: No
- **Purpose**: `pg_dump` snapshot before daily operations.
- **Output**: Backup file path, size.
- **Future**: S3 upload variant (see §5).

### Rules

- All cron output must be JSON-friendly (structured logs via `logger.py` or equivalent).
- `verify_prices` and `health` are diagnostic — never fail the job pipeline.
- `repair_prices` may fetch external data; all other jobs use cached data only.
- `recalculate --force` is the weekly safety net for cache drift.
- The lifecycle is sequential: each step depends on the previous one.

---

## 6. Backup Utility: S3-Compatable Backup

Extends the existing `backup` command (local `pg_dump` to file) with an S3-compatible upload variant.

### Command Shape

```
portfolio backup_s3 \
  --bucket portfolio-backups \
  --prefix my-portfolio \
  --format jsonl
```

| Flag | Required | Default | Description |
|---|---|---|---|
| `--bucket` | Yes | — | S3 bucket name |
| `--prefix` | No | `portfolio` | Key prefix for backup objects |
| `--format` | No | `jsonl` | Output format (jsonl or sql) |

### Environment Variables

```bash
PORTFOLIO_S3_ENDPOINT=      # Custom endpoint (e.g., MinIO, DigitalOcean Spaces)
PORTFOLIO_S3_REGION=         # AWS region (e.g., us-east-1)
PORTFOLIO_S3_BUCKET=         # Default bucket (overridable via --bucket)
PORTFOLIO_S3_ACCESS_KEY_ID=  # Access key
PORTFOLIO_S3_SECRET_ACCESS_KEY= # Secret key
PORTFOLIO_S3_PREFIX=         # Default prefix
```

### Backup Content

| Data | Required | Rationale |
|---|---|---|
| `transactions` | Yes | The minimal restore-able data set. Full portfolio state can be rebuilt from transactions + price data. |
| Schema version metadata | Yes | Version tag so restore can verify compatibility. |
| `daily_returns` | No | Optional restore accelerator — rebuilding from transactions is safe but slow. |
| `price_cache` | No | Optional restore accelerator — prices can be re-fetched via `repair_prices`. |

### Rules

- **Never store secrets in backup files.** No DB connection strings, no API keys, no S3 credentials.
- **Backup command must emit JSON** (same envelope as all other commands).
- **Upload failures must return explicit errors** with the failure reason.
- **Supabase users may rely on Supabase-managed backups** instead of S3. The `backup_s3` command is for self-hosted or hybrid setups.
- **Restore is a separate concern** — a `restore` command may be added later, but is out of scope for this spec.

### Implementation Notes

- Use the AWS SDK (`@aws-sdk/client-s3` for TypeScript).
- Prefer streaming upload (no local temp file for SQL format; for JSONL, stream directly).
- Should support S3-compatible stores: AWS S3, MinIO, DigitalOcean Spaces, Backblaze B2, Cloudflare R2.

---

## 7. iOS Widget via Scriptable

Lightweight read-only widget using the Scriptable iOS app. The widget fetches a JSON payload from the API adapter (or from a pre-generated file hosted on a server/cron).

### Existing Contract

The widget JSON contract is **already defined and implemented** at `docs/widget-contract.md` via the `portfolio-ts widget` command (issue #51, merged). This doc references it — it does not redefine it.

### Payload

See `docs/widget-contract.md` for the full shape. The payload is compact by design:

```json
{
  "title": "Portfolio",
  "currency": "USD",
  "as_of_date": "2026-05-30",
  "last_refresh": "2026-05-30",
  "value": 19257.13,
  "today": { "amount": 125.50, "pct": 0.65 },
  "total": { "amount": 4257.13, "pct": 28.3 },
  "series": [
    { "date": "2026-05-01", "value": 19000.00 }
  ]
}
```

### Stale Data Handling

- If `last_refresh` is more than `STALE_MAX_AGE_DAYS` (5) behind `as_of_date`, the Widget **must visually indicate stale data** (e.g., dimmed text, warning icon, red tint).
- The Scriptable widget code should check `as_of_date` vs current date and display a warning if the data is older than 1 market day.

### Rules

- **No transaction history in the widget.** The payload contains only aggregate data (value, gain, daily change).
- **No secrets in Scriptable source code.** The widget fetches from a public or authenticated URL — the URL itself is configured via Scriptable's settings UI (not hardcoded credentials).
- **Widget is read-only.** No write operations from Scriptable.
- **The widget can fetch from either** the API adapter (`GET /widget/ios` or similar) or from a pre-generated JSON file hosted at a static URL (e.g., S3). The latter avoids the need for a live API server.

### Future

- `GET /widget/ios` endpoint in the API adapter may serve the same payload with an `--as-of-date` query parameter.
- Widget auto-refresh (iOS 14+ widget refresh intervals) is a Scriptable concern, not a backend concern.

---

## 8. AI-Friendly CLI Command Discovery

Machine-readable command discovery so AI agents can determine which command to use without reading markdown docs.

### Commands

#### `portfolio commands`

Returns a JSON catalog of all available commands.

```json
{
  "ok": true,
  "command": "commands",
  "data": [
    {
      "name": "status",
      "group": "read-only",
      "description": "Current portfolio value, total gain, net contributions",
      "network": false,
      "mutates_state": false,
      "requires_confirmation": false,
      "safe_for_cron": true,
      "common_next_commands": ["cash", "allocation", "performance"]
    },
    {
      "name": "add",
      "group": "mutation",
      "description": "Record a transaction and recalculate",
      "network": false,
      "mutates_state": true,
      "requires_confirmation": false,
      "safe_for_cron": false,
      "common_next_commands": ["status", "transactions"]
    },
    {
      "name": "repair_prices",
      "group": "maintenance",
      "description": "Fetch missing prices from Yahoo Finance",
      "network": true,
      "mutates_state": true,
      "requires_confirmation": false,
      "safe_for_cron": true,
      "common_next_commands": ["recalculate", "verify_prices"]
    }
  ],
  "meta": {
    "generated_at": "2026-05-31T10:00:00Z",
    "count": 20
  }
}
```

Catalog fields:

| Field | Type | Description |
|---|---|---|
| `name` | string | CLI command name |
| `group` | string | `"read-only"`, `"mutation"`, `"maintenance"`, `"file"` |
| `description` | string | One-line description |
| `network` | boolean | Whether the command may call external providers |
| `mutates_state` | boolean | Whether the command writes to the DB |
| `requires_confirmation` | boolean | Whether `--confirm` is required |
| `safe_for_cron` | boolean | Whether the command is safe to run unattended |
| `common_next_commands` | string[] | Commands often run after this one |

#### `portfolio command_info <name>`

Returns detailed metadata for a single command.

```json
{
  "ok": true,
  "command": "command_info",
  "data": {
    "name": "add",
    "group": "mutation",
    "description": "Record a transaction and recalculate",
    "network": false,
    "mutates_state": true,
    "requires_confirmation": false,
    "safe_for_cron": false,
    "common_next_commands": ["status", "transactions"],
    "inputs": [
      { "name": "date", "type": "string", "required": true, "format": "YYYY-MM-DD", "description": "Transaction date" },
      { "name": "asset", "type": "string", "required": true, "description": "Ticker symbol" },
      { "name": "action", "type": "string", "required": true, "values": ["BUY", "SELL", "DEPOSIT", "WITHDRAW", "DIVIDEND", "INTEREST", "FEE", "TAX", "TRANSFER"], "description": "Transaction action" },
      { "name": "quantity", "type": "number", "required": true, "description": "Number of units" },
      { "name": "price", "type": "number", "required": false, "description": "Price per unit (required for BUY/SELL)" },
      { "name": "currency", "type": "string", "required": false, "description": "Transaction currency (default: USD)" },
      { "name": "fees", "type": "number", "required": false, "description": "Transaction fees" },
      { "name": "exchange", "type": "string", "required": true, "description": "Exchange name" },
      { "name": "account", "type": "string", "required": false, "description": "Account label (required for TRANSFER)" }
    ],
    "output_shape": {
      "transaction": {
        "id": "number",
        "date": "string",
        "asset": "string",
        "action": "string",
        "quantity": "number",
        "asset_type": "string",
        "price": "number",
        "currency": "string",
        "fees": "number",
        "exchange": "string",
        "data_source": "string"
      },
      "recalculated": "boolean"
    }
  },
  "meta": {
    "generated_at": "2026-05-31T10:00:00Z",
    "count": null
  }
}
```

#### `portfolio suggest_command --goal "..."` (optional)

Intent → command mapper. Returns recommended commands for a natural-language goal.

```json
{
  "ok": true,
  "command": "suggest_command",
  "data": {
    "goal": "check if portfolio data is stale",
    "recommended_commands": [
      {
        "command": "health",
        "reason": "Checks DB reachability, stale state, and price coverage."
      },
      {
        "command": "verify_prices",
        "reason": "Shows detailed missing or stale price coverage."
      }
    ]
  },
  "meta": {
    "generated_at": "2026-05-31T10:00:00Z",
    "count": 2
  }
}
```

### Rules

- **This is command discovery, not a chat agent.** It does not execute suggested commands automatically.
- **It must not call network providers.**
- **It must not mutate portfolio state.**
- **It must be deterministic and testable.**
- The `suggest_command` feature is optional (Phase 2) — `commands` and `command_info` are the core discovery commands.

### Goal Mapping Table (for `suggest_command`)

| Goal pattern | Recommended commands |
|---|---|
| "check if data is stale" | `health`, `verify_prices` |
| "how is my portfolio doing" | `status`, `performance`, `cash` |
| "what are my returns" | `performance`, `mwr` |
| "add a transaction" | `add` |
| "fix missing prices" | `repair_prices`, `recalculate` |
| "daily maintenance" | `sync` |
| "show me widgets" | `widget` |
| "backup my data" | `backup`, `backup_s3` |

---

## Implementation Status

Per issue #98, the suggested implementation order. Completed items are marked.

1. ~~`portfolio commands` and `portfolio command_info` (AI-friendly discovery)~~ — **Not implemented** (superseded by MCP)
2. S3-compatible `backup_s3` — **Not implemented**
3. ~~Read-only API adapter~~ — **Done** (PR #102+, extended in #181)
4. Read-only dashboard MVP — **Not implemented**
5. iOS Scriptable widget endpoint/payload — **Not implemented** (the `widget` CLI command exists)
6. ~~Write API endpoints~~ — **Done** (#181)
7. ~~MCP write adapter~~ — **Done** (#181)

---

## Out of Scope

- Full implementation of all adapters in a single PR.
- Rewriting financial calculations in frontend/API/widget code.
- Adding new financial features, metrics, transaction types, or asset classes.
- Combining this with unrelated Python or TypeScript refactors.
- Breaking the current CLI JSON contract.

---

## Cross-References

| Document | Relation |
|---|---|
| `CLAUDE.md` | Architecture layers (persistence → service → adapters), command classification, financial correctness rules |
| `docs/api-response-standardization-plan.md` | JSON envelope spec, per-command payload shapes, pagination |
| `docs/widget-contract.md` | Existing widget JSON contract (issue #51, merged) |
| `docs/crontab-schedule.md` | Existing cron schedule, log files, install instructions |
| `docs/transaction-spec.md` | Transaction action semantics, validation rules, recalculation behavior |
| `docs/production-ready-plan.md` | Milestone history, completed items |
| `portfolio-ts/PARITY.md` | Command parity between Python and TypeScript implementations |
| `portfolio-ts/src/response.ts` | Canonical JSON envelope implementation |
| `portfolio-ts/src/api/server.ts` | HTTP API adapter (read + write routes) |
| `portfolio-ts/src/mcp/adapter.ts` | MCP write adapter (`mcpWrite`) |
| `portfolio-ts/src/adapters/shared.ts` | Shared `WriteHandlers` + `toWriteErrorEnvelope` (used by API + MCP) |
| `.agents/skills/my-portfolio-cli/SKILL.md` | Skill file for CLI change workflows |
