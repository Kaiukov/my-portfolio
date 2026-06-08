---
name: portfolio-deploy
description: When the user needs to deploy, initialize, or publish the portfolio Cloudflare Worker widget or wrangler-managed dashboard.
---

# Portfolio CLI — Cloudflare Deploy

The CLI deploys a read-only portfolio widget to Cloudflare Workers + KV. The widget exposes a JSON endpoint for the Scriptable iOS widget.

## Prerequisites

- Cloudflare account with Workers + KV enabled
- `wrangler` CLI authenticated (`portfolio cloudflare login` or `wrangler login`)

## Auth Commands

```bash
portfolio cloudflare login       # Interactive OAuth via wrangler
portfolio cloudflare whoami      # Show authenticated account info
portfolio cloudflare logout      # Clear OAuth session
```

## Deploy Lifecycle

### 1. Init

Generates `cloudflare/wrangler.jsonc` and `cloudflare/worker.js`. Requires a KV namespace ID from the Cloudflare Dashboard.

```bash
portfolio cloudflare init --kv-namespace-id <id>
portfolio cloudflare init --force  # Overwrite existing files
```

### 2. Deploy

Runs `wrangler deploy` in the `cloudflare/` directory and saves the widget URL.

```bash
portfolio cloudflare deploy
```

### 3. Publish

Composes a portfolio snapshot from the database and writes it to Cloudflare KV.

```bash
portfolio cloudflare publish
```

### 4. Sync

Publish + loop mode:

```bash
portfolio cloudflare sync                    # One-shot
portfolio cloudflare sync --watch            # Loop, default 5m interval
portfolio cloudflare sync --interval 1h --watch
```

### 5. URL

Reads the deployed widget URL:

```bash
portfolio cloudflare url
```

## Database Backup

For DB `pg_dump` backup, S3/R2 push, and restore, see the [portfolio-backup](../backup/SKILL.md) skill.

## Dashboard Worker

The `portfolio-dashboard/` Worker serves a richer SPA dashboard (separate from the widget). Deploy directly with wrangler:

```bash
cd portfolio-dashboard
wrangler deploy --config wrangler.dev.jsonc   # Dev worker
wrangler deploy --config wrangler.prod.jsonc  # Prod worker
```

Publish the snapshot:

```bash
portfolio dashboard publish
```
