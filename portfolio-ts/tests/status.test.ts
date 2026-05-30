import { describe, expect, test, mock } from "bun:test";

const mockQuerySingle = mock();
const mockQuery = mock();

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  connect: () => {},
  close: () => {},
}));

describe("getStatus", () => {
  test("returns status from portfolio_status_sql()", async () => {
    mockQuerySingle.mockResolvedValue({
      transactions_count: 42,
      start_date: "2024-01-15",
      end_date: "2026-03-20",
      portfolio_value: 125000.50,
      total_invested: 85000,
      deposits: 100000,
      withdrawals: 15000,
      income: 2500,
      fees: 120,
      taxes: 50,
      total_gain: 40000.50,
      total_gain_pct: 47.06,
      cost_basis: 60000,
      realized_gain: 5000,
      unrealized_gain: 35000.50,
      total_profit: 40000.50,
      as_of_date: "2026-03-20",
    });

    const { getStatus } = await import("../src/commands/status.js");
    const result = await getStatus();

    expect(result.transactions).toBe(42);
    expect(result.start_date).toBe("2024-01-15");
    expect(result.end_date).toBe("2026-03-20");
    expect(result.portfolio_value).toBe(125000.50);
    expect(result.total_invested).toBe(85000);
    expect(result.deposits).toBe(100000);
    expect(result.withdrawals).toBe(15000);
    expect(result.income).toBe(2500);
    expect(result.fees).toBe(120);
    expect(result.taxes).toBe(50);
    expect(result.total_gain).toBe(40000.50);
    expect(result.total_gain_pct).toBe(47.06);
    expect(result.as_of_date).toBe("2026-03-20");
  });

  test("handles empty database gracefully", async () => {
    mockQuerySingle.mockResolvedValue(null);

    const { getStatus } = await import("../src/commands/status.js");
    const result = await getStatus();

    expect(result.transactions).toBe(0);
    expect(result.portfolio_value).toBeNull();
    expect(result.total_gain).toBeNull();
    expect(result.total_gain_pct).toBeNull();
    expect(result.deposits).toBe(0);
    expect(result.withdrawals).toBe(0);
    expect(result.income).toBe(0);
    expect(result.fees).toBe(0);
    expect(result.taxes).toBe(0);
    expect(result.cost_basis).toBeNull();
    expect(result.realized_gain).toBeNull();
    expect(result.unrealized_gain).toBeNull();
    expect(result.total_profit).toBeNull();
  });
});

describe("getStatus — FIFO cost basis regression (#66)", () => {
  test("surfaces cost_basis, realized_gain, unrealized_gain, total_profit", async () => {
    // Hand-calculated fixture:
    // BUY 10 AAPL@100 fee5  -> lot cost $1005 (100.50/unit)
    // BUY 10 AAPL@120 fee5  -> lot cost $1205 (120.50/unit)
    // SELL 14 AAPL@150 fee7 -> proceeds $2093
    // FIFO: consume 10@100.50 + 4@120.50, cost consumed = 1005+482=1487
    // realized_gain = 2093-1487 = 606
    // remaining: 6@120.50, cost_basis = 723
    // market price $130 -> value = 6*130 = 780
    // unrealized_gain = 780-723 = 57
    // total_profit = 606+57 = 663
    mockQuerySingle.mockResolvedValue({
      transactions_count: 3,
      start_date: "2026-01-01",
      end_date: "2026-01-03",
      portfolio_value: 780,
      total_invested: 1000,
      deposits: 1000,
      withdrawals: 0,
      income: 0,
      fees: 17,
      taxes: 0,
      total_gain: 100,
      total_gain_pct: 10,
      cost_basis: 723,
      realized_gain: 606,
      unrealized_gain: 57,
      total_profit: 663,
      as_of_date: "2026-01-03",
    });

    const { getStatus } = await import("../src/commands/status.js");
    const result = await getStatus();

    expect(result.cost_basis).toBe(723);
    expect(result.realized_gain).toBe(606);
    expect(result.unrealized_gain).toBe(57);
    expect(result.total_profit).toBe(663);
  });

  test("total_profit = realized_gain + unrealized_gain", async () => {
    mockQuerySingle.mockResolvedValue({
      transactions_count: 1,
      start_date: "2026-01-01",
      end_date: "2026-01-01",
      portfolio_value: 5000,
      total_invested: 4000,
      deposits: 5000,
      withdrawals: 1000,
      income: 0,
      fees: 0,
      taxes: 0,
      total_gain: 1000,
      total_gain_pct: 25,
      cost_basis: 3500,
      realized_gain: 800,
      unrealized_gain: 1500,
      total_profit: 2300,
      as_of_date: "2026-01-01",
    });

    const { getStatus } = await import("../src/commands/status.js");
    const result = await getStatus();

    expect(result.total_profit).toBe(result.realized_gain! + result.unrealized_gain!);
  });
});
