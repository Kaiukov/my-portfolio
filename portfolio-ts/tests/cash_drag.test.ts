import { describe, expect, test, mock, jest, beforeAll } from "bun:test";

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

function makeDragRow(overrides: Record<string, unknown> = {}) {
  return {
    total_portfolio_value: 100000,
    total_cash_usd: 5000,
    cash_pct: 5.0,
    portfolio_cagr: 12.5,
    benchmark_cagr: 10.0,
    assumed_cash_return_rate: 0.0,
    drag_vs_portfolio_cagr: 625,
    drag_vs_benchmark: 500,
    drag_vs_portfolio_pct: 0.625,
    drag_vs_benchmark_pct: 0.5,
    period_start_date: "2020-01-15",
    period_end_date: "2026-01-15",
    ...overrides,
  };
}

describe("getCashDrag", () => {
  test("returns cash drag metrics from portfolio_cash_drag_sql()", async () => {
    mockQuerySingle.mockResolvedValue(makeDragRow());

    const { getCashDrag } = await import("../src/commands/cash_drag.js");
    const result = await getCashDrag();

    expect(result.total_portfolio_value).toBe(100000);
    expect(result.total_cash_usd).toBe(5000);
    expect(result.cash_pct).toBe(5.0);
    expect(result.portfolio_cagr).toBe(12.5);
    expect(result.benchmark_cagr).toBe(10.0);
    expect(result.assumed_cash_return_rate).toBe(0.0);
    expect(result.drag_vs_portfolio_cagr).toBe(625);
    expect(result.drag_vs_benchmark).toBe(500);
    expect(result.drag_vs_portfolio_pct).toBeCloseTo(0.625, 5);
    expect(result.drag_vs_benchmark_pct).toBeCloseTo(0.5, 5);
    expect(result.period_start_date).toBe("2020-01-15");
    expect(result.period_end_date).toBe("2026-01-15");
  });

  test("handles null return (no data) gracefully", async () => {
    mockQuerySingle.mockResolvedValue(null);

    const { getCashDrag } = await import("../src/commands/cash_drag.js");
    const result = await getCashDrag();

    expect(result.total_portfolio_value).toBe(0);
    expect(result.total_cash_usd).toBe(0);
    expect(result.cash_pct).toBe(0);
    expect(result.portfolio_cagr).toBe(0);
    expect(result.benchmark_cagr).toBe(0);
    expect(result.assumed_cash_return_rate).toBe(0);
    expect(result.drag_vs_portfolio_cagr).toBe(0);
    expect(result.drag_vs_benchmark).toBe(0);
    expect(result.drag_vs_portfolio_pct).toBe(0);
    expect(result.drag_vs_benchmark_pct).toBe(0);
    expect(result.period_start_date).toBe("");
  });

  test("handles null fields gracefully", async () => {
    mockQuerySingle.mockResolvedValue({
      total_portfolio_value: null,
      total_cash_usd: null,
      cash_pct: null,
      portfolio_cagr: null,
      benchmark_cagr: null,
      assumed_cash_return_rate: null,
      drag_vs_portfolio_cagr: null,
      drag_vs_benchmark: null,
      drag_vs_portfolio_pct: null,
      drag_vs_benchmark_pct: null,
      period_start_date: null,
      period_end_date: null,
    });

    const { getCashDrag } = await import("../src/commands/cash_drag.js");
    const result = await getCashDrag();

    expect(result.total_portfolio_value).toBe(0);
    expect(result.total_cash_usd).toBe(0);
    expect(result.cash_pct).toBe(0);
    expect(result.period_start_date).toBe("");
    expect(result.period_end_date).toBe("");
  });

  test("passes all parameters to SQL function", async () => {
    mockQuerySingle.mockClear();
    mockQuerySingle.mockResolvedValue(makeDragRow());

    const { getCashDrag } = await import("../src/commands/cash_drag.js");
    await getCashDrag({
      asOfDate: "2026-01-15",
      fromDate: "2024-01-01",
      benchmarkReturnRate: 0.08,
      cashReturnRate: 0.045,
    });

    const calls = mockQuerySingle.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    // First call SQL text should reference portfolio_cash_drag_sql
    expect(calls[0][0]).toContain("portfolio_cash_drag_sql");
    // Parameters array should contain the date values
    const params = calls[0][1] as (string | number | null)[];
    expect(params[0]).toBe("2026-01-15");
    expect(params[1]).toBe("2024-01-01");
    expect(params[2]).toBe(0.08);
    expect(params[3]).toBe(0.045);
  });

  test("defaults cashReturnRate to 0.0 when not provided", async () => {
    mockQuerySingle.mockClear();
    mockQuerySingle.mockResolvedValue(makeDragRow());

    const { getCashDrag } = await import("../src/commands/cash_drag.js");
    await getCashDrag({});

    const calls = mockQuerySingle.mock.calls;
    const params = calls[0][1] as (string | number | null)[];
    expect(params[3]).toBe(0.0);
  });

  test("defaults fromDate and benchmarkReturnRate to null", async () => {
    mockQuerySingle.mockClear();
    mockQuerySingle.mockResolvedValue(makeDragRow());

    const { getCashDrag } = await import("../src/commands/cash_drag.js");
    await getCashDrag({ asOfDate: "2026-01-15" });

    const calls = mockQuerySingle.mock.calls;
    const params = calls[0][1] as (string | number | null)[];
    expect(params[1]).toBeNull();
    expect(params[2]).toBeNull();
  });

  test("zero cash produces zero drag (hand-calculated)", async () => {
    mockQuerySingle.mockResolvedValue(makeDragRow({
      total_cash_usd: 0,
      cash_pct: 0,
      drag_vs_portfolio_cagr: 0,
      drag_vs_benchmark: 0,
      drag_vs_portfolio_pct: 0,
      drag_vs_benchmark_pct: 0,
    }));

    const { getCashDrag } = await import("../src/commands/cash_drag.js");
    const result = await getCashDrag();

    expect(result.total_cash_usd).toBe(0);
    expect(result.drag_vs_portfolio_cagr).toBe(0);
    expect(result.drag_vs_benchmark).toBe(0);
    expect(result.drag_vs_portfolio_pct).toBe(0);
    expect(result.drag_vs_benchmark_pct).toBe(0);
  });

  test("cash rate equal to portfolio rate produces zero drag vs portfolio", async () => {
    // If portfolio_cagr = 10% and cash_return_rate = 0.10 (10%),
    // then rate gap = 0, drag = 0.
    mockQuerySingle.mockResolvedValue(makeDragRow({
      portfolio_cagr: 10.0,
      assumed_cash_return_rate: 0.10,
      drag_vs_portfolio_cagr: 0,
      drag_vs_portfolio_pct: 0,
    }));

    const { getCashDrag } = await import("../src/commands/cash_drag.js");
    const result = await getCashDrag();

    expect(result.portfolio_cagr).toBe(10.0);
    expect(result.assumed_cash_return_rate).toBe(0.10);
    expect(result.drag_vs_portfolio_cagr).toBe(0);
    expect(result.drag_vs_portfolio_pct).toBe(0);
  });
});

