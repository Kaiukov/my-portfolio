// portfolio-dashboard Cloudflare Worker
// Serves the read-only dashboard SPA (index.html), the dashboard snapshot
// from KV (PORTFOLIO_KV), and a lightweight read-only MCP endpoint at /mcp.
// No DB access, no write paths, no financial logic in the Worker.
import INDEX_HTML from "./index.html";

const MCP_PROTOCOL_VERSION = "2025-03-26";
const MCP_SERVER_NAME = "portfolio-dashboard";
const MCP_SERVER_VERSION = "1.0.0";
const MCP_PATHS = new Set(["/mcp", "/sse"]);
let activeSessionId = null;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Last-Event-ID, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders, ...extraHeaders },
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}

function getDashboardKey(env) {
  return env.DASHBOARD_KV_KEY || "dashboard";
}

async function loadDashboardSnapshot(env) {
  const key = getDashboardKey(env);
  return await env.PORTFOLIO_KV.get(key, "json");
}

function asNumber(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asTextContent(payload) {
  return [
    {
      type: "text",
      text: JSON.stringify(payload, null, 2),
    },
  ];
}

function compactSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    as_of_date: snapshot.as_of_date ?? null,
    updatedAt: snapshot.updatedAt ?? null,
    prices_as_of: snapshot.prices_as_of ?? null,
    price_age_days: snapshot.price_age_days ?? null,
    stale: snapshot.stale ?? null,
    portfolio_value_usd: snapshot.portfolio_value_usd ?? null,
    total_cash_usd: snapshot.total_cash_usd ?? null,
    total_gain: snapshot.total_gain ?? null,
    total_gain_pct: snapshot.total_gain_pct ?? null,
    realized_gain: snapshot.realized_gain ?? null,
    unrealized_gain: snapshot.unrealized_gain ?? null,
    holding_count: snapshot.holding_count ?? null,
  };
}

function buildStatus(snapshot) {
  return {
    ok: true,
    snapshot_present: Boolean(snapshot),
    ...compactSnapshot(snapshot),
  };
}

function buildSummary(snapshot) {
  return {
    holding_count: snapshot?.holding_count ?? null,
    total_cash_usd: snapshot?.total_cash_usd ?? null,
    portfolio_value_usd: snapshot?.portfolio_value_usd ?? null,
    as_of_date: snapshot?.as_of_date ?? null,
  };
}

function buildWidget(snapshot) {
  if (!snapshot) return null;
  return {
    title: "Portfolio dashboard",
    currency: "USD",
    as_of_date: snapshot.as_of_date ?? null,
    last_refresh: snapshot.updatedAt ?? snapshot.prices_as_of ?? null,
    value: snapshot.portfolio_value_usd ?? null,
    today: {
      amount: snapshot.today?.abs ?? 0,
      pct: snapshot.today?.pct ?? 0,
    },
    total: {
      amount: snapshot.total?.abs ?? 0,
      pct: snapshot.total?.pct ?? 0,
    },
    series: Array.isArray(snapshot.history)
      ? snapshot.history.map((row) => ({ date: row.date, value: row.value }))
      : [],
  };
}

function buildAllocation(snapshot) {
  return Array.isArray(snapshot?.allocation) ? snapshot.allocation : [];
}

function buildCash(snapshot) {
  return Array.isArray(snapshot?.cash) ? snapshot.cash : [];
}

function buildPerformance(snapshot) {
  return snapshot?.performance ?? null;
}

function buildVerifyPrices(snapshot) {
  return {
    prices_as_of: snapshot?.prices_as_of ?? null,
    price_age_days: snapshot?.price_age_days ?? null,
    stale: snapshot?.stale ?? null,
  };
}

function toolDefinitions() {
  const inputSchema = {
    type: "object",
    properties: {
      as_of: { type: "string" },
      asOf: { type: "string" },
    },
    additionalProperties: true,
  };

  return [
    {
      name: "dashboard",
      description: "Return the full read-only dashboard snapshot from KV.",
      inputSchema,
    },
    {
      name: "status",
      description: "Return the portfolio status summary from the dashboard snapshot.",
      inputSchema,
    },
    {
      name: "summary",
      description: "Return the summary card data from the dashboard snapshot.",
      inputSchema,
    },
    {
      name: "allocation",
      description: "Return the allocation table from the dashboard snapshot.",
      inputSchema,
    },
    {
      name: "cash",
      description: "Return the cash breakdown from the dashboard snapshot.",
      inputSchema,
    },
    {
      name: "performance",
      description: "Return the performance block from the dashboard snapshot.",
      inputSchema,
    },
    {
      name: "widget",
      description: "Return the compact widget view from the dashboard snapshot.",
      inputSchema,
    },
    {
      name: "verify_prices",
      description: "Return freshness data for prices used by the dashboard snapshot.",
      inputSchema,
    },
    {
      name: "health",
      description: "Return a lightweight health/freshness status for the dashboard worker.",
      inputSchema,
    },
  ];
}

