# my-portfolio

A Python CLI tool for portfolio tracking powered by PostgreSQL.

## Features

- **Pure JSON Output**: All commands output pure JSON, making it perfect for programmatic use, automation, and API integrations.
- **PostgreSQL Powered**: Uses PostgreSQL for durable portfolio storage, reporting snapshots, and derived calculations.
- **Deterministic Valuation**: Time-Weighted Return (TWR) is the primary portfolio return metric. Read-path valuation relies exclusively on cached price and FX series to ensure fast, deterministic reporting without silent outside API calls.
- **Comprehensive Tracking**: Supports standard trade actions (`BUY`, `SELL`), cash flows (`DEPOSIT`, `WITHDRAW`, `TRANSFER`), income (`DIVIDEND`, `INTEREST`), expenses (`FEE`, `TAX`), and currency exchanges.
- **Multi-Currency**: Base currency is USD, with robust support and FX-conversion tracking for international assets.

## Prerequisites

- Python >= 3.13
- [uv](https://docs.astral.sh/uv/) package manager

## Database Setup

This project runs on PostgreSQL only at runtime.

- Set `PORTFOLIO_DB_URL` to a local PostgreSQL DSN for development or tests.
- Set `PORTFOLIO_DB_URL` to a Supabase PostgreSQL DSN for hosted development.
- Keep `sslmode=require` on the Supabase URL.
- DuckDB is not supported as a runtime database; it remains only as a migration and verification fixture.
- The CLI auto-loads a `.env` file from the current directory or any parent directory before reading `PORTFOLIO_DB_URL`.

Example local DSN:

```bash
export PORTFOLIO_DB_URL=postgresql://postgres:postgres@localhost:5433/postgres
```

Example Supabase DSN:

```bash
export PORTFOLIO_DB_URL='postgresql://postgres:[YOUR-PASSWORD]@db.<project-ref>.supabase.co:5432/postgres?sslmode=require'
```

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd my-portfolio

# Install using uv
uv sync
```

The CLI will be available as `portfolio`.

## Usage

Interact with the portfolio database through the `portfolio` CLI.

### Initialization & Setup

Initialize a new portfolio DB (safe to run on an existing DB; idempotent):
```bash
portfolio init
```

### Mutating State

Add or edit transactions:
```bash
# Add a transaction
portfolio add --help

# Edit an existing transaction (supports --dry-run)
portfolio edit --id <txn-id> --dry-run
```

Supported transaction types:
- `BUY` / `SELL`
- `DEPOSIT` / `WITHDRAW`
- `DIVIDEND` / `INTEREST`
- `FEE` / `TAX`
- `TRANSFER`
- `EXCHANGE` (via the dedicated `portfolio exchange` command)

### Reporting & Analysis

All read commands output purely in JSON and do not trigger hidden network calls. They use the most recent cached prices/FX rates up to the `--as-of-date`.

```bash
# View current portfolio status
portfolio status

# Check cash balances
portfolio cash

# Get portfolio allocation
portfolio allocation

# View performance metrics (TWR, CAGR, gains)
portfolio performance

# Comprehensive portfolio summary
portfolio summary

# List transactions
portfolio transactions
```

### Maintenance & Price Management

Mutating commands generally trigger a recalculation automatically, but maintenance commands are available:

```bash
# Verify integrity of price caches
portfolio verify_prices

# Fetch missing/incomplete price series and cache them
# Use --dry-run to preview what will be fetched
portfolio repair_prices --dry-run
portfolio repair_prices

# Force recalculation of daily returns
portfolio recalculate --force

# Check overall DB health, reachability, and price coverage
portfolio health
```

## Documentation

Additional design notes and operational references live in `docs/`:

- [API Response Standardization Plan](docs/api-response-standardization-plan.md)
- [Cloudflare Widget](docs/widget-contract.md) — data contract served by the Worker; see also the [Cloudflare widget section](#cloudflare-widget) below for the deployment flow
- [Crontab Schedule](docs/crontab-schedule.md)
- [Platform Adapters](docs/platform-adapters.md) — architecture overview of all adapters (CLI, API, dashboard, Scriptable widget)
- [Production Ready Plan](docs/production-ready-plan.md)
- [Transaction Specification](docs/transaction-spec.md)

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

### Required Environment

```bash
export PORTFOLIO_DB_URL=postgresql://user:pass@host:5432/portfolio
```

`publish` needs the database to compose the snapshot from shared service commands (`summary`, `widget`, `status`, `freshness`). Cloudflare auth is handled by wrangler OAuth — no Cloudflare API token env var is needed for the basic flow.

### Command Flow

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

### Widget URL Example

```
https://portfolio-widget.<your-subdomain>.workers.dev/portfolio
```

Replace `<your-subdomain>` with your Cloudflare Workers subdomain (shown in the deploy output). The Worker serves the JSON at `GET /portfolio` with:

- **`Cache-Control: public, max-age=300`** — the Worker sets a 5-minute browser/proxy cache.
- **`Access-Control-Allow-Origin: *`** — CORS enabled for cross-origin fetches.
- **404 fallback** — if no snapshot exists in KV, returns `{"error": "portfolio not published"}`.

### Offline / Phone Widget

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

## Testing

The project uses `pytest`. Run tests locally with `uv`:

```bash
uv run pytest
```
