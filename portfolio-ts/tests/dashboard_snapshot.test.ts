import { describe, expect, test, mock } from "bun:test";

mock.module("../src/db.js", () => ({
  query: mock(() => Promise.resolve([])),
  querySingle: mock(() => Promise.resolve(null)),
  getAssetMetadata: mock(() => Promise.resolve([])),
  upsertAssetMetadata: mock(async () => {}),
  connect: () => {},
  close: () => {},
  getSql: () => ({
    unsafe: async () => [],
  }),
}));

mock.module("../src/tx.js", () => ({
  runTx: async <T>(
    fn: (tx: { unsafe: (...args: unknown[]) => unknown }) => Promise<T>,
  ): Promise<T> => fn({ unsafe: async () => [] }),
  beginTx: mock(() => Promise.resolve({})),
  commit: mock(() => Promise.resolve()),
  rollback: mock(() => Promise.resolve()),
}));

const summaryFixture = {
  holding_count: 5,
  total_cash_usd: 2500.75,
  portfolio_value_usd: 42500.12,
  last_transaction_date: "2026-06-01",
  transaction_count: 42,
  as_of_date: "2026-06-03",
};

const statusFixture = {
  transactions: 42,
  start_date: "2025-01-15",
  end_date: "2026-06-03",
  portfolio_value: 42500.12,
  total_invested: 38000.0,
  deposits: 40000.0,
  withdrawals: 2000.0,
  income: 500.0,
  fees: 75.0,
  taxes: 25.0,
  total_gain: 4500.12,
  total_gain_pct: 11.84,
  cost_basis: 38000.0,
  realized_gain: 1200.0,
  unrealized_gain: 3300.12,
  total_profit: 4500.12,
  as_of_date: "2026-06-03",
};

const widgetFixture = {
  title: "My holdings",
  currency: "USD",
  as_of_date: "2026-06-03",
  last_refresh: "2026-06-03",
  value: 42500.12,
  today: { amount: 125.5, pct: 0.296 },
  total: { amount: 4500.12, pct: 11.84 },
  series: [
    { date: "2025-06-04", value: 38000.0 },
    { date: "2026-06-03", value: 42500.12 },
  ],
};

const allocationFixture = {
  as_of_date: "2026-06-03",
  portfolio_value: 40000.0,
  rows: [
    { asset: "AAPL", asset_type: "stock", asset_kind: "equity", net_quantity: 50, value_usd: 9750.0, allocation_pct: 24.375, sector: "Technology" },
    { asset: "VTI", asset_type: "etf", asset_kind: "equity", net_quantity: 100, value_usd: 27250.0, allocation_pct: 56.875, sector_weights: [{ sector: "Technology", weight: 30 }, { sector: "Financial Services", weight: 15 }] },
    { asset: "USD", asset_type: "cash", asset_kind: "cash", net_quantity: 2500.75, value_usd: 2500.75, allocation_pct: 6.25 },
    { asset: "BND", asset_type: "etf", asset_kind: "fixed_income", net_quantity: 70, value_usd: 5000.0, allocation_pct: 12.5, sector: "Bonds" },
  ],
};

const cashFixture = {
  as_of_date: "2026-06-03",
  total_usd: 2500.75,
  rows: [
    { cash_key: "usd", currency: "USD", display_bucket: "USD Cash", balance: 2500.75, usd_value: 2500.75 },
  ],
};

const performanceFixture = {
  data: {
    total_days: 504,
    start_date: "2025-01-15",
    end_date: "2026-06-03",
    start_value: 38000.0,
    end_value: 42500.12,
    total_gain: 4500.12,
    avg_daily_return: 0.023,
    avg_investment_return: 0.018,
    std_dev: 0.85,
    hist_volatility: 13.5,
    var_95: -1.2,
    var_99: -2.1,
    cvar_95: -1.8,
    cvar_99: -2.7,
    max_drawdown: 8.5,
    avg_drawdown: 2.1,
    avg_drawdown_duration: 5.3,
    time_weighted_return_pct: 11.84,
    total_return_pct: 11.84,
    median_monthly_return: 0.9,
    cagr: 10.2,
    beta: 0.95,
    sharpe_ratio: 0.72,
    sortino_ratio: 1.05,
    treynor_ratio: 10.2,
    information_ratio: 0.35,
    jensens_alpha: 1.2,
    relative_return: 2.5,
    tracking_error: 3.1,
    spy_twr_pct: 9.34,
    spy_cagr_pct: 9.34,
    up_capture_ratio: 95.0,
    down_capture_ratio: 85.0,
    calmar_ratio: 1.2,
    real_cagr: 7.7,
    real_total_return_pct: 9.34,
    period_returns: { "1M": 1.5, "3M": 4.2, "6M": 8.1, YTD: 6.5, "1Y": 11.84, SII: 11.84 },
    rolling_12m_returns: [{ date: "2026-06-03", return: 11.84 }],
  },
  benchmark: "SPY",
};

