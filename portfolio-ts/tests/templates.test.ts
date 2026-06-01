import { describe, expect, test } from "bun:test";

import { generateWranglerJsonc, generateWorkerJs } from "../src/cloudflare/templates.js";
import type { CloudflareConfig } from "../src/cloudflare/types.js";

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("cloudflare templates", () => {
  test("generateWorkerJs resolves the KV key once per route", () => {
    const output = generateWorkerJs();

    expect(output).toContain('const key = env.KV_KEY || "portfolio";');
    expect(countOccurrences(output, 'const key = env.KV_KEY || "portfolio";')).toBe(2);
    expect(countOccurrences(output, 'env.PORTFOLIO_KV.get(key, "json")')).toBe(2);
    expect(output).not.toContain('env.PORTFOLIO_KV.get("portfolio", "json")');
  });

  test("generateWranglerJsonc emits vars.KV_KEY when configured", () => {
    const config: CloudflareConfig = {
      account_id: "abcdef1234567890abcdef1234567890",
      kv_key: "prod:portfolio:abc123",
      kv_namespace_id: "kv1234567890abcdef1234567890",
      wrangler_project_name: "test-widget",
      initialized_at: "2026-05-31T00:00:00.000Z",
    };

    const output = generateWranglerJsonc(config);
    const parsed = JSON.parse(output) as { vars?: { KV_KEY?: string } };

    expect(output).toContain('"vars": {');
    expect(output).toContain('"KV_KEY": "prod:portfolio:abc123"');
    expect(parsed.vars?.KV_KEY).toBe("prod:portfolio:abc123");
  });

  test("generateWranglerJsonc omits vars when kv_key is unset", () => {
    const config: CloudflareConfig = {
      account_id: "abcdef1234567890abcdef1234567890",
      kv_namespace_id: "kv1234567890abcdef1234567890",
      wrangler_project_name: "test-widget",
      initialized_at: "2026-05-31T00:00:00.000Z",
    };

    const output = generateWranglerJsonc(config);
    const parsed = JSON.parse(output) as { vars?: unknown; kv_namespaces?: unknown };

    expect(output).not.toContain('"vars"');
    expect(output).not.toContain('"KV_KEY"');
    expect(parsed.vars).toBeUndefined();
    expect(parsed.kv_namespaces).toBeDefined();
  });
});
