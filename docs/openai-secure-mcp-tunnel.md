# OpenAI Secure MCP Tunnel

**Source:** <https://developers.openai.com/api/docs/guides/secure-mcp-tunnels>
**Date archived:** 2026-06-12
**Purpose:** Connect private MCP servers to OpenAI products (ChatGPT, Codex, Responses API) without exposing them to the public internet.

---

## Overview

Secure MCP Tunnel allows you to connect private MCP servers to OpenAI products **without opening inbound ports or exposing the server to the public internet**.

- An outbound-only `tunnel-client` runs inside your network.
- It polls OpenAI for work, forwards MCP requests locally, and returns responses through the same tunnel.
- The MCP server remains fully private behind your firewall.

---

## How It Works

1. Create/manage an OpenAI-hosted MCP tunnel endpoint in **[Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels)**.
2. Run `tunnel-client` inside the network that can reach your private MCP server.
3. Configure `tunnel-client` with the **tunnel identity** and the **private MCP server address**.
4. OpenAI products send MCP requests to the OpenAI-hosted tunnel endpoint.
5. `tunnel-client` **long-polls** for queued work, forwards each JSON-RPC request to the private server, and posts the response back through the same tunnel.

> "The private MCP server does not need a public listener. The OpenAI-hosted endpoint gives supported products a normal MCP request path, while the network initiation point stays inside your boundary."

When streamed results are requested, the tunnel path forwards intermediate server-sent events.

---

## Prerequisites

| Item | Details |
|------|---------|
| **`tunnel_id`** | From [Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels) |
| **Runtime API key** | For `tunnel-client`. Needs: Tunnels **Read + Use** for the target tunnel |
| **Tunnel manager key** | For creating/editing metadata. Needs: Tunnels **Read + Manage** |
| **MCP server** | Reachable from `tunnel-client` via **stdio** or **HTTP** inside your network |

