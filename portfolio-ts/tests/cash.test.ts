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
  runTx: async <T>(fn: (tx: { unsafe: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<T>): Promise<T> => {
    return fn({ unsafe: async (_sql: string, _params?: unknown[]) => [] });
  },
}));

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    cash_key: "USD",
    currency: "USD",
    display_bucket: "CASH USD",
    balance: 5000,
    usd_value: 5000,
    ...overrides,
  };
}

describe("getCash", () => {
  test("returns cash rows from portfolio_cash_sql()", async () => {
    mockQuery.mockResolvedValue([
      makeRow(),
      makeRow({ cash_key: "EURUSD=X", currency: "EUR", display_bucket: "CASH EUR", balance: 1000, usd_value: 1085 }),
    ]);

    const { getCash } = await import("../src/commands/cash.js");
    const result = await getCash();

    expect(result.rows).toHaveLength(2);
    expect(result.total_usd).toBe(6085);
    expect(result.rows[0].cash_key).toBe("USD");
    expect(result.rows[0].currency).toBe("USD");
    expect(result.rows[0].balance).toBe(5000);
    expect(result.rows[0].usd_value).toBe(5000);
    expect(result.rows[1].currency).toBe("EUR");
    expect(result.rows[1].balance).toBe(1000);
    expect(result.as_of_date).toBeDefined();
  });

  test("passes as_of_date parameter to SQL", async () => {
    mockQuery.mockClear();
    mockQuery.mockResolvedValue([makeRow()]);

    const { getCash } = await import("../src/commands/cash.js");
    const result = await getCash("2026-01-15");

    expect(result.as_of_date).toBe("2026-01-15");
    expect(mockQuery.mock.calls[0][1]).toEqual(["2026-01-15"]);
  });

  test("handles empty result", async () => {
    mockQuery.mockResolvedValue([]);

    const { getCash } = await import("../src/commands/cash.js");
    const result = await getCash();

    expect(result.rows).toHaveLength(0);
    expect(result.total_usd).toBe(0);
    expect(result.as_of_date).toBeDefined();
  });

  test("handles null usd_value gracefully", async () => {
    mockQuery.mockResolvedValue([
      makeRow({ usd_value: null }),
    ]);

    const { getCash } = await import("../src/commands/cash.js");
    const result = await getCash();

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].usd_value).toBe(0);
    expect(result.total_usd).toBe(0);
  });

  test("response contains all required fields", async () => {
    mockQuery.mockResolvedValue([
      makeRow({ cash_key: "USD", currency: "USD", display_bucket: "CASH USD", balance: 5000, usd_value: 5000 }),
      makeRow({ cash_key: "EURUSD=X", currency: "EUR", display_bucket: "CASH EUR", balance: 1000, usd_value: 1085 }),
    ]);

    const { getCash } = await import("../src/commands/cash.js");
    const result = await getCash();

    expect(result).toHaveProperty("as_of_date");
    expect(result).toHaveProperty("total_usd");
    expect(result).toHaveProperty("rows");

    for (const row of result.rows) {
      expect(row).toHaveProperty("cash_key");
      expect(row).toHaveProperty("currency");
      expect(row).toHaveProperty("display_bucket");
      expect(row).toHaveProperty("balance");
      expect(row).toHaveProperty("usd_value");
    }
  });
});

describe("getCash — CLI integration", () => {
  test("dispatches cash command and returns success envelope", async () => {
    mockQuery.mockResolvedValue([
      makeRow(),
    ]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cash"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("cash");
    expect(output.data.as_of_date).toBeDefined();
    expect(output.data.total_usd).toBe(5000);
    expect(output.data.rows).toHaveLength(1);
    expect(output.meta.count).toBe(1);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("dispatches cash with --as-of-date", async () => {
    mockQuery.mockResolvedValue([]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cash", "--as-of-date", "2026-01-15"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("cash");
    expect(output.data.as_of_date).toBe("2026-01-15");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("cash appears in help text", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "--help"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("cash");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe("getCash — stock trade cash impact regression (#66)", () => {
  test("stock BUY reduces USD cash by quantity*price+fees, not share count", async () => {
    mockQuery.mockResolvedValue([
      makeRow({ cash_key: "USD", currency: "USD", display_bucket: "CASH USD", balance: 8995, usd_value: 8995 }),
    ]);

    const { getCash } = await import("../src/commands/cash.js");
    const result = await getCash();

    expect(result.rows).toHaveLength(1);
    expect(result.total_usd).toBe(8995);
    expect(result.rows[0].cash_key).toBe("USD");
    expect(result.rows[0].balance).toBe(8995);
    expect(result.rows[0].usd_value).toBe(8995);
  });

  test("stock SELL increases USD cash by quantity*price-fees", async () => {
    mockQuery.mockResolvedValue([
      makeRow({ cash_key: "USD", currency: "USD", display_bucket: "CASH USD", balance: 10438, usd_value: 10438 }),
      makeRow({ cash_key: "EURUSD=X", currency: "EUR", display_bucket: "CASH EUR", balance: -2000, usd_value: -2160 }),
    ]);

    const { getCash } = await import("../src/commands/cash.js");
    const result = await getCash();

    expect(result.rows).toHaveLength(2);
    expect(result.total_usd).toBe(8278);
    expect(result.rows[0].cash_key).toBe("USD");
    expect(result.rows[0].balance).toBe(10438);
  });

  test("stock trade cash deltas are in correct currency buckets", async () => {
    mockQuery.mockResolvedValue([
      makeRow({ cash_key: "USD", currency: "USD", display_bucket: "CASH USD", balance: 5000, usd_value: 5000 }),
      makeRow({ cash_key: "EURUSD=X", currency: "EUR", display_bucket: "CASH EUR", balance: 800, usd_value: 864 }),
    ]);

    const { getCash } = await import("../src/commands/cash.js");
    const result = await getCash();

    expect(result.rows[0].cash_key).toBe("USD");
    expect(result.rows[1].cash_key).toBe("EURUSD=X");
    expect(result.rows[0].usd_value).toBe(5000);
    expect(result.rows[1].usd_value).toBe(864);
    expect(result.total_usd).toBe(5864);
  });
});
