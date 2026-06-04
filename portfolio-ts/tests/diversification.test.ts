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

function makeDiversificationRow(overrides: Record<string, unknown> = {}) {
  return {
    as_of_date: "2026-01-15",
    hhi: 2500,
    total_holdings: 5,
    effective_holdings: 4.0,
    avg_pairwise_correlation: 0.35,
    max_pairwise_correlation: 0.72,
    min_pairwise_correlation: -0.15,
    correlation_weighted_hhi: 3800,
    ...overrides,
  };
}

describe("getDiversification", () => {
  test("returns diversification metrics", async () => {
    mockQuerySingle.mockResolvedValue(makeDiversificationRow());

    const { getDiversification } = await import("../src/commands/diversification.js");
    const result = await getDiversification();

    expect(result.hhi).toBe(2500);
    expect(result.total_holdings).toBe(5);
    expect(result.effective_holdings).toBe(4.0);
    expect(result.avg_pairwise_correlation).toBe(0.35);
    expect(result.max_pairwise_correlation).toBe(0.72);
    expect(result.min_pairwise_correlation).toBe(-0.15);
    expect(result.correlation_weighted_hhi).toBe(3800);
    expect(result.as_of_date).toBeDefined();
  });

  test("passes as_of_date, lookback_days, and min_correlation to SQL", async () => {
    mockQuerySingle.mockClear();
    mockQuerySingle.mockResolvedValue(makeDiversificationRow());

    const { getDiversification } = await import("../src/commands/diversification.js");
    await getDiversification("2026-01-15", 126, 0.3);

    expect(mockQuerySingle.mock.calls[0][1]).toEqual(["2026-01-15", 126, 0.3]);
  });

  test("defaults lookback_days to 252 and min_correlation to 0.0", async () => {
    mockQuerySingle.mockClear();
    mockQuerySingle.mockResolvedValue(makeDiversificationRow());

    const { getDiversification } = await import("../src/commands/diversification.js");
    await getDiversification("2026-01-15");

    expect(mockQuerySingle.mock.calls[0][1]).toEqual(["2026-01-15", 252, 0.0]);
  });

  test("handles null correlation fields (degenerate <2 priced assets)", async () => {
    mockQuerySingle.mockResolvedValue(makeDiversificationRow({
      avg_pairwise_correlation: null,
      max_pairwise_correlation: null,
      min_pairwise_correlation: null,
    }));

    const { getDiversification } = await import("../src/commands/diversification.js");
    const result = await getDiversification();

    expect(result.avg_pairwise_correlation).toBeNull();
    expect(result.max_pairwise_correlation).toBeNull();
    expect(result.min_pairwise_correlation).toBeNull();
    expect(result.hhi).toBe(2500);
    expect(result.correlation_weighted_hhi).toBe(3800);
  });

  test("handles null row from database", async () => {
    mockQuerySingle.mockResolvedValue(null);

    const { getDiversification } = await import("../src/commands/diversification.js");
    const result = await getDiversification();

    expect(result.hhi).toBe(0);
    expect(result.total_holdings).toBe(0);
    expect(result.effective_holdings).toBe(0);
    expect(result.avg_pairwise_correlation).toBeNull();
    expect(result.correlation_weighted_hhi).toBe(0);
  });
});

describe("getDiversification — CLI integration", () => {
  test("dispatches diversification command and returns success envelope", async () => {
    mockQuerySingle.mockResolvedValue(makeDiversificationRow());
    mockQuery.mockResolvedValue([]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "diversification"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("diversification");
    expect(output.data.hhi).toBe(2500);
    expect(output.data.total_holdings).toBe(5);
    expect(output.data.effective_holdings).toBe(4.0);
    expect(output.data.avg_pairwise_correlation).toBe(0.35);
    expect(output.data.correlation_weighted_hhi).toBe(3800);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("dispatches diversification with --as-of-date, --lookback-days, --min-correlation", async () => {
    mockQuerySingle.mockResolvedValue(makeDiversificationRow());
    mockQuery.mockResolvedValue([]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch([
      "bun", "src/cli.ts", "diversification",
      "--as-of-date", "2026-01-15",
      "--lookback-days", "126",
      "--min-correlation", "0.3",
    ]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("diversification");
    expect(output.data.as_of_date).toBe("2026-01-15");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("diversification appears in help text", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "--help"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("diversification");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("degenerate case: single holding JSON snapshot", async () => {
    mockQuerySingle.mockResolvedValue(makeDiversificationRow({
      hhi: 10000,
      total_holdings: 1,
      effective_holdings: 1.0,
      avg_pairwise_correlation: null,
      max_pairwise_correlation: null,
      min_pairwise_correlation: null,
      correlation_weighted_hhi: 10000,
    }));
    mockQuery.mockResolvedValue([]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "diversification"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.data.effective_holdings).toBe(1.0);
    expect(output.data.total_holdings).toBe(1);
    expect(output.data.avg_pairwise_correlation).toBeNull();

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
