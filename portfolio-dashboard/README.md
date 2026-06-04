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

## Deploy (orchestrator-only)

```bash
cd portfolio-dashboard
cp wrangler.jsonc.example wrangler.jsonc
# fill account_id + kv_namespaces[].id from ../portfolio-ts/.portfolio/config.json
wrangler deploy            # needs CLOUDFLARE_API_TOKEN or `wrangler login`
```

The KV namespace is shared with the widget (`portfolio-widget` uses key
`"portfolio"`; the dashboard uses key `"dashboard"` — no collision).

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
