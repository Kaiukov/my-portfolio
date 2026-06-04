import { success, error, type SuccessEnvelope } from "../response.js";
import { getStatus } from "../commands/status.js";
import { getSummary } from "../commands/summary.js";
import { getAllocation } from "../commands/allocation.js";
import { getCash } from "../commands/cash.js";
import { getCurrencyExposure } from "../commands/currency_exposure.js";
import { getIncome } from "../commands/income.js";
import { getRealizedGains } from "../commands/realized_gains.js";
import { getPerformance } from "../commands/performance.js";
import { getMwr } from "../commands/mwr.js";
import { getHealth } from "../commands/health.js";
import { verifyPrices } from "../commands/verify_prices.js";
import { getPriceFreshness } from "../commands/freshness.js";
import { getAssetMetadataRecords } from "../commands/asset_metadata.js";
import { ValidationError } from "../validators.js";
import { resolveWriteHandlers, toWriteErrorEnvelope, type WriteHandlers } from "../adapters/shared.js";

type RequestContext = {
  ready?: () => Promise<ReadyRouteResult> | ReadyRouteResult;
  write?: Partial<WriteHandlers>;
};

type Handler = (searchParams: URLSearchParams) => Promise<SuccessEnvelope>;

type JsonObject = Record<string, unknown>;

export interface ReadyRouteResult {
  status: 200 | 503;
  body: unknown;
}

const TRANSACTION_ID_ROUTE = /^\/transactions\/(\d+)$/;

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
  if (path === "/transactions") return ["POST"];
  if (TRANSACTION_ID_ROUTE.test(path)) return ["PATCH", "PUT", "DELETE"];
  if (path === "/exchange") return ["POST"];
  if (path === "/split") return ["POST"];
  if (ROUTES[path]) return ["GET"];
  return null;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
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

export async function handleRequest(req: Request, ctx: RequestContext = {}): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const allowedMethods = allowedMethodsForPath(path);
  const write = resolveWriteHandlers(ctx.write);

  if (!allowedMethods) {
    return jsonResponse(
      error("api", "NOT_FOUND", `Route ${path} not found`),
      404,
    );
  }

  if (!allowedMethods.includes(req.method)) {
    return jsonResponse(
      error("api", "METHOD_NOT_ALLOWED", `Method ${req.method} not allowed for ${path}. Allowed: ${allowedMethods.join(", ")}`),
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

  try {
    if (req.method === "GET") {
      const handler = ROUTES[path];
      const envelope = await handler(url.searchParams);
      return jsonResponse(envelope, 200);
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

      return jsonResponse(success("add", result), 200);
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
      return jsonResponse(success("exchange", result), 200);
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
      return jsonResponse(success("split", result), 200);
    }

    const transMatch = TRANSACTION_ID_ROUTE.exec(path);
    if (!transMatch) {
      return jsonResponse(error("api", "NOT_FOUND", `Route ${path} not found`), 404);
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
        return jsonResponse(success("edit", result), 200);
      }

      // PUT and PATCH both route through editTransaction to preserve a single mutation path.
      const result = await write.editTransaction(transId, changes);
      return jsonResponse(success("edit", result), 200);
    }

    if (req.method === "DELETE") {
      const isDryRun = boolFlag(url.searchParams, body, "dry_run", "dryRun", "dry-run");
      if (isDryRun) {
        const result = await write.deletePreview(transId);
        return jsonResponse(success("delete", result, result.would_delete.length), 200);
      }

      const confirm = boolFlag(url.searchParams, body, "confirm");
      const result = await write.deleteTransaction(transId, confirm);
      return jsonResponse(success("delete", result, result.deleted_ids.length), 200);
    }
  } catch (err) {
    const routeCommand =
      path === "/transactions"
        ? "add"
        : path === "/exchange"
          ? "exchange"
          : path === "/split"
            ? "split"
            : TRANSACTION_ID_ROUTE.test(path)
              ? (req.method === "DELETE" ? "delete" : "edit")
              : "api";
    const mapped = toWriteErrorEnvelope(routeCommand, err);
    return jsonResponse(mapped.body, mapped.status);
  }

  return jsonResponse(
    error("api", "METHOD_NOT_ALLOWED", `Method ${req.method} not allowed for ${path}`),
    405,
  );
}

export function createApiServer(opts?: { port?: number; ready?: () => Promise<ReadyRouteResult> | ReadyRouteResult }) {
  const port = opts?.port ?? 8787;
  const server = Bun.serve({
    port,
    fetch: (req) => handleRequest(req, { ready: opts?.ready }),
  });
  return server;
}
