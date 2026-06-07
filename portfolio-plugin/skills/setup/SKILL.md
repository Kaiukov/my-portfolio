---
name: portfolio-setup
description: When the user needs to clone, install, configure, or verify the my-portfolio CLI and its PostgreSQL database.
---

# Portfolio CLI — Setup

## Prerequisites

- Bun `>= 1.3`
- PostgreSQL `>= 14` (local or hosted)
- `psql` (recommended for schema bootstrap)

## Installation

```bash
git clone <repository-url>
cd my-portfolio
cd portfolio-ts
bun install
cd ..
```

## Database Configuration

Set `PORTFOLIO_DB_URL` in `.env` at the repository root (auto-loaded). Example:

```bash
# .env (gitignored)
PORTFOLIO_DB_URL=postgresql://postgres:postgres@localhost:5432/portfolio
```

### Schema Bootstrap

Apply SQL files once on a fresh database (the CLI's `init` command only verifies, it does not create tables):

```bash
psql "$PORTFOLIO_DB_URL" -v ON_ERROR_STOP=1 -f portfolio_db/sql/schema.sql
psql "$PORTFOLIO_DB_URL" -v ON_ERROR_STOP=1 -f portfolio_db/sql/functions.sql
psql "$PORTFOLIO_DB_URL" -v ON_ERROR_STOP=1 -f portfolio_db/sql/procedures.sql
psql "$PORTFOLIO_DB_URL" -v ON_ERROR_STOP=1 -f portfolio_db/sql/views.sql
psql "$PORTFOLIO_DB_URL" -v ON_ERROR_STOP=1 -f portfolio_db/sql/triggers.sql
```

### Verify

```bash
# From portfolio-ts/:
bun src/cli.ts health
# Or after bun link:
portfolio health
```

Returns `{"ok": true}` on success.

## CLI Invocation Forms

| Form | When to use |
|------|-------------|
| `bun src/cli.ts <cmd>` | From `portfolio-ts/` during development |
| `./bin/portfolio <cmd>` | From repo root (no global install) |
| `portfolio <cmd>` | After `bun link` in `portfolio-ts/` (global path) |
| `bun run start -- <cmd>` | Alternative via `package.json` script |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORTFOLIO_DB_URL` | Yes | PostgreSQL connection string |
| `PORTFOLIO_BENCHMARK_TICKERS` | No (default: `SPY`) | Benchmark tickers for `performance` |
| `CLOUDFLARE_API_TOKEN` | For Cloudflare KV API | Non-interactive Cloudflare auth |
