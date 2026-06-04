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
    calmar_ratio: 3.8235,
    real_cagr: 29.2683,
    real_total_return_pct: 12.0731,
    ...overrides,
  };
}

function setupMocks(perfRow: Record<string, unknown> | null = makeRow(), periodRows: Record<string, unknown>[] = [], rollingRows: Record<string, unknown>[] = []) {
  mockQuery.mockImplementation((sql: string, _params?: unknown[]) => {
    if (typeof sql === "string" && sql.includes("portfolio_period_returns_sql")) return Promise.resolve(periodRows);
    if (typeof sql === "string" && sql.includes("portfolio_rolling_returns_sql")) return Promise.resolve(rollingRows);
    return Promise.resolve([perfRow as Record<string, unknown>]);
  });
}

describe("getPerformance", () => {
  test("returns performance metrics from portfolio_performance_sql()", async () => {
    setupMocks();

    const { getPerformance } = await import("../src/commands/performance.js");
    const { data: result, benchmark } = await getPerformance();

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
    expect(result.calmar_ratio).toBe(3.8235);
    expect(result.real_cagr).toBe(29.2683);
    expect(result.real_total_return_pct).toBe(12.0731);
    expect(benchmark).toBe("SPY");
  });

  test("total_gain reconciles with TWR: total_gain ≈ start_value * twr_pct / 100", async () => {
    setupMocks();

    const { getPerformance } = await import("../src/commands/performance.js");
    const { data: result } = await getPerformance();

    const expected = result.start_value * result.time_weighted_return_pct / 100;
    const diff = Math.abs(result.total_gain - expected);
    expect(diff).toBeLessThan(0.01);
  });

  test("passes as_of_date, benchmark, from_date, inflationRate as SQL parameters", async () => {
    mockQuery.mockClear();
    setupMocks();

    const { getPerformance } = await import("../src/commands/performance.js");
    await getPerformance({ asOfDate: "2026-01-15", benchmark: "IVV", fromDate: "2025-01-01", inflationRate: "0.03" });

    expect(mockQuery.mock.calls[0][1]).toEqual(["2026-01-15", "IVV", "2025-01-01", "0.03"]);
  });

  test("uses default benchmark SPY and default inflation rate when not specified", async () => {
    mockQuery.mockClear();
    setupMocks();

    const { getPerformance } = await import("../src/commands/performance.js");
    await getPerformance();

    expect(mockQuery.mock.calls[0][1][1]).toBe("SPY");
    expect(mockQuery.mock.calls[0][1][3]).toBe("0.025");
  });

  test("uses PORTFOLIO_BENCHMARK_TICKERS env var fallback", async () => {
    mockQuery.mockClear();
    setupMocks();

    const prev = process.env["PORTFOLIO_BENCHMARK_TICKERS"];
    process.env["PORTFOLIO_BENCHMARK_TICKERS"] = "IVV,VOO";
    try {
      const { getPerformance } = await import("../src/commands/performance.js");
      await getPerformance();

      expect(mockQuery.mock.calls[0][1][1]).toBe("IVV");
    } finally {
      if (prev !== undefined) {
        process.env["PORTFOLIO_BENCHMARK_TICKERS"] = prev;
      } else {
        delete process.env["PORTFOLIO_BENCHMARK_TICKERS"];
      }
    }
  });

  test("computes from_date from period", async () => {
    mockQuery.mockClear();
    setupMocks();

    const { getPerformance } = await import("../src/commands/performance.js");
    await getPerformance({ period: "ytd" });

    const params = mockQuery.mock.calls[0][1] as [string, string, string, string];
    expect(params[2]).toBeDefined();
    expect(params[2]).toMatch(/^\d{4}-01-01$/);
  });

  test("handles empty result gracefully", async () => {
    mockQuery.mockImplementation(() => Promise.resolve([]));

    const { getPerformance } = await import("../src/commands/performance.js");
    const { data: result, benchmark } = await getPerformance();

    expect(result.total_days).toBe(0);
    expect(result.start_date).toBeNull();
    expect(result.end_date).toBeNull();
    expect(result.start_value).toBe(0);
    expect(result.end_value).toBe(0);
    expect(result.time_weighted_return_pct).toBe(0);
    expect(result.sharpe_ratio).toBe(0);
    expect(result.calmar_ratio).toBe(0);
    expect(result.real_cagr).toBe(0);
    expect(result.real_total_return_pct).toBe(0);
    expect(result.period_returns.SII).toBe(0);
    expect(result.rolling_12m_returns).toEqual([]);
    expect(benchmark).toBe("SPY");
  });

  test("handles null SQL values by coercing to 0", async () => {
    const nullRow: Record<string, unknown> = {
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
      calmar_ratio: null,
      real_cagr: null,
      real_total_return_pct: null,
    };
    setupMocks(nullRow);

    const { getPerformance } = await import("../src/commands/performance.js");
    const { data: result } = await getPerformance();

    expect(result.total_days).toBe(0);
    expect(result.start_date).toBeNull();
    expect(result.start_value).toBe(0);
    expect(result.sharpe_ratio).toBe(0);
    expect(result.calmar_ratio).toBe(0);
    expect(result.real_cagr).toBe(0);
  });

  test("period_returns defaults are populated", async () => {
    setupMocks(makeRow(), [], []);

    const { getPerformance } = await import("../src/commands/performance.js");
    const { data: result } = await getPerformance();

    expect(result.period_returns).toBeDefined();
    expect(result.period_returns["1M"]).toBe(0);
    expect(result.period_returns["3M"]).toBe(0);
    expect(result.period_returns["6M"]).toBe(0);
    expect(result.period_returns.YTD).toBe(0);
    expect(result.period_returns["1Y"]).toBe(0);
    expect(result.period_returns.SII).toBe(0);
    expect(result.rolling_12m_returns).toEqual([]);
  });

  test("period_returns maps SQL rows correctly", async () => {
    const periodRows = [
      { period: "1M", return_pct: 1.2 },
      { period: "3M", return_pct: 3.4 },
      { period: "6M", return_pct: 6.7 },
      { period: "YTD", return_pct: 8.9 },
      { period: "1Y", return_pct: 15.0 },
      { period: "SII", return_pct: 25.5 },
    ];
    setupMocks(makeRow(), periodRows, []);

    const { getPerformance } = await import("../src/commands/performance.js");
    const { data: result } = await getPerformance();

    expect(result.period_returns["1M"]).toBe(1.2);
    expect(result.period_returns["3M"]).toBe(3.4);
    expect(result.period_returns["6M"]).toBe(6.7);
    expect(result.period_returns.YTD).toBe(8.9);
    expect(result.period_returns["1Y"]).toBe(15.0);
    expect(result.period_returns.SII).toBe(25.5);
  });

  test("rolling_12m_returns maps SQL rows correctly", async () => {
    const rollingRows = [
      { date: "2026-01-31", return_pct: 5.0 },
      { date: "2026-02-28", return_pct: 6.2 },
      { date: "2026-03-31", return_pct: 4.8 },
    ];
    setupMocks(makeRow(), [], rollingRows);

    const { getPerformance } = await import("../src/commands/performance.js");
    const { data: result } = await getPerformance();

    expect(result.rolling_12m_returns).toHaveLength(3);
    expect(result.rolling_12m_returns[0]).toEqual({ date: "2026-01-31", return: 5.0 });
    expect(result.rolling_12m_returns[1]).toEqual({ date: "2026-02-28", return: 6.2 });
    expect(result.rolling_12m_returns[2]).toEqual({ date: "2026-03-31", return: 4.8 });
  });
});

describe("getPerformance — CLI integration", () => {
  test("dispatches performance command and returns success envelope", async () => {
    setupMocks();

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
    expect(output.data.calmar_ratio).toBe(3.8235);
    expect(output.data.real_cagr).toBe(29.2683);
    expect(output.data.real_total_return_pct).toBe(12.0731);
    expect(output.data.period_returns).toBeDefined();
    expect(output.data.rolling_12m_returns).toBeDefined();
    expect(Array.isArray(output.data.rolling_12m_returns)).toBe(true);
    expect(output.meta.benchmark).toBe("SPY");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("dispatches performance with --as-of-date, --benchmark, and --inflation-rate", async () => {
    setupMocks();

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "performance", "--as-of-date", "2026-01-15", "--benchmark", "IVV", "--inflation-rate", "0.03"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("performance");
    expect(output.data.period_returns).toBeDefined();
    expect(output.data.rolling_12m_returns).toBeDefined();
    expect(output.meta.benchmark).toBe("IVV");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("performance help text describes benchmark, inflation, period_returns, and rolling returns", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "--help"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("performance");
    expect(output).toContain("Calmar");
    expect(output).toContain("inflation");
    expect(output).toContain("period_returns");
    expect(output).toContain("rolling_12m_returns");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