describe("getCashDrag — CLI integration", () => {
  test("dispatches cash_drag command and returns success envelope", async () => {
    mockQuerySingle.mockResolvedValue(makeDragRow());

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cash_drag"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("cash_drag");
    expect(output.data.total_portfolio_value).toBe(100000);
    expect(output.data.total_cash_usd).toBe(5000);
    expect(output.data.cash_pct).toBe(5.0);
    expect(output.data.portfolio_cagr).toBe(12.5);
    expect(output.data.benchmark_cagr).toBe(10.0);
    expect(output.data.drag_vs_portfolio_cagr).toBe(625);
    expect(output.data.drag_vs_benchmark).toBe(500);
    expect(output.data.drag_vs_portfolio_pct).toBeCloseTo(0.625, 5);
    expect(output.data.drag_vs_benchmark_pct).toBeCloseTo(0.5, 5);
    expect(output.data.period_start_date).toBe("2020-01-15");
    expect(output.data.period_end_date).toBe("2026-01-15");
    expect(output.meta).toBeDefined();
    expect(output.meta.generated_at).toBeDefined();

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("dispatches cash_drag with --as-of-date and --from-date", async () => {
    mockQuerySingle.mockResolvedValue(makeDragRow({ period_start_date: "2024-01-01" }));

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cash_drag", "--as-of-date", "2026-01-15", "--from-date", "2024-01-01"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("cash_drag");
    expect(output.data.period_start_date).toBe("2024-01-01");
    expect(output.data.period_end_date).toBe("2026-01-15");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("dispatches cash_drag with --benchmark-return-rate and --cash-return-rate", async () => {
    mockQuerySingle.mockResolvedValue(makeDragRow({
      assumed_cash_return_rate: 0.045,
    }));

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cash_drag", "--benchmark-return-rate", "0.08", "--cash-return-rate", "0.045"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("cash_drag");
    expect(output.data.assumed_cash_return_rate).toBe(0.045);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("dispatches cash_drag with snake_case flags", async () => {
    mockQuerySingle.mockResolvedValue(makeDragRow());

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cash_drag",
      "--as_of_date", "2026-01-15",
      "--from_date", "2024-01-01",
      "--benchmark_return_rate", "0.08",
      "--cash_return_rate", "0.045",
    ]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("cash_drag");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("cash_drag appears in help text", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "--help"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("cash_drag");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe("getCashDrag — hand-calculated values", () => {
  test("drag_vs_portfolio_cagr = cash_usd * (cagr/100 - cash_rate)", async () => {
    // With: cash=5000, cagr=12.5%, cash_rate=0.0
    // Expected: drag$ = 5000 * (0.125 - 0.0) = 625
    mockQuerySingle.mockResolvedValue(makeDragRow({
      total_cash_usd: 5000,
      portfolio_cagr: 12.5,
      assumed_cash_return_rate: 0.0,
      drag_vs_portfolio_cagr: 625,
    }));

    const { getCashDrag } = await import("../src/commands/cash_drag.js");
    const result = await getCashDrag();

    expect(result.drag_vs_portfolio_cagr).toBeCloseTo(625, 2);
  });

  test("drag_vs_benchmark = cash_usd * (benchmark_rate - cash_rate)", async () => {
    // With: cash=5000, benchmark_cagr=10%, cash_rate=0.0
    // Expected: drag$ = 5000 * (0.10 - 0.0) = 500
    mockQuerySingle.mockResolvedValue(makeDragRow({
      total_cash_usd: 5000,
      benchmark_cagr: 10.0,
      assumed_cash_return_rate: 0.0,
      drag_vs_benchmark: 500,
    }));

    const { getCashDrag } = await import("../src/commands/cash_drag.js");
    const result = await getCashDrag();

    expect(result.drag_vs_benchmark).toBeCloseTo(500, 2);
  });

  test("drag_vs_portfolio_pct = drag_$ / portfolio_value * 100", async () => {
    // With: drag$=625, portfolio_value=100000
    // Expected: 625/100000*100 = 0.625%
    mockQuerySingle.mockResolvedValue(makeDragRow({
      total_portfolio_value: 100000,
      drag_vs_portfolio_cagr: 625,
      drag_vs_portfolio_pct: 0.625,
    }));

    const { getCashDrag } = await import("../src/commands/cash_drag.js");
    const result = await getCashDrag();

    expect(result.drag_vs_portfolio_pct).toBeCloseTo(0.625, 5);
  });

  test("cash_rate > cagr produces negative drag (opportunity gain)", async () => {
    // If cash yields 5% and portfolio CAGR is 3%, holding cash is BETTER
    // drag$ = 5000 * (0.03 - 0.05) = -100
    mockQuerySingle.mockResolvedValue(makeDragRow({
      total_cash_usd: 5000,
      portfolio_cagr: 3.0,
      assumed_cash_return_rate: 0.05,
      drag_vs_portfolio_cagr: -100,
      drag_vs_portfolio_pct: -0.1,
    }));

    const { getCashDrag } = await import("../src/commands/cash_drag.js");
    const result = await getCashDrag();

    expect(result.drag_vs_portfolio_cagr).toBe(-100);
    expect(result.drag_vs_portfolio_pct).toBe(-0.1);
  });
});
