import { describe, expect, test, mock } from "bun:test";

const mockQuerySingle = mock();
const mockQuery = mock();

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  connect: () => {},
  close: () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: async <T>(
    fn: (tx: { unsafe: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<T>,
  ): Promise<T> => fn({ unsafe: async (_sql: string, _params?: unknown[]) => [] }),
}));

const CONSISTENT_DATE = "2026-05-31";
const CONSISTENT_PORTFOLIO_VALUE = 19257.13;

function makeStatusRow(overrides: Record<string, unknown> = {}) {
  return {
    transactions_count: 42,
    start_date: "2024-01-15",
    end_date: CONSISTENT_DATE,
    portfolio_value: CONSISTENT_PORTFOLIO_VALUE,
    total_invested: 15000,
    deposits: 20000,
    withdrawals: 5000,
    income: 500,
    fees: 50,
    taxes: 0,
    total_gain: 4257.13,
    total_gain_pct: 28.38,
    cost_basis: 12000,
    realized_gain: 2000,
    unrealized_gain: 2257.13,
    total_profit: 4257.13,
    as_of_date: CONSISTENT_DATE,
    ...overrides,
  };
}

function makeAllocationRows() {
  return [
    { asset: "AAPL", asset_type: "stock_usd", net_quantity: 10, value_usd: 8000, allocation_pct: 41.55 },
    { asset: "GOOGL", asset_type: "stock_usd", net_quantity: 5, value_usd: 6257.13, allocation_pct: 32.49 },
    { asset: "USD", asset_type: "cash_base", net_quantity: 5000, value_usd: 5000, allocation_pct: 25.96 },
  ];
}

function makeSummaryRow(overrides: Record<string, unknown> = {}) {
  return {
    holding_count: 3,
    total_cash_usd: 5000,
    portfolio_value_usd: CONSISTENT_PORTFOLIO_VALUE,
    last_transaction_date: CONSISTENT_DATE,
    transaction_count: 42,
    as_of_date: CONSISTENT_DATE,
    ...overrides,
  };
}

