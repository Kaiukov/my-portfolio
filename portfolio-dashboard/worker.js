// portfolio-dashboard Cloudflare Worker
// Serves the read-only dashboard SPA (index.html) and the dashboard snapshot
// from KV (PORTFOLIO_KV, key "dashboard"). No DB access, no financial logic —
// pure static serving of a snapshot the backend publishes. Pattern 1 of #219.
import INDEX_HTML from "./index.html";

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

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}

async function serveDashboard(_request, env) {
  const key = env.DASHBOARD_KV_KEY || "dashboard";
  const data = await env.PORTFOLIO_KV.get(key, "json");
  if (!data) {
    return json({ error: "dashboard not published" }, 404);
  }
  return json(data, 200, { "Cache-Control": "public, max-age=300" });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
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
        // SPA: unknown paths fall back to the dashboard shell
        return html(INDEX_HTML);
    }
  },
};
