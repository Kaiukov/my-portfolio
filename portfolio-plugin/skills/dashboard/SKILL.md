---
name: portfolio-dashboard
description: When the user needs to publish the portfolio dashboard snapshot to Cloudflare KV or deploy the dashboard Worker.
---

# Portfolio CLI — Dashboard

The `portfolio-dashboard/` directory contains a Cloudflare Worker that serves a read-only SPA dashboard. The backend publishes a `DashboardSnapshot` to Cloudflare KV; the Worker serves it at `/api/dashboard`.

## Architecture

Two Workers share one KV namespace with distinct keys:

| Environment | Worker URL | KV Key |
|---|---|---|
| **dev** | `portfolio-dashboard.<subdomain>.workers.dev` | `dev:dashboard` |
| **prod** | `portfolio-dashboard-prod.<subdomain>.workers.dev` | `dashboard` |

## Dashboard Routes

- `GET /` or `/dashboard` — dashboard SPA (HTML)
- `GET /api/dashboard` — snapshot JSON from KV key `dashboard` (404 until first publish)
- `GET /health` — `{"ok": true}`
- `GET /version` — `{"app": "portfolio-dashboard", "pattern": "kv-snapshot-v1"}`

## Publish Snapshot

Composes a snapshot from the database and writes it to KV:

```bash
portfolio dashboard publish
```

The portfolio service runs this on cron when `PORTFOLIO_DASHBOARD_PUBLISH=true` (interval `PORTFOLIO_DASHBOARD_PUBLISH_INTERVAL`).

## Deploy the Worker

```bash
cd portfolio-dashboard

# Dev worker:
wrangler deploy --config wrangler.dev.jsonc

# Prod worker:
wrangler deploy --config wrangler.prod.jsonc
```

Requires `wrangler login` or `CLOUDFLARE_API_TOKEN`. Config files (`wrangler.dev.jsonc`, `wrangler.prod.jsonc`) are gitignored.
