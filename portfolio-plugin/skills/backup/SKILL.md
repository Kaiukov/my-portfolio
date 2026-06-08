---
name: portfolio-backup
description: When the user needs to backup, restore, or manage S3/R2 backup of the portfolio PostgreSQL database.
---

# Portfolio CLI — Backup & Restore

Creates `pg_dump` snapshots of the portfolio database and optionally pushes/pulls them to S3-compatible storage (Cloudflare R2, AWS S3, MinIO).

## Commands

```bash
# Create a local pg_dump backup
portfolio backup
portfolio backup --out /tmp/portfolio.sql

# Upload the latest snapshot to S3-compatible storage
portfolio backup push

# Restore the latest snapshot from S3-compatible storage
portfolio backup pull
portfolio backup pull --key portfolio.2026-06-01_120000.sql  # Specific key
```

`push` also writes a `latest.sql` key for easy pull-by-default. `pull` provides the `psql` restore command in the response. The local backup is written to a timestamped file in the current directory.

## Required Environment Variables

Each variable accepts both the `PORTFOLIO_` prefixed form shown below and the unprefixed form (e.g. `S3_ENDPOINT`).

| Variable | Required | Description |
|----------|----------|-------------|
| `PORTFOLIO_S3_ENDPOINT` | Yes | S3-compatible endpoint URL (e.g. `https://<accountid>.r2.cloudflarestorage.com`) |
| `PORTFOLIO_S3_BUCKET` | Yes | Bucket name |
| `PORTFOLIO_S3_ACCESS_KEY_ID` | Yes | S3 access key |
| `PORTFOLIO_S3_SECRET_ACCESS_KEY` | Yes | S3 secret key |
| `PORTFOLIO_S3_REGION` | No (default: `auto`) | S3 region |
| `PORTFOLIO_S3_PREFIX` | No | Key prefix (e.g. `portfolio/`) |

`PORTFOLIO_DB_URL` must also be set for all backup commands.

## Cron-Backup Env (Service Mode)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORTFOLIO_BACKUP_ENABLED` | `false` | Enable periodic backup in Docker service |
| `PORTFOLIO_BACKUP_INTERVAL` | `24h` | Interval between backups when enabled |

## Typical Setup (Cloudflare R2)

1. Create an R2 bucket in the Cloudflare Dashboard.
2. Generate an R2 API token (read/write). Use the endpoint, access key, and secret from the token.
3. Set the environment variables above.
4. Run `portfolio backup push` to upload.
