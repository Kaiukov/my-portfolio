import { describe, expect, test } from "bun:test";
import { argsFromSearchParams } from "../src/api/server.js";

describe("argsFromSearchParams", () => {
  test("maps kebab-case keys to snake_case", () => {
    const args = argsFromSearchParams(new URLSearchParams("lookback-days=60&min-correlation=0.3"));
    expect(args).toEqual({ lookback_days: "60", min_correlation: "0.3" });
  });
  test("leaves canonical keys untouched", () => {
    const args = argsFromSearchParams(new URLSearchParams("lookback_days=90&as_of_date=2026-01-02"));
    expect(args).toEqual({ lookback_days: "90", as_of_date: "2026-01-02" });
  });
  test("explicit snake_case wins over the kebab alias", () => {
    const args = argsFromSearchParams(new URLSearchParams("lookback-days=60&lookback_days=90"));
    expect(args["lookback_days"]).toBe("90");
  });
  test("explicit snake_case wins regardless of order", () => {
    const args = argsFromSearchParams(new URLSearchParams("lookback_days=90&lookback-days=60"));
    expect(args["lookback_days"]).toBe("90");
  });
});
