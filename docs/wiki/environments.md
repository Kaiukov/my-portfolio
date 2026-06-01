# Environments

> Live deploys, KV writes, and DB migrations are orchestrator-only; delegated agents work on mocks.

This page documents the dev and prod runtime boundaries only. The app runs via Docker in both environments.

## Dev

| Field | Value |
|---|---|
| Role | integration / live testing |
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
| Role | production |
| Host | Proxmox CT 104 (Docker-in-LXC) -> `192.168.1.104` |
| Provisioned | 2026-06-01 |
| Status | provisioned but NOT yet serving - code/secrets/data deploy is manual (orchestrator-only) |
| Blocker | must resolve the dev->prod Cloudflare KV/R2 collision (shared namespace) before the prod publish job goes live, otherwise dev and prod overwrite each other's widget snapshot |
