import { describe, expect, test, mock, jest } from "bun:test";

const mockQuerySingle = mock();

mock.module("../src/db.js", () => ({
  query: () => Promise.resolve([]),
  querySingle: mockQuerySingle,
  connect: () => {},
  close: () => {},
  getSql: () => ({}),
  getAssetMetadata: () => Promise.resolve(null),
  upsertAssetMetadata: () => Promise.resolve(),
}));

mock.module("../src/tx.js", () => ({
  runTx: async <T>(fn: (tx: { unsafe: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<T>): Promise<T> => {
    return fn({ unsafe: async (_sql: string, _params?: unknown[]) => [] });
  },
}));

function makeDecompRow(overrides: Record<string, unknown> = {}) {
  return {
    as_of_date: "2026-01-15",
    total_growth_usd: 50000,
    total_growth_pct: 50,
    from_contributions_usd: 20000,
    from_contributions_pct: 40,
    from_returns_usd: 30000,
    from_returns_pct: 60,
    initial_value: 100000,
    current_value: 150000,
    net_deposits: 20000,
    total_gain: 25000,
    total_income: 8000,
    total_fees_and_taxes: 3000,
    ...overrides,
  };
}

describe("getDecomposition", () => {
  test("returns decomposition data split into contributions vs returns", async () => {
    mockQuerySingle.mockResolvedValue(makeDecompRow());

    const { getDecomposition } = await import("../src/commands/decomposition.js");
    const result = await getDecomposition("2026-01-15");

    expect(result.as_of_date).toBe("2026-01-15");
    expect(result.total_growth_usd).toBe(50000);
    expect(result.total_growth_pct).toBe(50);
    expect(result.from_contributions_usd).toBe(20000);
    expect(result.from_contributions_pct).toBe(40);
    expect(result.from_returns_usd).toBe(30000);
    expect(result.from_returns_pct).toBe(60);
    expect(result.initial_value).toBe(100000);
    expect(result.current_value).toBe(150000);
    expect(result.net_deposits).toBe(20000);
    expect(result.total_gain).toBe(25000);
    expect(result.total_income).toBe(8000);
    expect(result.total_fees_and_taxes).toBe(3000);

    // Sanity: identity invariant
    expect(result.from_contributions_usd + result.from_returns_usd).toBe(result.total_growth_usd);
  });

  test("returns default values when SQL returns no row", async () => {
    mockQuerySingle.mockResolvedValue(null);

    const { getDecomposition } = await import("../src/commands/decomposition.js");
    const result = await getDecomposition("2026-01-15");

    expect(result.total_growth_usd).toBe(0);
    expect(result.total_growth_pct).toBe(0);
    expect(result.from_contributions_usd).toBe(0);
    expect(result.from_contributions_pct).toBe(0);
    expect(result.from_returns_usd).toBe(0);
    expect(result.from_returns_pct).toBe(0);
    expect(result.initial_value).toBe(0);
    expect(result.current_value).toBe(0);
    expect(result.net_deposits).toBe(0);
    expect(result.total_gain).toBe(0);
    expect(result.total_income).toBe(0);
    expect(result.total_fees_and_taxes).toBe(0);
  });

  test("defaults as_of_date to today when undefined", async () => {
    mockQuerySingle.mockClear();
    mockQuerySingle.mockResolvedValue(makeDecompRow());

    const { getDecomposition } = await import("../src/commands/decomposition.js");
    await getDecomposition();

    const today = new Date().toISOString().split("T")[0];
    expect(mockQuerySingle.mock.calls[0][1]).toEqual([today]);
  });

  test("passes as_of_date parameter to SQL", async () => {
    mockQuerySingle.mockClear();
    mockQuerySingle.mockResolvedValue(makeDecompRow());

    const { getDecomposition } = await import("../src/commands/decomposition.js");
    await getDecomposition("2025-06-01");

    expect(mockQuerySingle.mock.calls[0][1]).toEqual(["2025-06-01"]);
  });

  test("handles null fields in SQL result gracefully", async () => {
    mockQuerySingle.mockResolvedValue({
      as_of_date: "2026-01-15",
      total_growth_usd: null,
      total_growth_pct: null,
      from_contributions_usd: null,
      from_contributions_pct: null,
      from_returns_usd: null,
      from_returns_pct: null,
      initial_value: null,
      current_value: null,
      net_deposits: null,
      total_gain: null,
      total_income: null,
      total_fees_and_taxes: null,
    });

    const { getDecomposition } = await import("../src/commands/decomposition.js");
    const result = await getDecomposition();

    expect(result.as_of_date).toBe("2026-01-15");
    expect(result.total_growth_usd).toBe(0);
    expect(result.total_growth_pct).toBe(0);
    expect(result.from_contributions_usd).toBe(0);
    expect(result.from_contributions_pct).toBe(0);
    expect(result.from_returns_usd).toBe(0);
    expect(result.from_returns_pct).toBe(0);
    expect(result.initial_value).toBe(0);
    expect(result.current_value).toBe(0);
  });

  test("handles zero-growth case (total_growth_usd = 0)", async () => {
    mockQuerySingle.mockResolvedValue(makeDecompRow({
      total_growth_usd: 0,
      total_growth_pct: 0,
      from_contributions_usd: 10000,
      from_returns_usd: -10000,
      from_contributions_pct: 0,
      from_returns_pct: 0,
      net_deposits: 10000,
      total_gain: -8000,
      total_income: 1000,
      total_fees_and_taxes: 3000,
    }));

    const { getDecomposition } = await import("../src/commands/decomposition.js");
    const result = await getDecomposition();

    expect(result.total_growth_usd).toBe(0);
    expect(result.total_growth_pct).toBe(0);
    expect(result.from_contributions_pct).toBe(0);
    expect(result.from_returns_pct).toBe(0);
    expect(result.from_contributions_usd + result.from_returns_usd).toBe(result.total_growth_usd);
  });

  test("identity invariant: from_contributions + from_returns == total_growth", async () => {
    const row = makeDecompRow({
      total_growth_usd: 6510,
      total_growth_pct: 65.2,
      from_contributions_usd: 4000,
      from_contributions_pct: 61.4,
      from_returns_usd: 2510,
      from_returns_pct: 38.6,
      initial_value: 9985,
      current_value: 16495,
      net_deposits: 4000,
      total_gain: 2100,
      total_income: 500,
      total_fees_and_taxes: 90,
    });
    mockQuerySingle.mockResolvedValue(row);

    const { getDecomposition } = await import("../src/commands/decomposition.js");
    const result = await getDecomposition("2026-01-05");

    expect(result.initial_value).toBe(9985);
    expect(result.current_value).toBe(16495);
    expect(result.total_growth_usd).toBe(6510);

    // Core accounting identity: from_contributions_usd + from_returns_usd = total_growth_usd
    expect(result.from_contributions_usd + result.from_returns_usd).toBe(result.total_growth_usd);

    // from_contributions_usd = net_deposits (deposits delta - withdrawals delta)
    expect(result.from_contributions_usd).toBe(result.net_deposits);

    // total_growth_usd = current_value - initial_value
    expect(result.total_growth_usd).toBe(result.current_value - result.initial_value);
  });

  test("handles negative-growth case (total_growth_usd < 0)", async () => {
    mockQuerySingle.mockResolvedValue(makeDecompRow({
      total_growth_usd: -5000,
      total_growth_pct: 0,
      from_contributions_usd: 20000,
      from_returns_usd: -25000,
      from_contributions_pct: 0,
      from_returns_pct: 0,
      net_deposits: 20000,
      total_gain: -23000,
      total_income: 1000,
      total_fees_and_taxes: 3000,
    }));

    const { getDecomposition } = await import("../src/commands/decomposition.js");
    const result = await getDecomposition();

    expect(result.total_growth_usd).toBe(-5000);
    expect(result.total_growth_pct).toBe(0);
    expect(result.from_contributions_pct).toBe(0);
    expect(result.from_returns_pct).toBe(0);
    expect(result.from_contributions_usd + result.from_returns_usd).toBe(result.total_growth_usd);
  });
});

describe("getDecomposition — CLI integration", () => {
  test("dispatches decomposition command and returns success envelope", async () => {
    mockQuerySingle.mockResolvedValue(makeDecompRow());

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "decomposition"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("decomposition");
    expect(output.data.total_growth_usd).toBe(50000);
    expect(output.data.from_contributions_usd).toBe(20000);
    expect(output.data.from_returns_usd).toBe(30000);
    expect(output.meta.count).toBe(null);
    expect(output.meta.generated_at).toBeDefined();

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("dispatches decomposition with --as-of-date and passes to SQL", async () => {
    mockQuerySingle.mockClear();
    mockQuerySingle.mockResolvedValue(makeDecompRow());

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "decomposition", "--as-of-date", "2026-03-01"]);

    expect(mockQuerySingle.mock.calls[0][1]).toEqual(["2026-03-01"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("decomposition");
    expect(output.data.as_of_date).toBe("2026-01-15");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("decomposition command appears in help text", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "--help"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("decomposition");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
