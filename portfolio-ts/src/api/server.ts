import { success, error, type SuccessEnvelope } from "../response.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createPortfolioMcpServer } from "../mcp/server.js";
import { getStatus } from "../commands/status.js";
import { getSummary } from "../commands/summary.js";
import { getAllocation } from "../commands/allocation.js";
import { getCash } from "../commands/cash.js";
import { getCashDrag } from "../commands/cash_drag.js";
import { getCurrencyExposure } from "../commands/currency_exposure.js";
import { getRebalance } from "../commands/rebalance.js";
import { getIncome } from "../commands/income.js";
import { getRealizedGains } from "../commands/realized_gains.js";
import { getPerformance } from "../commands/performance.js";
import { getMwr } from "../commands/mwr.js";
import { getHealth } from "../commands/health.js";
import { verifyPrices } from "../commands/verify_prices.js";
import { getDiversification } from "../commands/diversification.js";
import { getConcentration } from "../commands/concentration.js";
import { getPriceFreshness } from "../commands/freshness.js";
import { getAssetMetadataRecords } from "../commands/asset_metadata.js";
import { getDecomposition } from "../commands/decomposition.js";
import { getProjection } from "../commands/projection.js";
import { getWithdrawal } from "../commands/withdrawal.js";
import { getAssetAnalysis } from "../commands/asset_analysis.js";
import { ValidationError } from "../validators.js";
import { resolveWriteHandlers, toWriteErrorEnvelope, type WriteHandlers } from "../adapters/shared.js";

type RequestContext = {
  ready?: () => Promise<ReadyRouteResult> | ReadyRouteResult;
  write?: Partial<WriteHandlers>;
  corsOrigin?: string;
};

type Handler = (searchParams: URLSearchParams) => Promise<SuccessEnvelope>;

type JsonObject = Record<string, unknown>;

export interface ReadyRouteResult {
  status: 200 | 503;
  body: unknown;
}

const TRANSACTION_ID_ROUTE = /^\/transactions\/(\d+)$/;
const MCP_HTTP_PATHS = new Set(["/mcp", "/sse"]);

