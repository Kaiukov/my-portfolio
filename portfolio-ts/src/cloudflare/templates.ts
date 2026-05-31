import type { CloudflareConfig } from "./types.js";

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/portfolio") {
      const data = await env.PORTFOLIO_KV.get("portfolio", "json");
      if (!data) {
        return new Response(JSON.stringify({ error: "portfolio not published" }), {
          status: 404,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=300",
        },
      });
    }

    return new Response("Not Found", { status: 404 });
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
