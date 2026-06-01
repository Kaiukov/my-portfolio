import { success, error } from "../response.js";
import { getStatus } from "../commands/status.js";
import { getSummary } from "../commands/summary.js";
import { getAllocation } from "../commands/allocation.js";
import { getCash } from "../commands/cash.js";
import { getPerformance } from "../commands/performance.js";
import { getMwr } from "../commands/mwr.js";
import { getHealth } from "../commands/health.js";
import { verifyPrices } from "../commands/verify_prices.js";

type RequestContext = {
  ready?: () => Promise<unknown> | unknown;
};

type Handler = (searchParams: URLSearchParams, ctx: RequestContext) => Promise<unknown>;

const ROUTES: Record<string, Handler> = {
  "/health": async (p) => {
    const maxAgeDays = parseIntParam(p, "max_age_days");
    return getHealth(maxAgeDays);
  },
  "/status": async (p) => {
    const asOf = strParam(p, "as_of");
    return getStatus(asOf);
  },
  "/summary": async (p) => {
    const asOf = strParam(p, "as_of");
    return getSummary(asOf);
  },
  "/allocation": async (p) => {
    const asOf = strParam(p, "as_of");
    return getAllocation(asOf);
  },
  "/cash": async (p) => {
    const asOf = strParam(p, "as_of");
    return getCash(asOf);
  },
  "/performance": async (p) => {
    const asOfDate = strParam(p, "as_of");
    const benchmark = strParam(p, "benchmark");
    const fromDate = strParam(p, "from_date");
    const period = strParam(p, "period");
    return getPerformance({ asOfDate, benchmark, fromDate, period });
  },
  "/mwr": async (p) => {
    const asOf = strParam(p, "as_of");
    return getMwr(asOf);
  },
  "/verify_prices": async (p) => {
    const maxAgeDays = parseIntParam(p, "max_age_days");
    return verifyPrices(maxAgeDays);
  },
  "/ready": async (_p, ctx) => {
    if (ctx.ready) return ctx.ready();
    return { ready: true };
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

  const handler = ROUTES[path];
  if (!handler) {
    return jsonResponse(
      error("api", "NOT_FOUND", `Route ${path} not found`),
      404,
    );
  }

  try {
    const data = await handler(url.searchParams, ctx);
    const command = path.slice(1); // strip leading /
    return jsonResponse(success(command, data), 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse(error("api", "INTERNAL_ERROR", msg), 500);
  }
}

export function createApiServer(opts?: { port?: number; ready?: () => Promise<unknown> | unknown }) {
  const port = opts?.port ?? 8787;
  const server = Bun.serve({
    port,
    fetch: (req) => handleRequest(req, { ready: opts?.ready }),
  });
  return server;
}
