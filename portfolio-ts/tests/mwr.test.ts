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

mockQuery.mockResolvedValue([]);

function summaryRow(portfolio_value_usd: number) {
  return {
    holding_count: 5,
    total_cash_usd: 5000,
    portfolio_value_usd,
    last_transaction_date: "2026-01-15",
    transaction_count: 42,
    as_of_date: "2026-01-15",
  };
}

describe("getMwr", () => {
  test("returns MWR row from portfolio_mwr_sql()", async () => {
    mockQuerySingle.mockClear();

    mockQuerySingle.mockResolvedValueOnce({ mwr: 0.1050 });
    mockQuerySingle.mockResolvedValueOnce(summaryRow(25000));

    const { getMwr } = await import("../src/commands/mwr.js");
    const result = await getMwr();

    expect(result.mwr_pct).toBe(10.5);
    expect(result.as_of_date).toBeDefined();
    expect(result.note).toContain("XIRR");
    expect(result.portfolio_value).toBe(25000);
  });

  test("passes as_of_date parameter to SQL", async () => {
    mockQuerySingle.mockClear();

    mockQuerySingle.mockResolvedValueOnce({ mwr: 0.05 });
    mockQuerySingle.mockResolvedValueOnce(summaryRow(18000));

    const { getMwr } = await import("../src/commands/mwr.js");
    await getMwr("2026-01-15");

    expect(mockQuerySingle.mock.calls[0][1]).toEqual(["2026-01-15"]);
  });

  test("handles null/insufficient data gracefully", async () => {
    mockQuerySingle.mockClear();

    mockQuerySingle.mockResolvedValueOnce({ mwr: null });
    mockQuerySingle.mockResolvedValueOnce(summaryRow(4500));

    const { getMwr } = await import("../src/commands/mwr.js");
    const result = await getMwr();

    expect(result.mwr_pct).toBe(0);
    expect(result.note).toContain("insufficient");
    expect(result.portfolio_value).toBe(4500);
  });

  test("XIRR 10% fixture: -1000 on 2025-01-01 +1100 on 2026-01-01 via mocked DB", async () => {
    mockQuerySingle.mockClear();

    mockQuerySingle.mockResolvedValueOnce({ mwr: 0.10 });
    mockQuerySingle.mockResolvedValueOnce(summaryRow(12500));

    const { getMwr } = await import("../src/commands/mwr.js");
    const result = await getMwr("2026-01-01");

    expect(result.mwr_pct).toBe(10.0);
    expect(result.portfolio_value).toBe(12500);
  });

  test("reports real portfolio_value from getSummary, not hardcoded 0 (#193)", async () => {
    mockQuerySingle.mockClear();

    mockQuerySingle.mockResolvedValueOnce({ mwr: 0.085 });
    mockQuerySingle.mockResolvedValueOnce(summaryRow(19120.12));

    const { getMwr } = await import("../src/commands/mwr.js");
    const result = await getMwr("2026-03-15");

    expect(result.portfolio_value).toBe(19120.12);
    expect(result.mwr_pct).toBe(8.5);
    expect(result.as_of_date).toBe("2026-03-15");
  });
});

describe("getMwr — CLI integration", () => {
  test("dispatches mwr command and returns success envelope", async () => {
    mockQuerySingle.mockClear();
    mockQuery.mockClear();

    mockQuerySingle.mockResolvedValueOnce({ prices_as_of: "2026-01-15" });
    mockQuerySingle.mockResolvedValueOnce({ needs_recalc: false });
    mockQuerySingle.mockResolvedValueOnce({ mwr: 0.085 });
    mockQuerySingle.mockResolvedValueOnce(summaryRow(19120.12));
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "mwr"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("mwr");
    expect(output.data.mwr_pct).toBe(8.5);
    expect(output.data.note).toContain("XIRR");
    expect(output.data.portfolio_value).toBe(19120.12);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("dispatches mwr with --as-of-date", async () => {
    mockQuerySingle.mockClear();
    mockQuery.mockClear();

    mockQuerySingle.mockResolvedValueOnce({ prices_as_of: "2026-01-01" });
    mockQuerySingle.mockResolvedValueOnce({ needs_recalc: false });
    mockQuerySingle.mockResolvedValueOnce({ mwr: 0.12 });
    mockQuerySingle.mockResolvedValueOnce(summaryRow(22000));
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "mwr", "--as-of-date", "2026-01-01"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("mwr");
    expect(output.data.mwr_pct).toBe(12.0);
    expect(output.data.portfolio_value).toBe(22000);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("mwr appears in help text", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "--help"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("mwr");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