> Start with the [MCP and Connectors guide](https://platform.openai.com/docs/guides/mcp-connectors) for general concepts.

---

## Organizations & Workspaces

- A tunnel can be associated with **one or more** Platform organizations or ChatGPT workspaces.
- Include the **owning Platform org**.
- Include the **ChatGPT workspace** for connector settings visibility.
- Include **other orgs** for Codex/API flows.
- **Crucial:** A tunnel associated *only with a personal account* won't automatically appear in an enterprise ChatGPT workspace.
- If automatic linking fails, contact your OpenAI account team for a manual association override.

---

## Network Requirements

`tunnel-client` needs **outbound HTTPS only** (no inbound internet access):

| From | To | Usage |
|------|----|-------|
| Host running `tunnel-client` | `api.openai.com:443` on `/v1/tunnel/*` | Default polling & response posting |
| Host running `tunnel-client` | `mtls.api.openai.com:443` on `/v1/tunnel/*` | Polling when control-plane mTLS is configured |
| Host running `tunnel-client` | Configured private MCP server (stdio/HTTP URL) | Forwarding MCP requests inside your network |

---

## Setup & CLI

Download from [openai/tunnel-client releases](https://github.com/openai/tunnel-client/releases/latest) or via Platform tunnel settings.

> **Keep your runbook pointed at the latest-release URL** — do not hard-code a specific release.

### Stdio MCP Server

```bash
export CONTROL_PLANE_API_KEY="sk-..."
cd portfolio-ts
bun run mcp

# in another terminal, point tunnel-client at the local MCP server
# (replace the command with your own deployment path if needed)

tunnel-client init \
  --sample sample_mcp_stdio_local \
  --profile local-stdio \
  --tunnel-id tunnel_0123456789abcdef0123456789abcdef \
  --mcp-command "bun run mcp"

tunnel-client doctor --profile local-stdio --explain
tunnel-client run --profile local-stdio
```

### HTTP MCP Server

Use `--mcp-server-url` instead of `--mcp-command`:

```bash
--mcp-server-url https://mcp.internal.example.com/mcp
```

### Health & Status

- `tunnel-client` exposes `/healthz`, `/readyz`, `/metrics`, and a **local admin UI** at `/ui`.
- Admin UI is **loopback-only by default** — avoid exposing it remotely unless intentional.
- Use `tunnel-client doctor --profile <name> --explain` to validate the profile.

> **Keep `tunnel-client run ...` healthy** while you create or test the connector. Connector discovery and MCP tool calls depend on the running client.

---

## Configuration Details

### Deployment Patterns

| Pattern | Description |
|---------|-------------|
| **Kubernetes sidecar** | `tunnel-client` next to the MCP server in a single Pod over localhost |
| **Dedicated K8s deployment** | Separate from MCP server, reachable over private Service |
| **VM or systemd service** | On a host with private network access to the MCP server |

### Connecting from ChatGPT

1. Open **ChatGPT connector settings** → create a custom connector.
2. Under **Connection**, choose **Tunnel**.
3. Select an available tunnel or paste a valid `tunnel_id`.

If the tunnel doesn't appear, verify:
- The tunnel is associated with the **ChatGPT workspace** (not just a Platform org).
- The connector operator has **Tunnels Read + Use** permissions.

---

## Security & Networking

- `tunnel-client` authenticates to the OpenAI tunnel control plane via runtime API key, with optional **control-plane mTLS**.
- MCP server address stays **private** — never exposed to OpenAI or the public internet.
- Supports: **outbound proxies**, **custom CA bundles**, **control-plane client certificates**, and **MCP-side mTLS**.

### Logging Boundaries

| Log Type | Behavior |
|----------|----------|
| Tunnel transport (auth, poll, forward) | **Not** emitted as ChatGPT Compliance Platform app events |
| Tunnel metadata changes | Exposed via **API Platform Audit logs** (`tunnel.created`, `.updated`, `.deleted`) |
| App-level logs (invocation, auth lifecycle) | Apply normally — tunnel is only the transport path |

### Advanced: Harpoon (Allowlisted HTTP Callouts)

- `tunnel-client` includes an embedded `harpoon` daemon that allows MCP servers to make **allowlisted HTTP callouts** to internal + external endpoints.
- Configuration is an **allowlist + deny list** of URL prefixes, not a pass-through.
- Harpoon paths are **logged and rate-limited**.
- To enable: add `harpoon_config` to your tunnel profile. Specific configs vary by deployment profile.
- Harpoon is under active development — configuration patterns may change.

---

## Key Takeaways for Hermes/Portfolio Integration

- **MCP Tunnel solves the private-server problem** — you can run MCP servers on a private network (like the portfolio server at 192.168.1.104) and connect them to ChatGPT/Codex without opening firewall ports.
- **No inbound ports needed** — only outbound HTTPS from the tunnel-client host to `api.openai.com:443`.
- **The portfolio MCP layer** (`portfolio-ts/src/mcp/`) is exposed via `portfolio-ts/src/mcp/server.ts` / `bun run mcp`, so it can be attached to `tunnel-client` and made available in ChatGPT conversations.
- **Multi-org support** — a single tunnel can serve both personal and enterprise workspaces.
- **Harpoon** — allows controlled outbound HTTP from MCP servers for data enrichment while keeping the connection pattern secure.

---

## End-to-End Runbook: Portfolio MCP + Secure Tunnel

This runbook covers the full setup from local development to a live ChatGPT connector. Steps marked **"operator-only"** require live credentials, tunnel creation, or deployment — do not perform these in CI or automated environments.

### 1. Install and build

```bash
cd portfolio-ts
bun install                # installs deps including @modelcontextprotocol/sdk + zod
bun run typecheck          # verify zero TypeScript errors
bun test                   # verify all tests pass (DB-gated tests may skip)
```

### 2. Start the MCP server

Two transport modes are supported:

#### A. Stdio mode (for tunnel-client `--mcp-command`)

```bash
cd portfolio-ts
PORTFOLIO_DB_URL="postgresql://..." bun run mcp
```

The server starts on stdin/stdout and waits for JSON-RPC requests from the
parent process (tunnel-client). This is the recommended mode for single-host
deployments.

#### B. HTTP mode (for tunnel-client `--mcp-server-url`)

```bash
cd portfolio-ts
PORTFOLIO_DB_URL="postgresql://..." PORTFOLIO_API_CORS_ORIGIN="*" bun run start api --port 8787
```

The API server exposes `/mcp` (streamable HTTP / SSE) and `/sse` (SSE-only)
endpoints. Use this mode when `tunnel-client` runs on a different host or
container.

### 3. Configure tunnel-client (operator-only)

> ⚠️ **Operator-only step.** Do not run in CI. Requires:
> - A tunnel created at <https://platform.openai.com/settings/organization/tunnels>
> - A runtime API key with **Tunnels Read + Use** permissions
> - The `tunnel-client` binary from [GitHub releases](https://github.com/openai/tunnel-client/releases/latest)

A committed, secret-free template is available at
`portfolio-ts/tunnel-client.example.json`. Copy it and replace all `PLACEHOLDER`
values with real credentials.

#### Stdio profile setup

```bash
# Using the template as reference:
tunnel-client init \
  --profile portfolio-mcp-stdio \
  --tunnel-id tunnel_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  --mcp-command "bun run mcp"

# Validate the profile and connectivity
tunnel-client doctor --profile portfolio-mcp-stdio --explain

# Start the tunnel (keeps running, long-polls for work)
tunnel-client run --profile portfolio-mcp-stdio
```

#### HTTP profile setup

```bash
tunnel-client init \
  --profile portfolio-mcp-http \
  --tunnel-id tunnel_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  --mcp-server-url http://localhost:8787/mcp

tunnel-client doctor --profile portfolio-mcp-http --explain
tunnel-client run --profile portfolio-mcp-http
```

### 4. Create ChatGPT Connector (operator-only)

> ⚠️ **Operator-only step.** Requires access to ChatGPT connector settings.

1. Open **ChatGPT connector settings** → **Create custom connector**.
2. Under **Connection**, choose **Tunnel**.
3. Select the tunnel created in step 3.
4. The connector discovers 28 tools (23 read + 5 write) automatically from the
   MCP `tools/list` response.
5. Test a read tool (e.g. `status`) and verify the canonical JSON envelope is
   returned: `{"ok": true, "command": "status", "data": {...}, "meta": {...}}`.

### 5. Verify health

```bash
# When running in HTTP mode, check readiness
curl http://localhost:8787/ready

# Check tunnel-client health (admin UI, loopback only by default)
curl http://localhost:8080/healthz    # tunnel-client's own health
curl http://localhost:8080/readyz     # tunnel-to-MCP connectivity probe
```

### 6. Transport mode reference

**Для tunnel-client:** stdio (`bun run mcp`) — дочерний процесс.

**Для всех остальных клиентов:** канонический Streamable HTTP (`http://<host>:8787/mcp`).
Спека: [MCP Connection Spec](wiki/mcp-connect-spec.md).

| Transport | Entrypoint | Use case |
|-----------|-----------|----------|
| Stdio | `bun run mcp` | Только tunnel-client (дочерний процесс) |
| Streamable HTTP | `http://<host>:8787/mcp` | Все внешние сервисы, агенты, dashboard |

### 7. Troubleshooting

| Symptom | Check |
|---------|-------|
| Tunnel not appearing in ChatGPT | Verify tunnel is associated with the ChatGPT **workspace** (not just Platform org) |
| `tunnel-client doctor` fails | Verify runtime API key has **Tunnels Read + Use** permissions |
| MCP tools return empty | Check `PORTFOLIO_DB_URL` is set and the DB is reachable |
| `needs_recalc` in meta | Run `portfolio recalculate` or `portfolio sync` to refresh stale prices |