const freshnessFixture = {
  prices_as_of: "2026-06-03",
  price_age_days: 0,
  stale: false,
  needs_recalc: false,
};

describe("buildDashboardSnapshot", () => {
  test("produces all fields with correct shape using injected deps", async () => {
    const mockGetSummary = mock(async () => summaryFixture);
    const mockGetStatus = mock(async () => statusFixture);
    const mockGetWidget = mock(async () => widgetFixture);
    const mockGetAllocation = mock(async () => allocationFixture);
    const mockGetCash = mock(async () => cashFixture);
    const mockGetPerformance = mock(async () => performanceFixture);
    const mockGetPriceFreshness = mock(async () => freshnessFixture);

    const { buildDashboardSnapshot } = await import("../src/commands/dashboard.js");
    const snapshot = await buildDashboardSnapshot("2026-06-03", {
      getSummary: mockGetSummary,
      getStatus: mockGetStatus,
      getWidget: mockGetWidget,
      getAllocation: mockGetAllocation,
      getCash: mockGetCash,
      getPerformance: mockGetPerformance,
      getPriceFreshness: mockGetPriceFreshness,
    });

    expect(snapshot.summary.holding_count).toBe(5);
    expect(snapshot.summary.total_cash_usd).toBe(2500.75);
    expect(snapshot.summary.portfolio_value_usd).toBe(42500.12);
    expect(snapshot.summary.last_transaction_date).toBe("2026-06-01");
    expect(snapshot.summary.transaction_count).toBe(42);
    expect(snapshot.summary.as_of_date).toBe("2026-06-03");

    expect(snapshot.status.transactions).toBe(42);
    expect(snapshot.status.portfolio_value).toBe(42500.12);
    expect(snapshot.status.total_gain).toBe(4500.12);
    expect(snapshot.status.total_gain_pct).toBe(11.84);

    expect(Array.isArray(snapshot.allocation_rows)).toBe(true);
    expect(snapshot.allocation_rows.length).toBe(4);
    const aapl = snapshot.allocation_rows[0];
    expect(aapl.asset).toBe("AAPL");
    expect(aapl.asset_type).toBe("stock");
    expect(aapl.asset_kind).toBe("equity");
    expect(aapl.net_quantity).toBe(50);
    expect(aapl.value_usd).toBe(9750.0);
    expect(aapl.allocation_pct).toBe(24.375);
    expect(aapl.sector).toBe("Technology");

    const vti = snapshot.allocation_rows[1];
    expect(vti.asset).toBe("VTI");
    expect(vti.sector).toBeUndefined();
    expect(vti.sector_weights).toBeDefined();
    expect(vti.sector_weights!.length).toBe(2);
    expect(vti.sector_weights![0].sector).toBe("Technology");
    expect(vti.sector_weights![0].weight).toBe(30);

    expect(Array.isArray(snapshot.cash_rows)).toBe(true);
    expect(snapshot.cash_rows.length).toBe(1);
    expect(snapshot.cash_rows[0].cash_key).toBe("usd");
    expect(snapshot.cash_rows[0].currency).toBe("USD");
    expect(snapshot.cash_rows[0].display_bucket).toBe("USD Cash");
    expect(snapshot.cash_rows[0].balance).toBe(2500.75);
    expect(snapshot.cash_rows[0].usd_value).toBe(2500.75);

    expect(snapshot.performance.total_days).toBe(504);
    expect(snapshot.performance.cagr).toBe(10.2);
    expect(snapshot.performance.sharpe_ratio).toBe(0.72);

    expect(snapshot.today.abs).toBe(125.5);
    expect(snapshot.today.pct).toBe(0.296);
    expect(snapshot.total.abs).toBe(4500.12);
    expect(snapshot.total.pct).toBe(11.84);

    expect(Array.isArray(snapshot.history)).toBe(true);
    expect(snapshot.history.length).toBe(2);
    expect(snapshot.history[0]).toEqual({ date: "2025-06-04", value: 38000.0 });
    expect(snapshot.history[1]).toEqual({ date: "2026-06-03", value: 42500.12 });

    expect(snapshot.prices_as_of).toBe("2026-06-03");
    expect(typeof snapshot.updatedAt).toBe("string");
    expect(snapshot.updatedAt.length).toBeGreaterThan(0);
  });

  test("today.abs comes from widget.today.amount (not status)", async () => {
    const mockGetSummary = mock(async () => summaryFixture);
    const mockGetStatus = mock(async () => statusFixture);
    const mockGetWidget = mock(async () => ({
      ...widgetFixture,
      today: { amount: 999.99, pct: 2.5 },
    }));
    const mockGetAllocation = mock(async () => allocationFixture);
    const mockGetCash = mock(async () => cashFixture);
    const mockGetPerformance = mock(async () => performanceFixture);
    const mockGetPriceFreshness = mock(async () => freshnessFixture);

    const { buildDashboardSnapshot } = await import("../src/commands/dashboard.js");
    const snapshot = await buildDashboardSnapshot("2026-06-03", {
      getSummary: mockGetSummary,
      getStatus: mockGetStatus,
      getWidget: mockGetWidget,
      getAllocation: mockGetAllocation,
      getCash: mockGetCash,
      getPerformance: mockGetPerformance,
      getPriceFreshness: mockGetPriceFreshness,
    });

    expect(snapshot.today.abs).toBe(999.99);
    expect(snapshot.today.pct).toBe(2.5);
  });

  test("total.abs uses status.total_gain with fallback 0", async () => {
    const mockGetSummary = mock(async () => summaryFixture);
    const mockGetStatus = mock(async () => ({
      ...statusFixture,
      total_gain: null,
      total_gain_pct: null,
    }));
    const mockGetWidget = mock(async () => widgetFixture);
    const mockGetAllocation = mock(async () => allocationFixture);
    const mockGetCash = mock(async () => cashFixture);
    const mockGetPerformance = mock(async () => performanceFixture);
    const mockGetPriceFreshness = mock(async () => freshnessFixture);

    const { buildDashboardSnapshot } = await import("../src/commands/dashboard.js");
    const snapshot = await buildDashboardSnapshot("2026-06-03", {
      getSummary: mockGetSummary,
      getStatus: mockGetStatus,
      getWidget: mockGetWidget,
      getAllocation: mockGetAllocation,
      getCash: mockGetCash,
      getPerformance: mockGetPerformance,
      getPriceFreshness: mockGetPriceFreshness,
    });

    expect(snapshot.total.abs).toBe(0);
    expect(snapshot.total.pct).toBe(0);
  });

  test("prices_as_of is null when freshness returns null", async () => {
    const mockGetSummary = mock(async () => summaryFixture);
    const mockGetStatus = mock(async () => statusFixture);
    const mockGetWidget = mock(async () => widgetFixture);
    const mockGetAllocation = mock(async () => allocationFixture);
    const mockGetCash = mock(async () => cashFixture);
    const mockGetPerformance = mock(async () => performanceFixture);
    const mockGetPriceFreshness = mock(async () => ({
      prices_as_of: null,
      price_age_days: null,
      stale: true,
      needs_recalc: false,
    }));

    const { buildDashboardSnapshot } = await import("../src/commands/dashboard.js");
    const snapshot = await buildDashboardSnapshot("2026-06-03", {
      getSummary: mockGetSummary,
      getStatus: mockGetStatus,
      getWidget: mockGetWidget,
      getAllocation: mockGetAllocation,
      getCash: mockGetCash,
      getPerformance: mockGetPerformance,
      getPriceFreshness: mockGetPriceFreshness,
    });

    expect(snapshot.prices_as_of).toBeNull();
  });

  test("history is mapped from widget.series with correct date/value shape", async () => {
    const mockGetSummary = mock(async () => summaryFixture);
    const mockGetStatus = mock(async () => statusFixture);
    const mockGetWidget = mock(async () => ({
      ...widgetFixture,
      series: [
        { date: "2025-01-01", value: 10000 },
        { date: "2025-06-01", value: 15000 },
        { date: "2026-01-01", value: 20000 },
        { date: "2026-06-01", value: 25000 },
      ],
    }));
    const mockGetAllocation = mock(async () => allocationFixture);
    const mockGetCash = mock(async () => cashFixture);
    const mockGetPerformance = mock(async () => performanceFixture);
    const mockGetPriceFreshness = mock(async () => freshnessFixture);

    const { buildDashboardSnapshot } = await import("../src/commands/dashboard.js");
    const snapshot = await buildDashboardSnapshot("2026-06-03", {
      getSummary: mockGetSummary,
      getStatus: mockGetStatus,
      getWidget: mockGetWidget,
      getAllocation: mockGetAllocation,
      getCash: mockGetCash,
      getPerformance: mockGetPerformance,
      getPriceFreshness: mockGetPriceFreshness,
    });

    expect(snapshot.history.length).toBe(4);
    expect(snapshot.history[0]).toEqual({ date: "2025-01-01", value: 10000 });
    expect(snapshot.history[3]).toEqual({ date: "2026-06-01", value: 25000 });
  });

  test("performance comes from getPerformance().data (not the wrapper)", async () => {
    const mockGetSummary = mock(async () => summaryFixture);
    const mockGetStatus = mock(async () => statusFixture);
    const mockGetWidget = mock(async () => widgetFixture);
    const mockGetAllocation = mock(async () => allocationFixture);
    const mockGetCash = mock(async () => cashFixture);
    const mockGetPerformance = mock(async () => ({
      data: { ...performanceFixture.data, total_days: 999, cagr: 99.9 },
      benchmark: "VOO",
    }));
    const mockGetPriceFreshness = mock(async () => freshnessFixture);

    const { buildDashboardSnapshot } = await import("../src/commands/dashboard.js");
    const snapshot = await buildDashboardSnapshot("2026-06-03", {
      getSummary: mockGetSummary,
      getStatus: mockGetStatus,
      getWidget: mockGetWidget,
      getAllocation: mockGetAllocation,
      getCash: mockGetCash,
      getPerformance: mockGetPerformance,
      getPriceFreshness: mockGetPriceFreshness,
    });

    expect(snapshot.performance.total_days).toBe(999);
    expect(snapshot.performance.cagr).toBe(99.9);
  });

  test("getWidget is called with 365 days", async () => {
    const mockGetSummary = mock(async () => summaryFixture);
    const mockGetStatus = mock(async () => statusFixture);
    const mockGetWidget = mock(async () => widgetFixture);
    const mockGetAllocation = mock(async () => allocationFixture);
    const mockGetCash = mock(async () => cashFixture);
    const mockGetPerformance = mock(async () => performanceFixture);
    const mockGetPriceFreshness = mock(async () => freshnessFixture);

    const { buildDashboardSnapshot } = await import("../src/commands/dashboard.js");
    await buildDashboardSnapshot("2026-06-03", {
      getSummary: mockGetSummary,
      getStatus: mockGetStatus,
      getWidget: mockGetWidget,
      getAllocation: mockGetAllocation,
      getCash: mockGetCash,
      getPerformance: mockGetPerformance,
      getPriceFreshness: mockGetPriceFreshness,
    });

    expect(mockGetWidget).toHaveBeenCalledWith(365, "2026-06-03");
  });

  test("updatedAt is a valid ISO string", async () => {
    const mockGetSummary = mock(async () => summaryFixture);
    const mockGetStatus = mock(async () => statusFixture);
    const mockGetWidget = mock(async () => widgetFixture);
    const mockGetAllocation = mock(async () => allocationFixture);
    const mockGetCash = mock(async () => cashFixture);
    const mockGetPerformance = mock(async () => performanceFixture);
    const mockGetPriceFreshness = mock(async () => freshnessFixture);

    const { buildDashboardSnapshot } = await import("../src/commands/dashboard.js");
    const snapshot = await buildDashboardSnapshot("2026-06-03", {
      getSummary: mockGetSummary,
      getStatus: mockGetStatus,
      getWidget: mockGetWidget,
      getAllocation: mockGetAllocation,
      getCash: mockGetCash,
      getPerformance: mockGetPerformance,
      getPriceFreshness: mockGetPriceFreshness,
    });

    const parsed = new Date(snapshot.updatedAt);
    expect(parsed instanceof Date).toBe(true);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    expect(snapshot.updatedAt).toBe(parsed.toISOString());
  });

  test("buildDashboardSnapshotFromContext reuses shared updatedAt and common metrics", async () => {
    const mockGetAllocation = mock(async () => allocationFixture);
    const mockGetCash = mock(async () => cashFixture);
    const mockGetPerformance = mock(async () => performanceFixture);

    const { buildDashboardSnapshotFromContext } = await import(
      "../src/commands/dashboard.js"
    );
    const snapshot = await buildDashboardSnapshotFromContext(
      {
        asOfDate: "2026-06-03",
        updatedAt: "2026-06-03T12:34:56.000Z",
        summary: summaryFixture,
        status: statusFixture,
        widget: widgetFixture,
        freshness: freshnessFixture,
      },
      {
        getSummary: mock(async () => summaryFixture),
        getStatus: mock(async () => statusFixture),
        getWidget: mock(async () => widgetFixture),
        getAllocation: mockGetAllocation,
        getCash: mockGetCash,
        getPerformance: mockGetPerformance,
        getPriceFreshness: mock(async () => freshnessFixture),
      },
    );

    expect(snapshot.updatedAt).toBe("2026-06-03T12:34:56.000Z");
    expect(snapshot.summary.as_of_date).toBe("2026-06-03");
    expect(snapshot.today.abs).toBe(125.5);
    expect(snapshot.total.abs).toBe(4500.12);
    expect(mockGetAllocation).toHaveBeenCalledWith("2026-06-03");
    expect(mockGetCash).toHaveBeenCalledWith("2026-06-03");
    expect(mockGetPerformance).toHaveBeenCalledWith({ asOfDate: "2026-06-03" });
  });

  test("ETF sector_weights are passed through to snapshot allocation_rows", async () => {
    const etfAlloc = {
      as_of_date: "2026-06-03",
      portfolio_value: 50000.0,
      rows: [
        {
          asset: "SCHD",
          asset_type: "etf",
          asset_kind: "equity",
          net_quantity: 200,
          value_usd: 30000.0,
          allocation_pct: 60,
          sector_weights: [
            { sector: "Financial Services", weight: 20 },
            { sector: "Healthcare", weight: 15 },
            { sector: "Technology", weight: 12 },
          ],
        },
        {
          asset: "AAPL",
          asset_type: "stock",
          asset_kind: "equity",
          net_quantity: 50,
          value_usd: 20000.0,
          allocation_pct: 40,
          sector: "Technology",
        },
      ],
    };

    const mockGetSummary = mock(async () => summaryFixture);
    const mockGetStatus = mock(async () => statusFixture);
    const mockGetWidget = mock(async () => widgetFixture);
    const mockGetAllocation = mock(async () => etfAlloc);
    const mockGetCash = mock(async () => cashFixture);
    const mockGetPerformance = mock(async () => performanceFixture);
    const mockGetPriceFreshness = mock(async () => freshnessFixture);

    const { buildDashboardSnapshot } = await import("../src/commands/dashboard.js");
    const snapshot = await buildDashboardSnapshot("2026-06-03", {
      getSummary: mockGetSummary,
      getStatus: mockGetStatus,
      getWidget: mockGetWidget,
      getAllocation: mockGetAllocation,
      getCash: mockGetCash,
      getPerformance: mockGetPerformance,
      getPriceFreshness: mockGetPriceFreshness,
    });

    expect(snapshot.allocation_rows).toHaveLength(2);

    const schd = snapshot.allocation_rows[0];
    expect(schd.asset).toBe("SCHD");
    expect(schd.sector).toBeUndefined();
    expect(schd.sector_weights).toBeDefined();
    expect(schd.sector_weights!.length).toBe(3);
    expect(schd.sector_weights![0].sector).toBe("Financial Services");
    expect(schd.sector_weights![0].weight).toBe(20);

    const aapl = snapshot.allocation_rows[1];
    expect(aapl.asset).toBe("AAPL");
    expect(aapl.sector).toBe("Technology");
    expect(aapl.sector_weights).toBeUndefined();
  });
});