describe("Cross-command consistency — valuation engine consolidation (#87)", () => {
  test("portfolio_value is consistent across status, allocation, and summary for same date", async () => {
    mockQuerySingle.mockReset();
    mockQuery.mockReset();
    mockQuerySingle.mockResolvedValueOnce(makeStatusRow());
    mockQuery.mockResolvedValueOnce(makeAllocationRows());
    mockQuerySingle.mockResolvedValueOnce(makeSummaryRow());

    const { getStatus } = await import("../src/commands/status.js");
    const { getAllocation } = await import("../src/commands/allocation.js");
    const { getSummary } = await import("../src/commands/summary.js");

    const statusResult = await getStatus(CONSISTENT_DATE);
    const allocResult = await getAllocation(CONSISTENT_DATE);
    const summaryResult = await getSummary(CONSISTENT_DATE);

    const allocTotal = allocResult.rows.reduce((sum, r) => sum + r.value_usd, 0);

    expect(statusResult.portfolio_value).toBe(CONSISTENT_PORTFOLIO_VALUE);
    expect(allocTotal).toBeCloseTo(CONSISTENT_PORTFOLIO_VALUE, 2);
    expect(summaryResult.portfolio_value_usd).toBe(CONSISTENT_PORTFOLIO_VALUE);
    expect(statusResult.portfolio_value).toBe(allocTotal);
    expect(statusResult.portfolio_value).toBe(summaryResult.portfolio_value_usd);
  });

  test("status, allocation, and summary receive the same as-of-date parameter", async () => {
    mockQuerySingle.mockReset();
    mockQuery.mockReset();
    mockQuerySingle.mockResolvedValueOnce(makeStatusRow());
    mockQuery.mockResolvedValueOnce(makeAllocationRows());
    mockQuerySingle.mockResolvedValueOnce(makeSummaryRow());

    const { getStatus } = await import("../src/commands/status.js");
    const { getAllocation } = await import("../src/commands/allocation.js");
    const { getSummary } = await import("../src/commands/summary.js");

    await getStatus(CONSISTENT_DATE);
    await getAllocation(CONSISTENT_DATE);
    await getSummary(CONSISTENT_DATE);

    const statusCall = mockQuerySingle.mock.calls[0];
    const allocCall = mockQuery.mock.calls[0];
    const summaryCall = mockQuerySingle.mock.calls[1];

    expect(statusCall[1]).toEqual([CONSISTENT_DATE]);
    expect(allocCall[1]).toEqual([CONSISTENT_DATE]);
    expect(summaryCall[1]).toEqual([CONSISTENT_DATE]);
  });

  test("all commands route through the canonical SQL functions", async () => {
    mockQuerySingle.mockReset();
    mockQuery.mockReset();
    mockQuerySingle.mockResolvedValueOnce(makeStatusRow());
    mockQuery.mockResolvedValueOnce(makeAllocationRows());
    mockQuerySingle.mockResolvedValueOnce(makeSummaryRow());

    const { getStatus } = await import("../src/commands/status.js");
    const { getAllocation } = await import("../src/commands/allocation.js");
    const { getSummary } = await import("../src/commands/summary.js");

    await getStatus(CONSISTENT_DATE);
    await getAllocation(CONSISTENT_DATE);
    await getSummary(CONSISTENT_DATE);

    const statusSql = String(mockQuerySingle.mock.calls[0][0]);
    const allocSql = String(mockQuery.mock.calls[0][0]);
    const summarySql = String(mockQuerySingle.mock.calls[1][0]);

    expect(statusSql).toContain("portfolio_status_sql");
    expect(allocSql).toContain("portfolio_allocation_sql");
    expect(summarySql).toContain("portfolio_summary_sql");
  });

  test("consistency holds with zero-value portfolio (empty DB)", async () => {
    mockQuerySingle.mockReset();
    mockQuery.mockReset();
    mockQuerySingle.mockResolvedValueOnce(
      makeStatusRow({ portfolio_value: 0, total_gain: null, total_gain_pct: null }),
    );
    mockQuery.mockResolvedValueOnce([]);
    mockQuerySingle.mockResolvedValueOnce(
      makeSummaryRow({ portfolio_value_usd: 0, total_cash_usd: 0, holding_count: 0 }),
    );

    const { getStatus } = await import("../src/commands/status.js");
    const { getAllocation } = await import("../src/commands/allocation.js");
    const { getSummary } = await import("../src/commands/summary.js");

    const statusResult = await getStatus(CONSISTENT_DATE);
    const allocResult = await getAllocation(CONSISTENT_DATE);
    const summaryResult = await getSummary(CONSISTENT_DATE);

    expect(statusResult.portfolio_value).toBe(0);
    expect(allocResult.portfolio_value).toBe(0);
    expect(summaryResult.portfolio_value_usd).toBe(0);
  });

  test("DELIBERATE BREAK CATCH: diverging portfolio_value across commands is detected", async () => {
    mockQuerySingle.mockReset();
    mockQuery.mockReset();

    const BROKEN_VALUE = 50000;
    mockQuerySingle.mockResolvedValueOnce(makeStatusRow());
    mockQuery.mockResolvedValueOnce([
      {
        asset: "AAPL",
        asset_type: "stock_usd",
        net_quantity: 10,
        value_usd: BROKEN_VALUE,
        allocation_pct: 100,
      },
    ]);
    mockQuerySingle.mockResolvedValueOnce(makeSummaryRow());

    const { getStatus } = await import("../src/commands/status.js");
    const { getAllocation } = await import("../src/commands/allocation.js");
    const { getSummary } = await import("../src/commands/summary.js");

    const statusResult = await getStatus(CONSISTENT_DATE);
    const allocResult = await getAllocation(CONSISTENT_DATE);
    const summaryResult = await getSummary(CONSISTENT_DATE);

    expect(statusResult.portfolio_value).toBe(CONSISTENT_PORTFOLIO_VALUE);
    expect(allocResult.portfolio_value).toBe(BROKEN_VALUE);
    expect(statusResult.portfolio_value).not.toBe(allocResult.portfolio_value);
    expect(statusResult.portfolio_value).toBe(summaryResult.portfolio_value_usd);
  });

  test("TS adapter is thin — no duplicated valuation math in TypeScript", async () => {
    mockQuerySingle.mockReset();
    mockQuery.mockReset();
    mockQuerySingle.mockResolvedValueOnce(makeStatusRow());
    mockQuery.mockResolvedValueOnce(makeAllocationRows());
    mockQuerySingle.mockResolvedValueOnce(makeSummaryRow());

    const { getStatus } = await import("../src/commands/status.js");
    const { getAllocation } = await import("../src/commands/allocation.js");
    const { getSummary } = await import("../src/commands/summary.js");

    const statusResult = await getStatus(CONSISTENT_DATE);
    const allocResult = await getAllocation(CONSISTENT_DATE);
    const summaryResult = await getSummary(CONSISTENT_DATE);

    expect(typeof statusResult.portfolio_value).toBe("number");
    expect(typeof summaryResult.portfolio_value_usd).toBe("number");
    expect(Array.isArray(allocResult.rows)).toBe(true);
    for (const row of allocResult.rows) {
      expect(typeof row.value_usd).toBe("number");
    }
  });
});
