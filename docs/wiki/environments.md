# Environments

> Live deploys, KV writes, and DB migrations are orchestrator-only; delegated agents work on mocks.

This page documents the dev and prod runtime boundaries only. The app runs via Docker in both environments.

## Dev

| Field | Value |
|---|---|
| Role | integration / QA twin (permanent) |
| Host | `ssh root@dev` (Tailscale alias) -> `root@100.118.240.71` |
| Type | Linux host with Docker + Docker Compose (no native bun/psql) |
| Deploy path | `/root/portfolio-dev` |
| Runtime | app runs via `docker compose` (service + PostgreSQL in Docker, ~205-transaction dataset) |
| Automation / cron | price refresh hourly · widget publish hourly · backup every 24h |
| Storage | Cloudflare R2 backups + KV widget (live, verified 2026-06-01) |
| First deployed | issue #135 |

## Prod

| Field | Value |
|---|---|
| Role | production (live, serving) |
| Host | Proxmox CT 104 (Docker-in-LXC) -> `192.168.1.104` |
| Provisioned | 2026-06-01 |
| API | read + write (`POST`/`PATCH`/`DELETE /transactions`, `/exchange`) |
| Automation / cron | price refresh hourly · widget publish hourly · backup every 24h |
| Scheduler KV key | `prod:portfolio:0fa1c86` |
| R2 backup prefix | `prod/` |
| Data | ~205 transactions, cost basis preserved |
| First deployed | issue #178 (2026-06-01) |

## Lifecycle

- **Dev** is a **permanent QA twin**, NOT scheduled for decommission. It serves as the integration environment for testing changes before they reach prod.
- **Prod** is the canonical environment for consumers — the agent skills on the openclaw/hermes box (`192.168.1.131`) and the production widget (`portfolio-widget-prod.kayukov2010.workers.dev`) point at prod (`192.168.1.104:8787`).
- The two environments run independently. They may show slightly different `portfolio_value` due to price-refresh timing, while sharing identical cost basis. Decommissioning dev would be a separate, explicit decision — it is not implied by prod going live.
- Before any prod recreate, run `docker compose config | grep PORTFOLIO_DB_URL` and verify the resolved URL contains the 48-char prod password, not `portfolio_password`.
