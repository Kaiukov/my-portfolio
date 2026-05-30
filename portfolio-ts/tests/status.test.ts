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
  });
});
