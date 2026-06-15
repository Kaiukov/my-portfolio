# Spec — Fix #300: ChatGPT MCP tunnel invocation loop

**Issue:** https://github.com/Kaiukov/my-portfolio/issues/300
**Branch:** `feat/openai-tunnel`
**Scope:** ONE file — `portfolio-ts/src/api/server.ts`. Do not touch financial logic, commands, SQL, or any other file except where this spec says.

---

## 1. Background (why)

The ChatGPT connector discovers all 28 tools but never executes them — it keeps re-running `initialize`/discovery. Ground-truth investigation on the live `dev` tunnel proved:

- The MCP server itself executes every tool correctly (`tools/call status` → `200`, real data).
- The live HTTP `/mcp` handler is **stateless and throwaway-per-request**: it builds a brand-new `McpServer` + transport on every HTTP request with `sessionIdGenerator: undefined`.
- Because it is stateless, `initialize` returns **no `Mcp-Session-Id`**, so the ChatGPT Apps SDK never gets a stable session and re-initializes instead of executing.
- The standalone `GET /mcp` SSE stream is an orphan per request (no session), which also makes the tunnel-client MCP readiness probe time out.

**Fix:** make the HTTP `/mcp` transport **stateful** — generate a session id, return it on `initialize`, keep one `McpServer` + transport per session in a map, and route subsequent POST/GET/DELETE by session id. Also enable plain-JSON unary responses (tunnel-friendly).

This is the canonical MCP Streamable-HTTP server pattern; the current per-request throwaway is the anti-pattern.

---

## 2. Exact changes — `portfolio-ts/src/api/server.ts`

### 2a. Add an import for `crypto` — NOT needed
`crypto.randomUUID()` is a Bun/Web global. Do **not** add any import for it.

### 2b. Add a module-level session map

Near the top of the file, right after the line:
```ts
const MCP_HTTP_PATHS = new Set(["/mcp", "/sse"]);
```
add:
```ts
// One persistent MCP server + transport per ChatGPT/Apps-SDK session, keyed by Mcp-Session-Id.
const mcpTransports = new Map<string, WebStandardStreamableHTTPServerTransport>();
```

### 2c. Replace the whole `handleMcpHttpRequest` function

**Current code to replace (the entire function):**
```ts
async function handleMcpHttpRequest(req: Request): Promise<Response> {
  try {
    const server = createPortfolioMcpServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message,
        },
        id: null,
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }
}
```

**New implementation:**
```ts
function mcpJsonRpcError(status: number, code: number, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

async function handleMcpHttpRequest(req: Request): Promise<Response> {
  try {
    const sessionId = req.headers.get("mcp-session-id") ?? undefined;

    // Existing session: reuse its persistent transport.
    if (sessionId) {
      const existing = mcpTransports.get(sessionId);
      if (existing) {
        return await existing.handleRequest(req);
      }
      return mcpJsonRpcError(404, -32000, "Bad Request: unknown session ID");
    }

    // No session id. Only a POST (an `initialize` request) may open a new session.
    if (req.method !== "POST") {
      return mcpJsonRpcError(400, -32000, "Bad Request: missing session ID");
    }

    // New session: stateful transport + persistent server, stored on init.
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (sid: string) => {
        mcpTransports.set(sid, transport);
      },
      onsessionclosed: (sid: string) => {
        mcpTransports.delete(sid);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) {
        mcpTransports.delete(transport.sessionId);
      }
    };

    const server = createPortfolioMcpServer();
    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return mcpJsonRpcError(500, -32603, message);
  }
}
```

Notes:
- The transport itself validates that a no-session POST is actually an `initialize`; if not, it returns a 400 from the SDK. We do not need to peek the body.
- `onsessioninitialized` runs synchronously during `handleRequest`, so the transport is stored before the response is returned.
- Keep everything else in the file unchanged. Do not modify `createPortfolioMcpServer`, routes, CORS, or any command.

---

## 3. Do NOT do

- Do NOT change `portfolio-ts/src/mcp/server.ts` (tool registration / capabilities). `resources/list` returning `-32601` is spec-compliant and is out of scope for this fix.
- Do NOT change tool input schemas.
- Do NOT touch any file other than `portfolio-ts/src/api/server.ts`.
- Do NOT add new npm dependencies.

---

## 4. Verification (run these and report exact output)

From `portfolio-ts/`:

```bash
bun run typecheck          # MUST be zero errors
bun test                   # MUST stay green (DB-gated tests may skip — that is fine)
```

Then a live local session check (no DB needed for the protocol assertions):

```bash
# start the API server on a spare port
PORTFOLIO_API_CORS_ORIGIN="*" bun src/cli.ts api --port 8799 &
sleep 3

# 1) initialize — capture headers; MUST now include an Mcp-Session-Id header
curl -s -D - -o /dev/null -X POST http://localhost:8799/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  | grep -i "mcp-session-id"

# stop the server
pkill -f "cli.ts api --port 8799"
```

**Pass criteria:**
1. `bun run typecheck` → no errors.
2. `bun test` → no failures (skips allowed).
3. The `initialize` response includes an `mcp-session-id` response header (it did NOT before this fix).

Report the actual command outputs. If typecheck or tests fail, fix the cause — do not skip or disable tests.
