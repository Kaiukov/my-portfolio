import { spawnWrangler } from "./spawn.js";
import { loadLocalConfig } from "./config.js";
import type { PublishResult, PortfolioSnapshot } from "./types.js";
import { getSummary } from "../commands/summary.js";
import { getWidget } from "../commands/widget.js";
import { getStatus } from "../commands/status.js";
import { getPriceFreshness } from "../commands/freshness.js";

export async function buildSnapshot(): Promise<PortfolioSnapshot> {
  const [summary, widget, status, freshness] = await Promise.all([
    getSummary(),
    getWidget(180),
    getStatus(),
    getPriceFreshness(),
  ]);

  return {
    portfolio_value_usd: summary.portfolio_value_usd,
    today: { abs: widget.today.amount, pct: widget.today.pct },
    total: {
      abs: status.total_gain ?? 0,
      pct: status.total_gain_pct ?? 0,
    },
    history: widget.series.map((s) => ({ date: s.date, value: s.value })),
    prices_as_of: freshness.prices_as_of ?? "",
    as_of_date: summary.as_of_date,
    updatedAt: new Date().toISOString(),
  };
}

export function validateSnapshot(snapshot: PortfolioSnapshot): string | null {
  if (typeof snapshot.portfolio_value_usd !== "number" || !Number.isFinite(snapshot.portfolio_value_usd)) {
    return "portfolio_value_usd is missing or NaN";
  }
  if (typeof snapshot.today?.abs !== "number" || !Number.isFinite(snapshot.today.abs)) {
    return "today.abs is missing or NaN";
  }
  if (typeof snapshot.today?.pct !== "number" || !Number.isFinite(snapshot.today.pct)) {
    return "today.pct is missing or NaN";
  }
  if (typeof snapshot.total?.abs !== "number" || !Number.isFinite(snapshot.total.abs)) {
    return "total.abs is missing or NaN";
  }
  if (typeof snapshot.total?.pct !== "number" || !Number.isFinite(snapshot.total.pct)) {
    return "total.pct is missing or NaN";
  }
  if (!Array.isArray(snapshot.history)) {
    return "history is missing or not an array";
  }
  if (!snapshot.as_of_date) {
    return "as_of_date is missing or empty";
  }
  if (!snapshot.updatedAt) {
    return "updatedAt is missing or empty";
  }
  return null;
}

export async function publishToKv(projectRoot?: string): Promise<PublishResult> {
  const root = projectRoot ?? process.cwd();
  const config = loadLocalConfig(root);

  if (!config) {
    return {
      success: false,
      key: "portfolio",
      namespaceId: null,
      snapshot: null,
      error:
        "Not initialized. Run `portfolio cloudflare init` and `portfolio cloudflare deploy` first.",
    };
  }

  const namespaceId = config.kv_namespace_id;
  if (!namespaceId) {
    return {
      success: false,
      key: "portfolio",
      namespaceId: null,
      snapshot: null,
      error:
        "KV namespace not configured. Run `portfolio cloudflare init` or set kv_namespace_id in .portfolio/config.json.",
    };
  }

  const snapshot = await buildSnapshot();

  const validationError = validateSnapshot(snapshot);
  if (validationError) {
    return {
      success: false,
      key: "portfolio",
      namespaceId,
      snapshot,
      error: `Validation failed: ${validationError}`,
    };
  }

  const payload = JSON.stringify(snapshot);
  const proc = spawnWrangler([
    "kv",
    "key",
    "put",
    "portfolio",
    payload,
    "--namespace-id",
    namespaceId,
    "--remote",
  ]);

  if (proc.exitCode !== 0) {
    return {
      success: false,
      key: "portfolio",
      namespaceId,
      snapshot,
      error: `wrangler kv key put failed (exit code ${proc.exitCode}): ${proc.stderr}`.trim(),
    };
  }

  return {
    success: true,
    key: "portfolio",
    namespaceId,
    snapshot,
  };
}
