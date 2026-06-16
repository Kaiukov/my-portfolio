import { success, error, type SuccessEnvelope, type Envelope } from "../response.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createPortfolioMcpServer } from "../mcp/server.js";
import { mcpSessionRegistry } from "./mcp_session_registry.js";
import { dispatchRead } from "../adapters/read_shared.js";
import { ValidationError } from "../validators.js";
import { resolveWriteHandlers, toWriteErrorEnvelope, type WriteHandlers } from "../adapters/shared.js";

type RequestContext = {
  ready?: () => Promise<ReadyRouteResult> | ReadyRouteResult;
  write?: Partial<WriteHandlers>;
  corsOrigin?: string;
};

type Handler = (searchParams: URLSearchParams) => Promise<Envelope>;

type JsonObject = Record<string, unknown>;

export interface ReadyRouteResult {
  status: 200 | 503;
  body: unknown;
}

const TRANSACTION_ID_ROUTE = /^\/transactions\/(\d+)$/;
const MCP_HTTP_PATHS = new Set(["/mcp", "/sse"]);

function argsFromSearchParams(p: URLSearchParams): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [key, value] of p.entries()) {
    args[key] = value;
  }
  return args;
}

export const ROUTES: Record<string, Handler> = {
  "/health": async (p) => dispatchRead("health", argsFromSearchParams(p)),
  "/status": async (p) => dispatchRead("status", argsFromSearchParams(p)),
  "/summary": async (p) => dispatchRead("summary", argsFromSearchParams(p)),
  "/allocation": async (p) => dispatchRead("allocation", argsFromSearchParams(p)),
  "/rebalance": async (p) => dispatchRead("rebalance", argsFromSearchParams(p)),
  "/concentration": async (p) => {
    const args = argsFromSearchParams(p);
    // concentration default: top_n=5 (not set by dispatchRead)
    if (args["top_n"] === undefined && args["topN"] === undefined) {
      args["top_n"] = "5";
    }
    return dispatchRead("concentration", args);
  },
  "/diversification": async (p) => dispatchRead("diversification", argsFromSearchParams(p)),
  "/decomposition": async (p) => dispatchRead("decomposition", argsFromSearchParams(p)),
  "/cash": async (p) => dispatchRead("cash", argsFromSearchParams(p)),
  "/cash_drag": async (p) => dispatchRead("cash_drag", argsFromSearchParams(p)),
  "/currency_exposure": async (p) => dispatchRead("currency_exposure", argsFromSearchParams(p)),
  "/income": async (p) => dispatchRead("income", argsFromSearchParams(p)),
  "/realized_gains": async (p) => dispatchRead("realized_gains", argsFromSearchParams(p)),
  "/performance": async (p) => dispatchRead("performance", argsFromSearchParams(p)),
  "/mwr": async (p) => dispatchRead("mwr", argsFromSearchParams(p)),
  "/verify_prices": async (p) => dispatchRead("verify_prices", argsFromSearchParams(p)),
  "/asset_metadata": async (p) => dispatchRead("asset_metadata", argsFromSearchParams(p)),
  "/projection": async (p) => dispatchRead("projection", argsFromSearchParams(p)),
  "/withdrawal": async (p) => dispatchRead("withdrawal", argsFromSearchParams(p)),
  "/asset_analysis": async (p) => dispatchRead("asset_analysis", argsFromSearchParams(p)),
  "/transactions": async (p) => dispatchRead("transactions", argsFromSearchParams(p)),
  "/report": async (p) => dispatchRead("report", argsFromSearchParams(p)),
};

function routeCommandForPath(path: string, method: string): string {
  if (path === "/transactions") return method === "GET" ? "transactions" : "add";
  if (path === "/report") return "report";
  if (path === "/exchange") return "exchange";
  if (path === "/split") return "split";
  if (TRANSACTION_ID_ROUTE.test(path)) return method === "DELETE" ? "delete" : "edit";
  if (MCP_HTTP_PATHS.has(path)) return "mcp";
  return "api";
}

function strField(body: JsonObject, key: string): string | undefined {
  const val = body[key];
  return typeof val === "string" ? val : undefined;
}

function floatField(body: JsonObject, key: string): number | undefined {
  const raw = body[key];
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : undefined;
  }
  if (typeof raw === "string") {
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseBoolValue(raw: unknown): boolean | undefined {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") {
    if (raw === 1) return true;
    if (raw === 0) return false;
    return undefined;
  }
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
    return undefined;
  }
  return undefined;
}

function boolFlag(search: URLSearchParams, body: JsonObject, ...keys: string[]): boolean {
  for (const key of keys) {
    if (search.has(key)) {
      const queryVal = search.get(key);
      if (queryVal === "" || queryVal === null) return true;
      const parsed = parseBoolValue(queryVal);
      return parsed ?? true;
    }
  }

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      const parsed = parseBoolValue(body[key]);
      return parsed ?? false;
    }
  }

  return false;
}

