import { describe, expect, test, mock, jest } from "bun:test";

const mockQuerySingle = mock();
const mockQuery = mock();

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  connect: () => {},
  close: () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: mock(),
}));

const TODAY = new Date().toISOString().split("T")[0];

function daysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split("T")[0];
}

describe("getPriceFreshness", () => {
  test("returns stale=true when MAX(date) is older than max-age (default 5 days)", async () => {
    const oldDate = daysAgo(7);
    mockQuerySingle.mockResolvedValue({ prices_as_of: oldDate });

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.prices_as_of).toBe(oldDate);
    expect(result.price_age_days).toBe(7);
    expect(result.stale).toBe(true);
  });

  test("returns stale=false when MAX(date) is within max-age", async () => {
    const recent = daysAgo(2);
    mockQuerySingle.mockResolvedValue({ prices_as_of: recent });

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.prices_as_of).toBe(recent);
    expect(result.price_age_days).toBe(2);
    expect(result.stale).toBe(false);
  });

  test("returns stale=true at exact boundary (age = max-age days)", async () => {
    const boundary = daysAgo(5);
    mockQuerySingle.mockResolvedValue({ prices_as_of: boundary });

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.prices_as_of).toBe(boundary);
    expect(result.price_age_days).toBe(5);
    expect(result.stale).toBe(false);
  });

  test("returns null prices_as_of when no price data exists", async () => {
    mockQuerySingle.mockResolvedValue(null);

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.prices_as_of).toBeNull();
    expect(result.price_age_days).toBeNull();
    expect(result.stale).toBe(false);
  });

  test("handles null prices_as_of field in row", async () => {
    mockQuerySingle.mockResolvedValue({ prices_as_of: null });

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.prices_as_of).toBeNull();
    expect(result.price_age_days).toBeNull();
    expect(result.stale).toBe(false);
  });

  test("uses env PORTFOLIO_PRICE_MAX_AGE_DAYS override", async () => {
    process.env["PORTFOLIO_PRICE_MAX_AGE_DAYS"] = "10";
    const oldDate = daysAgo(7);
    mockQuerySingle.mockResolvedValue({ prices_as_of: oldDate });

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.prices_as_of).toBe(oldDate);
    expect(result.price_age_days).toBe(7);
    expect(result.stale).toBe(false);

    delete process.env["PORTFOLIO_PRICE_MAX_AGE_DAYS"];
  });

  test("ignores invalid env PORTFOLIO_PRICE_MAX_AGE_DAYS and falls back to default", async () => {
    process.env["PORTFOLIO_PRICE_MAX_AGE_DAYS"] = "not-a-number";
    const oldDate = daysAgo(7);
    mockQuerySingle.mockResolvedValue({ prices_as_of: oldDate });

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.prices_as_of).toBe(oldDate);
    expect(result.price_age_days).toBe(7);
    expect(result.stale).toBe(true);

    delete process.env["PORTFOLIO_PRICE_MAX_AGE_DAYS"];
  });
});

describe("summary regression: stays read-only, carries freshness meta", () => {
  test("summary envelope contains freshness meta", async () => {
    mockQuerySingle
      .mockResolvedValueOnce({ prices_as_of: daysAgo(3) })
      .mockResolvedValueOnce({
        holding_count: 5,
        total_cash_usd: 5000,
        portfolio_value_usd: 25000,
        last_transaction_date: "2026-01-15",
        transaction_count: 42,
        as_of_date: "2026-01-15",
      });

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "summary"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("summary");
    expect(output.data.holding_count).toBe(5);
    expect(output.meta.prices_as_of).toBeDefined();
    expect(output.meta.price_age_days).toBe(3);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("summary does NOT invoke fetchPrices (no network)", async () => {
    mockQuerySingle
      .mockResolvedValueOnce({ prices_as_of: daysAgo(3) })
      .mockResolvedValueOnce({
        holding_count: 5,
        total_cash_usd: 5000,
        portfolio_value_usd: 25000,
        last_transaction_date: "2026-01-15",
        transaction_count: 42,
        as_of_date: "2026-01-15",
      });

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "summary"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("summary");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
