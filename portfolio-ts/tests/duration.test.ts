import { describe, expect, test } from "bun:test";

describe("parseInterval parity", () => {
  test("parses minute and hour intervals", async () => {
    const mod = await import("../src/cloudflare/sync.js");
    expect(mod.parseInterval("15m")).toBe(15 * 60 * 1000);
    expect(mod.parseInterval("1h")).toBe(60 * 60 * 1000);
  });

  test("keeps the same error contract for invalid input", async () => {
    const { parseInterval } = await import("../src/cloudflare/sync.js");
    expect(() => parseInterval("100")).toThrow("Invalid interval");
    expect(() => parseInterval("bad")).toThrow("Invalid interval");
    expect(() => parseInterval("")).toThrow("Invalid interval");
  });

  test("re-export still resolves and keeps the default interval", async () => {
    const mod = await import("../src/cloudflare/sync.js");
    expect(typeof mod.parseInterval).toBe("function");
    expect(mod.DEFAULT_SYNC_INTERVAL_MS).toBe(60 * 60 * 1000);
  });
});