const ROUTES: Record<string, Handler> = {
  "/health": async (p) => {
    const maxAgeDays = parseIntParam(p, "max_age_days");
    const data = await getHealth(maxAgeDays);
    return success("health", data);
  },
  "/status": async (p) => {
    const asOf = strParam(p, "as_of");
    const freshnessMeta = await getPriceFreshness(asOf);
    const data = await getStatus(asOf);
    return success("status", data, null, undefined, freshnessMeta as unknown as Record<string, unknown>);
  },
  "/summary": async (p) => {
    const asOf = strParam(p, "as_of");
    const freshnessMeta = await getPriceFreshness(asOf);
    const data = await getSummary(asOf);
    return success("summary", data, null, undefined, freshnessMeta as unknown as Record<string, unknown>);
  },
  "/allocation": async (p) => {
    const asOf = strParam(p, "as_of");
    const freshnessMeta = await getPriceFreshness(asOf);
    const data = await getAllocation(asOf);
    return success("allocation", data, data.rows.length, undefined, freshnessMeta as unknown as Record<string, unknown>);
  },
  "/rebalance": async (p) => {
    const targetStr = strParam(p, "target");
    if (!targetStr) {
      throw new ValidationError("target query parameter is required (e.g. ?target=VTI=50,VXUS=20,BND=30)");
    }
    const asOf = strParam(p, "as_of");
    const data = await getRebalance(targetStr, asOf);
    return success("rebalance", data, data.rows.length);
  },
  "/concentration": async (p) => {
    const asOf = strParam(p, "as_of");
    const topN = parseIntParam(p, "top_n") ?? 5;
    const freshnessMeta = await getPriceFreshness(asOf);
    const data = await getConcentration(asOf, topN);
    return success("concentration", data, null, undefined, freshnessMeta as unknown as Record<string, unknown>);
  },
  "/diversification": async (p) => {
    const asOf = strParam(p, "as_of");
    const lookbackDays = parseIntParam(p, "lookback_days") ?? 252;
    const minCorrelation = parseFloatParam(p, "min_correlation") ?? 0.0;
    const freshnessMeta = await getPriceFreshness(asOf);
    const data = await getDiversification(asOf, lookbackDays, minCorrelation);
    return success("diversification", data, null, undefined, freshnessMeta as unknown as Record<string, unknown>);
  },
  "/decomposition": async (p) => {
    const asOf = strParam(p, "as_of");
    const freshnessMeta = await getPriceFreshness(asOf);
    const data = await getDecomposition(asOf);
    return success("decomposition", data, null, undefined, freshnessMeta as unknown as Record<string, unknown>);
  },
  "/cash": async (p) => {
    const asOf = strParam(p, "as_of");
    const freshnessMeta = await getPriceFreshness(asOf);
    const data = await getCash(asOf);
    return success("cash", data, data.rows.length, undefined, freshnessMeta as unknown as Record<string, unknown>);
  },
  "/cash_drag": async (p) => {
    const asOf = strParam(p, "as_of");
    const fromDate = strParam(p, "from_date");
    const benchmarkReturnRate = parseFloatParam(p, "benchmark_return_rate");
    const cashReturnRate = parseFloatParam(p, "cash_return_rate");
    const freshnessMeta = await getPriceFreshness(asOf);
    const data = await getCashDrag({ asOfDate: asOf, fromDate, benchmarkReturnRate, cashReturnRate });
    return success("cash_drag", data, null, undefined, freshnessMeta as unknown as Record<string, unknown>);
  },
  "/currency_exposure": async (p) => {
    const asOf = strParam(p, "as_of");
    const freshnessMeta = await getPriceFreshness(asOf);
    const data = await getCurrencyExposure(asOf);
    return success("currency_exposure", data, data.rows.length, undefined, freshnessMeta as unknown as Record<string, unknown>);
  },
  "/income": async (p) => {
    const asOf = strParam(p, "as_of");
    const fromDate = strParam(p, "from_date");
    const asset = strParam(p, "asset");
    const data = await getIncome(asOf, fromDate, asset);
    return success("income", data, data.rows.length);
  },
  "/realized_gains": async (p) => {
    const fromDate = strParam(p, "from_date");
    const toDate = strParam(p, "to_date");
    const asset = strParam(p, "asset");
    const byYear = parseBoolValue(p.get("by_year")) ?? false;
    const data = await getRealizedGains({ fromDate, toDate, asset, byYear });
    return success("realized_gains", data, data.rows.length);
  },
  "/performance": async (p) => {
    const asOfDate = strParam(p, "as_of");
    const benchmark = strParam(p, "benchmark");
    const fromDate = strParam(p, "from_date");
    const period = strParam(p, "period");
    const inflationRate = strParam(p, "inflation_rate");
    const freshnessMeta = await getPriceFreshness(asOfDate);
    const { data, benchmark: resolvedBenchmark } = await getPerformance({ asOfDate, benchmark, fromDate, period, inflationRate });
    const meta = { ...(freshnessMeta as unknown as Record<string, unknown>), benchmark: resolvedBenchmark };
    return success("performance", data, null, undefined, meta);
  },
  "/mwr": async (p) => {
    const asOf = strParam(p, "as_of");
    const freshnessMeta = await getPriceFreshness(asOf);
    const data = await getMwr(asOf);
    return success("mwr", data, null, undefined, freshnessMeta as unknown as Record<string, unknown>);
  },
  "/verify_prices": async (p) => {
    const maxAgeDays = parseIntParam(p, "max_age_days");
    const data = await verifyPrices(maxAgeDays);
    return success("verify_prices", data);
  },
  "/asset_metadata": async (p) => {
    const asset = strParam(p, "asset");
    const refresh = parseBoolValue(p.get("refresh")) ?? false;
    const data = await getAssetMetadataRecords({ asset, refresh });
    return success("asset_metadata", data, data.assets.length);
  },
  "/projection": async (p) => {
    const asOfDate = strParam(p, "as_of");
    const monthlyContribution = parseFloatParam(p, "monthly_contribution");
    const annualReturnRate = parseFloatParam(p, "annual_return_rate");
    const targetValue = parseFloatParam(p, "target_value");
    const projectionYears = parseIntParam(p, "projection_years");
    const inflationRate = parseFloatParam(p, "inflation_rate");
    const data = await getProjection({
      asOfDate,
      monthlyContribution,
      annualReturnRate,
      targetValue,
      projectionYears,
      inflationRate,
    });
    return success("projection", data);
  },
  "/withdrawal": async (p) => {
    const asOfDate = strParam(p, "as_of");
    const annualWithdrawal = parseFloatParam(p, "annual_withdrawal");
    const withdrawalRate = parseFloatParam(p, "withdrawal_rate");
    const timeHorizonYears = parseIntParam(p, "time_horizon_years");
    const expectedReturn = parseFloatParam(p, "expected_return");
    const inflationRate = parseFloatParam(p, "inflation_rate");
    const data = await getWithdrawal({
      asOfDate,
      annualWithdrawal,
      withdrawalRate,
      timeHorizonYears,
      expectedReturn,
      inflationRate,
    });
    return success("withdrawal", data);
  },
  "/asset_analysis": async (p) => {
    const ticker = strParam(p, "ticker");
    const asset = strParam(p, "asset");
    if (!ticker && !asset) {
      throw new ValidationError("ticker or asset query parameter is required (e.g. ?ticker=AAPL)");
    }
    const period = strParam(p, "period");
    const lookbackDays = parseIntParam(p, "lookback_days") ?? parseIntParam(p, "lookbackDays");
    const benchmark = strParam(p, "benchmark");
    const asOfDate = strParam(p, "as_of") ?? strParam(p, "as_of_date") ?? strParam(p, "asOf");
    const riskFreeRate = parseFloatParam(p, "risk_free_rate") ?? parseFloatParam(p, "riskFreeRate");
    const data = await getAssetAnalysis({
      ticker,
      asset,
      period: period as Parameters<typeof getAssetAnalysis>[0]["period"],
      lookbackDays,
      benchmark,
      asOfDate,
      riskFreeRate,
    });
    return success("asset_analysis", data);
  },
};

function routeCommandForPath(path: string, method: string): string {
  if (path === "/transactions") return method === "GET" ? "transactions" : "add";
  if (path === "/exchange") return "exchange";
  if (path === "/split") return "split";
  if (TRANSACTION_ID_ROUTE.test(path)) return method === "DELETE" ? "delete" : "edit";
  if (MCP_HTTP_PATHS.has(path)) return "mcp";
  if (path === "/asset_analysis") return "asset_analysis";
  return "api";
}

function strParam(p: URLSearchParams, key: string): string | undefined {
  return p.get(key) ?? undefined;
}

function parseIntParam(p: URLSearchParams, key: string): number | undefined {
  const raw = p.get(key);
  if (raw === null) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

function parseFloatParam(p: URLSearchParams, key: string): number | undefined {
  const raw = p.get(key);
  if (raw === null) return undefined;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
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
  if (path === "/transactions") return ["POST"];
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
      return respond(envelope, 200);
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

      const result = await write.addTransaction({
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
      });

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