function mcpEnvelope(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function mcpError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

function parseMaybeJson(raw) {
  if (!raw.trim()) return null;
  return JSON.parse(raw);
}

function pickId(message) {
  return message && typeof message === "object" && "id" in message ? message.id : null;
}

function mcpResultFromSnapshot(toolName, snapshot) {
  switch (toolName) {
    case "dashboard":
      return snapshot ?? { error: "dashboard not published" };
    case "status":
      return buildStatus(snapshot);
    case "summary":
      return buildSummary(snapshot);
    case "allocation":
      return buildAllocation(snapshot);
    case "cash":
      return buildCash(snapshot);
    case "performance":
      return buildPerformance(snapshot);
    case "widget":
      return buildWidget(snapshot);
    case "verify_prices":
      return buildVerifyPrices(snapshot);
    case "health":
      return buildStatus(snapshot);
    default:
      throw new Error(`Unsupported MCP tool: ${toolName}`);
  }
}

async function handleMcpToolCall(toolName, args, env) {
  const snapshot = await loadDashboardSnapshot(env);
  if (!snapshot && toolName !== "health") {
    throw new Error("dashboard not published");
  }

  const payload = mcpResultFromSnapshot(toolName, snapshot);
  return {
    content: asTextContent({
      tool: toolName,
      args,
      data: payload,
    }),
  };
}

function buildMcpInitializeResult() {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    serverInfo: {
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
    },
    capabilities: {
      tools: { listChanged: false },
      resources: { listChanged: false },
    },
    instructions: "Read-only portfolio dashboard tools backed by Cloudflare KV.",
  };
}

async function handleMcpMessage(message, env) {
  if (!message || typeof message !== "object") {
    return mcpError(null, -32600, "Invalid Request");
  }

  const method = message.method;
  const id = pickId(message);

  if (method === "initialize") {
    const sessionId = activeSessionId || crypto.randomUUID();
    activeSessionId = sessionId;
    return {
      envelope: mcpEnvelope(id, buildMcpInitializeResult()),
      sessionId,
    };
  }

  if (method === "notifications/initialized") {
    return { notification: true };
  }

  if (method === "tools/list") {
    return mcpEnvelope(id, { tools: toolDefinitions() });
  }

  if (method === "tools/call") {
    const params = message.params && typeof message.params === "object" ? message.params : {};
    const toolName = typeof params.name === "string" ? params.name : null;
    const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};

    if (!toolName) {
      return mcpError(id, -32602, "tools/call requires params.name");
    }

    try {
      const result = await handleMcpToolCall(toolName, args, env);
      return mcpEnvelope(id, result);
    } catch (err) {
      const messageText = err instanceof Error ? err.message : String(err);
      return mcpError(id, -32000, messageText);
    }
  }

  if (method === "ping") {
    return mcpEnvelope(id, {});
  }

  return mcpError(id, -32601, `Unsupported MCP method: ${method}`);
}

async function handleMcpPost(request, env) {
  let body;
  try {
    body = parseMaybeJson(await request.text());
  } catch (err) {
    const messageText = err instanceof Error ? err.message : String(err);
    return json(mcpError(null, -32700, messageText), 400);
  }

  const accept = request.headers.get("accept") || "";
  const wantsSse = accept.includes("text/event-stream");
  const sessionId = request.headers.get("mcp-session-id") || activeSessionId || crypto.randomUUID();
  activeSessionId = sessionId;

  const emit = async (payload) => {
    if (wantsSse) {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify(payload)}\n\n`));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "Mcp-Session-Id": sessionId,
          "Mcp-Protocol-Version": MCP_PROTOCOL_VERSION,
          ...corsHeaders,
        },
      });
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Mcp-Session-Id": sessionId,
        "Mcp-Protocol-Version": MCP_PROTOCOL_VERSION,
        ...corsHeaders,
      },
    });
  };

  if (Array.isArray(body)) {
    const results = [];
    for (const message of body) {
      const response = await handleMcpMessage(message, env);
      if (response && response.notification) continue;
      results.push(response);
    }
    return emit(wantsSse ? results : results.length === 1 ? results[0] : results);
  }

  const response = await handleMcpMessage(body, env);
  if (response && response.notification) {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders,
        "Mcp-Session-Id": sessionId,
        "Mcp-Protocol-Version": MCP_PROTOCOL_VERSION,
      },
    });
  }

  return emit(response);
}

async function handleMcpGet(request, env) {
  const sessionId = request.headers.get("mcp-session-id") || activeSessionId || crypto.randomUUID();
  activeSessionId = sessionId;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`: connected\n\n`));
      const keepAlive = setInterval(() => {
        controller.enqueue(new TextEncoder().encode(`: ping\n\n`));
      }, 15000);
      request.signal.addEventListener("abort", () => {
        clearInterval(keepAlive);
        try {
          controller.close();
        } catch {
          // ignore
        }
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Mcp-Session-Id": sessionId,
      "Mcp-Protocol-Version": MCP_PROTOCOL_VERSION,
      ...corsHeaders,
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (MCP_PATHS.has(url.pathname)) {
      if (request.method === "GET") {
        return handleMcpGet(request, env);
      }
      if (request.method === "POST") {
        return handleMcpPost(request, env);
      }
      return json({ error: "method not allowed" }, 405);
    }

    switch (url.pathname) {
      case "/api/dashboard":
        return serveDashboard(request, env);
      case "/health":
        return json({ ok: true });
      case "/version":
        return json({ app: "portfolio-dashboard", pattern: "kv-snapshot-v1" });
      case "/":
      case "/index.html":
      case "/dashboard":
        return html(INDEX_HTML);
      default:
        // SPA: unknown paths fall back to the dashboard shell.
        return html(INDEX_HTML);
    }
  },
};

async function serveDashboard(_request, env) {
  const key = env.DASHBOARD_KV_KEY || "dashboard";
  const data = await env.PORTFOLIO_KV.get(key, "json");
  if (!data) {
    return json({ error: "dashboard not published" }, 404);
  }
  return json(data, 200, { "Cache-Control": "public, max-age=300" });
}
