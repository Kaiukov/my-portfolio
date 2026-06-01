import { describe, expect, test, mock, jest, beforeEach } from "bun:test";
import type { PriceRow } from "../src/providers/yahoo.js";

const TODAY = new Date().toISOString().split("T")[0];

const mockQuery = mock();
const mockQuerySingle = mock();
const mockFetchPrices = mock(async (ticker: string, _startDate: string, _endDate: string): Promise<PriceRow[]> => [
  { ticker, date: "2026-01-15", price: ticker === "USD" ? 1 : 200 },
]);

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  connect: () => {},
  close: () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: mock(),
}));

mock.module("../src/providers/yahoo.js", () => ({
  fetchPrices: mockFetchPrices,
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

function configureRefreshDbMocks(options: {
  degradedRepair?: boolean;
  staleBlock?: boolean;
}) {
  const degradedRepair = options.degradedRepair ?? false;
  const staleBlock = options.staleBlock ?? false;

  mockQuerySingle.mockImplementation((sql: string) => {
    if (sql.includes("MIN(date)::text AS start_date")) {
      return Promise.resolve({ start_date: "2026-01-01", end_date: "2026-01-31" });
    }
    if (sql.includes("COUNT(*)::int AS total_rows")) {
      return Promise.resolve({ total_rows: 1, min_date: "2026-01-15", max_date: "2026-01-15" });
    }
    if (sql.includes("SELECT needs_recalc() AS needs_recalc")) {
      return Promise.resolve({ needs_recalc: staleBlock });
    }
    if (sql.includes("portfolio_summary_sql")) {
      return Promise.resolve(makeSummaryRow());
    }
    if (sql.includes("MAX(date)::text AS prices_as_of")) {
      return Promise.resolve({ prices_as_of: TODAY });
    }
    return Promise.resolve(null);
  });

  mockQuery.mockImplementation((sql: string) => {
    if (sql.includes("SELECT ticker FROM discover_required_tickers_sql() WHERE ticker NOT LIKE 'CASH %' ORDER BY ticker")) {
      return Promise.resolve([{ ticker: "USD" }]);
    }
    if (sql.includes("INSERT INTO prices")) {
      return Promise.resolve([]);
    }
    if (sql.includes("INSERT INTO repair_log")) {
      return Promise.resolve([]);
    }
    if (sql.includes("SELECT upsert_asset_metadata")) {
      return Promise.resolve([]);
    }
    if (sql.includes("INSERT INTO refresh_log")) {
      return Promise.resolve([]);
    }
    if (sql.includes("INSERT INTO service_state")) {
      return Promise.resolve([]);
    }
    if (sql.includes("UPDATE service_state SET state_value = 'false'")) {
      return Promise.resolve([]);
    }
    if (sql.includes("SELECT DISTINCT ticker FROM prices ORDER BY ticker")) {
      return Promise.resolve([{ ticker: "USD" }]);
    }
    if (sql.includes("SELECT ticker, ticker_category FROM discover_required_tickers_sql() ORDER BY ticker")) {
      return Promise.resolve([{ ticker: "USD", ticker_category: "cash" }]);
    }
    if (sql.includes("SELECT ticker, checkpoint_date::text AS checkpoint_date FROM get_required_price_checkpoints_sql")) {
      return Promise.resolve(
        degradedRepair
          ? [{ ticker: "AAPL", checkpoint_date: "2026-01-15" }]
          : [],
      );
    }
    if (sql.includes("SELECT d::text FROM (VALUES")) {
      return Promise.resolve(degradedRepair ? [{ d: "2026-01-15" }] : []);
    }
    if (sql.includes("SELECT ticker FROM stale_tickers_sql")) {
      return Promise.resolve(staleBlock ? [{ ticker: "AAPL" }] : []);
    }
    if (sql.includes("price_asof_stale_sql")) {
      return Promise.resolve(staleBlock ? [{ ticker: "AAPL" }] : []);
    }
    if (sql.includes("SELECT refresh_daily_returns_sql($1) AS refresh_daily_returns_sql")) {
      return Promise.resolve([{ refresh_daily_returns_sql: 10 }]);
    }
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuerySingle.mockReset();
  mockFetchPrices.mockReset();
  mockFetchPrices.mockImplementation(async (ticker: string, _startDate: string, _endDate: string): Promise<PriceRow[]> => [
    { ticker, date: "2026-01-15", price: ticker === "USD" ? 1 : 200 },
  ]);
});

describe("refreshPortfolio service", () => {
  test("uses force:true for clean refreshes and surfaces the recalc result", async () => {
    configureRefreshDbMocks({ degradedRepair: false, staleBlock: false });

    const { refreshPortfolio } = await import("../src/commands/refresh.js");
    const result = await refreshPortfolio();

    expect(mockQuerySingle.mock.calls.some((call) => String(call[0]).includes("SELECT needs_recalc() AS needs_recalc"))).toBe(true);
    expect(result.refreshed.status).toBe("ok");
    expect(result.recalculated).toBe(true);
    expect(result.recalc).toEqual({
      rows_affected: 10,
      recalc_type: "full",
      from_date: null,
    });
    expect(result.summary.holding_count).toBe(5);
    expect(result.summary.portfolio_value_usd).toBe(25000);
  });

  test("uses force:false for degraded refreshes and blocks stale revaluation", async () => {
    configureRefreshDbMocks({ degradedRepair: true, staleBlock: true });

    const { refreshPortfolio } = await import("../src/commands/refresh.js");
    const result = await refreshPortfolio();

    expect(result.refreshed.status).toBe("degraded");
    expect(result.recalculated).toBe(false);
    expect(result.recalc).toEqual({
      rows_affected: 0,
      recalc_type: "full",
      from_date: null,
      prices_stale: true,
      stale_tickers: ["AAPL"],
    });
    expect(result.recalc.prices_stale).toBe(true);
    expect(result.recalc.stale_tickers).toEqual(["AAPL"]);
  });

  test("never reports recalculated:true when the stale guard blocks recalc", async () => {
    configureRefreshDbMocks({ degradedRepair: true, staleBlock: true });

    const { refreshPortfolio } = await import("../src/commands/refresh.js");
    const result = await refreshPortfolio();

    expect(result.recalculated).toBe(false);
    expect(result.recalc.prices_stale).toBe(true);
  });
});

describe("refreshPortfolioDryRun service", () => {
  test("composes repairPricesDryRun + getSummary + has correct shape", async () => {
    configureRefreshDbMocks({ degradedRepair: false, staleBlock: false });

    const { refreshPortfolioDryRun } = await import("../src/commands/refresh.js");
    const result = await refreshPortfolioDryRun();

    expect(result).toHaveProperty("dry_run");
    expect(result).toHaveProperty("refreshed");
    expect(result).toHaveProperty("recalculated");
    expect(result).toHaveProperty("summary");
    expect(result.dry_run).toBe(true);
    expect(result.recalculated).toBe(false);
    expect(result.refreshed.would_repair).toEqual(["USD"]);
    expect(result.summary.holding_count).toBe(5);
    expect(result.summary.portfolio_value_usd).toBe(25000);
  });
});

describe("refresh CLI dispatch", () => {
  test("dispatches refresh and returns the clean refresh JSON envelope", async () => {
    configureRefreshDbMocks({ degradedRepair: false, staleBlock: false });

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "refresh"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output).toMatchObject({
      ok: true,
      command: "refresh",
      data: {
        recalculated: true,
        recalc: {
          rows_affected: 10,
          recalc_type: "full",
          from_date: null,
        },
        refreshed: {
          status: "ok",
        },
        summary: {
          holding_count: 5,
          portfolio_value_usd: 25000,
        },
      },
      meta: {
        prices_as_of: TODAY,
      },
    });

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("dispatches refresh and returns the degraded refresh JSON envelope", async () => {
    configureRefreshDbMocks({ degradedRepair: true, staleBlock: true });

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "refresh"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output).toMatchObject({
      ok: true,
      command: "refresh",
      data: {
        recalculated: false,
        recalc: {
          rows_affected: 0,
          recalc_type: "full",
          from_date: null,
          prices_stale: true,
          stale_tickers: ["AAPL"],
        },
        refreshed: {
          status: "degraded",
        },
        summary: {
          holding_count: 5,
          portfolio_value_usd: 25000,
        },
      },
      meta: {
        prices_as_of: TODAY,
      },
    });

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("dispatches refresh --dry-run and returns preview", async () => {
    configureRefreshDbMocks({ degradedRepair: false, staleBlock: false });

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "refresh", "--dry-run"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("refresh");
    expect(output.data.dry_run).toBe(true);
    expect(output.data.recalculated).toBe(false);
    expect(output.data.refreshed.would_repair).toEqual(["USD"]);
    expect(output.data.summary).toBeDefined();

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
