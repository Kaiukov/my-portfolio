# Dashboard Cloudflare Architecture & Prep Plan

> Extends [#218](https://github.com/Kaiukov/my-portfolio/issues/218) with the concrete
> Cloudflare hosting design. Read-only analysis — no implementation.

## 1. Recommended architecture: KV snapshot, read-only (Pattern 1)

The backend API runs on a LAN/Tailscale host (`192.168.1.104:8787`, `portfolio-ts/src/service.ts:460-501`) and is **not publicly reachable**. A static SPA on Cloudflare cannot reach it directly. The pragmatic v1 solution: **extend the existing widget publish pipeline**.

### Data-flow diagram

```
                    ┌──────────────────────────────┐
                    │  Backend (Proxmox CT 104)     │
                    │  ┌────────────────────────┐   │
                    │  │ portfolio service       │   │
                    │  │ (src/service.ts)        │   │
                    │  │                         │   │
                    │  │  cron: refresh ─┐       │   │
                    │  │  cron: publish ─┤       │   │
                    │  │                 ▼       │   │
                    │  │  dashboard_publish.ts   │   │   ◀── NEW file
                    │  │  assembles richer       │   │
                    │  │  DashboardSnapshot JSON │   │
                    │  │      │                  │   │
                    │  └──────┼──────────────────┘   │
                    │         │ Cloudflare REST API   │
                    └─────────┼──────────────────────┘
                              │ kv_api.ts: putKvValueViaApi()
                              ▼
              ┌───────────────────────────────┐
              │  Cloudflare KV                 │
              │  Namespace: PORTFOLIO_KV       │
              │  Key: "dashboard"              │   ◀── new key (widget stays "portfolio")
              └───────────┬───────────────────┘
                          │ KV binding
                          ▼
              ┌───────────────────────────────┐
              │  Cloudflare Worker             │
              │  or Pages (w/ Functions)       │
              │  ┌─────────────────────────┐   │
              │  │ Serves static SPA assets │   │
              │  │ + /api/dashboard → KV    │   │
              │  │ + /widget → KV           │   │
              │  │ + /health, /version      │   │
              │  └─────────────────────────┘   │
              └───────────┬───────────────────┘
                          │ HTTPS (workers.dev or custom domain)
                          ▼
              ┌───────────────────────────────┐
              │  Browser / Mobile / PWA        │
              │  SPA loads → fetches           │
              │  /api/dashboard → renders      │
              └───────────────────────────────┘
```

### Why this wins

| Factor | Pattern 1 (KV snapshot) | Pattern 2 (Cloudflare Tunnel) | Pattern 3 (Hybrid) |
|---|---|---|---|
| **Reuses existing pipeline** | Yes — `publish.ts`, `kv_api.ts`, `templates.ts`, KV binding | No — new tunnel setup | Partial |
| **Security surface** | Minimal — KV is read-only, no path to backend | Exposes backend entry point to tunnel | Pattern 2's surface |
| **Write capability** | None — read-only | Full read+write | Full read+write (live path) |
| **Data freshness** | As fresh as publish cron (default: 1h) | Real-time | Real-time on-demand |
| **Cost** | Free tier (KV reads + Worker invocations) | cloudflared host + Access (free tier) | Both |
| **Auth complexity** | None (public read-only dashboard) | Cloudflare Access + API auth | Both |
| **CORS needed** | No — same KV-backed Worker origin | Yes — must add CORS to `src/api/server.ts` | Yes |
| **What breaks** | Live writes from UI not possible | Widget's offline-safety gone | Must maintain both paths |

**Recommendation: Pattern 1 for v1, Pattern 3 for v2.** The widget pipeline already works in production; extending it avoids backend exposure, auth complexity, and CORS changes. v2 can add a tunnel for live writes.

## 2. Cloudflare resource inventory

### Existing (widget pipeline — `portfolio-ts/src/cloudflare/*`)

| Resource | Identifier | Provenance |
|---|---|---|
| KV namespace | `PORTFOLIO_KV` binding | `templates.ts:29` — wrangler.jsonc binding |
| KV key (widget) | `"portfolio"` (env `PORTFOLIO_KV_KEY`) | `publish.ts:70`, `templates.ts:22-24` — WRANGLER JSONC var |
| Worker (dev) | `portfolio-widget` | `init.ts:45` — default `wrangler_project_name` |
| Worker (prod) | `portfolio-widget-prod` | Separate wrangler.jsonc / env in cloudflare directory |
| Account ID | `CLOUDFLARE_ACCOUNT_ID` env or `wrangler whoami` parse | `auth.ts:8-9,63-65` |
| Config file | `.portfolio/config.json` | `config.ts:5-6` |

### Dashboard additions (new)

| Resource | Identifier | Notes |
|---|---|---|
| KV key (dashboard) | `"dashboard"` | New key in same `PORTFOLIO_KV` namespace — **reuse**, don't create a new namespace |
| Worker (dev) | `portfolio-dashboard` | New Worker OR Pages project `portfolio-dashboard` |
| Worker (prod) | `portfolio-dashboard-prod` | Separate environment or Pages production branch |
| Static SPA assets | Bundled into Worker (ES modules) or Pages `_assets/` | Pages is preferred for SPA hosting (free unlimited static asset requests) |
| Custom domain | `dash.example.com` (TBD by user) | Optional — workers.dev default otherwise |

**Recommendation: Cloudflare Pages for SPA + Pages Functions for `/api/dashboard`.** Pages hosts static assets natively; a single Pages Function reads KV and serves the snapshot. Worker-only (like widget) works but Pages gives better DX (git-integrated deploys, preview branches).

### Dev vs prod separation

```
┌─ portfolio-widget (dev)  ── KV key: "portfolio" ──┐
│  portfolio-widget-prod       KV key: "portfolio"    │  existing
├─ portfolio-dashboard (dev) ── KV key: "dashboard" ──┤
│  portfolio-dashboard-prod    KV key: "dashboard"    │  new
└─────────────────────────────────────────────────────┘
         Same KV namespace, separate keys
```

Mirror the existing two-worker split (`deploy.ts:14-55` deploys per cloudflare dir). The dashboard can use the same KV namespace (`PORTFOLIO_KV`) but a different key (`"dashboard"`) so the widget and dashboard snapshots don't collide.

## 3. Data contract

### Dashboard snapshot shape (proposed extension of `PortfolioSnapshot`)

The existing widget snapshot (`types.ts:69-77`) is too lean for a full dashboard:

```typescript
// Current PortfolioSnapshot (types.ts:69-77)
{
  portfolio_value_usd: number;
  today: { abs: number; pct: number };
  total: { abs: number; pct: number };
  history: { date: string; value: number }[];
  prices_as_of: string;
  as_of_date: string;
  updatedAt: string;
}
```

**Proposed `DashboardSnapshot`** — assembled by a new `src/commands/dashboard.ts` or extended `publish.ts`:

```typescript
interface DashboardSnapshot {
  // ── from summary (summary.ts:3-10) ──
  holding_count: number;
  total_cash_usd: number;
  portfolio_value_usd: number;
  as_of_date: string;

  // ── from status (status.ts:3-22) ──
  total_invested: number | null;
  deposits: number;
  withdrawals: number;
  income: number;
  fees: number;
  taxes: number;
  total_gain: number | null;
  total_gain_pct: number | null;
  cost_basis: number | null;
  realized_gain: number | null;
  unrealized_gain: number | null;
  total_profit: number | null;

  // ── today change (widget.ts:82-97, from daily_returns) ──
  today: { abs: number; pct: number };

  // ── value history for chart (365 days) ──
  // source: daily_returns table via widget.ts:66-73 pattern
  history: { date: string; value: number }[];

  // ── holdings table (status + allocation join or new query) ──
  holdings: {
    asset: string;
    asset_type: string;
    asset_kind: string;
    net_quantity: number;
    last_price: number | null;
    cost_basis: number;
    market_value_usd: number;
    day_gain_usd: number;
    total_gain_usd: number;
    total_gain_pct: number;
    allocation_pct: number;
    // dividend_income: number;  // depends on #213
  }[];

  // ── allocation (allocation.ts:3-10) ──
  allocation: {
    asset: string;
    asset_type: string;
    asset_kind: string;
    net_quantity: number;
    value_usd: number;
    allocation_pct: number;
  }[];

  // ── cash (commands/cash.ts) ──
  cash: {
    currency: string;
    display_name: string;
    balance: number;
    usd_value: number;
  }[];

  // ── performance (performance.ts:3-37) ──
  performance: {
    total_days: number;
    total_return_pct: number;
    cagr: number;
    sharpe_ratio: number;
    max_drawdown: number;
    beta: number;
    time_weighted_return_pct: number;
    median_monthly_return: number;
  };

  // ── freshness (freshness.ts:4-11) ──
  prices_as_of: string | null;
  price_age_days: number | null;
  stale: boolean;

  // meta
  updatedAt: string;
}
```

### Mapping to #218 UI blocks

| UI block | Snapshot field(s) | Data source |
|---|---|---|
| Summary header (market value, cash, day change, G/L) | `portfolio_value_usd`, `total_cash_usd`, `today`, `total_gain`, `total_gain_pct`, `realized_gain`, `unrealized_gain` | `summary.ts` + `status.ts` + `widget.ts` |
| Value-over-time chart | `history[]` | `daily_returns` table (same query as `widget.ts:66-73`) |
| Holdings table | `holdings[]` | `status.ts` + `allocation.ts` (or new SQL query joining `holdings_with_value` view) |
| Allocation card | `allocation[]` | `allocation.ts:31-33` → `portfolio_allocation_sql()` |
| Cash breakdown | `cash[]` | `commands/cash.ts` → `portfolio_cash_sql()` |
| Gain/Loss card | `total_gain`, `total_gain_pct`, `total_profit` | `status.ts` |
| Dividend payouts | (gap — depends on #213) | Not yet implemented |

### Chart value-series gap — confirmed

- **`GET /performance`** returns only aggregate metrics (`total_days`, `cagr`, `sharpe_ratio`, etc.) — **no dated value series** (`performance.ts:3-37`).
- **`widget.ts`** already queries `daily_returns` for a date+value series (`widget.ts:66-73`), but:
  - It's limited to the `--days` parameter (default 180 days used by `publish.ts:20`).
  - It is **not exposed as a REST API route** — no `GET /widget` in `server.ts:30-80`.
- **Solution for v1**: The dashboard snapshot builder queries `daily_returns` directly for 365 days (same pattern as `widget.ts:66-73`) and includes it in `history[]`. No new `/history` endpoint needed for the KV-snapshot path.

### Snapshot size estimate

~100 holdings + 365 history points ≈ ~80–120 KB. KV value limit is 25 MB — ample headroom.

## 4. Backend preparation work (ordered checklist)

### 4.1 Dashboard snapshot builder (`src/commands/dashboard.ts`) — NEW FILE

Assembles the `DashboardSnapshot` from existing service functions. Reuses:
- `getSummary()` (`summary.ts`)
- `getStatus()` (`status.ts`)
- `getWidget(days)` (`widget.ts`) — for `today` and `history` series
- `getAllocation()` (`allocation.ts`)
- `getCash()` (exists as `commands/cash.ts`)
- `getPerformance()` (`performance.ts`)
- `getPriceFreshness()` (`freshness.ts`)

Plus a new holdings query that joins `current_holdings` / `holdings_with_value` PG views with `daily_returns` to get day-gain, cost-basis, total-gain per holding. This could be a new SQL function (e.g., `portfolio_holdings_sql()`) or built in TypeScript from existing data.

**Touches**: NEW file `src/commands/dashboard.ts`, optionally NEW SQL function in `portfolio_db/sql/functions.sql`.

### 4.2 Dashboard publish command (`src/cloudflare/dashboard_publish.ts`) — NEW FILE

Analogous to `publish.ts:67-181` but writes key `"dashboard"` instead of `"portfolio"` and validates the richer shape.

Reuses:
- `loadLocalConfig()` (`config.ts:8-18`)
- `putKvValueViaApi()` (`kv_api.ts:3-37`) — Cloudflare REST API PUT
- `spawnWrangler()` (`spawn.ts:12-25`) — fallback via wrangler CLI

**Touches**: NEW file `src/cloudflare/dashboard_publish.ts`.

### 4.3 CLI command: `portfolio dashboard publish` — EXTEND

Register a new subcommand in `src/cli.ts` that calls `dashboard_publish.ts`. The existing `portfolio cloudflare publish` publishes the widget snapshot; `portfolio dashboard publish` publishes the dashboard snapshot.

**Touches**: `src/cli.ts` (add case in command dispatch, ~line 850-910 area).

### 4.4 Service cron integration — EXTEND

Add a `dashboard_publish` job to the service scheduler (`service.ts:468-491`) alongside the existing `cloudflare_publish` job. Controlled by env `PORTFOLIO_DASHBOARD_PUBLISH=true` + `PORTFOLIO_DASHBOARD_PUBLISH_INTERVAL`.

**Touches**: `src/service.ts` (add job in `startPortfolioService()`), `src/service.ts:413-451` (add config parsing).

### 4.5 Worker / Pages for dashboard — NEW

Two options:

**Option A: Pages (recommended)**
- SPA built to static assets (`portfolio-dashboard/dist/`)
- `wrangler.jsonc` for Pages project `portfolio-dashboard`
- Pages Function at `/functions/api/dashboard.ts` reads KV and returns snapshot JSON
- Static assets served directly by Pages CDN

**Option B: Worker (mirror widget pattern)**
- All assets bundled into Worker JS
- Served via `workers.dev` subdomain
- Same pattern as existing `worker.js` (`templates.ts:41-114`) but serves HTML/CSS/JS assets + `/api/dashboard`

**Touches**: NEW `portfolio-dashboard/` directory in repo root (SPA source + build config), NEW Pages Function OR extended `templates.ts` for dashboard Worker JS.

### 4.6 KV key — reuse namespace, new key

No new KV namespace needed. The dashboard writes to key `"dashboard"` in the same `PORTFOLIO_KV` namespace. The Worker/Pages Function reads from that key.

**Touches**: `src/cloudflare/dashboard_publish.ts` (hardcode or env-var the KV key `"dashboard"`), Pages Function / Worker code.

### 4.7 CORS handling

**Not needed for Pattern 1 (KV snapshot).** The SPA and the KV data are served from the same Cloudflare origin — no cross-origin requests.

If Pattern 2/3 (tunnel) is chosen later, the API now supports opt-in CORS via `PORTFOLIO_API_CORS_ORIGIN` (wired through `src/api/server.ts`). Example addition:

```typescript
// server.ts — enable CORS for a tunnel-backed frontend
const server = createApiServer({ corsOrigin: "https://dashboard.example.com" });
```

### 4.8 Frontend SPA build pipeline — NEW

The SPA lives in repo root `portfolio-dashboard/` and is built independently:

```
portfolio-dashboard/
├── src/            # SPA source (framework TBD)
├── public/         # static assets
├── package.json    # separate package.json
├── wrangler.jsonc  # Pages config
├── functions/
│   └── api/
│       └── dashboard.ts  # reads KV, returns DashboardSnapshot
└── dist/           # build output (.gitignored)
```

**Touches**: NEW `portfolio-dashboard/` directory tree.

### Summary checklist (ordered by dependency)

| # | Item | New/Extend | Touches |
|---|---|---|---|
| 1 | `DashboardSnapshot` type + builder (`src/commands/dashboard.ts`) | New | `src/commands/dashboard.ts` |
| 2 | `dashboard_publish.ts` — KV publish for dashboard key | New | `src/cloudflare/dashboard_publish.ts` |
| 3 | CLI `portfolio dashboard publish` command | Extend | `src/cli.ts` |
| 4 | Service cron job for dashboard publish | Extend | `src/service.ts` |
| 5 | Worker/Pages project with `/api/dashboard` endpoint | New | `portfolio-dashboard/` directory |
| 6 | Frontend SPA (HTML/CSS/JS framework) | New | `portfolio-dashboard/src/` |
| 7 | CORS on API (deferred to v2/tunnel) | Extend | `src/api/server.ts:155-159` |
| 8 | Cloudflare Access / Auth (deferred to v2/tunnel) | New | Cloudflare dashboard config, not code |

## 5. Security

### What must never be public

- **Write routes** (`POST /transactions`, `POST /exchange`, `PATCH/DELETE /transactions/:id`) — not reachable in Pattern 1 since the SPA only talks to KV-backed Worker.
- **Database credentials** — never leave the backend. The KV snapshot contains only computed values.
- **API tokens** — `CLOUDFLARE_API_TOKEN` stays in backend env (`auth.ts:7`). The Worker uses KV binding, not an API token.
- **`CLOUDFLARE_ACCOUNT_ID`** + **KV namespace ID** — stay in `.portfolio/config.json` and env vars on the backend. Never in the SPA or Worker code.

### Access control

- **v1 (Pattern 1)**: Public read-only dashboard. The KV-backed Worker serves publicly via `workers.dev` or custom domain. No auth — same risk profile as the existing widget.
- **v2 (Pattern 3 / tunnel)**: Cloudflare Access for the tunnel path (`cloudflared` + Access policy), plus API auth (token/session) on the backend.

### Secret handling (same rule as today)

- `CLOUDFLARE_API_TOKEN` — env var, never in repo
- `CLOUDFLARE_ACCOUNT_ID` — env var or `wrangler whoami` parse (`auth.ts:60-71`)
- KV namespace ID — in `.portfolio/config.json` (gitignored), referenced by `config.ts:8-18`
- DB connection string — `PORTFOLIO_DB_URL` env var, never in KV or Worker code

## 6. Phasing

### v1 — Read-only KV snapshot (recommended first release)

| Deliverable | Depends on | Estimated scope |
|---|---|---|
| Dashboard snapshot builder + KV publish | None (all data sources exist) | 1 new file + CLI integration |
| Worker/Pages serving SPA + `/api/dashboard` | #4 (items 1-3 above) | 1 new directory |
| Frontend SPA (responsive, read-only) | #218 | New `portfolio-dashboard/` app |
| Holdings table | `portfolio_holdings_sql()` or TS join of existing data | New SQL or TS in `dashboard.ts` |
| Value chart (365d series) | `daily_returns` query (same as `widget.ts:66-73`) | Included in snapshot builder |

**What works**: Summary header, holdings table, allocation card, cash breakdown, value chart, gain/loss card.
**What doesn't**: Dividend payouts (#213), write operations, sector allocation.

### v2 — Live/write via Cloudflare Tunnel

| Deliverable | Depends on | Estimated scope |
|---|---|---|
| Cloudflare Tunnel (`cloudflared`) on backend | Backend access | Ops work, not code |
| Cloudflare Access for auth | Tunnel setup | Cloudflare dashboard config |
| CORS on API (`server.ts:155-159`) | Tunnel + Access | 2-line change |
| API auth (token/session) on backend | Access | New middleware |
| Write UI (add/edit/delete from dashboard) | All of the above | SPA work |
| Live refresh (call API directly for latest data) | Tunnel + CORS | SPA work |

### Dependency on other issues

| Issue | What it blocks | Priority for v1 |
|---|---|---|
| #218 | Overall dashboard design (already read) | **Foundation** |
| #213 (dividends) | Dividend payouts card in dashboard | **v1.1** — not blocking v1; card shows "coming soon" |

## 7. Open questions for the user

1. **Cloudflare Pages vs Worker?** Pages is recommended for SPA hosting (free unlimited static asset requests, git-integrated deploys, preview branches). Worker-only (mirroring widget) works too but bundles all assets into one JS file. Which do you prefer?

2. **Custom domain?** Workers.dev subdomain (`portfolio-dashboard.xxx.workers.dev`) is free and works out of the box. A custom domain (e.g., `dash.example.com`) requires Cloudflare DNS setup. Which do you want?

3. **Public read-only vs authenticated?** v1 with KV snapshot means the dashboard is public (like the existing widget Worker at `portfolio-widget.xxx.workers.dev/portfolio`). Is that acceptable, or do you want Cloudflare Access from day one?

4. **Reuse KV namespace or new one?** `PORTFOLIO_KV` already holds the widget snapshot at key `"portfolio"`. The dashboard uses key `"dashboard"` in the same namespace — no new namespace needed. Confirm this is acceptable?

5. **Frontend framework preference?** The SPA can be any framework (Svelte, SolidJS, React, plain HTML/JS) as long as it builds to static assets. What's your preference?

6. **Snapshot refresh interval?** The widget publishes hourly via cron (`service.ts:468-491`). Same for the dashboard? Or less frequent (e.g., 4h)?

---

*Analysis completed. File references correspond to `portfolio-ts/src/` unless otherwise noted.*
