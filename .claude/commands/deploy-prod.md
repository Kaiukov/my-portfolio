---
name: deploy-prod
description: Deploy portfolio-ts to production (192.168.1.104). Use when the user asks to deploy to prod or push changes to the live server.
disable-model-invocation: true
allowed-tools: Bash
---

Deploy portfolio-ts to production.

## Target

- **Host**: `192.168.1.104` (Proxmox CT 104, Docker-in-LXC)
- **Deploy path**: `/opt/portfolio` (rsync target, NOT a git repo — `/root/portfolio-dev` is the DEV host)
- **API**: `http://192.168.1.104:8787`

## Steps

1. **Run the full test suite**

   ```bash
   cd portfolio-ts && bun test
   ```

   Do not proceed if any test fails.

2. **Build the Docker image**

   ```bash
   cd /opt/portfolio/portfolio-ts && docker compose build portfolio
   ```

   **Do NOT pass a bare `-f docker-compose.yml`** — that disables the
   auto-merge of `docker-compose.override.yml`, which carries the real 48-char
   prod DB password. Run plain `docker compose` (both files auto-merge), or if
   you must be explicit pass BOTH: `-f docker-compose.yml -f docker-compose.override.yml`.

3. **Sync files to remote** (if not building on remote)

   ```bash
   rsync -avz --delete \
     --exclude '.portfolio' \
     --exclude 'docker-compose.override.yml' \
     --exclude '.env.runtime' \
     --exclude '.env' \
     --exclude 'node_modules' \
     ./ root@192.168.1.104:/opt/portfolio/
   ```

   **Critical**: The `--exclude` flags protect prod-only runtime files not in git. `.portfolio/config.json` contains Cloudflare KV config (`account_id`, `kv_namespace_id`) and is bind-mounted into the container. If lost, restore it on the host — it's live immediately (no rebuild).

4. **Pre-check DB credentials, then restart the service**

   ```bash
   cd /opt/portfolio/portfolio-ts
   # MUST show the 48-char prod password, NOT `portfolio_password` (the dev default).
   # If it shows `portfolio_password`, the override file is being ignored — STOP, do not recreate.
   docker compose config | grep PORTFOLIO_DB_URL
   # IMPORTANT: use plain `docker compose up` so `docker-compose.override.yml` auto-merges.
   docker compose up -d portfolio
   ```

5. **Verify the deployment**

   - `curl http://192.168.1.104:8787/health` → `{"success":true,...}`
   - `curl http://192.168.1.104:8787/summary` → valid JSON envelope
   - `curl -X POST http://192.168.1.104:8787/transactions -H 'Content-Type: application/json' -d '{"date":"2026-01-01","asset":"TEST","action":"buy","quantity":1,"price":1,"exchange":"TEST"}'` then delete it → write path returns success envelope
   - MCP `tools/list` at `http://192.168.1.104:8787/mcp` → returns tool definitions

6. **Publish dashboard snapshot**

   ```bash
   cd /opt/portfolio/portfolio-ts && docker compose exec portfolio bun run src/cli.ts dashboard publish
   ```

7. **Verify Cloudflare dashboard** — confirm dashboard URL returns 200 and shows correct data.

## Success Criteria

Done only when ALL of the following are true:

- [ ] All tests pass (step 1)
- [ ] Docker image builds without errors (step 2)
- [ ] Files synced to remote (step 3)
- [ ] Container restarts and stays healthy (step 4)
- [ ] CLI, HTTP API, and MCP all respond with valid JSON envelopes on prod (step 5)
- [ ] Dashboard publish succeeds (step 6)
- [ ] Cloudflare dashboard is live and shows current data (step 7)
