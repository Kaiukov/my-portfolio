import { beforeEach, describe, expect, test, mock, jest } from "bun:test";
import type { PriceRow } from "../src/providers/yahoo.js";

const mockQuery = mock();
const mockQuerySingle = mock();
const repairLogRows: Array<{ ticker: string; status: string; rowsLoaded: number; message: string | null }> = [];

const REQUIRED_TICKER_FIXTURE = [
  { ticker: "EUR", ticker_category: "cash_fx" },
  { ticker: "AAPL", ticker_category: "asset" },
];

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  connect: () => {},
  close: () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: mock(),
}));

beforeEach(() => {
  mockQuery.mockReset();
  mockQuerySingle.mockReset();
  repairLogRows.length = 0;
});

function installRequiredTickerMocks() {
  mockQuerySingle.mockImplementation((sql: string) => {
    if (sql.includes("MIN(date)::text AS start_date")) {
      return Promise.resolve({ start_date: "2026-01-01", end_date: "2026-01-31" });
    }
    return Promise.resolve(null);
  });

  mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
    if (sql.includes("discover_required_tickers_sql()")) {
      const rows = sql.includes("NOT is_cash_like_sql(ticker)")
        ? REQUIRED_TICKER_FIXTURE.filter((row) => row.ticker !== "EUR")
        : REQUIRED_TICKER_FIXTURE;
      return Promise.resolve(rows.map((row) => ({ ticker: row.ticker })));
    }

    if (sql.includes("INSERT INTO repair_log")) {
      repairLogRows.push({
        ticker: String(params?.[0]),
        status: String(params?.[3]),
        rowsLoaded: Number(params?.[4] ?? 0),
        message: params?.[5] == null ? null : String(params?.[5]),
      });
      return Promise.resolve([]);
    }

    return Promise.resolve([]);
  });
}

function installFullRepairMocks() {
  installRequiredTickerMocks();

  mockQuerySingle.mockImplementation((sql: string) => {
    if (sql.includes("MIN(date)::text AS start_date")) {
      return Promise.resolve({ start_date: "2026-01-01", end_date: "2026-01-31" });
    }
    if (sql.includes("COUNT(*)::int AS total_rows")) {
      return Promise.resolve({ total_rows: 1, min_date: "2026-01-15", max_date: "2026-01-15" });
    }
    if (sql.includes("needs_recalc() AS needs_recalc")) {
      return Promise.resolve({ needs_recalc: false });
    }
    return Promise.resolve(null);
  });

  mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
    if (sql.includes("discover_required_tickers_sql()")) {
      const rows = sql.includes("NOT is_cash_like_sql(ticker)")
        ? REQUIRED_TICKER_FIXTURE.filter((row) => row.ticker !== "EUR")
        : REQUIRED_TICKER_FIXTURE;
      return Promise.resolve(rows.map((row) => ({ ticker: row.ticker })));
    }

    if (sql.includes("INSERT INTO prices")) {
      return Promise.resolve([]);
    }

    if (sql.includes("INSERT INTO repair_log")) {
      repairLogRows.push({
        ticker: String(params?.[0]),
        status: String(params?.[3]),
        rowsLoaded: Number(params?.[4] ?? 0),
        message: params?.[5] == null ? null : String(params?.[5]),
      });
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
      return Promise.resolve([{ ticker: "AAPL" }]);
    }

    if (sql.includes("get_required_price_checkpoints_sql")) {
      return Promise.resolve([]);
    }

    if (sql.includes("SELECT d::text FROM (VALUES")) {
      return Promise.resolve([]);
    }

    return Promise.resolve([]);
  });
}

