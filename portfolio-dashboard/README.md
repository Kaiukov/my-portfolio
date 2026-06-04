# portfolio-dashboard (Cloudflare Worker)

Public, read-only portfolio dashboard. Pattern 1 of
[`docs/dashboard-cloudflare-architecture.md`](../docs/dashboard-cloudflare-architecture.md):
the backend publishes a `DashboardSnapshot` to Cloudflare KV (namespace
`PORTFOLIO_KV`, key `"dashboard"`); this Worker serves a static SPA plus a
`/api/dashboard` route that returns the snapshot. No DB access, no write paths,
no financial logic in the Worker.

## Files

| File | Purpose | Committed? |
|---|---|---|
| `index.html` | Single-file SPA. Fetches `/api/dashboard` and renders. **No embedded data.** | yes |
| `worker.js` | Serves `index.html` on `/`, `/dashboard`; serves KV snapshot on `/api/dashboard`; `/health`, `/version`. | yes |
| `wrangler.jsonc.example` | Config template — copy to `wrangler.jsonc`, fill account + KV ids. | yes |
| `wrangler.jsonc` | Real config with account/KV ids. | **gitignored** |

## Routes

- `GET /`, `/dashboard`, `/index.html` → dashboard SPA (HTML)
- `GET /api/dashboard` → snapshot JSON from KV key `dashboard` (404 until first publish)
- `GET /health` → `{ ok: true }`
- `GET /version` → `{ app, pattern }`

## Live links (dev / prod split)

Two Workers, one shared KV namespace, distinct keys (mirrors the widget convention
`portfolio-widget` / `portfolio-widget-prod`):

| Env | URL | KV key | Published by |
|---|---|---|---|
| **dev** | https://portfolio-dashboard.kayukov2010.workers.dev | `dev:dashboard` | dev service (CT 103) |
| **prod** | https://portfolio-dashboard-prod.kayukov2010.workers.dev | `dashboard` | prod service (CT 104) |

## Deploy (orchestrator-only)

```bash
cd portfolio-dashboard
# dev worker (bare name, dev:dashboard key):
wrangler deploy --config wrangler.dev.jsonc
# prod worker (-prod name, dashboard key):
wrangler deploy --config wrangler.prod.jsonc
# needs CLOUDFLARE_API_TOKEN or `wrangler login`
```

`wrangler.dev.jsonc` / `wrangler.prod.jsonc` are gitignored (real account + KV ids);
they differ only in `name` and `vars.DASHBOARD_KV_KEY`. The KV namespace
`d4416963…` is shared with the widget (`portfolio` / `prod:portfolio:…`) and the
dashboard keys (`dev:dashboard` / `dashboard`) — no collision.

## Publishing the snapshot

The backend publishes the snapshot:

```bash
portfolio dashboard publish      # writes KV key "dashboard"
```

The portfolio service runs this on a cron when
`PORTFOLIO_DASHBOARD_PUBLISH=true` (interval `PORTFOLIO_DASHBOARD_PUBLISH_INTERVAL`).

## Security

Public read-only. The KV snapshot holds only computed display values — no DB
credentials, no API tokens, no write routes. `CLOUDFLARE_API_TOKEN` stays in the
backend environment and is never committed or shipped to the Worker.
