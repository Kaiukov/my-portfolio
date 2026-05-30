import { describe, expect, test, mock, jest } from "bun:test";

const mockQuery = mock();
const mockQuerySingle = mock(() => null);

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
    total_days: 120,
    start_date: "2026-01-02",
    end_date: "2026-05-30",
    start_value: 10000,
    end_value: 11500,
    total_gain: 1500,
    avg_daily_return: 0.12,
    avg_investment_return: 0.12,
    std_dev: 1.5,
    hist_volatility: 23.8,
    var_95: -2.1,
    var_99: -3.5,
    cvar_95: -2.8,
    cvar_99: -4.2,
    max_drawdown: 8.5,
    avg_drawdown: 3.2,
    avg_drawdown_duration: 5.1,
    time_weighted_return_pct: 15.0,
    total_return_pct: 15.0,
    median_monthly_return: 2.8,
    cagr: 32.5,
    beta: 0.95,
    sharpe_ratio: 1.35,
    sortino_ratio: 2.1,
    treynor_ratio: 3.4,
    information_ratio: 0.75,
    jensens_alpha: 2.3,
    relative_return: 5.0,
    tracking_error: 12.3,
    spy_twr_pct: 10.0,
    spy_cagr_pct: 21.5,
    up_capture_ratio: 0.92,
    down_capture_ratio: 0.85,
    ...overrides,
  };
}

describe("getPerformance", () => {
  test("returns performance metrics from portfolio_performance_sql()", async () => {
    mockQuery.mockResolvedValue([makeRow()]);

    const { getPerformance } = await import("../src/commands/performance.js");
    const result = await getPerformance();

    expect(result.total_days).toBe(120);
    expect(result.start_date).toBe("2026-01-02");
    expect(result.end_date).toBe("2026-05-30");
    expect(result.start_value).toBe(10000);
    expect(result.end_value).toBe(11500);
    expect(result.total_gain).toBe(1500);
    expect(result.time_weighted_return_pct).toBe(15);
    expect(result.total_return_pct).toBe(15);
    expect(result.median_monthly_return).toBe(2.8);
    expect(result.cagr).toBe(32.5);
    expect(result.sharpe_ratio).toBe(1.35);
    expect(result.sortino_ratio).toBe(2.1);
    expect(result.max_drawdown).toBe(8.5);
    expect(result.beta).toBe(0.95);
  });

  test("passes as_of_date, benchmark, from_date as SQL parameters", async () => {
    mockQuery.mockClear();
    mockQuery.mockResolvedValue([makeRow()]);

    const { getPerformance } = await import("../src/commands/performance.js");
    await getPerformance({ asOfDate: "2026-01-15", benchmark: "IVV", fromDate: "2025-01-01" });

    expect(mockQuery.mock.calls[0][1]).toEqual(["2026-01-15", "IVV", "2025-01-01"]);
  });

  test("uses default benchmark SPY when not specified", async () => {
    mockQuery.mockClear();
    mockQuery.mockResolvedValue([makeRow()]);

    const { getPerformance } = await import("../src/commands/performance.js");
    await getPerformance();

    expect(mockQuery.mock.calls[0][1][1]).toBe("SPY");
  });

  test("uses PORTFOLIO_BENCHMARK_TICKERS env var fallback", async () => {
    mockQuery.mockClear();
    mockQuery.mockResolvedValue([makeRow()]);

    const prev = process.env["PORTFOLIO_BENCHMARK_TICKERS"];
    process.env["PORTFOLIO_BENCHMARK_TICKERS"] = "IVV,VOO";

    const { getPerformance } = await import("../src/commands/performance.js");
    await getPerformance();

    expect(mockQuery.mock.calls[0][1][1]).toBe("IVV");

    if (prev !== undefined) {
      process.env["PORTFOLIO_BENCHMARK_TICKERS"] = prev;
    } else {
      delete process.env["PORTFOLIO_BENCHMARK_TICKERS"];
    }
  });

  test("computes from_date from period", async () => {
    mockQuery.mockClear();
    mockQuery.mockResolvedValue([makeRow()]);

    const { getPerformance } = await import("../src/commands/performance.js");
    await getPerformance({ period: "ytd" });

    const params = mockQuery.mock.calls[0][1] as [string, string, string];
    expect(params[2]).toBeDefined();
    expect(params[2]).toMatch(/^\d{4}-01-01$/);
  });

  test("handles empty result gracefully", async () => {
    mockQuery.mockResolvedValue([]);

    const { getPerformance } = await import("../src/commands/performance.js");
    const result = await getPerformance();

    expect(result.total_days).toBe(0);
    expect(result.start_date).toBeNull();
    expect(result.end_date).toBeNull();
    expect(result.start_value).toBe(0);
    expect(result.end_value).toBe(0);
    expect(result.time_weighted_return_pct).toBe(0);
    expect(result.sharpe_ratio).toBe(0);
  });

  test("handles null SQL values by coercing to 0", async () => {
    mockQuery.mockResolvedValue([{
      total_days: 0,
      start_date: null,
      end_date: null,
      start_value: null,
      end_value: null,
      total_gain: null,
      avg_daily_return: null,
      avg_investment_return: null,
      std_dev: null,
      hist_volatility: null,
      var_95: null,
      var_99: null,
      cvar_95: null,
      cvar_99: null,
      max_drawdown: null,
      avg_drawdown: null,
      avg_drawdown_duration: null,
      time_weighted_return_pct: null,
      total_return_pct: null,
      median_monthly_return: null,
      cagr: null,
      beta: null,
      sharpe_ratio: null,
      sortino_ratio: null,
      treynor_ratio: null,
      information_ratio: null,
      jensens_alpha: null,
      relative_return: null,
      tracking_error: null,
      spy_twr_pct: null,
      spy_cagr_pct: null,
      up_capture_ratio: null,
      down_capture_ratio: null,
    }]);

    const { getPerformance } = await import("../src/commands/performance.js");
    const result = await getPerformance();

    expect(result.total_days).toBe(0);
    expect(result.start_date).toBeNull();
    expect(result.start_value).toBe(0);
    expect(result.sharpe_ratio).toBe(0);
  });
});

describe("getPerformance — CLI integration", () => {
  test("dispatches performance command and returns success envelope", async () => {
    mockQuery.mockResolvedValue([makeRow()]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "performance"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("performance");
    expect(output.data.time_weighted_return_pct).toBe(15);
    expect(output.data.cagr).toBe(32.5);
    expect(output.data.sharpe_ratio).toBe(1.35);
    expect(output.data.median_monthly_return).toBe(2.8);
    expect(output.data.max_drawdown).toBe(8.5);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("dispatches performance with --as-of-date and --benchmark", async () => {
    mockQuery.mockResolvedValue([makeRow()]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "performance", "--as-of-date", "2026-01-15", "--benchmark", "IVV"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("performance");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("performance appears in help text", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "--help"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("performance");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
