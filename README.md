# my-portfolio

A TypeScript/Bun CLI for portfolio tracking, backed by PostgreSQL.

## Features

- **Pure JSON Output**: All commands emit JSON envelopes, making the CLI ideal for scripting, automation, and downstream integrations.
- **PostgreSQL Powered**: All financial data — transactions, daily returns, price cache, and FIFO cost basis — lives in PostgreSQL. The CLI never recomputes what the database already owns.
- **Deterministic Valuation**: Time-Weighted Return (TWR) is the primary portfolio return metric. Read commands consume cached prices and FX only; they never trigger network calls.
- **Comprehensive Tracking**: Supports standard trade actions (`BUY`, `SELL`), cash flows (`DEPOSIT`, `WITHDRAW`, `TRANSFER`), income (`DIVIDEND`, `INTEREST`), expenses (`FEE`, `TAX`), and currency exchanges.
- **Multi-Currency**: Base currency is USD, with FX-converted reporting and FIFO cost basis for international assets.

## Prerequisites

- [Bun](https://bun.sh) `>= 1.3` — the JavaScript/TypeScript runtime that executes the CLI directly from source. No build step is required.
- PostgreSQL `>= 14` — local install (e.g. `brew install postgresql@16`) or a hosted instance (Supabase, Neon, etc.).
- `psql` (optional, recommended) — for one-time schema bootstrap before first `portfolio health`.

Bun runs the TypeScript source directly via the shebang in `portfolio-ts/src/cli.ts`, so a separate `tsc` build is not required for normal use. `bun run typecheck` is available for static validation.

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd my-portfolio

# Install CLI dependencies (Bun reads bun.lock)
cd portfolio-ts
bun install
cd ..
```

That's it for the runtime. The CLI source ships as TypeScript and is executed by Bun directly.

## Configure the database

The CLI talks to PostgreSQL through a single environment variable: `PORTFOLIO_DB_URL`.

You can set it in your shell, or — more conveniently — drop it in a `.env` file. The CLI auto-loads `.env` from the current working directory or any parent directory before reading `PORTFOLIO_DB_URL` (issue #142), so you usually do not need to `export` anything.

Create a `.env` at the repository root (or copy from `.env.example`):

```bash
# .env  (gitignored — never commit real credentials)
PORTFOLIO_DB_URL=postgresql://postgres:postgres@localhost:5432/portfolio
```

Or for a hosted instance:

```bash
PORTFOLIO_DB_URL='postgresql://postgres:[YOUR-PASSWORD]@db.<project-ref>.supabase.co:5432/postgres?sslmode=require'
```

### One-time schema bootstrap

The CLI's `init` command only **verifies** that the schema is in place — it does not create tables. On a fresh database, apply the SQL files under `portfolio_db/sql/` once:

```bash
psql "$PORTFOLIO_DB_URL" -v ON_ERROR_STOP=1 -f portfolio_db/sql/schema.sql
psql "$PORTFOLIO_DB_URL" -v ON_ERROR_STOP=1 -f portfolio_db/sql/functions.sql
psql "$PORTFOLIO_DB_URL" -v ON_ERROR_STOP=1 -f portfolio_db/sql/procedures.sql
psql "$PORTFOLIO_DB_URL" -v ON_ERROR_STOP=1 -f portfolio_db/sql/views.sql
psql "$PORTFOLIO_DB_URL" -v ON_ERROR_STOP=1 -f portfolio_db/sql/triggers.sql
```

DuckDB is no longer a runtime database. The `portfolio_db/sql/` files are pure PostgreSQL and remain the source of truth for the schema. See [Legacy / migration notes](#legacy--migration-notes) below for one-off DuckDB import tooling.

## Quick start

There are two equivalent ways to invoke the CLI.

**1. From the `portfolio-ts/` directory (development form):**

```bash
cd portfolio-ts
bun src/cli.ts --help          # or: bun start -- --help
bun src/cli.ts health
```

**2. As the `portfolio` binary:**

A wrapper script lives at `bin/portfolio` at the repo root and can be invoked directly:

```bash
./bin/portfolio --help
./bin/portfolio health
```

The `package.json` also declares `"bin": {"portfolio": "src/cli.ts"}`, so after `bun link` (run inside `portfolio-ts/`) the `portfolio` command is on your `PATH` globally:

```bash
cd portfolio-ts
bun link                      # one-time, registers the `portfolio` bin
portfolio --help
portfolio health
```

All examples below use the `portfolio` form. Substitute `bun src/cli.ts` (run from `portfolio-ts/`) or `./bin/portfolio` (run from the repo root) if you have not linked the bin.

## Verify the install

```bash
portfolio health
```

`health` checks DB reachability and price coverage. It returns a JSON envelope and exits non-zero on any problem. If you see `ok: true`, you are ready to go.

## Initialization & setup

```bash
# Verify the database schema is in place (does NOT create tables)
portfolio init
```

## Add and edit transactions

```bash
# Add a transaction (--exchange is required)
portfolio add --date 2026-01-01 --asset AAPL --action BUY \
              --quantity 10 --price 150 --exchange Interactive

# Edit an existing transaction (supports --dry-run)
portfolio edit --id 42 --price 155.50
portfolio edit --id 42 --dry-run

# Delete a transaction (--confirm required, --dry-run previews)
portfolio delete --id 42 --confirm
portfolio delete --id 42 --dry-run

# Record a currency exchange (two linked transactions)
portfolio exchange --date 2026-01-01 \
                   --from USD --to EURUSD=X \
                   --quantity 1000 --rate 0.92
```

Supported transaction types: `BUY`, `SELL`, `DEPOSIT`, `WITHDRAW`, `TRANSFER`, `DIVIDEND`, `INTEREST`, `FEE`, `TAX`, and `EXCHANGE` (via the dedicated `portfolio exchange` command).

## Reporting & analysis

All read commands emit pure JSON, do not trigger hidden network calls, and use the most recent cached prices/FX rates up to `--as-of-date`.

```bash
# Current portfolio status
portfolio status
portfolio status --as-of-date 2026-01-31

# Cash balances by currency with USD conversion
portfolio cash

# Portfolio allocation breakdown
portfolio allocation

# High-level summary metrics
portfolio summary

# Concentration metrics (HHI + top holdings)
portfolio concentration
portfolio concentration --top-n 10

# Performance: TWR, CAGR, Sharpe, max drawdown, benchmark
portfolio performance
portfolio performance --benchmark QQQ --period ytd
portfolio performance --from-date 2025-01-01

# Money-weighted return (XIRR) accounting for deposit/withdraw timing
portfolio mwr

# Paginated transaction list
portfolio transactions --limit 20 --offset 40

# Paginated daily returns
portfolio report --limit 20 --offset 0
```

## Maintenance & price management

Mutating commands auto-recalculate. Maintenance commands give you explicit control.

```bash
# Price coverage diagnostics (read-only, no network)
portfolio verify_prices

# Fetch missing prices from Yahoo Finance and cache them
portfolio repair_prices --dry-run
portfolio repair_prices
portfolio repair_prices --ticker AAPL,MSFT

# Rebuild daily_returns from cached prices (refuses on stale data)
portfolio recalculate --dry-run
portfolio recalculate --force

# One-shot daily maintenance: stale check + repair + recalculate
portfolio sync

# Fetch prices via HTTPS, recalculate, and return a summary (OS-cron entry)
portfolio refresh
portfolio refresh --dry-run
```

Stale-price enforcement: `recalculate` and `sync` refuse to run when required tickers lack prices within `STALE_MAX_AGE_DAYS` (default 5) unless `--force` is passed. `sync` and `refresh` run the daily maintenance check first.

## Scheduling (OS crontab)

`portfolio schedule` manages an idempotent OS crontab block. The block invokes the CLI through Bun using the path of the `portfolio-ts/` directory.

```bash
# Print the crontab block (for review or manual install)
portfolio schedule emit

# Install the managed crontab block (idempotent)
portfolio schedule install

# Remove the managed crontab block
portfolio schedule remove
```

The installed block uses `bun run portfolio-ts/src/cli.ts <cmd>` so no global install is required for cron to work — it just needs Bun on `PATH` and a working `portfolio-ts/` checkout. See [docs/crontab-schedule.md](docs/crontab-schedule.md) for the full lifecycle and the pg_cron alternative.

## JSON envelope contract

Every command emits the same envelope:

```json
{
  "ok": true,
  "command": "status",
  "data": { /* command-specific payload */ },
  "meta": { "generated_at": "2026-06-01T12:00:00Z", "count": null }
}
```

Errors:

```json
{
  "ok": false,
  "command": "status",
  "error": { "code": "INTERNAL_ERROR", "message": "..." },
  "meta": { "generated_at": "...", "count": null }
}
```

The canonical implementation is in `portfolio-ts/src/response.ts`; see [docs/api-response-standardization-plan.md](docs/api-response-standardization-plan.md) for the design history.

## Date format

- **Write and read commands** accept ISO `YYYY-MM-DD` (primary).
- Legacy `DD-MM-YYYY` is still accepted on write commands (`--date`, `--start-date`, `--end-date`, `--from-date`) with a stderr deprecation warning. Remove legacy support after the migration window closes.
- The historical `migrate` command (DuckDB import, Python-era) ingests semicolon-separated CSV with `DD-MM-YYYY` dates; see [Legacy / migration notes](#legacy--migration-notes).

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `PORTFOLIO_DB_URL` | Yes | PostgreSQL connection string (local or hosted). |
| `PORTFOLIO_BENCHMARK_TICKERS` | No (default: `SPY`) | Comma-separated benchmark tickers for `performance`. |
| `PORTFOLIO_LOG_PATH` | Reserved | Reserved for the legacy Python logger; not used by the TypeScript CLI. |
| `PORTFOLIO_PRICE_PROVIDER` | Reserved | Reserved/legacy. The TypeScript CLI uses `yahoo-finance2` directly; this variable is ignored. |
| `PORTFOLIO_S3_*` / `S3_*` | For `backup push` / `backup pull` | S3-compatible backup storage (see [Backups](#backups-s3--cloudflare-r2)). |

See [`.env.example`](.env.example) for a ready-to-copy template. `.env` is auto-loaded from the current directory or any parent directory.

## Cloudflare Widget

Deploy a read-only portfolio widget to Cloudflare Workers + KV. The Worker serves the [widget JSON contract](docs/widget-contract.md) (compact portfolio snapshot: value, today change, total gain, sparkline series). The Scriptable iOS app fetches this endpoint — see [examples/scriptable/README.md](examples/scriptable/README.md) for the phone widget setup.

### Prerequisites

- A **Cloudflare account** with Workers and KV enabled.
- **wrangler** CLI — installed and authenticated. The `portfolio cloudflare` commands delegate to wrangler for auth (OAuth session persists in `~/.wrangler`). You can also set `CLOUDFLARE_API_TOKEN` for non-interactive auth.

Auth commands:

| Command | Description |
|---|---|
| `portfolio cloudflare login` | Opens browser; delegates to `wrangler login` (interactive OAuth) |
| `portfolio cloudflare whoami` | Shows authenticated account name, ID, email; delegates to `wrangler whoami` |
| `portfolio cloudflare logout` | Clears wrangler OAuth session; delegates to `wrangler logout` |

### Required environment

```bash
export PORTFOLIO_DB_URL=postgresql://user:pass@host:5432/portfolio
```

`publish` needs the database to compose the snapshot from shared service commands (`summary`, `widget`, `status`, `freshness`). Cloudflare auth is handled by wrangler OAuth — no Cloudflare API token env var is needed for the basic flow.

### Command flow

The lifecycle is `init → deploy → publish`. All commands emit pure JSON with the standard envelope (`success()` / `error()` from `response.ts`).

#### `portfolio cloudflare init`

Generates `cloudflare/wrangler.jsonc` (wires `account_id` and `kv_namespace_id` from local config) and `cloudflare/worker.js` (the Worker script). Ensures wrangler is authenticated and the account ID is valid (32-char hex). Creates `.portfolio/config.json` to persist settings.

JSON output includes `config` (the saved config), `files` (paths), `fileActions` (written/skipped), and `warnings` (e.g. missing KV namespace ID).

Flags: `--project-name`, `--account-id`, `--kv-namespace-id`, `--force` (overwrite existing files).

#### `portfolio cloudflare deploy`

Runs `wrangler deploy` in the `cloudflare/` directory, parses the `.workers.dev` URL from the output, appends `/portfolio` to form the widget URL, and saves it to `.portfolio/config.json`.

JSON output: `{ "ok": true, "data": { "url": "https://portfolio-widget.<your-subdomain>.workers.dev/portfolio" } }`.

#### `portfolio cloudflare publish`

Composes a financial snapshot from the database (via `getSummary`, `getWidget`, `getStatus`, `getPriceFreshness`), validates it, and writes it to Cloudflare KV via `wrangler kv key put portfolio --namespace-id <id> --remote`.

JSON output: `{ "ok": true, "data": { "key": "portfolio", "namespace_id": "...", "snapshot": { portfolio_value_usd, today, total, history, prices_as_of, as_of_date, updatedAt } } }`.

The snapshot shape is an extended version of the widget contract — see [`docs/widget-contract.md`](docs/widget-contract.md) for the `portfolio` endpoint's data contract and field definitions.

Requires `kv_namespace_id` to be set in `.portfolio/config.json` (wired during `init`).

#### `portfolio cloudflare url`

Reads the saved widget URL from `.portfolio/config.json` and prints it.

JSON output: `{ "ok": true, "data": { "url": "https://portfolio-widget.<your-subdomain>.workers.dev/portfolio" } }`.

#### `portfolio cloudflare sync`

Composes a snapshot and writes it to KV in a single step. Supports a watch loop:

```bash
portfolio cloudflare sync                          # one-shot
portfolio cloudflare sync --watch                   # loop, default 5m interval
portfolio cloudflare sync --interval 1h --watch     # loop, custom interval
```

### Widget URL example

```
https://portfolio-widget.<your-subdomain>.workers.dev/portfolio
```

Replace `<your-subdomain>` with your Cloudflare Workers subdomain (shown in the deploy output). The Worker serves the JSON at `GET /portfolio` with:

- **`Cache-Control: public, max-age=300`** — the Worker sets a 5-minute browser/proxy cache.
- **`Access-Control-Allow-Origin: *`** — CORS enabled for cross-origin fetches.
- **404 fallback** — if no snapshot exists in KV, returns `{"error": "portfolio not published"}`.

### Offline / phone widget

The Worker's `Cache-Control: public, max-age=300` gives a 5-minute browser-cache window. The Scriptable iOS widget (see [`examples/scriptable/README.md`](examples/scriptable/README.md)) caches the last good response on-device — if the fetch fails (network down, server unreachable) it displays the cached data and a stale indicator rather than a blank error.

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `"Not authenticated"` on any `portfolio cloudflare` command | wrangler OAuth session expired or never created | Run `portfolio cloudflare login` (or `wrangler login` directly) |
| `"KV namespace not configured"` on `publish` | `kv_namespace_id` not set in `.portfolio/config.json` or `wrangler.jsonc` | Create a KV namespace in the Cloudflare Dashboard, then re-run `portfolio cloudflare init --kv-namespace-id <id>` |
| `{"error": "portfolio not published"}` (404) on the widget URL | KV has no `portfolio` key — `publish` never ran or failed | Run `portfolio cloudflare publish` and verify success |
| `wrangler deploy` fails | Missing `account_id`, stale wrangler config, or wrangler not authenticated | Re-run `portfolio cloudflare init --force` to regenerate `wrangler.jsonc`; verify `portfolio cloudflare whoami` works |
| `parseDeployedUrl` failure | `wrangler deploy` output format changed | Check the raw deploy output in the error's `stdout`/`stderr`; try deploying manually from `cloudflare/` with `wrangler deploy` |

### Security

These paths and files are **already gitignored** — keep them so:

| Path | Contents |
|---|---|
| `.portfolio/` | `config.json` with `account_id`, `kv_namespace_id`, `widget_url` |
| `cloudflare/` | Generated `wrangler.jsonc` (embeds `account_id` and KV namespace ID) and `worker.js` |
| `.env` | `PORTFOLIO_DB_URL` (database connection string) |

- Secrets must **never** be committed to the repository. The gitignore rules above exist for this reason.
- The Worker itself contains zero credentials — it reads from KV only, not from the database directly.
- The widget URL is publicly routable by design (the Scriptable phone widget needs public HTTPS access). The data served is read-only aggregate portfolio metrics — no transaction details, no DB credentials, no API keys.

## Backups (S3 / Cloudflare R2)

S3-compatible backup storage for PostgreSQL dumps. Implemented as `portfolio backup push` and `portfolio backup pull`.

### What it does

- **`portfolio backup push`** — runs `pg_dump` against `$PORTFOLIO_DB_URL`, uploads the dump to an S3-compatible bucket as both `portfolio.backup-<timestamp>.sql` and `latest.sql`.
- **`portfolio backup pull [--key <name>]`** — downloads a dump and prints a restore command (`psql "$PORTFOLIO_DB_URL" -f <file>`). Defaults to `latest.sql`.

### Required environment

The command reads `PORTFOLIO_S3_*` variables first, falling back to bare `S3_*`:

| Variable | Required | Description |
|---|---|---|
| `PORTFOLIO_S3_ENDPOINT` / `S3_ENDPOINT` | Yes | S3 API endpoint URL |
| `PORTFOLIO_S3_BUCKET` / `S3_BUCKET` | Yes | Bucket name |
| `PORTFOLIO_S3_ACCESS_KEY_ID` / `S3_ACCESS_KEY_ID` | Yes | S3 API access key |
| `PORTFOLIO_S3_SECRET_ACCESS_KEY` / `S3_SECRET_ACCESS_KEY` | Yes | S3 API secret key |
| `PORTFOLIO_S3_REGION` / `S3_REGION` | No (default: `auto`) | AWS region or `auto` for R2 |

Plus `PORTFOLIO_DB_URL` (see [Configuration](#configure-the-database)).

Example `.env` block (placeholders only — never commit real keys):

```bash
PORTFOLIO_DB_URL=postgresql://user:pass@host:5432/portfolio
PORTFOLIO_S3_ENDPOINT=https://<your-account-id>.r2.cloudflarestorage.com
PORTFOLIO_S3_BUCKET=portfolio-backups
PORTFOLIO_S3_ACCESS_KEY_ID=<your-access-key-id>
PORTFOLIO_S3_SECRET_ACCESS_KEY=<your-secret-access-key>
PORTFOLIO_S3_REGION=auto
```

### Cloudflare R2

This project uses Cloudflare R2 as the S3-compatible store. Key specifics:

- **Endpoint format**: `https://<account-id>.r2.cloudflarestorage.com` (account-level; the client uses path-style addressing / `forcePathStyle`).
- **Region**: must be `auto`.
- **Obtaining credentials**: Cloudflare Dashboard → R2 → "Manage R2 API Tokens" → create an API token. The token yields an Access Key ID and a Secret Access Key. These are **separate** from `wrangler login` OAuth tokens — wrangler OAuth does **not** grant S3 API keys.
- **Create a dedicated bucket**: `wrangler r2 bucket create portfolio-backups`. Set `PORTFOLIO_S3_BUCKET` to match. A dedicated bucket is recommended so backups don't mix with other data.

### Usage

```bash
# Push a backup
portfolio backup push
```

Push JSON output:

```json
{
  "ok": true,
  "command": "backup:push",
  "data": {
    "bucket": "portfolio-backups",
    "dump_path": "/tmp/portfolio.backup-2026-05-31T120000.sql",
    "dump_size_bytes": 143360,
    "objects": [
      "portfolio.backup-2026-05-31T120000.sql",
      "latest.sql"
    ]
  },
  "meta": {
    "generated_at": "2026-05-31T12:00:00Z",
    "count": 2
  }
}
```

```bash
# Pull the latest backup
portfolio backup pull

# Pull a specific backup
portfolio backup pull --key portfolio.backup-2026-05-30T120000.sql
```

Pull JSON output:

```json
{
  "ok": true,
  "command": "backup:pull",
  "data": {
    "bucket": "portfolio-backups",
    "key": "latest.sql",
    "local_path": "portfolio.restored.latest.sql",
    "size_bytes": 143360,
    "restore_command": "psql \"$PORTFOLIO_DB_URL\" -f portfolio.restored.latest.sql"
  },
  "meta": {
    "generated_at": "2026-05-31T12:00:00Z",
    "count": null
  }
}
```

A local `pg_dump` to a file is also available:

```bash
portfolio backup --out /tmp/portfolio.sql
```

### Security

- Secrets must **never** be committed. Keep them in `.env` (gitignored) or a secrets manager.
- Do **not** paste keys into committed files, issues, or chat.
- R2 API tokens can be rotated or revoked at any time from Cloudflare Dashboard → R2 → "Manage R2 API Tokens".
- Database credentials (`PORTFOLIO_DB_URL`) are never stored in the backup itself.

## Testing

The project uses `bun test`. Run all tests from the `portfolio-ts/` directory:

```bash
cd portfolio-ts
bun test
```

Type-check the TypeScript source without producing output:

```bash
bun run typecheck
```

## Documentation

Additional design notes and operational references live in `docs/`:

- [API Response Standardization Plan](docs/api-response-standardization-plan.md)
- [Cloudflare Widget](docs/widget-contract.md) — data contract served by the Worker; see also the [Cloudflare Widget section](#cloudflare-widget) above for the deployment flow
- [Crontab Schedule](docs/crontab-schedule.md)
- [Platform Adapters](docs/platform-adapters.md) — architecture overview of all adapters (CLI, API, dashboard, Scriptable widget)
- [Production Ready Plan](docs/production-ready-plan.md)
- [Transaction Specification](docs/transaction-spec.md)
- [TypeScript Migration](docs/typescript-migration/README.md) — history of the Python → TypeScript/Bun cutover

> **Note:** Some historical docs (and the `portfolio-db/` and `scripts/` directories) still reference the old `portfolio-py` Python CLI or the `portfolio-ts` bin name. The current binary is **`portfolio`** (issue #141, completed). When in doubt, follow the JSON-envelope contract and the command list in [`bun src/cli.ts --help`](portfolio-ts/src/cli.ts) — those are the source of truth.

## Legacy / migration notes

- **DuckDB is no longer a runtime database.** The CLI no longer ships a `migrate-duckdb-to-postgres` command (see `portfolio-ts/PARITY.md`). If you have historical data in a DuckDB file, the Python-era migration script in git history may still work with `uv`, but the supported runtime is PostgreSQL.
- **The `portfolio_db/` directory contains SQL only** (no Python source). Apply these files with `psql` during one-time schema bootstrap — see [One-time schema bootstrap](#one-time-schema-bootstrap).
- **Reserved env vars** `PORTFOLIO_PRICE_PROVIDER` and `PORTFOLIO_LOG_PATH` are kept in `.env.example` for compatibility with downstream tooling but are ignored by the TypeScript CLI. They can be removed once no caller references them.
