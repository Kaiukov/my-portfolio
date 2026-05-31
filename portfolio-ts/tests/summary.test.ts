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

function makeSummaryRow(overrides: Record<string, unknown> = {}) {
  return {
    holding_count: 5,
    total_cash_usd: 5000,
    portfolio_value_usd: 25000,
    last_transaction_date: "2026-01-15",
    transaction_count: 42,
    as_of_date: "2026-01-15",
    ...overrides,
  };
}

describe("getSummary", () => {
  test("returns summary row from portfolio_summary_sql()", async () => {
    mockQuerySingle.mockResolvedValue(makeSummaryRow());

    const { getSummary } = await import("../src/commands/summary.js");
    const result = await getSummary();

    expect(result.holding_count).toBe(5);
    expect(result.total_cash_usd).toBe(5000);
    expect(result.portfolio_value_usd).toBe(25000);
    expect(result.last_transaction_date).toBe("2026-01-15");
    expect(result.transaction_count).toBe(42);
    expect(result.as_of_date).toBeDefined();
  });

  test("passes as_of_date parameter to SQL", async () => {
    mockQuerySingle.mockClear();
    mockQuerySingle.mockResolvedValue(makeSummaryRow());

    const { getSummary } = await import("../src/commands/summary.js");
    const result = await getSummary("2026-01-15");

    expect(result.as_of_date).toBe("2026-01-15");
    expect(mockQuerySingle.mock.calls[0][1]).toEqual(["2026-01-15"]);
  });

  test("handles null result gracefully", async () => {
    mockQuerySingle.mockResolvedValue(null);

    const { getSummary } = await import("../src/commands/summary.js");
    const result = await getSummary();

    expect(result.holding_count).toBe(0);
    expect(result.total_cash_usd).toBe(0);
    expect(result.portfolio_value_usd).toBe(0);
    expect(result.as_of_date).toBeDefined();
  });

  test("handles null fields gracefully", async () => {
    mockQuerySingle.mockResolvedValue(makeSummaryRow({
      last_transaction_date: null,
      as_of_date: null,
    }));

    const { getSummary } = await import("../src/commands/summary.js");
    const result = await getSummary();

    expect(result.last_transaction_date).toBeNull();
    expect(result.as_of_date).toBeDefined();
  });
});

describe("getSummary — CLI integration", () => {
  test("dispatches summary command and returns success envelope", async () => {
    mockQuerySingle.mockResolvedValue(makeSummaryRow());
    mockQuery.mockResolvedValue([]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "summary"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("summary");
    expect(output.data.holding_count).toBe(5);
    expect(output.data.portfolio_value_usd).toBe(25000);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("dispatches summary with --as-of-date", async () => {
    mockQuerySingle.mockResolvedValue(makeSummaryRow());
    mockQuery.mockResolvedValue([]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "summary", "--as-of-date", "2026-01-15"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("summary");
    expect(output.data.as_of_date).toBe("2026-01-15");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("summary appears in help text", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "--help"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("summary");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