function allowedMethodsForPath(path: string): string[] | null {
  if (path === "/ready") return ["GET"];
  if (path === "/withdrawal") return ["GET"];
  if (path === "/projection") return ["GET"];
  if (path === "/transactions") return ["GET", "POST"];
  if (TRANSACTION_ID_ROUTE.test(path)) return ["PATCH", "PUT", "DELETE"];
  if (path === "/exchange") return ["POST"];
  if (path === "/split") return ["POST"];
  if (MCP_HTTP_PATHS.has(path)) return ["GET", "POST", "DELETE"];
  if (ROUTES[path]) return ["GET"];
  return null;
}

function buildCorsHeaders(corsOrigin?: string): Record<string, string> {
  if (!corsOrigin) return {};
  return {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Last-Event-ID, Mcp-Session-Id, Mcp-Protocol-Version",
    "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function jsonResponse(body: unknown, status: number, corsOrigin?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...buildCorsHeaders(corsOrigin),
    },
  });
}

async function parseJsonBody(req: Request): Promise<JsonObject> {
  const raw = await req.text();
  if (!raw.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ValidationError("Request body must be a JSON object");
  }

  return parsed as JsonObject;
}

function mcpJsonRpcError(status: number, code: number, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

async function handleMcpHttpRequest(req: Request): Promise<Response> {
  // Optional bearer auth check
  const mcpToken = process.env.PORTFOLIO_MCP_TOKEN;
  if (mcpToken) {
    const authHeader = req.headers.get("authorization");
    const expectedAuth = `Bearer ${mcpToken}`;
    if (authHeader !== expectedAuth) {
      return mcpJsonRpcError(401, -32000, "Unauthorized");
    }
  }

  try {
    const sessionId = req.headers.get("mcp-session-id") ?? undefined;

    // Existing session: reuse its persistent transport.
    if (sessionId) {
      const existing = mcpSessionRegistry.get(sessionId);
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
        mcpSessionRegistry.set(sid, transport);
      },
      onsessionclosed: (sid: string) => {
        mcpSessionRegistry.delete(sid);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) {
        mcpSessionRegistry.delete(transport.sessionId);
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

export async function handleRequest(req: Request, ctx: RequestContext = {}): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const corsOrigin = ctx.corsOrigin;
  const respond = (body: unknown, status: number): Response => jsonResponse(body, status, corsOrigin);
  const allowedMethods = allowedMethodsForPath(path);
  const write = resolveWriteHandlers(ctx.write);

  if (!allowedMethods) {
    return respond(error("api", "NOT_FOUND", `Route ${path} not found`), 404);
  }

  if (req.method === "OPTIONS") {
    if (!corsOrigin) {
      return respond(
        error("api", "METHOD_NOT_ALLOWED", `Method ${req.method} not allowed for ${path}. Allowed: ${allowedMethods.join(", ")}`),
        405,
      );
    }
    return new Response(null, {
      status: 204,
      headers: buildCorsHeaders(corsOrigin),
    });
  }

  if (!allowedMethods.includes(req.method)) {
    return respond(
      error("api", "METHOD_NOT_ALLOWED", `Method ${req.method} not allowed for ${path}. Allowed: ${allowedMethods.join(", ")}`),
      405,
    );
  }

  if (path === "/ready") {
    if (ctx.ready) {
      const readyResult = await ctx.ready();
      return respond(readyResult.body, readyResult.status);
    }
    return respond({ ready: true }, 200);
  }

  if (MCP_HTTP_PATHS.has(path)) {
    return handleMcpHttpRequest(req);
  }

  try {
    if (req.method === "GET") {
      const handler = ROUTES[path];
      const envelope = await handler(url.searchParams);
      const status = envelope.ok ? 200 : (!envelope.ok && envelope.error?.code === "INTERNAL_ERROR") ? 500 : 400;
      return respond(envelope, status);
    }

    if (path === "/transactions" && req.method === "GET") {
      const handler = ROUTES[path];
      const envelope = await handler(url.searchParams);
      const status = envelope.ok ? 200 : (!envelope.ok && envelope.error?.code === "INTERNAL_ERROR") ? 500 : 400;
      return respond(envelope, status);
    }

    if (path === "/transactions" && req.method === "POST") {
      const body = await parseJsonBody(req);
      const dateStr = strField(body, "date");
      const asset = strField(body, "asset");
      const action = strField(body, "action");
      const quantity = floatField(body, "quantity");

      if (!dateStr || !asset || !action || quantity === undefined) {
        throw new ValidationError(
          "Required: date, asset, action, quantity, exchange",
        );
      }

      const params = {
        dateStr,
        asset,
        action,
        quantity,
        price: floatField(body, "price"),
        currency: strField(body, "currency"),
        fees: floatField(body, "fees"),
        feeCurrency: strField(body, "feeCurrency") ?? strField(body, "fee_currency"),
        exchange: strField(body, "exchange") ?? "",
        account: strField(body, "account"),
      };

      const isDryRun = boolFlag(url.searchParams, body, "dry_run", "dryRun", "dry-run");
      if (isDryRun) {
        const result = await write.addDryRun(params);
        return respond(success("add", result), 200);
      }

      const result = await write.addTransaction(params);
      return respond(success("add", result), 200);
    }

    if (path === "/exchange" && req.method === "POST") {
      const body = await parseJsonBody(req);
      const dateStr = strField(body, "date");
      const fromAsset = strField(body, "fromAsset") ?? strField(body, "from_asset") ?? strField(body, "from");
      const toAsset = strField(body, "toAsset") ?? strField(body, "to_asset") ?? strField(body, "to");
      const quantity = floatField(body, "quantity");
      const rate = floatField(body, "rate");

      if (!dateStr || !fromAsset || !toAsset || quantity === undefined || rate === undefined) {
        throw new ValidationError(
          "Required: date, fromAsset, toAsset, quantity, rate",
        );
      }

      const result = await write.exchangeCurrency({ dateStr, fromAsset, toAsset, quantity, rate });
      return respond(success("exchange", result), 200);
    }

    if (path === "/split" && req.method === "POST") {
      const body = await parseJsonBody(req);
      const dateStr = strField(body, "date");
      const asset = strField(body, "asset");
      const ratio = floatField(body, "ratio");
      const confirm = body["confirm"];

      if (!dateStr || !asset || ratio === undefined) {
        throw new ValidationError("Required: date, asset, ratio, confirm");
      }

      if (!confirm) {
        throw new ValidationError("--confirm is required for split");
      }

      const result = await write.applySplit({
        dateStr,
        asset,
        ratio,
        exchange: strField(body, "exchange"),
        account: strField(body, "account"),
      });
      return respond(success("split", result), 200);
    }

    const transMatch = TRANSACTION_ID_ROUTE.exec(path);
    if (!transMatch) {
      return respond(error("api", "NOT_FOUND", `Route ${path} not found`), 404);
    }

    const transId = parseInt(transMatch[1], 10);
    const body = await parseJsonBody(req);

    if (req.method === "PATCH" || req.method === "PUT") {
      const changes = {
        dateStr: strField(body, "date"),
        asset: strField(body, "asset"),
        action: strField(body, "action"),
        quantity: floatField(body, "quantity"),
        price: floatField(body, "price"),
        currency: strField(body, "currency"),
        fees: floatField(body, "fees"),
        feeCurrency: strField(body, "feeCurrency") ?? strField(body, "fee_currency"),
        exchange: strField(body, "exchange"),
        dataSource: strField(body, "dataSource") ?? strField(body, "data_source"),
        account: strField(body, "account"),
      };

      const isDryRun = boolFlag(url.searchParams, body, "dry_run", "dryRun", "dry-run");
      if (isDryRun) {
        const result = await write.editDryRun(transId, changes);
        return respond(success("edit", result), 200);
      }

      // PUT and PATCH both route through editTransaction to preserve a single mutation path.
      const result = await write.editTransaction(transId, changes);
      return respond(success("edit", result), 200);
    }

    if (req.method === "DELETE") {
      const isDryRun = boolFlag(url.searchParams, body, "dry_run", "dryRun", "dry-run");
      if (isDryRun) {
        const result = await write.deletePreview(transId);
        return respond(success("delete", result, result.would_delete.length), 200);
      }

      const confirm = boolFlag(url.searchParams, body, "confirm");
      const result = await write.deleteTransaction(transId, confirm);
      return respond(success("delete", result, result.deleted_ids.length), 200);
    }
  } catch (err) {
    const routeCommand = routeCommandForPath(path, req.method);
    const mapped = toWriteErrorEnvelope(routeCommand, err);
    return respond(mapped.body, mapped.status);
  }

  return respond(
    error("api", "METHOD_NOT_ALLOWED", `Method ${req.method} not allowed for ${path}`),
    405,
  );
}

export function createApiServer(opts?: {
  port?: number;
  ready?: () => Promise<ReadyRouteResult> | ReadyRouteResult;
  corsOrigin?: string;
}) {
  const port = opts?.port ?? 8787;
  const corsOrigin = opts?.corsOrigin ?? process.env.PORTFOLIO_API_CORS_ORIGIN;
  const server = Bun.serve({
    port,
    fetch: (req) => handleRequest(req, { ready: opts?.ready, corsOrigin }),
  });
  return server;
}
