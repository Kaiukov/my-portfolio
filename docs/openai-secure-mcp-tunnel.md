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