describe("repairPricesDryRun", () => {
  test("excludes cash-like tickers from the required set", async () => {
    installRequiredTickerMocks();

    const { repairPricesDryRun } = await import("../src/commands/repair_prices.js");
    const result = await repairPricesDryRun({ endDate: "2026-01-31" });

    expect(result.dry_run).toBe(true);
    expect(result.would_repair).toEqual(["AAPL"]);
    expect(result.range).toEqual({ start: "2026-01-01", end: "2026-01-31" });
  });

  test("uses explicit ticker list when provided", async () => {
    mockQuerySingle.mockResolvedValue({ start_date: "2026-01-01", end_date: "2026-03-01" });

    const { repairPricesDryRun } = await import("../src/commands/repair_prices.js");
    const result = await repairPricesDryRun({ tickers: ["SPY"] });
    expect(result.would_repair).toEqual(["SPY"]);
  });
});

describe("repairPrices", () => {
  test("calls fetch function per ticker and upserts prices", async () => {
    mockQuerySingle.mockResolvedValue({ start_date: "2026-01-01", end_date: "2026-01-31" });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("discover_required_tickers_sql()")) {
        return Promise.resolve([{ ticker: "AAPL" }]);
      }
      return Promise.resolve([]);
    });

    const fakeFetch = mock(async (): Promise<PriceRow[]> => [
      { ticker: "AAPL", date: "2026-01-15", price: 200 },
      { ticker: "AAPL", date: "2026-01-16", price: 201 },
    ]);

    const { repairPrices } = await import("../src/commands/repair_prices.js");
    const result = await repairPrices({}, fakeFetch);

    expect(result.tickers).toEqual(["AAPL"]);
    expect(result.rows_loaded).toBe(2);
    expect(result.rows_per_ticker["AAPL"]).toBe(2);
    expect(fakeFetch).toHaveBeenCalledWith("AAPL", "2026-01-01", expect.any(String));
  });

  test("uses explicit tickers when provided", async () => {
    mockQuerySingle.mockResolvedValue({ start_date: "2026-01-01", end_date: "2026-01-31" });

    const fakeFetch = mock(async (): Promise<PriceRow[]> => [
      { ticker: "SPY", date: "2026-01-15", price: 500 },
    ]);

    const { repairPrices } = await import("../src/commands/repair_prices.js");
    const result = await repairPrices({ tickers: ["SPY"] }, fakeFetch);

    expect(result.tickers).toEqual(["SPY"]);
    expect(fakeFetch).toHaveBeenCalledWith("SPY", expect.any(String), expect.any(String));
  });

  test("full repair excludes cash-like tickers from fetches and repair_log failures", async () => {
    installFullRepairMocks();

    const fetchCalls: string[] = [];
    const fakeFetch = mock(async (ticker: string): Promise<PriceRow[]> => {
      fetchCalls.push(ticker);
      if (ticker === "EUR") {
        throw new Error("cash-like tickers should not be fetched");
      }
      return [{ ticker: "AAPL", date: "2026-01-15", price: 200 }];
    });

    const { repairPrices } = await import("../src/commands/repair_prices.js");
    const result = await repairPrices({}, fakeFetch, async () => null);

    expect(result.status).toBe("ok");
    expect(result.tickers).toEqual(["AAPL"]);
    expect(result.rows_loaded).toBe(1);
    expect(fetchCalls).toEqual(["AAPL"]);
    expect(fakeFetch).not.toHaveBeenCalledWith("EUR", expect.any(String), expect.any(String));
    expect(repairLogRows).toEqual([
      { ticker: "AAPL", status: "success", rowsLoaded: 1, message: null },
    ]);
  });
});

describe("repairPrices CLI", () => {
  test("CLI JSON snapshot excludes EUR from the repair list", async () => {
    installRequiredTickerMocks();

    const { dispatch } = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await dispatch(["bun", "src/cli.ts", "repair_prices", "--dry-run", "--end-date", "2026-01-31"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("repair_prices");
    expect(output.data.dry_run).toBe(true);
    expect(output.data.would_repair).toEqual(["AAPL"]);
    expect(output.data.would_skip_fresh).toEqual([]);
    expect(output.data.range).toEqual({ start: "2026-01-01", end: "2026-01-31" });

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
