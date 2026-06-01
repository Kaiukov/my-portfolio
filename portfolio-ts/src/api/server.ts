import { success, error, type SuccessEnvelope } from "../response.js";
import { getStatus } from "../commands/status.js";
import { getSummary } from "../commands/summary.js";
import { getAllocation } from "../commands/allocation.js";
import { getCash } from "../commands/cash.js";
import { getPerformance } from "../commands/performance.js";
import { getMwr } from "../commands/mwr.js";
import { getHealth } from "../commands/health.js";
import { verifyPrices } from "../commands/verify_prices.js";
import { getPriceFreshness } from "../commands/freshness.js";

type RequestContext = {
  ready?: () => Promise<ReadyRouteResult> | ReadyRouteResult;
};

type Handler = (searchParams: URLSearchParams) => Promise<SuccessEnvelope>;

export interface ReadyRouteResult {
  status: 200 | 503;
  body: unknown;
}

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
  "/cash": async (p) => {
    const asOf = strParam(p, "as_of");
    const freshnessMeta = await getPriceFreshness(asOf);
    const data = await getCash(asOf);
    return success("cash", data, data.rows.length, undefined, freshnessMeta as unknown as Record<string, unknown>);
  },
  "/performance": async (p) => {
    const asOfDate = strParam(p, "as_of");
    const benchmark = strParam(p, "benchmark");
    const fromDate = strParam(p, "from_date");
    const period = strParam(p, "period");
    const freshnessMeta = await getPriceFreshness(asOfDate);
    const data = await getPerformance({ asOfDate, benchmark, fromDate, period });
    return success("performance", data, null, undefined, freshnessMeta as unknown as Record<string, unknown>);
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
};

function strParam(p: URLSearchParams, key: string): string | undefined {
  return p.get(key) ?? undefined;
}

function parseIntParam(p: URLSearchParams, key: string): number | undefined {
  const raw = p.get(key);
  if (raw === null) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleRequest(req: Request, ctx: RequestContext = {}): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method !== "GET") {
    return jsonResponse(
      error("api", "METHOD_NOT_ALLOWED", `Method ${req.method} not allowed. Only GET is supported.`),
      405,
    );
  }

  if (path === "/ready") {
    if (ctx.ready) {
      const readyResult = await ctx.ready();
      return jsonResponse(readyResult.body, readyResult.status);
    }
    return jsonResponse({ ready: true }, 200);
  }

  const handler = ROUTES[path];
  if (!handler) {
    return jsonResponse(
      error("api", "NOT_FOUND", `Route ${path} not found`),
      404,
    );
  }

  try {
    const envelope = await handler(url.searchParams);
    return jsonResponse(envelope, 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse(error("api", "INTERNAL_ERROR", msg), 500);
  }
}

export function createApiServer(opts?: { port?: number; ready?: () => Promise<ReadyRouteResult> | ReadyRouteResult }) {
  const port = opts?.port ?? 8787;
  const server = Bun.serve({
    port,
    fetch: (req) => handleRequest(req, { ready: opts?.ready }),
  });
  return server;
}
