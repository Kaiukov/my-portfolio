import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { CloudflareConfig } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8"));
export const API_VERSION: string = pkg.version;

export function generateWranglerJsonc(config: CloudflareConfig): string {
  const lines = [
    "{",
    `  "$schema": "https://raw.githubusercontent.com/cloudflare/workers-sdk/main/templates/configuration/wrangler.jsonc",`,
    `  "name": "${config.wrangler_project_name}",`,
    `  "main": "worker.js",`,
    `  "compatibility_date": "2026-05-31",`,
    `  "account_id": "${config.account_id}",`,
  ];

  if (config.kv_namespace_id) {
    lines.push(`  "kv_namespaces": [`);
    lines.push(`    { "binding": "PORTFOLIO_KV", "id": "${config.kv_namespace_id}" }`);
    lines.push(`  ],`);
  } else {
    lines.push(`  "kv_namespaces": [`);
    lines.push(`    { "binding": "PORTFOLIO_KV", "id": "REPLACE_WITH_YOUR_KV_NAMESPACE_ID" }`);
    lines.push(`  ],`);
  }

  lines.push("}");
  return lines.join("\n") + "\n";
}

export function generateWorkerJs(): string {
  return `// portfolio-ts Cloudflare Worker
// Serves published portfolio.json from KV (PORTFOLIO_KV).
// CLI generates and uploads portfolio.json; this Worker only serves it.
// No DB access, no financial logic — pure static KV serving.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders, ...extraHeaders },
  });
}

const routes = {
  "/portfolio": async (_request, env) => {
    const data = await env.PORTFOLIO_KV.get("portfolio", "json");
    if (!data) {
      return json({ error: "portfolio not published" }, 404);
    }
    return json(data, 200, { "Cache-Control": "public, max-age=300" });
  },

  "/widget": async (_request, env) => {
    const data = await env.PORTFOLIO_KV.get("portfolio", "json");
    if (!data) {
      return json({ error: "portfolio not published" }, 404);
    }
    const widget = {
      title: "My holdings",
      currency: "USD",
      as_of_date: data.as_of_date ?? null,
      last_refresh: data.prices_as_of ?? data.updatedAt ?? null,
      value: data.portfolio_value_usd ?? null,
      today: { amount: data.today?.abs ?? 0, pct: data.today?.pct ?? 0 },
      total: { amount: data.total?.abs ?? 0, pct: data.total?.pct ?? 0 },
      series: Array.isArray(data.history) ? data.history.map((h) => ({ date: h.date, value: h.value })) : [],
    };
    return json(widget, 200, { "Cache-Control": "public, max-age=300" });
  },

  "/health": async () => {
    return json({ ok: true });
  },

  "/version": async () => {
    return json({ version: "${API_VERSION}" });
  },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const handler = routes[url.pathname];
    if (handler) {
      return handler(request, env);
    }

    return json({ error: "not found" }, 404);
  },
};
`;
}

export function generatePortfolioJsonTemplate(): object {
  return {
    portfolio_value_usd: 0,
    today: { abs: 0, pct: 0 },
    total: { abs: 0, pct: 0 },
    history: [],
    prices_as_of: new Date().toISOString().split("T")[0],
    as_of_date: new Date().toISOString().split("T")[0],
    updatedAt: new Date().toISOString(),
  };
}
